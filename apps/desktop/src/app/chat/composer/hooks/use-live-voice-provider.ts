import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  ComposerLiveVoiceProvider,
  ComposerLiveVoiceSession,
  ComposerLiveVoiceState,
  LiveVoiceStatus
} from '../contrib'

interface LiveVoiceProviderOptions {
  enabled: boolean
  ensureSessionId: () => Promise<null | string>
  onFatalError: (error: unknown) => void
  onTranscript: (role: 'assistant' | 'user', text: string) => void
  provider: ComposerLiveVoiceProvider | null
  sessionId: null | string | undefined
}

export function useLiveVoiceProvider({
  enabled,
  ensureSessionId,
  onFatalError,
  onTranscript,
  provider,
  sessionId
}: LiveVoiceProviderOptions) {
  const [state, setState] = useState<Required<ComposerLiveVoiceState>>({ level: 0, muted: false, status: 'idle' })
  const liveRef = useRef<ComposerLiveVoiceSession | null>(null)
  const generationRef = useRef(0)

  const applyState = useCallback((next: ComposerLiveVoiceState) => {
    setState(current => ({
      level: next.level ?? current.level,
      muted: next.muted ?? current.muted,
      status: (next.status ?? current.status) as LiveVoiceStatus
    }))
  }, [])

  const end = useCallback(async () => {
    generationRef.current += 1
    const live = liveRef.current
    liveRef.current = null
    await live?.end()
    setState({ level: 0, muted: false, status: 'idle' })
  }, [])

  const start = useCallback(async () => {
    if (!provider) {
      return
    }

    const generation = ++generationRef.current
    const resolvedSessionId = sessionId || (await ensureSessionId())

    // Creating a session updates the active-session state and may rerender this
    // hook. If that cleanup superseded this start, let the new generation own
    // the provider instead of opening two WebRTC sessions.
    if (generation !== generationRef.current) {
      return
    }

    if (!resolvedSessionId) {
      throw new Error('Hermes could not create a session for live voice.')
    }

    const live = provider.create({
      sessionId: resolvedSessionId,
      onError: error => {
        if (generation === generationRef.current) {
          onFatalError(error)
        }
      },
      onTranscript,
      onState: next => {
        if (generation === generationRef.current) {
          applyState(next)
        }
      }
    })

    liveRef.current = live
    await live.start()
  }, [applyState, ensureSessionId, onFatalError, onTranscript, provider, sessionId])

  useEffect(() => {
    if (!provider || !enabled) {
      return
    }

    void start().catch(onFatalError)

    return () => {
      void end()
    }
  }, [enabled, end, onFatalError, provider, start])

  return {
    end,
    level: state.level,
    muted: state.muted,
    start,
    status: state.status,
    stopTurn: () => liveRef.current?.stopTurn(),
    toggleMute: () => liveRef.current?.toggleMute()
  }
}
