// Game-outcome channel.
//
// The attestations ARE the game result and they stream in over time, so
// pass/fail (and everything gated on it) can't be known at setGameResults
// time. Native fires window.setGameOutcome(...) once, when its streamed
// attestation count reaches the passing threshold (6) — carrying the
// pass-gated payload (justBecameMember / prizeDraw / usernameClaim). It may
// also send { passed: false } at its ~10-min timeout for a definitive fail.
// See NATIVE_SPEC §2.5 / §7 and STREAMING_OUTCOME_PROPOSAL.md.
//
// Same buffer-or-deliver pattern as setUsernameAvailability / pushAttestation:
// installed at module load so calls before React mounts are replayed on
// subscribe.

import type { GameOutcome } from './types'
import { normPrizeDraw, normUsernameClaim } from './input'

type Listener = (outcome: GameOutcome) => void

let buffered: GameOutcome | null = null
const listeners = new Set<Listener>()

/** Coerce a native payload into a GameOutcome. Returns null unless `passed`
 *  is an explicit boolean (the one required field). The pass-gated fields
 *  reuse the exact same normalizers as setGameResults. */
function normalizeOutcome(raw: unknown): GameOutcome | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.passed !== 'boolean') return null
  return {
    passed: o.passed,
    justBecameMember: o.justBecameMember === true,
    prizeDraw: normPrizeDraw(o.prizeDraw),
    usernameClaim: normUsernameClaim(o.usernameClaim)
  }
}

;(window as unknown as Record<string, unknown>).setGameOutcome = (raw: unknown) => {
  const outcome = normalizeOutcome(raw)
  if (!outcome) {
    if (typeof console !== 'undefined') {
      console.warn('[outcome] setGameOutcome: ignoring payload (missing boolean `passed`)')
    }
    return
  }
  buffered = outcome
  for (const cb of listeners) {
    try { cb(outcome) } catch { /* a listener throwing can't break the channel */ }
  }
}

/** Subscribe to the game outcome. Replays the buffered outcome immediately
 *  if one already arrived. Returns an unsubscribe function. */
export function subscribeOutcome(cb: Listener): () => void {
  listeners.add(cb)
  if (buffered) {
    try { cb(buffered) } catch { /* see above */ }
  }
  return () => { listeners.delete(cb) }
}

/** The buffered outcome, if native pushed one before React read state. */
export function readBufferedOutcome(): GameOutcome | null {
  return buffered
}

/** Clear the buffered outcome (dev panel only — loading a fresh mock).
 *  Listeners are intentionally kept: App subscribes once for the page
 *  lifetime, so we must not tear that subscription down between mocks. */
export function resetOutcome(): void {
  buffered = null
}
