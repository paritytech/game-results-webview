// Internal types for the prize-draw scene. The bridge contract (PrizeDraw,
// from src/bridge/types.ts) is the public boundary; everything below is
// stage-private.

import type { PrizeDraw } from '../bridge/types'

/** A PrizeDraw with a guaranteed `ticketDistance`. Native's wire field is
 *  optional/deprecated (the chain can't compute it yet), so the
 *  PrizeDrawScreen shim fills it in deterministically (see
 *  src/draw/ticketDistance.ts) before handing the draw to this module.
 *  Everything below consumes `EffectiveDraw`, never the raw bridge type. */
export type EffectiveDraw = PrizeDraw & { ticketDistance: number }

/** Outcome bucket — drives camera path, copy, and result-stage treatment.
 *  Derived from PrizeDraw at sub-stage entry; subsequent components consume
 *  this rather than re-deriving. */
export type DrawOutcome = 'win' | 'lose-near' | 'lose-far'

/** Heuristic: ticketDistance under this counts as "near miss". Above is
 *  "far". Tuned so a 1337-entry pool's natural distribution gives a
 *  meaningful split (~10% near, ~90% far on a uniform random ticket). */
export const NEAR_LOSS_THRESHOLD = 50

export function outcomeFor(draw: EffectiveDraw): DrawOutcome {
  if (draw.won) return 'win'
  if (draw.ticketDistance <= NEAR_LOSS_THRESHOLD) return 'lose-near'
  return 'lose-far'
}

/** Position of one ticket in the perspective lane plane. */
export interface LanePosition {
  lane: 0 | 1 | 2     // left, middle, right
  y: number           // lane-local Y; lower = further back from camera
  row?: number        // for winners, their row index in the band
}

/** Kind of ticket in the lane scene — drives styling + animation. */
export type TicketKind = 'anon' | 'user' | 'winner' | 'user-winner'

/** A ticket placed in the lane scene. The `hash` is the bridge-contract
 *  hex string (for user + winners) or a synthesized placeholder (for
 *  anons — the webview never sees real anon hashes). */
export interface LaneTicket {
  id: string                // unique key
  kind: TicketKind
  hash: string              // 64-char hex (or a synthesized fingerprint for anons)
  position: LanePosition
}
