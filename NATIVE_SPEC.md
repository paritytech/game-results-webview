# game-results Webview — Native Integration Spec

This document describes the complete contract between the native host
(Android `polkadot-app-android-v2` / iOS counterpart) and the
`game-results` webview as of this version. It is the authoritative
reference for what native must implement to drive the post-game
celebration flow.

The webview source of truth is `src/bridge/types.ts`. This document
mirrors that file with native-side semantics and timing requirements.

---

## 0. TL;DR (Quick Reference)

A one-screen summary of the contract. Full details in the sections
below; this is for at-a-glance reference.

### What native installs / calls

Five JS globals on `WebView`, all installable any time (calls before
React mounts are buffered):

| Global | Purpose | Section |
|---|---|---|
| `window.setGameResults(input)` | Deliver the (outcome-independent) game-result blob | §2.1, §3 |
| `window.setDisplayName(name)` | Push the user's display name | §2.2 |
| `window.setUsernameAvailability(payload)` | Push the People Chain username-availability result | §2.3, §6 |
| `window.pushAttestation(payload)` | Stream one passed-attestation as it arrives from the chain | §2.4, §7 |
| `window.setGameOutcome(payload)` | Deliver pass/fail + the pass-gated payload, fired when the streamed attestation count reaches the threshold (6) | §2.5, §7 |

`window.gameResults.postMessage(...)` (the existing inbound bridge) is
how native receives the events listed below.

### Events native receives

Flow beats, in the new reveal-first order (`flow.ready`,
`flow.pack_shown`, `flow.pack_opened`, `flow.nft_reveal_started{count}`,
`flow.nft_reveal_complete`, `flow.results_shown`,
`flow.prize_draw_started`, `flow.prize_draw_complete{won}`,
`flow.request_display_name`, `flow.complete`) plus:

- `flow.pack_shown` / `flow.pack_opened` — **NEW.** The treasure-chest
  pre-reveal beat mounted / was opened. The chest is now the first screen.
- `flow.results_shown` — unchanged event; now fires when the membership
  verdict screen mounts, which comes AFTER the reveal instead of before.
- `flow.username_availability_needed{name}` — webview is about to need
  availability and hasn't received one; trigger your chain query now
- `flow.error{phase, detail?}` — recoverable webview-side error worth
  logging (today: `boot_timeout`, `assets`)
- `flow.username_claim_requested` — **DEPRECATED, no longer emitted** (the
  username CTA is a plain "Next" now). Kept in the contract for back-compat.

`flow.complete` is the dismiss signal — close the WebView.

### Data shape (compressed)

```typescript
interface GameResultsInput {
  attestations: { score, total, passed }            // passed is native-authoritative
  member: {
    rankBefore?: MemberRank | null,                 // DEPRECATED + OPTIONAL — webview ignores
    rankAfter?: MemberRank | null,                  // DEPRECATED + OPTIONAL — webview ignores
    justBecameMember: boolean,                      // == got personhood this game (load-bearing)
    gamesInRank?, gamesPerRank?,                     // DEPRECATED + OPTIONAL — webview ignores
    displayName?, memberSince?
  }
  prizeDraw: {
    prizeUsd: number,                               // prize amount, whole units (200 / 2000) — displayed as "200 CASH" / "2000 CASH"
    userTicket: string,                             // 32-byte hash as 64-char lowercase hex
    winningTickets: string[],                       // ~20 winners (same hex shape)
    ticketDistance?: number,                        // DEPRECATED + OPTIONAL — webview simulates, ignores native's value
    totalEntries?: number,                          // OPTIONAL — webview no longer displays it
    nextDrawAt: string,                             // ISO 8601 — next weekly draw
    won: boolean                                    // native-authoritative
  } | null
  usernameClaim: {
    eligible: boolean,
    suggestedUsername?: string,                     // base form, no suffix
    previousUsername?: string,                      // suffixed candidate form
    availability?: 'available' | 'taken' | 'unknown',
    alternatives?: string[]                         // ≤5, only meaningful when 'taken'
  }
}
```

Under the **streaming-derived outcome** model (see "What changed" below
and §7), `setGameResults` upfront should carry only the
outcome-INDEPENDENT fields (`attestations.total`, `member.displayName`);
the pass-gated fields travel in a separate `setGameOutcome` call:

```typescript
// window.setGameOutcome(...) — fired when the streamed attestation count
// reaches the passing threshold (6); see §2.5 / §7.
interface GameOutcome {
  passed: boolean                  // the `false` form is the ~10-min timeout signal
  justBecameMember?: boolean       // present when passed
  prizeDraw?: PrizeDraw | null     // present when passed (null for a passing candidate)
  usernameClaim?: UsernameClaim    // present when passed
}
```

Old native that still sends the pass-gated fields inside `setGameResults`
keeps working — the webview synthesizes the outcome from them (back-compat,
§7).

### What changed from older specs

- ⚠️ **Rank / ranking REMOVED from the webview.** The webview no longer
  renders the rank card, rank tier label, or games-until-next-rank
  progression. `member.rankBefore`, `member.rankAfter`,
  `member.gamesInRank`, `member.gamesPerRank` (and the `MemberRank` enum)
  are now **optional** and deprecated — native may omit them entirely (or
  keep sending them during the transition); either way the webview
  ignores them. `member.justBecameMember` is unaffected and remains the
  load-bearing personhood signal. The results screen now shows a plain
  membership card (Polkadot brand + display name).
- ⚠️ **`MemberState.demoted` REMOVED.** Members don't actually demote.
  Native may keep sending it; webview ignores. Future: replace with
  `memberStatus: 'active' | 'caution' | 'suspended'` (§10).
- ⚠️ **`PrizeDraw` shape REPLACED.** Old `seed` + `userTicket.{mains, powerball}`
  fields are gone. New shape uses a single `userTicket: number`, a list
  of `winningTickets`, and a precomputed `ticketDistance`. Animation is
  being redesigned; contract is now animation-agnostic.
- ⚠️ **`PrizeDraw.ticketDistance` now OPTIONAL + deprecated.** The chain
  can't compute a real ticket-distance yet, so the webview simulates one
  deterministically from `userTicket` and ignores whatever native sends.
  Native may omit the field entirely (`won` remains the authoritative
  win/loss signal). When chain support lands it can become authoritative
  again with no contract change.
- ⚠️ **`PrizeDraw.kind` REMOVED.** Every draw runs weekly — there is no
  separate cadence. Once a month, one of those weekly draws carries a
  bonus purse; the webview infers "bonus week" purely from `prizeUsd`
  (typically 200, occasionally 2000). No flag needed.
