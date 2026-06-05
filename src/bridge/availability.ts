// Username availability channel — separate from the input blob so native
// can push the result of its People Chain query independently of
// setGameResults. Mirrors the setDisplayName channel in input.ts.
//
// Lifecycle: native MAY include `usernameClaim.availability` in the
// initial GameResultsInput, OR it may call window.setUsernameAvailability
// (alone, anytime) once the chain query resolves. The webview accepts
// either — usually whichever arrives last wins (the assumption being that
// a later push is fresher data, e.g. native queried twice).

import type { UsernameAvailability } from './types'

export interface AvailabilityPayload {
  availability: UsernameAvailability
  alternatives?: string[]
}

type Listener = (payload: AvailabilityPayload) => void

let bufferedPayload: AvailabilityPayload | null = null
let listener: Listener | null = null

export function isValidAvailability(v: unknown): v is UsernameAvailability {
  return v === 'available' || v === 'taken' || v === 'unknown'
}

// Same sanitization rules as setDisplayName: strip HTML chars, cap length,
// trim. Plus: cap the list at 5 entries (the UI can't render more cleanly)
// and dedupe.
export function sanitizeAlternatives(list: unknown): string[] | undefined {
  if (!Array.isArray(list)) return undefined
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim().slice(0, 24).replace(/[<>"'&]/g, '')
    if (!trimmed) continue
    if (seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
    if (out.length >= 5) break
  }
  return out.length > 0 ? out : undefined
}

// Registered at module load so native can call window.setUsernameAvailability
// at any point — even before React has mounted — without being dropped.
;(window as unknown as Record<string, unknown>).setUsernameAvailability = (raw: unknown) => {
  if (!raw || typeof raw !== 'object') return
  const obj = raw as Record<string, unknown>
  if (!isValidAvailability(obj.availability)) return
  const payload: AvailabilityPayload = { availability: obj.availability }
  const alts = sanitizeAlternatives(obj.alternatives)
  if (alts) payload.alternatives = alts
  if (listener) listener(payload)
  else bufferedPayload = payload
}

/** Subscribe to availability pushed by native. Returns unsubscribe.
 *  If a payload was buffered before the subscriber registered, it's
 *  delivered immediately (and the buffer is cleared). */
export function subscribeAvailability(cb: Listener): () => void {
  listener = cb
  if (bufferedPayload) {
    cb(bufferedPayload)
    bufferedPayload = null
  }
  return () => { if (listener === cb) listener = null }
}
