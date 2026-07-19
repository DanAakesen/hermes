import { COMPOSER_AREAS, host } from '@hermes/plugin-sdk'

const provider = {
  label: 'OpenAI Realtime',
  create(context) {
    let pc = null
    let dc = null
    let stream = null
    let audio = null
    let audioContext = null
    let analyser = null
    let playbackSource = null
    let playbackPromise = null
    let levelFrame = 0
    let muted = false
    let closed = false
    let speechActive = false
    let activeResponse = false
    let outputAudioActive = false
    let pendingContinuation = false
    let responseCreatePending = false
    let activeContinuation = false
    let continuationRetryCount = 0
    let continuationTimer = 0
    const handledCalls = new Set()

    const state = next => context.onState(next)
    const persistedTraceEvents = new Set([
      'session.ready',
      'tool.complete',
      'response.create',
      'response.created',
      'response.done',
      'response.cancelled',
      'audio.started',
      'audio.stopped',
      'speech.started',
      'speech.stopped',
      'playback.ready',
      'playback.error'
    ])
    // Electron forwards renderer warnings into desktop.log. Keep this as
    // metadata-only prototype telemetry: never include transcript, arguments,
    // tool output, or credentials.
    const trace = (event, details = {}) => {
      console.warn(`[gpt-realtime-voice] ${event}`, details)
      if (!persistedTraceEvents.has(event)) return
      void context
        .rest('/event', {
          method: 'POST',
          body: {
            event,
            tool: typeof details.name === 'string' ? details.name : undefined,
            outcome: typeof details.ok === 'boolean' ? (details.ok ? 'ok' : 'error') : undefined
          },
          timeoutMs: 2_000
        })
        .catch(() => undefined)
    }
    const send = event => {
      if (dc?.readyState !== 'open') {
        throw new Error('Realtime control channel is not open')
      }
      dc.send(JSON.stringify(event))
    }

    const recoverableError = error => {
      const normalized = error instanceof Error ? error : new Error(String(error))
      console.warn('[gpt-realtime-voice] recoverable Realtime event', normalized)
      host.notifyError(normalized, 'Realtime voice recovered')
      if (!closed) state({ status: speechActive ? 'listening' : 'idle' })
    }

    const ensurePlayback = () => {
      if (!audio || closed) return Promise.resolve()
      if (playbackPromise) return playbackPromise

      playbackPromise = (async () => {
        try {
          if (audioContext?.state === 'suspended') {
            await audioContext.resume()
          }
          await audio.play()
          trace('playback.ready')
        } catch (error) {
          trace('playback.error', { ok: false })
          context.onError(error instanceof Error ? error : new Error(String(error)))
        } finally {
          playbackPromise = null
        }
      })()

      return playbackPromise
    }

    const continueWhenIdle = () => {
      if (
        !pendingContinuation ||
        closed ||
        dc?.readyState !== 'open' ||
        activeResponse ||
        responseCreatePending ||
        speechActive ||
        outputAudioActive
      ) {
        return
      }
      clearTimeout(continuationTimer)
      continuationTimer = 0
      responseCreatePending = true
      send({
        type: 'response.create',
        response: {
          output_modalities: ['audio'],
          instructions:
            'Continue the current Hermes turn. The immediately preceding function_call_output contains the completed Hermes tool result. Answer the user\'s original request aloud now using that result. Do not stay silent or merely acknowledge the tool call. Be concise and natural.'
        }
      })
      trace('response.create', { reason: 'tool-continuation' })
      state({ status: 'thinking' })
    }

    const toolOutputEnvelope = (name, ok, value) => {
      let result = String(value || '')
      try {
        result = JSON.parse(result)
      } catch {
        // Plain-text tool results remain strings inside the stable envelope.
      }
      return JSON.stringify({
        status: ok ? 'success' : 'error',
        tool: name,
        result,
        response_instruction: 'Answer the user\'s pending request aloud using this result.'
      })
    }

    const appendTranscript = (role, text) => {
      const clean = String(text || '').trim()
      if (!clean || closed) return
      context.onTranscript(role, clean)
      void host.request('live.transcript.append', {
        session_id: context.sessionId,
        role,
        text: clean
      }).catch(context.onError)
    }

    const executeTool = async event => {
      const callId = String(event.call_id || event.item_id || '')
      const name = String(event.name || '')
      if (!callId || !name || handledCalls.has(callId)) return
      handledCalls.add(callId)
      continuationRetryCount = 0
      trace('tool.start', { callId, name })
      state({ status: 'thinking' })

      let args
      try {
        args = JSON.parse(event.arguments || '{}')
      } catch {
        args = {}
      }

      try {
        const result = await host.request('live.tool.execute', {
          session_id: context.sessionId,
          call_id: callId,
          name,
          arguments: args
        })
        send({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: toolOutputEnvelope(name, true, result.output)
          }
        })
        pendingContinuation = true
        trace('tool.complete', { callId, name, ok: true })
      } catch (error) {
        send({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: toolOutputEnvelope(
              name,
              false,
              JSON.stringify({ error: error instanceof Error ? error.message : String(error) })
            )
          }
        })
        pendingContinuation = true
        trace('tool.complete', { callId, name, ok: false })
      }

      continueWhenIdle()
    }

    const handleEvent = event => {
      switch (event.type) {
        case 'input_audio_buffer.speech_started':
          speechActive = true
          continuationRetryCount = 0
          clearTimeout(continuationTimer)
          continuationTimer = 0
          trace('speech.started')
          state({ status: 'listening' })
          break
        case 'input_audio_buffer.speech_stopped':
          speechActive = false
          trace('speech.stopped')
          state({ status: 'thinking' })
          // Give server VAD a moment to create the user's response first. If
          // it does not, make sure a completed Hermes tool result cannot stay
          // stranded waiting for another utterance.
          clearTimeout(continuationTimer)
          continuationTimer = setTimeout(continueWhenIdle, 250)
          break
        case 'response.created':
          clearTimeout(continuationTimer)
          continuationTimer = 0
          activeResponse = true
          activeContinuation = responseCreatePending
          pendingContinuation = false
          responseCreatePending = false
          trace('response.created')
          state({ status: 'thinking' })
          break
        case 'output_audio_buffer.started':
          outputAudioActive = true
          trace('audio.started')
          void ensurePlayback()
          state({ status: 'speaking' })
          break
        case 'response.output_audio.done':
          // Audio generation can finish while WebRTC is still playing the
          // acknowledgement. The post-tool response must wait for the actual
          // output buffer to stop, otherwise Realtime can complete it empty.
          break
        case 'response.output_audio.started':
          trace('audio.started')
          void ensurePlayback()
          state({ status: 'speaking' })
          break
        case 'output_audio_buffer.stopped':
          outputAudioActive = false
          trace('audio.stopped')
          state({ status: muted ? 'idle' : 'listening' })
          continueWhenIdle()
          break
        case 'output_audio_buffer.cleared':
          outputAudioActive = false
          activeResponse = false
          activeContinuation = false
          responseCreatePending = false
          trace('response.cancelled')
          state({ status: muted ? 'idle' : 'listening' })
          continueWhenIdle()
          break
        case 'response.cancelled':
          activeResponse = false
          activeContinuation = false
          responseCreatePending = false
          trace('response.cancelled')
          state({ status: muted ? 'idle' : 'listening' })
          continueWhenIdle()
          break
        case 'conversation.item.input_audio_transcription.completed':
          appendTranscript('user', event.transcript)
          break
        case 'response.output_audio_transcript.done':
        case 'response.audio_transcript.done':
          appendTranscript('assistant', event.transcript)
          break
        case 'response.done': {
          activeResponse = false
          responseCreatePending = false
          const output = event.response?.output || []
          const calls = output.filter(item => item.type === 'function_call')
          const wasContinuation = activeContinuation
          activeContinuation = false
          trace('response.done', { callCount: calls.length, status: event.response?.status || 'unknown' })
          for (const call of calls) {
            void executeTool(call).catch(recoverableError)
          }
          if (calls.length === 0) {
            const hasSpokenOutput = output.some(
              item => item.type === 'message' && Array.isArray(item.content) && item.content.length > 0
            )
            if (wasContinuation && !hasSpokenOutput && continuationRetryCount < 1) {
              continuationRetryCount += 1
              pendingContinuation = true
              continueWhenIdle()
              break
            }
            state({ status: muted ? 'idle' : 'listening' })
            continueWhenIdle()
          }
          break
        }
        case 'error':
          recoverableError(new Error(event.error?.message || 'OpenAI Realtime session error'))
          break
      }
    }

    const startMeter = () => {
      if (!audioContext || !analyser || !stream) return
      const source = audioContext.createMediaStreamSource(stream)
      source.connect(analyser)
      const values = new Uint8Array(analyser.fftSize)
      const tick = () => {
        if (closed || !analyser) return
        analyser.getByteTimeDomainData(values)
        let sum = 0
        for (const value of values) {
          const sample = (value - 128) / 128
          sum += sample * sample
        }
        state({ level: Math.min(1, Math.sqrt(sum / values.length) * 4) })
        levelFrame = requestAnimationFrame(tick)
      }
      tick()
    }

    const end = async () => {
      if (closed) return
      closed = true
      cancelAnimationFrame(levelFrame)
      clearTimeout(continuationTimer)
      playbackSource?.disconnect()
      dc?.close()
      pc?.close()
      stream?.getTracks().forEach(track => track.stop())
      audio?.pause()
      audio && (audio.srcObject = null)
      await audioContext?.close().catch(() => undefined)
      pc = null
      dc = null
      stream = null
      analyser = null
      playbackSource = null
      playbackPromise = null
      state({ level: 0, muted: false, status: 'idle' })
    }

    return {
      async start() {
        closed = false
        state({ level: 0, muted: false, status: 'thinking' })

        const description = await host.request('live.session.describe', { session_id: context.sessionId })
        const bootstrap = await context.rest('/session', {
          method: 'POST',
          body: { instructions: description.instructions, tools: description.tools },
          timeoutMs: 30_000
        })

        stream = await navigator.mediaDevices.getUserMedia({
          audio: { autoGainControl: true, echoCancellation: true, noiseSuppression: true }
        })
        audioContext = new AudioContext()
        analyser = audioContext.createAnalyser()
        analyser.fftSize = 256
        if (audioContext.state === 'suspended') {
          await audioContext.resume()
        }

        pc = new RTCPeerConnection()
        audio = new Audio()
        audio.autoplay = true
        audio.playsInline = true
        audio.volume = 1
        try {
          playbackSource = audioContext.createMediaElementSource(audio)
          playbackSource.connect(audioContext.destination)
        } catch (error) {
          // The HTML media element still has its native output path if a
          // platform cannot expose MediaStream audio through Web Audio.
          console.warn('[gpt-realtime-voice] Web Audio playback route unavailable', error)
        }
        pc.ontrack = event => {
          audio.srcObject = event.streams[0] || new MediaStream([event.track])
          void ensurePlayback()
        }
        stream.getTracks().forEach(track => pc.addTrack(track, stream))
        dc = pc.createDataChannel('oai-events')
        dc.onmessage = message => {
          try {
            handleEvent(JSON.parse(String(message.data)))
          } catch (error) {
            recoverableError(error)
          }
        }
        dc.onerror = () => context.onError(new Error('Realtime control channel failed'))
        dc.onclose = () => {
          if (!closed) context.onError(new Error('Realtime control channel closed'))
        }
        pc.onconnectionstatechange = () => {
          if (pc?.connectionState === 'failed' && !closed) {
            context.onError(new Error('Realtime media connection failed'))
          }
        }

        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        const response = await fetch(bootstrap.calls_url, {
          method: 'POST',
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${bootstrap.value}`,
            'Content-Type': 'application/sdp'
          }
        })
        if (!response.ok) throw new Error(`OpenAI Realtime connection failed (HTTP ${response.status})`)
        await pc.setRemoteDescription({ type: 'answer', sdp: await response.text() })

        startMeter()
        trace('session.ready')
        state({ status: 'listening' })
      },
      end,
      stopTurn() {
        if (dc?.readyState !== 'open') return
        send({ type: 'input_audio_buffer.commit' })
        send({ type: 'response.create' })
        state({ status: 'thinking' })
      },
      toggleMute() {
        muted = !muted
        stream?.getAudioTracks().forEach(track => {
          track.enabled = !muted
        })
        state({ muted, status: muted ? 'idle' : 'listening' })
      }
    }
  }
}

export default {
  id: 'gpt-realtime-voice',
  name: 'GPT Realtime Voice',
  defaultEnabled: true,
  register(context) {
    // Give the provider its scoped authenticated REST door without exposing
    // the standard OpenAI key to the renderer.
    const liveProvider = {
      ...provider,
      create(options) {
        return provider.create({ ...options, rest: context.rest })
      }
    }
    context.register({
      id: 'live-provider',
      area: COMPOSER_AREAS.liveVoice,
      order: -100,
      data: liveProvider
    })
  }
}
