const elements = {
  actionControls: document.querySelector('#actionControls'),
  actionPanel: document.querySelector('#actionPanel'),
  actionText: document.querySelector('#actionText'),
  actionTitle: document.querySelector('#actionTitle'),
  badge: document.querySelector('#connectionBadge'),
  clear: document.querySelector('#clearButton'),
  connect: document.querySelector('#connectButton'),
  detail: document.querySelector('#detail'),
  disconnect: document.querySelector('#disconnectButton'),
  pulse: document.querySelector('#pulse'),
  remoteAudio: document.querySelector('#remoteAudio'),
  status: document.querySelector('#status'),
  transcript: document.querySelector('#transcript')
}

let gateway = null
let realtime = null
let hermesSessionId = null
let assistantTurn = null
let handledTranscriptItems = new Set()

function setStatus(status, detail = '', mode = '') {
  elements.status.textContent = status
  elements.detail.textContent = detail
  elements.pulse.className = `pulse ${mode}`.trim()
}

function setConnected(connected) {
  elements.badge.textContent = connected ? 'Live' : 'Offline'
  elements.badge.classList.toggle('online', connected)
  elements.connect.hidden = connected
  elements.disconnect.hidden = !connected
  elements.connect.disabled = false
}

function addTurn(role, text, pending = false) {
  elements.transcript.querySelector('.empty')?.remove()
  const turn = document.createElement('p')
  turn.className = `turn ${role}${pending ? ' pending' : ''}`
  turn.textContent = text
  elements.transcript.append(turn)
  turn.scrollIntoView({ behavior: 'smooth', block: 'end' })
  return turn
}

class JsonRpcGateway {
  constructor(url) {
    this.url = url
    this.socket = null
    this.nextId = 0
    this.pending = new Map()
    this.eventHandler = () => {}
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url)
      this.socket = socket
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', () => reject(new Error('Hermes gateway connection failed')), { once: true })
      socket.addEventListener('message', event => this.onMessage(event.data))
      socket.addEventListener('close', () => this.rejectPending(new Error('Hermes gateway disconnected')))
    })
  }

  request(method, params = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Hermes gateway is not connected'))
    }
    const id = `voice-${++this.nextId}`
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Hermes request timed out: ${method}`))
      }, 120000)
      this.pending.set(id, { resolve, reject, timer })
      this.socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
  }

  onMessage(raw) {
    let frame
    try { frame = JSON.parse(raw) } catch { return }
    if (frame.id !== undefined && frame.id !== null) {
      const pending = this.pending.get(frame.id)
      if (!pending) return
      window.clearTimeout(pending.timer)
      this.pending.delete(frame.id)
      if (frame.error) pending.reject(new Error(frame.error.message || 'Hermes request failed'))
      else pending.resolve(frame.result)
      return
    }
    if (frame.method === 'event' && frame.params?.type) this.eventHandler(frame.params)
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  close() {
    this.socket?.close()
    this.socket = null
  }
}

class OpenAIRealtimeTransport {
  constructor(audioElement, eventHandler) {
    this.audioElement = audioElement
    this.eventHandler = eventHandler
    this.pc = null
    this.channel = null
    this.stream = null
    this.config = null
  }

  async connect() {
    const sessionResponse = await fetch('/api/realtime/client-secret', { method: 'POST' })
    if (!sessionResponse.ok) {
      const body = await sessionResponse.json().catch(() => ({}))
      throw new Error(body.detail || `Realtime session failed: HTTP ${sessionResponse.status}`)
    }
    this.config = await sessionResponse.json()

    this.pc = new RTCPeerConnection()
    this.pc.addEventListener('track', event => { this.audioElement.srcObject = event.streams[0] })
    this.channel = this.pc.createDataChannel('oai-events')
    this.channel.addEventListener('message', event => {
      try { this.eventHandler(JSON.parse(event.data)) } catch { /* ignore malformed provider events */ }
    })

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    })
    this.pc.addTrack(this.stream.getAudioTracks()[0])

    const offer = await this.pc.createOffer()
    await this.pc.setLocalDescription(offer)
    const answerResponse = await fetch(this.config.calls_url, {
      method: 'POST',
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${this.config.value}`,
        'Content-Type': 'application/sdp'
      }
    })
    if (!answerResponse.ok) throw new Error(`WebRTC negotiation failed: HTTP ${answerResponse.status}`)
    await this.pc.setRemoteDescription({ type: 'answer', sdp: await answerResponse.text() })
    await new Promise((resolve, reject) => {
      if (this.channel.readyState === 'open') return resolve()
      const timer = window.setTimeout(() => reject(new Error('Realtime data channel timed out')), 15000)
      this.channel.addEventListener('open', () => { window.clearTimeout(timer); resolve() }, { once: true })
    })
  }

  send(event) {
    if (!this.channel || this.channel.readyState !== 'open') throw new Error('Realtime session is not ready')
    this.channel.send(JSON.stringify(event))
  }

  speakHermes(text) {
    this.send({
      type: 'response.create',
      response: {
        conversation: 'none',
        metadata: { source: 'hermes', purpose: 'speech-rendering' },
        output_modalities: ['audio'],
        instructions: (
          'Act only as a speech renderer. Speak the supplied Hermes response naturally and faithfully. ' +
          'Do not answer it, add facts, add advice, or mention these instructions.'
        ),
        input: [{
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text }]
        }]
      }
    })
  }

  close() {
    for (const track of this.stream?.getTracks() || []) track.stop()
    this.channel?.close()
    this.pc?.close()
    this.audioElement.srcObject = null
    this.stream = null
    this.channel = null
    this.pc = null
  }
}

