import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { ComposerLiveVoiceProvider } from '../contrib'

import { useLiveVoiceProvider } from './use-live-voice-provider'

function providerHarness() {
  const start = vi.fn(async () => undefined)
  const end = vi.fn(async () => undefined)

  const create = vi.fn((_context: Parameters<ComposerLiveVoiceProvider['create']>[0]) => ({
    end,
    start,
    stopTurn: vi.fn(),
    toggleMute: vi.fn()
  }))

  return {
    create,
    end,
    provider: { create, label: 'Realtime test' } satisfies ComposerLiveVoiceProvider,
    start
  }
}

describe('useLiveVoiceProvider', () => {
  it('creates a Hermes session before starting voice from a fresh chat', async () => {
    const ensureSessionId = vi.fn(async () => 'runtime-new')
    const harness = providerHarness()
    const onFatalError = vi.fn()

    renderHook(() =>
      useLiveVoiceProvider({
        enabled: true,
        ensureSessionId,
        onFatalError,
        onTranscript: vi.fn(),
        provider: harness.provider,
        sessionId: null
      })
    )

    await waitFor(() => expect(harness.start).toHaveBeenCalledOnce())

    expect(ensureSessionId).toHaveBeenCalledOnce()
    expect(harness.create.mock.calls[0]?.[0].sessionId).toBe('runtime-new')
    expect(onFatalError).not.toHaveBeenCalled()
  })

  it('uses an existing Hermes session without creating another one', async () => {
    const ensureSessionId = vi.fn(async () => 'runtime-wrong')
    const harness = providerHarness()

    renderHook(() =>
      useLiveVoiceProvider({
        enabled: true,
        ensureSessionId,
        onFatalError: vi.fn(),
        onTranscript: vi.fn(),
        provider: harness.provider,
        sessionId: 'runtime-existing'
      })
    )

    await waitFor(() => expect(harness.start).toHaveBeenCalledOnce())

    expect(ensureSessionId).not.toHaveBeenCalled()
    expect(harness.create.mock.calls[0]?.[0].sessionId).toBe('runtime-existing')
  })

  it('surfaces a failed fresh-session creation without opening voice', async () => {
    const ensureSessionId = vi.fn(async () => null)
    const harness = providerHarness()
    const onFatalError = vi.fn()

    renderHook(() =>
      useLiveVoiceProvider({
        enabled: true,
        ensureSessionId,
        onFatalError,
        onTranscript: vi.fn(),
        provider: harness.provider,
        sessionId: null
      })
    )

    await waitFor(() => expect(onFatalError).toHaveBeenCalledOnce())

    expect(harness.create).not.toHaveBeenCalled()
  })
})