- ⚠️ **Prize is displayed as "CASH", not USD.** The bridge field `prizeUsd`
  retains its legacy name (changing it is a contract break the native team
  owns scheduling). The VALUE is the prize amount in whole units
  (e.g., 200, 2000). The webview displays it as "200 CASH" / "2000 CASH".
  A future contract bump will likely rename to `prizeAmount` or similar.
- ⚠️ **`PrizeDraw.nextDrawAt` is a required field.** Native must always
  send it when `prizeDraw` is non-null.
- ⚠️ **`PrizeDraw.totalEntries` now OPTIONAL + deprecated.** The webview
  no longer displays the pool size, so it no longer drives any copy.
  Native may omit it. (If sent, it still sizes the simulated
  ticket-distance pool; when absent the webview uses a default.)
- ⚠️ **NFT reveal is now streamed.** The webview no longer generates
  NFT content locally. Native pushes one `pushAttestation({index, hash})`
  per passed attestation as they arrive (in real time after the game
  ends). The webview maps each hash to a displayable asset locally.
- ⚠️ **Game outcome is now STREAM-DERIVED, not upfront.** Native cannot
  know pass/fail (or anything gated on it) at `setGameResults` time — the
  attestations *are* the result, and they stream in. So **pass/fail +
  `justBecameMember` + `prizeDraw` + `usernameClaim` now travel in a new
  `window.setGameOutcome(...)` call**, fired when the streamed count reaches
  the passing threshold (**6**). `setGameResults` upfront carries only
  outcome-independent data (`attestations.total`, `member.displayName`).
  The webview reveals collectibles as they stream, shows the verdict when
  `setGameOutcome` arrives, and for the no-outcome tail (fail / skunk /
  slow) hands off to the app. At its ~10-min timeout native may send
  `setGameOutcome({passed:false})` for a definitive failure.
  **Back-compat:** if native still sends `attestations.passed` upfront, the
  webview synthesizes the outcome from it — old native keeps working. Full
  design + rationale: `STREAMING_OUTCOME_PROPOSAL.md`.
- **NEW:** `usernameClaim.availability` and `usernameClaim.alternatives`
  fields, and the matching `window.setUsernameAvailability` push method.

### Critical timing rules

- **Boot timeout: 30s.** If `setGameResults` doesn't fire within 30s of
  page load, the webview shows an error screen and emits
  `flow.error{phase:'boot_timeout'}`.
- **Username availability:** must arrive (via initial input or async
  push) before the user reaches the username CTA (~10–25s after results
  arrive, depending on flow). The variant is locked at username-CTA
  mount; late arrivals are ignored.
- **Attestations stream in real time, and the outcome is derived from
  them.** Native pushes one `pushAttestation` per passed attestation as it
  lands. The webview renders a fixed 10-slot shelf and fills each slot as
  its push arrives. The streamed count is also what resolves pass/fail:
  native fires `setGameOutcome` when the count reaches the threshold (6) —
  there is no trustworthy upfront `score`. Pushes that arrive before the
  user reaches NFT reveal are buffered.
- **The webview never queries any chain.** All on-chain reads happen
  natively. The webview consumes only what native pushes.

### Critical edge case (the username flow)

When `member.justBecameMember && usernameClaim.eligible &&
usernameClaim.suggestedUsername`, native MUST query People Chain for
the **base** (no-suffix) username and push the result. The webview
plays the suffix-drop ceremony ONLY for `availability === 'available'`;
anything else degrades to a generic celebration. See §6 for full
treatment.

---

## 1. Overview

The webview is loaded inside a native WebView host after the user
finishes voting in a game. It plays the post-game celebration sequence
(treasure chest → NFT reveal → membership verdict → prize draw →
username CTA → done) and
communicates with native through a single JavaScript bridge named
`gameResults`.

**Bundle URL:** the build is published to the Polkadot Bulletin Chain and
served at the DotNS domain `game-webview.dot` (resolved natively in-app; via
gateway `https://game-webview.paseo.li` / `https://game-webview.dot.li` in a
browser), with `file:///android_asset/game_results/index.html` as fallback.
URL config is host-side; the webview itself does not care which URL loaded
it. See `DEPLOY_DOC.md` for how the bundle is deployed.

**Bridge object name:** `gameResults` (do not rename — hardcoded on the
web side).

---

## 2. Bridge surface (web side)

The webview installs five globals at module load. Native may invoke
any of them at any point during the WebView's lifetime, including
before React mounts (the calls are buffered until a subscriber
registers).

### 2.1 `window.setGameResults(input: GameResultsInput): void`

The primary payload-delivery method. Pushes the full game result blob.
Idempotent: calling it again replaces state and re-routes to the
results screen. Used for both initial delivery (post-`pageFinished`)
and dev-mode replay.

**When to call:** as soon as the chain data is available after the
user submits votes. The webview will sit on a "Waiting for results…"
boot screen until this fires. If it doesn't arrive within **30s**, the
webview emits `flow.error{phase:'boot_timeout'}` and shows a retry/
close error screen.

Alternative: native may set `window.__GAME_RESULTS__ = input` BEFORE
the webview's JS executes. The webview will pick it up on first read
without needing a call. Useful for warm-cached HTML.

### 2.2 `window.setDisplayName(name: string): void`

Delivers (or updates) the user's display name. Sanitization rules
applied web-side: trim, max 24 chars, strips `<>"'&`. Empty/non-string
inputs are silently ignored.

**When to call:** either include `member.displayName` in the
GameResultsInput, OR respond to a `flow.request_display_name` event
the webview emits when it loads input without a name. The webview
times out the request after 3s and continues without a name.

### 2.4 `window.pushAttestation(payload): void`

**NEW.** Streams one passed-attestation to the webview. Native is
expected to call this once per passed attestation, in real time as
each attestation lands from the chain after the game ends.

```typescript
window.pushAttestation({
  index: number,        // 0-based; tells the webview which silhouette to fill
  hash: string,         // 32-byte attestation hash (64 hex chars, optional 0x prefix)
  highValue?: boolean   // OPTIONAL advisory rarity flag — see notes below
}): void
```

**Sanitization** (web-side):
- `index` must be a non-negative finite number; otherwise the push is dropped silently.
- `hash` must be a non-empty string; trimmed before storage. Format expected: 32-byte hex (see resolver behavior in §7).
- `highValue` is honored only if exactly `true`; any other value is treated as `false`. **Advisory only** — the webview derives the authoritative rarity from the hash bytes (see §7).

