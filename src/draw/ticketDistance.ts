// Ticket-distance simulation shim.
//
// THE PROBLEM
// -----------
// The bridge contract has `PrizeDraw.ticketDistance: number` — the count
// of tickets sitting between the user's ticket and the nearest winner.
// This number is fundamental to the ceremony: it drives the user's
// position in the perspective lane, the counter ticks during the
// post-cascade scroll-back, and the "so close" vs "miles away" copy in
// ResultHero.
//
// As of 2026-05, the underlying chain doesn't expose that distance —
// native can't compute it, so it can't populate the bridge field with
// anything meaningful. Rather than ship a broken contract, we keep the
// field in the bridge type AND keep all the downstream consumers wired
// up to it, then SHIM the value at a single point (PrizeDrawScreen)
// using a deterministic-from-hash simulation.
//
// When chain support lands later:
//   1. Delete the call to `simulateTicketDistance` in PrizeDrawScreen.
//   2. Use `draw.ticketDistance` directly.
//   3. Optionally delete this file.
//
// All other code in the draw module is already correct — it consumes
// the field as if it were real. No animation logic needs to change.
//
// THE SIMULATION
// --------------
// Deterministic hash of the user's ticket (first 12 hex chars → 48-bit
// number, well within Number.MAX_SAFE_INTEGER), modulo the pool of
// non-winning tickets, plus 1 to avoid distance=0 (which would imply
// the user IS a winner — a separate branch).
//
// Same `userTicket` always produces the same distance, so refreshing
// the page or replaying the ceremony gives a stable result. Different
// draws (different userTicket values) produce different distances
// distributed across the loser space.

// Default pool size when `totalEntries` is absent (native may omit it —
// PrizeDraw.totalEntries is optional). 1337 matches the pool the loss
// near/far split (NEAR_LOSS_THRESHOLD in ./types) was tuned against, so
// the lane behaves identically whether or not native sends a pool size.
const DEFAULT_POOL_SIZE = 1337

/** Deterministic simulated ticket-distance from the user's ticket hash.
 *
 *  @param userTicket  64-char hex string (32-byte ticket hash)
 *  @param totalEntries  Total tickets entered into this draw. Optional —
 *                       defaults to DEFAULT_POOL_SIZE when absent.
 *  @param winnerCount  Number of winning tickets in the draw
 *  @returns A positive integer in [1, pool - winnerCount]
 */
export function simulateTicketDistance(
  userTicket: string,
  totalEntries: number | undefined,
  winnerCount: number
): number {
  const pool = totalEntries && totalEntries > 0 ? totalEntries : DEFAULT_POOL_SIZE
  // First 12 hex chars = 48 bits. Big enough for plenty of entropy, small
  // enough to fit safely in JS Number (max safe = 2^53 - 1).
  const slice = userTicket.slice(0, 12)
  const n = parseInt(slice, 16)
  if (!Number.isFinite(n) || n < 0) {
    // Defensive fallback if the input wasn't a valid hex string.
    return Math.max(1, Math.floor(pool / 2))
  }
  // Modulo into the loser pool (pool minus the winners).
  const losers = Math.max(1, pool - Math.max(0, winnerCount))
  return (n % losers) + 1
}