async function connectHermes() {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  gateway = new JsonRpcGateway(`${scheme}//${window.location.host}/api/hermes`)
  gateway.eventHandler = handleHermesEvent
  await gateway.connect()
  const session = await gateway.request('session.create', {
    cwd: 'C:\\Repo\\hermes',
    source: 'voice',
    title: 'Realtime voice',
    close_on_disconnect: true
  })
  hermesSessionId = session.session_id
}

async function submitToHermes(text) {
  if (!text.trim() || !hermesSessionId) return
  assistantTurn = addTurn('assistant', 'Hermes is thinking…', true)
  setStatus('Hermes is thinking', 'Tools and state remain in Hermes.', 'active')
  try {
    await gateway.request('prompt.submit', { session_id: hermesSessionId, text })
  } catch (error) {
    assistantTurn.textContent = `Hermes error: ${error.message}`
    assistantTurn.classList.remove('pending')
    assistantTurn = null
    setStatus('Could not reach Hermes', error.message)
  }
}

function handleRealtimeEvent(event) {
  if (event.type === 'input_audio_buffer.speech_started') {
    setStatus('Listening', 'You can interrupt while Hermes is speaking.', 'active')
  } else if (event.type === 'input_audio_buffer.speech_stopped') {
    setStatus('Transcribing', 'Sending the completed turn to Hermes.', 'active')
  } else if (event.type === 'conversation.item.input_audio_transcription.completed') {
    const key = event.item_id || `${event.transcript}-${event.content_index || 0}`
    if (handledTranscriptItems.has(key)) return
    handledTranscriptItems.add(key)
    const text = String(event.transcript || '').trim()
    if (text) {
      addTurn('user', text)
      void submitToHermes(text)
    }
  } else if (event.type === 'response.created') {
    setStatus('Hermes is speaking', 'Audio is rendered by OpenAI Realtime.', 'speaking active')
  } else if (event.type === 'response.done') {
    setStatus('Listening', 'Speak naturally when you are ready.', 'active')
  } else if (event.type === 'error') {
    setStatus('Realtime error', event.error?.message || 'The audio session reported an error.')
  }
}