**Buffering:** the channel buffers pushes by `index` until a subscriber
registers, then replays them in index order. Duplicate index pushes
replace; native may safely re-push if needed.

**Count.** A failed game streams 1–5 (its score, below the passing
threshold of 6); a passed game streams the full 10. The webview always
renders a fixed 10-slot shelf and fills slots as pushes arrive — it does
NOT pre-size from a `score` (which isn't known upfront). Crossing 6 is
how native knows the user passed → it then sends `setGameOutcome` (§2.5).

**When to call:** as soon as each attestation is available — typically
streamed over seconds-to-minutes after the game ends (no hard bound under
~10 min). Calls before `setGameResults` are buffered and applied when the
NFT-reveal screen mounts; calls after are reactively rendered. There is no
per-attestation "stream complete" signal — instead native sends
`setGameOutcome` when the count reaches the threshold (and, optionally,
`setGameOutcome({passed:false})` at its ~10-min timeout).

See §7 for the full attestation + outcome flow.

### 2.3 `window.setUsernameAvailability(payload: { availability, alternatives? }): void`

Delivers the result of the People Chain query for the base
member username. See §6 for the full availability flow.

```typescript
window.setUsernameAvailability({
  availability: 'available' | 'taken' | 'unknown',
  alternatives?: string[]   // only meaningful when 'taken'
})
```

**Sanitization** (web-side):
- `availability` must be exactly one of `'available' | 'taken' | 'unknown'`. Anything else is dropped silently.
- `alternatives` must be `string[]`. Each entry is trimmed, capped at 24 chars, stripped of `<>"'&`, deduped, and the list is capped at 5 entries. Empty list after sanitization is treated as undefined.

**When to call:** see §6.

### 2.5 `window.setGameOutcome(payload: GameOutcome): void`

**NEW.** Delivers the game outcome and everything gated on passing. The
attestations *are* the result and they stream in, so none of this is
knowable at `setGameResults` time (see §7). Native fires this once, the
moment its streamed attestation count reaches the **passing threshold (6)**.

```typescript
window.setGameOutcome({
  passed: boolean,                 // true at the 6th attestation; false = ~10-min timeout
  justBecameMember?: boolean,      // when passed
  prizeDraw?: PrizeDraw | null,    // when passed (null for a passing candidate — §4)
  usernameClaim?: UsernameClaim    // when passed
})
```

- **When to call (pass):** the instant the streamed count hits 6. Bundle
  the pass-gated payload — at that moment native knows `justBecameMember`,
  `prizeDraw`, and `usernameClaim`. The webview shows the membership verdict
  off this call.
- **When to call (fail):** native need not call it for a failing game — the
  count never reaches 6. *Optionally*, native MAY call
  `setGameOutcome({passed:false})` at its ~10-min timeout to give the
  webview a definitive failure (upgrades the soft "still arriving" handoff
  to a real failed verdict if the user is still on screen).
- **Threshold ownership.** The webview does **not** hardcode 6 — the trigger
  is this call. Change the chain rule and the webview follows for free.
- **Buffer-or-deliver.** Installed at module load; calls before the webview
  mounts are buffered and replayed on subscribe (same as §2.3 / §2.4).
- **Idempotent.** A repeat call replaces.
- **Sanitization** (web-side): `passed` must be a boolean or the call is
  dropped. When `passed === true`, `prizeDraw` / `usernameClaim` are
  validated with the same rules as in `setGameResults` (§3).

See §7 for how this interleaves with the stream and the no-outcome handoff.

---

## 3. `GameResultsInput` — Full Schema

```typescript
interface GameResultsInput {
  attestations: Attestations
  member: MemberState
  prizeDraw: PrizeDraw | null      // outcome-gated — see note + §2.5
  usernameClaim: UsernameClaim     // outcome-gated — see note + §2.5
}
```

> **Outcome split (streaming-derived model, §7).** Under the current
> contract, native cannot know pass/fail at `setGameResults` time, so the
> **pass-gated fields move to `setGameOutcome` (§2.5)**: `prizeDraw`,
> `usernameClaim`, `member.justBecameMember`, and `attestations.passed`.
> Upfront, `setGameResults` should carry only `attestations.total` and
> `member.displayName`. The fields below are documented in full because
> their *shapes* are unchanged — they just travel in `setGameOutcome`.
> Old native that still puts them in `setGameResults` keeps working
> (back-compat synthesis, §7).

### 3.1 `Attestations`

```typescript
interface Attestations {
  total: number        // shelf size / expected max — typically 10
  score?: number       // NOT knowable upfront (see §7). Old native may still
                       //   send it; the webview tolerates it for back-compat.
  passed?: boolean     // NOT knowable upfront — see setGameOutcome (§2.5, §7).
                       //   If old native sends it, the webview synthesizes the
                       //   outcome from it (back-compat).
}
```

- **`total`** is the only field the webview needs upfront — the shelf is a
  fixed `total`-slot (10) layout.
- **`passed` / `score` are no longer trustworthy upfront.** The outcome is
  derived from the attestation stream (the attestations *are* the result)
  and delivered via `setGameOutcome` (§2.5, §7). The passing **threshold
  is 6**.
- **Back-compat only:** if old native still sends `passed` (a boolean) in
  `setGameResults`, the webview treats it as an immediate authoritative
  outcome and synthesizes a `GameOutcome` from the upfront
  `passed` / `prizeDraw` / `member` / `usernameClaim` fields — no
  `setGameOutcome` needed.
- **Stream count (unchanged):** passed → native streams 10; failed → streams
  its `score` (1–5). The shelf always renders 10 slots; unfilled slots stay
  as empty placeholders.
- **No upfront skunk short-circuit anymore.** A 0-collectible game is just a
  stream that never crosses 6; it degrades to the Prizes-chat handoff (§7),
  not an instant Done.

### 3.1a `AttestationPayload` (streamed, not part of GameResultsInput)

```typescript
interface AttestationPayload {
  index: number        // 0-based slot in the user's attestation sequence
  hash: string         // 32-byte hash as 64 hex chars (optional 0x prefix); see §7
  highValue?: boolean  // ADVISORY ONLY — resolver derives rarity from hash bytes
}
```

Delivered one-at-a-time via `window.pushAttestation(payload)`. Sits
outside `GameResultsInput` because each attestation arrives
independently and may straddle screen transitions.

**Hash → image resolution.** The webview maps each attestation's hash
to a displayable image via the Bulletin-chain-backed resolver in
`src/attestations/resolver.ts` (ported from
`~/git/CollectableHashResolver`). The mapping is deterministic:
- **Bytes 0–1** (uint16): rarity roll — if `< 6554` (~10% of hash
  space) the image is drawn from the **rare pool**; otherwise from the
  **normal pool**.
- **Bytes 2–3** (uint16): image index — `pickVal % poolSize` selects
  the entry from the sorted pool.
- Pools are bundled at build time from `src/attestations/cid_map.json`
  (filename → CID, generated by the CollectableHashResolver upload
  script). Filenames containing "rare" land in the rare pool; all
  others in normal.
- Image URLs point at the Paseo Bulletin Chain IPFS gateway
  (`https://paseo-bulletin-next-ipfs.polkadot.io/ipfs/<CID>`). On
  testnet, data expires ~every 2 weeks — re-upload via the resolver
  tool when needed; CIDs in `cid_map.json` may need refreshing.

**Why `highValue` is advisory.** The resolver derives rarity from the
same hash that picks the image, so card art and image rarity are
always self-consistent. Native may omit `highValue` entirely. If sent,
the webview uses it as a tentative card-art hint while the resolver is
in flight (sub-frame, in practice), then overrides with the resolver's
verdict.

See §7 for the full attestation streaming flow.

### 3.2 `MemberState`

```typescript
interface MemberState {
  rankBefore?: MemberRank | null    // DEPRECATED + OPTIONAL — webview ignores
  rankAfter?: MemberRank | null     // DEPRECATED + OPTIONAL — webview ignores
  justBecameMember: boolean         // load-bearing personhood signal
  gamesInRank?: number              // DEPRECATED + OPTIONAL — webview ignores
  gamesPerRank?: number             // DEPRECATED + OPTIONAL — webview ignores
  displayName?: string
  memberSince?: string              // ISO date, optional, currently unused
}

// DEPRECATED — retained only so the deprecated rank fields keep their
// shape. The webview no longer renders rank.
type MemberRank =
  | 'spark' | 'ignition' | 'flame' | 'fire' | 'blaze'   // candidate
  | 'fresh' | 'returning' | 'regular' | 'familiar'
  | 'reliable' | 'strong' | 'enduring'
  | 'veteran' | 'hero' | 'legend' | 'mythic'
  | 'immortal' | 'apex' | 'eternal'
```

- ⚠️ **Rank / ranking — REMOVED from the webview.** The webview no
  longer renders the rank card, rank tier label, or the
  games-until-next-rank progression stripe. `rankBefore`, `rankAfter`,
  `gamesInRank`, `gamesPerRank`, and the `MemberRank` enum are now
  **optional** and deprecated — native may omit them entirely (or keep
  sending them during the transition); either way the webview silently
  ignores them. They may be dropped completely in a future contract bump.
  The results screen now shows a plain membership card (Polkadot brand +
  `displayName`); there is no longer a "back to the start" /
  progression-wiped placeholder, and failure copy is uniform regardless
  of the player's prior rank or how they failed.
- **`justBecameMember: true`** is **unaffected** by the rank removal and
  remains the canonical "got personhood this game" signal. It is the
  gate for: the celebration variant of the results screen, the new-member
  consolation overlay on prize-draw loss, and the username CTA's
  eligibility logic (paired with `usernameClaim.eligible`). Per project
  convention, candidate→member IS the personhood transition — there is no
  separate personhood flag. Native must keep sending it correctly.
- ⚠️ **`demoted` field — REMOVED** (unchanged from prior specs). Native
  may keep sending it; the webview ignores it.
- **`displayName`** ≤ 24 chars. Webview sanitizes again on its side,
  but native should sanitize at source for cleaner logs. Shown on the
  membership card.
- **`memberSince`** is optional and currently unused by any screen.
  Reserved for future "X year veteran" surfacing.

### 3.3 `PrizeDraw` (nullable)

```typescript
interface PrizeDraw {
  prizeUsd: number              // prize amount in whole units; 200 normal week, 2000 monthly bonus (displayed as "CASH")
  userTicket: string            // 32-byte hash as 64-char lowercase hex
  winningTickets: string[]      // all winners this draw (~20 tickets, same hex shape)
  ticketDistance?: number       // DEPRECATED + OPTIONAL — webview simulates; native's value ignored
  totalEntries?: number         // OPTIONAL — webview no longer displays it
  nextDrawAt: string            // ISO 8601 timestamp of the next weekly draw
  won: boolean                  // native-authoritative
}
```

The draw is modeled as a lottery: every eligible member's ticket is a
32-byte hash (e.g., blake2b of their address + draw seed; the exact
derivation is up to native), and native picks roughly twenty winning
hashes. The webview never reasons about the hash space itself — it just
renders what native sends.

**Ticket display.** The raw 64-char hex hash is never shown to the
user. The webview derives a short friendly display code (e.g., `A7F2`
for the lane scene, `A7F2-X923` for the sealed/hero screens) from the
hash via a deterministic short-code formatter. The same hash always
renders the same code, so users recognize "their" ticket across screens
without ever seeing the raw bytes.

**Draw cadence.** Every draw runs once per week. Once a month, one of
those weekly draws is the *bonus* draw with a larger prize (typically
2000 vs the usual 200). There is no separate cadence field — the
webview infers the bonus week purely from `prizeUsd`. From a flow
perspective every draw is identical; only the purse changes.

- **`prizeDraw === null`** = no draw this game. The webview routes
  `results → nft_reveal`, skipping the draw screen entirely.
- **Eligibility invariant.** The prize draw is tied to game pass/fail:
  - `attestations.passed === false` → native MUST send `prizeDraw === null`. Failing the game makes the user ineligible for the weekly draw, period. The webview enforces this on its own side too — it will skip the draw screen on any failed game regardless of whether `prizeDraw` is populated.
  - `attestations.passed === true` AND user is a member (current or just-became) → native MUST send a `prizeDraw` payload. Every member who plays and passes is in this week's draw.
  - `attestations.passed === true` AND user is still a candidate (no member rank yet, e.g. first-ever or candidate progression game) → `prizeDraw === null` is valid. The weekly draw is a members-only benefit; candidates pass through directly to NFT reveal.
- **`prizeUsd`** is the prize amount in **whole units** — not
  micro-units, not dollars, despite the legacy field name. Typical
  values are 200 (normal weekly) and 2000 (monthly bonus). The webview
  displays it as `"<value> CASH"` (e.g., "200 CASH", "2,000 CASH") and may
  treat the higher value with extra ceremony.
  - **Naming note:** the field is named `prizeUsd` for historical
    reasons — the design was dollar-denominated originally.
    Native should keep sending whatever the actual amount is in
    this field. A future contract bump will likely rename it; the
    webview's display formatter is the single source of truth for the
    unit string, so the rename will not need coordinated UI changes.
- **`userTicket`** is the user's ticket hash for this draw — a 32-byte
  value rendered as a 64-character lowercase hex string. The webview
  produces a short friendly display code from the hash; the raw hex is
  never surfaced to the user.
- **`winningTickets`** is the full set of winning hashes — typically
  ~20 entries, same hex shape as `userTicket`. Include the user's
  ticket here when they won. Order doesn't matter; the webview sorts
  by closeness-to-user for display.
- ⚠️ **`ticketDistance` — DEPRECATED + OPTIONAL.** The chain does not yet
  expose a real ticket-distance value, so native cannot compute this
  field meaningfully. The webview internally **simulates** ticketDistance
  from a hash of `userTicket` (deterministic per draw) and **ignores
  whatever native passes**. Native may omit the field entirely. When
  chain support lands and native can compute true distance, the webview's
  simulation will be removed and native's value becomes authoritative
  again — no contract change required (just start sending it).
  - Historical semantics: distance from the user's ticket to the nearest
    winning ticket; `0` meant the user won. `won` is now the sole
    authoritative win/loss signal.
- **`totalEntries`** — **OPTIONAL** (deprecated). The webview no longer
  displays the pool size, so this no longer drives any framing copy.
  If sent, it still sizes the simulated ticket-distance pool (the lane's
  spatial scale); when absent the simulation falls back to a default
  pool size. Native may omit it.
- **`nextDrawAt`** is the ISO 8601 timestamp of the next weekly draw.
  Drives the countdown on the result stage. Native owns the schedule —
  the webview never computes draw cadence. Required.
- **`won`** is **native-authoritative**. The webview plays the win or
  loss flow based purely on this boolean. (Historically `won ===
  (ticketDistance === 0)`, but `ticketDistance` is now deprecated and
  webview-simulated — `won` is the sole authoritative win/loss signal.)

**Animation note:** the current draw screen is a placeholder — header,
brief "drawing tickets…" beat, then either a win takeover (name + prize
+ Claim CTA) or a loss layout (user ticket + winning tickets list +
"N tickets away"). The animation will be redesigned; the contract above
is independent of any specific draw mechanic.

### 3.4 `UsernameClaim`

```typescript
interface UsernameClaim {
  eligible: boolean
  suggestedUsername?: string
  previousUsername?: string
  availability?: 'available' | 'taken' | 'unknown'  // NEW
  alternatives?: string[]                            // NEW
}
```

- **`eligible: true`** means the user can claim a custom member
  username (in the Prizes chat). Practically this maps to "just transitioned to
  member" + identity flow is wired. The webview only renders the
  username CTA screen when this is true (regardless of variant).
- **`suggestedUsername`** is the clean base name with no suffix
  (e.g., `"byteboro"`). This is **not** the user's current candidate
  name (which is suffixed).
- **`previousUsername`** is the user's current candidate handle, e.g.,
  `"byteboro.42"`. Used in the "available" variant to derive the
  trailing `.XX` to animate off, and in the "taken" variant for the
  "you'll keep this for now" copy. If omitted, the webview synthesizes
  `${suggestedUsername}.01` so the suffix-drop ceremony has a starting
  state.
- **`availability`** and **`alternatives`** drive the three-way variant
  selection. See §6.

---

## 4. `FlowEvent` — Events the Webview Emits

All events flow web→native via `gameResults.postMessage(...)`. On
Android, `postMessage` receives a stringified JSON; on iOS it receives
the object directly. Native should treat unknown event types as
informational (log + ignore) so the webview can evolve without
breaking older native builds.

| Event | Trigger | Payload |
|---|---|---|
| `flow.ready` | First paint complete | — |
| `flow.pack_shown` | **NEW.** Treasure-chest screen mounts — the pre-reveal beat (now the first screen) | — |
| `flow.pack_opened` | **NEW.** User opens the chest, handing off into the collectibles reveal | — |
| `flow.nft_reveal_started` | NFTRevealScreen mounts (now the first major beat, right after the chest) | `count: number` (1..10) |
| `flow.nft_reveal_complete` | User taps Continue past the reveal finale (advancing to the verdict screen) | — |
| `flow.results_shown` | Membership verdict screen mounts (now AFTER the reveal, as its own screen) | — |
| `flow.prize_draw_started` | User advances past the verdict into the prize draw | — |
| `flow.prize_draw_complete` | User taps Continue on the prize-draw outcome | `won: boolean` |
| `flow.username_claim_requested` | **DEPRECATED — no longer emitted.** The username CTA button is now a plain "Next" that just advances; claiming happens in the Prizes chat. Kept in the contract for back-compat. | — |
| `flow.request_display_name` | Webview loaded input without `member.displayName` | — |
| `flow.username_availability_needed` | **NEW.** Webview detected it'll need availability but didn't receive one | `name: string` (the base name to query) |
| `flow.error` | **NEW.** Recoverable webview-side error worth logging | `phase: string`, `detail?: string` |
| `flow.complete` | User tapped Done OR boot timed out and closed | — |

`flow.complete` is the dismiss signal — native should close the
WebView when it arrives.

### `flow.error` phases

| `phase` | When | `detail` |
|---|---|---|
| `boot_timeout` | Input never arrived within 30s | — |
| `assets` | One or more IPFS composites failed during NFT reveal | `composite_failures=N` |

---

## 5. Lifecycle & Timing

```
       ┌────────────────────────────────────────────────────────┐
       │  Native opens WebView                                  │
       │    optional: window.__GAME_RESULTS__ = input           │
       │              (outcome-independent fields only; see §3)  │
       └────────────────────────────────────────────────────────┘
                       │
                       ▼
       ┌────────────────────────────────────────────────────────┐
       │  WebView pageFinished, JS executes                     │
       │  flow.ready fires                                      │
       │  If no input yet → 'Waiting for results…' boot         │
       └────────────────────────────────────────────────────────┘
                       │
                       │  Native: window.setGameResults(input)
                       │  (outcome-INDEPENDENT only: total + displayName;
                       │   must arrive within 30s of boot, else boot_error)
                       │  Native: BEGIN window.pushAttestation(...) as each
                       │  attestation arrives. At the 6th →
                       │  window.setGameOutcome({passed:true, ...}).
                       │  All buffered until consumed. (See §7.)
                       ▼
       ┌────────────────────────────────────────────────────────┐
       │  chest screen (always shown — no upfront skunk skip)  │
       │  flow.pack_shown                                       │
       │  A living treasure chest that sets stakes and buys a    │
       │  little time while attestations stream in. It rattles   │
       │  ("something's trapped inside"), then becomes tappable   │
       │  after a short fixed dwell (~2s). It does NOT gate on    │
       │  or display the attestation count.                      │
       │  If justBecameMember + eligible + suggestedUsername    │
       │  AND availability still unknown:                       │
       │    → flow.username_availability_needed{name}           │
       │  Native should start the People Chain query here       │
       │  (earliest point — the chest buys the most time).      │
       └────────────────────────────────────────────────────────┘
                       │  user taps Open → flow.pack_opened
                       ▼
       ┌────────────────────────────────────────────────────────┐
       │  nft_reveal screen (the FIRST major beat)             │
       │  flow.nft_reveal_started{count}                       │
       │  Cards fill as window.pushAttestation(...) streams.    │
       │  User-paced; no known total to wait for. See §7.       │
       │  finale → "Collection complete!" + Continue            │
       └────────────────────────────────────────────────────────┘
                       │  user taps Continue → flow.nft_reveal_complete
                       ▼
       ┌────────────────────────────────────────────────────────┐
       │  OUTCOME GATE (§7.5)                                    │
       │   • setGameOutcome({passed:true})  → verdict (member)   │
       │   • setGameOutcome({passed:false}) → verdict (failed)   │
       │     (back-compat: upfront attestations.passed instead)  │
       │   • neither + stream stalled (~9s quiet / ~45s cap)     │
       │       → handoff screen → done:                          │
       │         "collectibles still arriving — see the app"     │
       └────────────────────────────────────────────────────────┘
                       │  (outcome resolved)
                       ▼
       ┌────────────────────────────────────────────────────────┐
       │  verdict screen (its own screen, not an overlay)      │
       │  flow.results_shown                                    │
       │  membership card + celebration (failed = copy only).   │
       │  Native: window.setUsernameAvailability(...) should    │
       │  arrive by here, else cautious-generic username variant.│
       └────────────────────────────────────────────────────────┘
                       │  user taps Continue
                       ▼
       ┌────────────────────────────────────────────────────────┐
       │  prize_draw screen (if passed && prizeDraw != null)   │
       │  flow.prize_draw_started → ... → flow.prize_draw_complete│
       │  Draw placeholder, ~3–5s                               │
       └────────────────────────────────────────────────────────┘
                       │  user taps Continue
                       ▼
       ┌────────────────────────────────────────────────────────┐
       │  username_cta screen (if usernameClaim.eligible)       │
       │                                                        │
       │  Variant chosen ONCE at mount time, based on current   │
       │  availability state. Later updates do NOT change the   │
       │  rendered variant (avoids janky retroactive ceremony). │
       │                                                        │
       │  → 'available' = suffix-drop ceremony                  │
       │  → 'taken'     = name-taken variant with alternatives  │
       │  → otherwise   = cautious-generic                      │
       └────────────────────────────────────────────────────────┘
                       │
                      Next
                       │
       (no event — claiming happens in the Prizes chat)
                       │
                       ▼
       ┌────────────────────────────────────────────────────────┐
       │  done screen                                           │
       │  If any IPFS failures during nft_reveal:               │
       │    → flow.error{phase:'assets', detail:'...'}          │
       │  User taps Done → flow.complete                        │
       │  Native should close the WebView                       │
       └────────────────────────────────────────────────────────┘
```

---

## 6. Username Availability Flow (Critical)

This is the contract for the user's stated edge case: "if a user is
potentially going to get personhood after this game, check their
username in form 'username' rather than 'username.01' to see if
'username' is available."

### 6.1 Trigger conditions

Native needs to perform the People Chain availability query when ALL
of the following are true after the game ends:

- `member.justBecameMember === true` — the player transitioned
  candidate → member this game (== got personhood).
- `usernameClaim.eligible === true` — they can claim a custom name.
- `usernameClaim.suggestedUsername` exists — there is a base name to
  check.

The name to query is the **base form** (no suffix). Example: if the
user's current on-chain handle is `"byteboro.42"`, the query is for
`"byteboro"`, not `"byteboro.42"`.

### 6.2 The query

Hit the Polkadot People Chain:

- **Primary:** `Identity::usernameOwnerOf(name) → Option<AccountId>`
  - `None` → name is **available**
  - `Some(_)` → name is **taken** (by anyone, including someone with a
    pending reservation; treat as taken for celebration purposes)
- **Secondary (only if `'taken'`):** query
  `Identity::usernameReservationQueue(name)` for nearby variants to
  populate `alternatives`. Send up to 5 suggested alternative names.
  If you can't get good alternatives cheaply, send the field as
  undefined — the webview will still render the taken variant, just
  without the chips.

### 6.3 Delivering the result

Two equivalent paths — pick whichever is convenient:

**Inline (preferred when fast):** include in the initial input.

```kotlin
GameResultsInput(
  // ... rest of the input ...
  usernameClaim = UsernameClaim(
    eligible = true,
    suggestedUsername = "byteboro",
    previousUsername = "byteboro.42",
    availability = "available",
    alternatives = null
  )
)
```

**Async push (preferred when the chain query may delay opening):**
open the webview with the input *without* availability, then push
later via `window.setUsernameAvailability(...)`. The webview accepts
the late push at any point before the user reaches the username CTA
screen.

The webview emits `flow.username_availability_needed{name}` as soon as
it determines a query will be needed but doesn't yet have a value.
Native may use this as a fallback trigger if it didn't pre-query.

### 6.4 Variant matrix

| `availability` | `suggestedUsername` | Variant rendered | Why |
|---|---|---|---|
| `'available'` | present | **Confident ceremony** — full suffix-drop animation | The "drop the .01" moment. Only fires when we know the name is free. |
| `'taken'` | present | **Name-taken** — shows alternatives, "you'll keep `<previous>` until you pick one" | Acknowledges the conflict, gives the user options without celebrating a name they can't get. |
| `'unknown'` or absent | any | **Cautious generic** — greets with the user's handle, "You can claim your new username in the Prizes chat." No claimable name shown, no suffix-drop | We never fabricate a celebration for a name we couldn't confirm is free. |
| any | absent | **Cautious generic** | Same — no name to celebrate. |

**Hard rule:** the suffix-drop ceremony only fires when
`availability === 'available'`. Any other state degrades to the
cautious variant. Native should treat this as load-bearing — there's
no fallback chain-query in the webview.

### 6.5 Timing budget

Native has from `setGameResults` until the user finishes NFT reveal to
deliver the availability — typically 10–25 seconds. If the result
arrives after the username CTA has already mounted, the webview will
NOT retroactively switch to the ceremony (avoids visual jank). Aim to
have it pushed by the end of the prize-draw screen for safety.

---

## 7. Attestation Streaming (Critical)

NFT reveal is no longer driven by webview-side mock generation. Native
is the source of truth for the user's passed attestations, and pushes
each one to the webview as it arrives from the chain — typically in
real time over seconds-to-minutes after the game ends.

### 7.1 The contract

Native calls `window.pushAttestation(payload)` once per passed
attestation:

```typescript
window.pushAttestation({
  index: number,        // 0-based slot in the user's attestation sequence
  hash: string,         // attestation hash from the chain
  highValue?: boolean   // optional rarity flag
})
```

- **Count** (this is also how the outcome is determined — see §7.5):
  - **A passed game streams 10.** The full 10-card pack — the cards beyond
    the user's passed attestations are bonus drops. The **6th push is proof
    of passing** (a failed game never reaches 6, the threshold).
  - **A failed game streams its `score` (1–5).** One push per attestation
    they passed, below the threshold.
  - **A skunk streams 0.** No upfront short-circuit — the stream simply
    never crosses 6 and the webview degrades to the handoff (§7.5).
  
  The shelf itself **always renders 10 slots** (a fixed 5×2 layout)
  regardless — fewer than 10 NFTs leaves the rest as empty placeholders.
  More pushes than expected → extras up to slot 9 are accepted, beyond
  that dropped with a console warning.
- **Order.** Pushes may arrive in any order. `index` is the anchor;
  duplicate-index pushes replace.
- **Timing.** Push as soon as each attestation is available — there is
  no need to batch. Pushes that arrive before the user reaches the NFT
  reveal screen are buffered and applied on mount. Pushes that arrive
  during the screen are reactively rendered. A push for an attestation
  the webview already received is treated as a re-push (idempotent).

### 7.2 Hash → asset mapping

The webview owns the mapping from attestation hash to the displayable
NFT asset. Native passes only the hash; the webview is responsible for
deriving the bulletin-chain-stored CID and fetching the IPFS content.

**Today (stub):** `src/attestations/resolver.ts` deterministically maps
each hash to one of 15 bundled badge assets. Sufficient for dev /
preview / native-side integration testing without bulletin chain
connectivity.

**Beyond the prototype:** the resolver is the integration point for
the real lookup — likely a deterministic hash→CID transform followed
by an IPFS gateway fetch. The bridge contract above does not change;
only the resolver implementation does.

Per the design rule established in §6, native does not push CIDs and
the webview does not query any chain — IPFS fetches over HTTP gateway
are not considered chain queries.

### 7.3 What the user sees

1. NFT-reveal screen mounts (after results / prize draw). All 10
   shelf slots are rendered immediately as empty placeholders — the
   shelf shape is the same regardless of score.
2. As each `pushAttestation` lands, the corresponding silhouette
   "lights up" with its badge image and becomes tappable. The
   `10 - score` slots that will never receive a push stay as empty
   placeholders for the run of the screen.
3. Pre-existing UX (tap to flip, tap to store, Collect-All, finale)
   runs unchanged once a slot is ready. Finale fires after the user
   has stored all `score` cards, not all 10 — empty placeholders are
   not part of the completion condition.
4. If too few attestations arrive (after `STUCK_TIMEOUT_MS = 2 min` with
   zero ready), the stuck-screen recovery overlay surfaces — same as
   the existing IPFS-failure path.

### 7.4 Implementation notes for native

- The push channel is installed at module load, so calls before React
  mounts are safe.
- Pushing on every attestation arrival from the chain is the right
  cadence. Batching is unnecessary and would only delay the user's
  visual feedback.
- The webview emits `flow.nft_reveal_started{count}` when the screen
  mounts; `count` is the number of attestations received so far (there is
  no known total upfront). Native may use it to confirm streaming.

### 7.5 Outcome derivation + the no-outcome handoff

The attestations are the only source of the result, so the webview can't
know pass/fail upfront. It resolves the outcome like this:

1. **Reveal first.** Cards light up as `pushAttestation` lands. The reveal
   is user-paced; the user collects what has arrived. There is no known
   total to wait on.
2. **Pass → `setGameOutcome({passed:true, ...})`.** Native fires it at the
   6th attestation, carrying `justBecameMember` / `prizeDraw` /
   `usernameClaim`. The webview shows the membership **verdict screen** off
   this call (emitting `flow.results_shown`), then prize draw / username CTA
   per the payload.
3. **Definitive fail → `setGameOutcome({passed:false})`** (optional, at
   native's ~10-min timeout) → the webview shows the failed verdict.
4. **No outcome yet + the stream goes quiet → handoff.** If neither arrives
   and no new attestation lands for the **stall window** (~9s quiet gap,
   ~45s absolute cap — tunable on device), the webview stops waiting in the
   foreground and shows a soft handoff: *"Your collectibles are still
   arriving — they'll show up in the app."* → Done. This never
   declares failure (a late-but-passing player and a true failer are
   indistinguishable here); a `setGameOutcome` arriving while the user is
   still on screen always wins and upgrades the screen.

**Back-compat.** If `setGameResults` arrives with a boolean
`attestations.passed`, the webview synthesizes the outcome from the upfront
fields immediately and skips the wait — old "outcome-known-upfront" native
works unchanged.

---

## 8. Existing Behaviors Native Should Know About

### 7.1 Pre-warming
The native side currently pre-warms a hidden WebView. This is fine —
the contract above doesn't change. The pre-warmed WebView fires
`flow.ready` early; native shouldn't infer anything from the timing
(it does not mean input has been consumed).

### 7.2 Display name fallback
If `member.displayName` is absent from input, the webview fires
`flow.request_display_name`. Native responds with
`window.setDisplayName(name)` at any point thereafter. Webview times
out after 3s and continues without a name (only affects the jackpot
overlay on win — every other screen tolerates absence).

### 7.3 Dismissal
The user-controlled `Done` button on the final screen fires
`flow.complete`. Native should close the WebView on this signal.
Native may also close at any time (e.g., user pressed system back) —
the webview tolerates abrupt teardown.

---

## 9. Implementation Checklist (Native)

### Required (load-bearing)

- [ ] Add `availability?: 'available' | 'taken' | 'unknown'` to
      `UsernameClaim` data class.
- [ ] Add `alternatives?: List<String>` to `UsernameClaim` data class.
- [ ] Update `GameResultsPayloadJson.encode()` to emit both fields when
      present (omit when null/empty).
- [ ] Install `window.setUsernameAvailability` JS interface. Sanitize:
      validate `availability` is one of the three strings; sanitize
      `alternatives` per §2.3 rules; reject malformed payloads silently.
- [ ] Wire the People Chain query: when game ends with
      `justBecameMember && eligible && suggestedUsername`, query
      `Identity::usernameOwnerOf(base)` and translate to
      `'available' | 'taken' | 'unknown'`. Push via the new method (or
      include in the initial input if fast enough).
- [ ] Install `window.pushAttestation` JS interface. Stream one push
      per passed attestation as it arrives from the chain (passed → 10,
      failed → 1–5). Pushes before the webview mounts the NFT screen are
      buffered; pushes during are reactive. See §7 for the full contract.
- [ ] **Install `window.setGameOutcome` JS interface.** Fire it once when
      the streamed attestation count reaches the passing threshold (**6**),
      with `{ passed: true, justBecameMember, prizeDraw, usernameClaim }`.
      The webview shows the membership verdict off this call. See §2.5 / §7.5.
- [ ] **Move the pass-gated fields out of `setGameResults` into
      `setGameOutcome`:** `attestations.passed`, `member.justBecameMember`,
      `prizeDraw`, `usernameClaim`. `setGameResults` upfront should carry
      only `attestations.total` + `member.displayName`. *(Optional during
      migration — the webview's back-compat path still reads them from
      `setGameResults` if you keep sending them.)*

### Recommended (graceful degradation)

- [ ] Handle `flow.username_availability_needed{name}` — use as a
      late-trigger if the pre-query wasn't done or hasn't returned.
- [ ] Handle `flow.error{phase, detail?}` — log for observability. Two
      known phases today: `boot_timeout` and `assets`.
- [ ] Send `setGameOutcome({ passed: false })` at your ~10-min attestation
      timeout, so the webview shows a definitive failed verdict instead of
      the soft "still arriving" handoff. Optional, but nicer for the tail.

### Not required but useful

- [ ] Stop sending the rank fields (`member.rankBefore` / `rankAfter` /
      `gamesInRank` / `gamesPerRank`). They are now optional and ignored
      by the webview — drop them whenever convenient. No webview change
      needed either way.
- [ ] Stop sending `prizeDraw.ticketDistance`. It is now optional and the
      webview simulates its own value (the chain can't compute a real one
      yet) — drop it whenever convenient.
- [ ] Stop sending `prizeDraw.totalEntries`. It is now optional and the
      webview no longer displays the pool size — drop it whenever
      convenient. (If sent it still scales the simulated lane distance.)
- [ ] On `'taken'`: populate `alternatives` from the reservation queue
      if available. Up to 5 suggested names. If you don't, the variant
      still renders without chips.
- [ ] Consider opening the WebView only after the availability query
      kicks off, so the request is in-flight by the time the user is
      seeing results. The webview will wait gracefully either way.

---

## 10. Out of Scope (Future)

These were identified during the design pass but deferred. The webview
does NOT currently consume them; native does NOT need to send them.

- **Member caution / suspension states.** Members who fail enter a
  caution period (still a member) or get suspended (no longer a
  member). Neither is currently in the contract. Proposed shape: add
  `memberStatus: 'active' | 'caution' | 'suspended'` to `MemberState`
  so the webview can render the correct emotional beat (gentle caution
  vs. heavy suspension vs. nothing for active). Until this lands, the
  failure copy in ResultsScreen stays uniform regardless of the
  player's prior member tier. The old `demoted: boolean` field is
  removed from the contract; native may stop sending it (the webview
  silently ignores it if present).
- Tied / shared prize (cowinners, prizeShare)
- Streak milestones (`OnChainVideoGameStreak`)
- User avatar
- Locale / non-USD currency display
- Native-authoritative NFT content (items are currently generated
  webview-side from a bundled slot table; flagged as a future native
  contract)
- Schema versioning

---

## 11. Test Scenarios (Dev Panel)

The dev panel (`?dev=1`) exercises every native contract path:

| Mock | Avail | What it tests |
|---|---|---|
| pass + new member + won | `'available'` | Full happy path with confident ceremony |
| pass + new member + lost | `'available'` | Win→lose path on the prize draw + ceremony |
| **pass + new member + name taken** | `'taken'` | Name-taken variant with alternatives |
| **new member + unknown avail** | `'unknown'` | Cautious-generic variant when query failed |
| **new member + async avail** | (absent) | Validates `setUsernameAvailability` async push |
| member + won | — | Existing member wins the weekly draw |
| member + lost | — | Existing member loses the weekly draw |
| member + failed | — | Existing member fails the game (no draw, no rank change) |
| first ever (candidate) | — | First-game-ever (rankBefore=null) |
| candidate failed (3/10) | — | Candidate-tier failure → `rankAfter: null` (progression wiped) |
| skunk (0/10) | — | No attestations ever stream → no `setGameOutcome` → stalls into the "still arriving, see the app" handoff (no upfront skip) |

> **Note (rank removal):** the rank card and progression UI were removed
> from the webview. Scenarios that previously differed only by rank tier
> or progression (e.g. "first ever", "candidate failed", member-tier
> variations) now render the same plain membership card. They remain
> useful for confirming native sends a well-formed payload and that the
> webview ignores the deprecated rank fields cleanly. The `rankAfter:
> null` rows no longer produce a "start over" placeholder — just uniform
> failure copy.

The dev panel also has "push availability" buttons that simulate
async `setUsernameAvailability` arrivals — use these in conjunction
with the `async avail` mock to verify the late-arrival flow.

**Attestation streaming in dev:** when a mock is loaded, the webview
auto-simulates native pushing attestations by calling
`window.pushAttestation` itself, staggered across ~4.5 seconds. This
exercises the same buffering / reactive-render path that real native
streaming uses. To validate against a real native build, disable the
mock and have native push via the real `pushAttestation` channel.

---

## 12. Versioning Note

There is no schema version field in the bridge today. Until one
exists, the contract must remain additive: native may add new optional
fields and the webview must tolerate them, but neither side may
require fields the other doesn't ship. The events table follows the
same rule: native must treat unknown event types as informational.
