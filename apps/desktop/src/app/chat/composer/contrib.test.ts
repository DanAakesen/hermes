import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { registry } from '@/contrib/registry'

import {
  COMPOSER_AREAS,
  type ComposerLiveVoiceProvider,
  type ComposerMiddleware,
  runComposerMiddleware,
  useComposerLiveVoiceProvider
} from './contrib'

const disposers: Array<() => void> = []

function addMiddleware(id: string, handler: ComposerMiddleware['handler'], order?: number) {
  disposers.push(
    registry.register({ id, area: COMPOSER_AREAS.middleware, order, data: { handler } satisfies ComposerMiddleware })
  )
}

afterEach(() => {
  disposers.splice(0).forEach(d => d())
})

describe('runComposerMiddleware', () => {
  it('passes the draft through untouched when nothing is registered', async () => {
    const draft = { text: 'hello' }

    expect(await runComposerMiddleware(draft)).toBe(draft)
  })

  it('chains rewrites in registry order', async () => {
    addMiddleware('b', d => ({ ...d, text: `${d.text}b` }), 20)
    addMiddleware('a', d => ({ ...d, text: `${d.text}a` }), 10)

    expect(await runComposerMiddleware({ text: 'x' })).toEqual({ text: 'xab' })
  })

  it('cancels the send when a handler returns null', async () => {
    addMiddleware('gate', () => null)
    addMiddleware('later', d => ({ ...d, text: 'never' }), 99)

    expect(await runComposerMiddleware({ text: 'x' })).toBeNull()
  })

  it('treats a throwing handler as pass-through', async () => {
    addMiddleware('boom', () => {
      throw new Error('broken plugin')
    })
    addMiddleware('after', d => ({ ...d, text: `${d.text}!` }), 99)

    expect(await runComposerMiddleware({ text: 'x' })).toEqual({ text: 'x!' })
  })

  it('supports async handlers', async () => {
    addMiddleware('async', async d => ({ ...d, text: d.text.toUpperCase() }))

    expect(await runComposerMiddleware({ text: 'quiet' })).toEqual({ text: 'QUIET' })
  })
})

describe('useComposerLiveVoiceProvider', () => {
  it('returns no provider when no live voice contribution is registered', () => {
    const { result } = renderHook(() => useComposerLiveVoiceProvider())

    expect(result.current).toBeNull()
  })

  it('selects the highest-priority valid provider', () => {
    const create = () => ({ start: async () => {}, end: () => {}, stopTurn: () => {}, toggleMute: () => {} })
    const fallback = { label: 'Fallback', create } satisfies ComposerLiveVoiceProvider
    const preferred = { label: 'Preferred', create } satisfies ComposerLiveVoiceProvider

    disposers.push(
      registry.register({ id: 'fallback', area: COMPOSER_AREAS.liveVoice, order: 10, data: fallback }),
      registry.register({ id: 'preferred', area: COMPOSER_AREAS.liveVoice, order: -10, data: preferred })
    )

    const { result } = renderHook(() => useComposerLiveVoiceProvider())

    expect(result.current).toBe(preferred)
  })
})
