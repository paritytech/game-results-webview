// Native input reader + buffer.
//
// Mirrors game-end's __SCRATCH_INPUT__ pattern: native may have set the
// global BEFORE the webview's JS executed (immediate read), or may call
// setGameResults() AFTER our React tree mounts (deferred push). The
// buffer keeps a late-arriving input until React's subscriber registers.

import type {
  GameResultsInput, Attestations, MemberState, PrizeDraw, UsernameClaim
} from './types'
import { isValidAvailability, sanitizeAlternatives } from './availability'

type Listener = (input: GameResultsInput) => void

let bufferedInput: GameResultsInput | null = null
let listener: Listener | null = null

// ── Input normalization ──────────────────────────────────────────────
// Native is the source of truth but may be buggy: missing sub-objects,
// wrong types, out-of-range numbers, malformed strings, even a non-object
// payload. Everything downstream (App routing + every screen) reads
// `input.<x>.<y>` directly with no per-field checks, so we normalize ONCE
// here at the boundary and hand the rest of the app a guaranteed-shaped
// GameResultsInput. A non-object payload returns null (caller ignores it;
// the boot timeout then handles "no input"). This is the single chokepoint
// for the `setGameResults` / `__GAME_RESULTS__` contract — the streaming
// channels (pushAttestation / setUsernameAvailability / setDisplayName)
// already sanitize themselves.

// Contract is ~20 winners; cap so a buggy native can't blow out the lane DOM.
const MAX_WINNERS = 60

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}
function finiteNum(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}
function strictBool(v: unknown): boolean {
  return v === true
}
/** Trim, strip HTML-injection chars, cap length. Returns undefined when
 *  empty/non-string. Same rules as the setDisplayName channel. */
function cleanStr(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim().slice(0, max).replace(/[<>"'&]/g, '')
  return t || undefined
}
/** Normalize a hash-like field: lowercase, strip a leading 0x. Non-string
 *  → ''. (ticketDisplay / the resolver already tolerate empty/short/non-hex
 *  input, so we normalize the shape rather than reject.) */
function hexId(v: unknown): string {
  if (typeof v !== 'string') return ''
  const t = v.trim()
  return (t.startsWith('0x') || t.startsWith('0X') ? t.slice(2) : t).toLowerCase()
}

function normAttestations(v: unknown): Attestations {
  const o = asObject(v) ?? {}
  const totalRaw = Math.floor(finiteNum(o.total, 10))
  const total = totalRaw > 0 ? totalRaw : 10
  const a: Attestations = { total }
  // passed / score are no longer guaranteed upfront. Only carry them when
  // native actually sent them (the legacy "outcome-known-upfront" shape).
  // Their PRESENCE is the back-compat discriminator App uses to synthesize
  // the outcome instead of waiting for setGameOutcome.
  if (typeof o.passed === 'boolean') a.passed = o.passed
  if (typeof o.score === 'number' && Number.isFinite(o.score)) {
    a.score = Math.max(0, Math.min(total, Math.floor(o.score)))
  }
  return a
}

function normMember(v: unknown): MemberState {
  const o = asObject(v) ?? {}
  const m: MemberState = { justBecameMember: strictBool(o.justBecameMember) }
  const name = cleanStr(o.displayName, 24)
  if (name) m.displayName = name
  if (typeof o.memberSince === 'string') m.memberSince = o.memberSince
  // Deprecated rank fields are intentionally dropped — the webview ignores them.
  return m
}

export function normPrizeDraw(v: unknown): PrizeDraw | null {
  const o = asObject(v)
  if (!o) return null
  const userTicket = hexId(o.userTicket)
  // No usable ticket → treat as "no draw" rather than risk a half-built
  // object reaching the draw screen.
  if (!userTicket) return null
  const winningTickets = Array.isArray(o.winningTickets)
    ? o.winningTickets.map(hexId).filter(Boolean).slice(0, MAX_WINNERS)
    : []
  const draw: PrizeDraw = {
    prizeUsd: Math.max(0, finiteNum(o.prizeUsd, 0)),
    userTicket,
    winningTickets,
    nextDrawAt: typeof o.nextDrawAt === 'string' ? o.nextDrawAt : '',
    won: strictBool(o.won)
  }
  // Optional + webview-derived — pass finite numbers through, else omit.
  if (typeof o.ticketDistance === 'number' && Number.isFinite(o.ticketDistance)) draw.ticketDistance = o.ticketDistance
  if (typeof o.totalEntries === 'number' && Number.isFinite(o.totalEntries)) draw.totalEntries = o.totalEntries
  return draw
}

export function normUsernameClaim(v: unknown): UsernameClaim {
  const o = asObject(v) ?? {}
  const uc: UsernameClaim = { eligible: strictBool(o.eligible) }
  const suggested = cleanStr(o.suggestedUsername, 32)
  if (suggested) uc.suggestedUsername = suggested
  const previous = cleanStr(o.previousUsername, 32)
  if (previous) uc.previousUsername = previous
  if (isValidAvailability(o.availability)) uc.availability = o.availability
  const alts = sanitizeAlternatives(o.alternatives)
  if (alts) uc.alternatives = alts
  return uc
}

/** Coerce an arbitrary native payload into a guaranteed-shaped
 *  GameResultsInput. Returns null only when the payload isn't an object
 *  at all (caller ignores it). */
export function normalizeInput(raw: unknown): GameResultsInput | null {
  const o = asObject(raw)
  if (!o) return null
  return {
    attestations: normAttestations(o.attestations),
    member: normMember(o.member),
    prizeDraw: normPrizeDraw(o.prizeDraw),
    usernameClaim: normUsernameClaim(o.usernameClaim)
  }
}

function takeInitial(): GameResultsInput | null {
  try {
    return normalizeInput((window as unknown as Record<string, unknown>).__GAME_RESULTS__)
  } catch { /* ignore */ }
  return null
}

// Registered at module load so native can call window.setGameResults at
// any point — even before React has mounted — without the call being
// dropped.
;(window as unknown as Record<string, unknown>).setGameResults = (raw: unknown) => {
  const input = normalizeInput(raw)
  if (!input) {
    if (typeof console !== 'undefined') {
      console.warn('[input] setGameResults: ignoring malformed payload (not an object)')
    }
    return
  }
  if (listener) {
    listener(input)
  } else {
    bufferedInput = input
  }
}

// Display-name channel — separate from the input blob so native can
// respond to a `flow.request_display_name` event without re-pushing the
// whole GameResultsInput. Same buffer-or-deliver pattern as the input
// global above.
type NameListener = (name: string) => void
let nameListener: NameListener | null = null
let bufferedName: string | null = null

;(window as unknown as Record<string, unknown>).setDisplayName = (name: unknown) => {
  if (typeof name !== 'string') return
  const trimmed = name.trim().slice(0, 24).replace(/[<>"'&]/g, '')
  if (!trimmed) return
  if (nameListener) nameListener(trimmed)
  else bufferedName = trimmed
}

/** Subscribe to a display name pushed by native. Returns unsubscribe. */
export function subscribeDisplayName(cb: NameListener): () => void {
  nameListener = cb
  if (bufferedName) {
    cb(bufferedName)
    bufferedName = null
  }
  return () => { if (nameListener === cb) nameListener = null }
}

export function readInitialInput(): GameResultsInput | null {
  return takeInitial()
}

/** Subscribe to late-arriving input. Returns an unsubscribe function. */
export function subscribeInput(cb: Listener): () => void {
  listener = cb
  if (bufferedInput) {
    cb(bufferedInput)
    bufferedInput = null
  }
  return () => {
    if (listener === cb) listener = null
  }
}
