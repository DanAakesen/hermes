/**
 * Composer contribution surface — every seam of the composer is hook-into-able
 * through the SAME registry schema as every other surface (statusbar, titlebar,
 * panes, layouts):
 *
 *   render areas (`render`):  composer.top      — banner strip above the input
 *                             composer.bottom   — row below the input grid
 *                             composer.leading  — inline after the "+" menu
 *                             composer.actions  — inline before the model pill
 *
 *   data kinds (`data`):      composer.middleware   (ComposerMiddleware)
 *                             composer.attachments  (ComposerAttachmentProvider)
 *                             composer.liveVoice    (ComposerLiveVoiceProvider)
 *
 * Core keeps ownership of the transcript, input, and submit engine — these
 * seams AUGMENT the composer, they never replace it. Middleware runs as an
 * ordered async chain around the app's onSubmit: each handler may rewrite the
 * draft, pass it through, or cancel the send by returning null.
 */

import { useContributions } from '@/contrib/react/use-contributions'
import { registry } from '@/contrib/registry'
import type { ComposerAttachment } from '@/store/composer'

export const COMPOSER_AREAS = {
  top: 'composer.top',
  bottom: 'composer.bottom',
  leading: 'composer.leading',
  actions: 'composer.actions',
  middleware: 'composer.middleware',
  attachments: 'composer.attachments',
  liveVoice: 'composer.liveVoice'
} as const

export interface ComposerDraft {
  text: string
  attachments?: ComposerAttachment[]
}

/** Payload of a `composer.middleware` data contribution. */
export interface ComposerMiddleware {
  /** Rewrite (return a draft), pass through (same draft), or cancel (null). */
  handler: (draft: ComposerDraft) => ComposerDraft | null | Promise<ComposerDraft | null>
}

export interface ComposerAttachmentContext {
  insertText: (text: string) => void
}

/** Payload of a `composer.attachments` data contribution — an entry in the
 *  composer's "+" attach menu. */
export interface ComposerAttachmentProvider {
  label: string
  /** Codicon name for the menu row. Defaults to `plug`. */
  icon?: string
  run: (ctx: ComposerAttachmentContext) => void | Promise<void>
}

export type LiveVoiceStatus = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking'

export interface ComposerLiveVoiceState {
  level?: number
  muted?: boolean
  status?: LiveVoiceStatus
}

export interface ComposerLiveVoiceContext {
  sessionId: string
  onError: (error: unknown) => void
  onState: (state: ComposerLiveVoiceState) => void
  onTranscript: (role: 'assistant' | 'user', text: string) => void
}

export interface ComposerLiveVoiceSession {
  start: () => Promise<void>
  end: () => Promise<void> | void
  stopTurn: () => void
  toggleMute: () => void
}

/** A model-backed, bidirectional voice session. The provider owns media and
 * transport; Hermes continues to own session context and tool execution. */
export interface ComposerLiveVoiceProvider {
  label: string
  create: (ctx: ComposerLiveVoiceContext) => ComposerLiveVoiceSession
}

/**
 * Run the ordered middleware chain over a draft. Contributions execute in
 * registry order (`order`, then registration order); the first `null` wins
 * and cancels the send. A throwing handler is treated as pass-through so a
 * broken plugin can't eat messages.
 */
export async function runComposerMiddleware(draft: ComposerDraft): Promise<ComposerDraft | null> {
  let current = draft

  for (const contribution of registry.getArea(COMPOSER_AREAS.middleware)) {
    const middleware = contribution.data as ComposerMiddleware | undefined

    if (!middleware?.handler) {
      continue
    }

    try {
      const next = await middleware.handler(current)

      if (next === null) {
        return null
      }

      current = next
    } catch {
      // Pass-through: a faulty middleware must never swallow the message.
    }
  }

  return current
}

/** Attach-menu entries contributed by plugins/core, with stable render keys. */
export function useComposerAttachmentProviders(): Array<ComposerAttachmentProvider & { key: string }> {
  return useContributions(COMPOSER_AREAS.attachments)
    .map(c => ({ key: `${c.source ?? 'core'}:${c.id}`, ...(c.data as ComposerAttachmentProvider) }))
    .filter(p => Boolean(p.label && p.run))
}

/** Highest-priority live provider. No contribution keeps the legacy STT/TTS
 * conversation path byte-for-byte intact. */
export function useComposerLiveVoiceProvider(): ComposerLiveVoiceProvider | null {
  const contribution = useContributions(COMPOSER_AREAS.liveVoice)[0]
  const provider = contribution?.data as Partial<ComposerLiveVoiceProvider> | undefined

  return typeof provider?.label === 'string' && provider.label.length > 0 && typeof provider.create === 'function'
    ? (provider as ComposerLiveVoiceProvider)
    : null
}