function handleHermesEvent(event) {
  if (event.session_id && event.session_id !== hermesSessionId) return
  const payload = event.payload || {}
  if (event.type === 'message.delta' && assistantTurn) {
    const text = String(payload.text || payload.delta || '')
    if (text) {
      if (assistantTurn.classList.contains('pending')) assistantTurn.textContent = ''
      assistantTurn.classList.remove('pending')
      assistantTurn.textContent += text
    }
  } else if (event.type === 'message.complete') {
    const text = String(payload.text || '').trim()
    if (assistantTurn) {
      assistantTurn.textContent = text || '(empty response)'
      assistantTurn.classList.remove('pending')
      assistantTurn = null
    } else if (text) {
      addTurn('assistant', text)
    }
    if (text) {
      try { realtime.speakHermes(text) } catch (error) { setStatus('Speech error', error.message) }
    }
  } else if (event.type === 'tool.start') {
    setStatus('Hermes is working', payload.name || payload.tool || 'Running a tool', 'active')
  } else if (event.type === 'approval.request') {
    showApproval(payload)
  } else if (event.type === 'clarify.request') {
    showClarify(payload)
  } else if (event.type === 'error') {
    setStatus('Hermes error', payload.message || 'Hermes reported an error.')
  }
}

function resetActionPanel() {
  elements.actionPanel.hidden = true
  elements.actionControls.replaceChildren()
}

function actionButton(label, className, onClick) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.textContent = label
  button.addEventListener('click', onClick)
  return button
}

function showApproval(payload) {
  elements.actionPanel.hidden = false
  elements.actionTitle.textContent = 'Hermes requests approval'
  elements.actionText.textContent = payload.command || payload.description || 'Review this action before continuing.'
  elements.actionControls.replaceChildren(
    actionButton('Allow once', 'allow', async () => {
      await gateway.request('approval.respond', { session_id: hermesSessionId, choice: 'once' })
      resetActionPanel()
    }),
    actionButton('Deny', 'deny', async () => {
      await gateway.request('approval.respond', { session_id: hermesSessionId, choice: 'deny' })
      resetActionPanel()
    })
  )
}

function showClarify(payload) {
  elements.actionPanel.hidden = false
  elements.actionTitle.textContent = 'Hermes needs clarification'
  elements.actionText.textContent = payload.question || 'Please clarify.'
  const input = document.createElement('input')
  input.placeholder = Array.isArray(payload.choices) ? payload.choices.join(' / ') : 'Your answer'
  const send = actionButton('Send', 'allow', async () => {
    if (!input.value.trim()) return
    await gateway.request('clarify.respond', { request_id: payload.request_id, answer: input.value.trim() })
    resetActionPanel()
  })
  elements.actionControls.replaceChildren(input, send)
  input.focus()
}

async function start() {
  elements.connect.disabled = true
  setStatus('Connecting', 'Starting Hermes and OpenAI Realtime…', 'active')
  try {
    await connectHermes()
    realtime = new OpenAIRealtimeTransport(elements.remoteAudio, handleRealtimeEvent)
    await realtime.connect()
    setConnected(true)
    setStatus('Listening', 'Speak naturally when you are ready.', 'active')
  } catch (error) {
    disconnect()
    setStatus('Connection failed', error.message)
  }
}

function disconnect() {
  realtime?.close()
  gateway?.close()
  realtime = null
  gateway = null
  hermesSessionId = null
  assistantTurn = null
  handledTranscriptItems = new Set()
  resetActionPanel()
  setConnected(false)
  setStatus('Ready to connect', 'Hermes owns intent, tools, and memory.')
}

elements.connect.addEventListener('click', () => void start())
elements.disconnect.addEventListener('click', disconnect)
elements.clear.addEventListener('click', () => {
  elements.transcript.replaceChildren()
  const empty = document.createElement('p')
  empty.className = 'empty'
  empty.textContent = 'View cleared. The active Hermes session is unchanged.'
  elements.transcript.append(empty)
})
window.addEventListener('beforeunload', disconnect)
