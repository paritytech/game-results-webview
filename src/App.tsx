import { useEffect, useMemo, useRef, useState } from 'react'
import PhoneFrame from './components/PhoneFrame'
import ChestScreen from './screens/ChestScreen'
import ResultsScreen from './screens/ResultsScreen'
import PrizeDrawScreen from './screens/PrizeDrawScreen'
import NFTRevealScreen from './screens/NFTRevealScreen'
import UsernameCTAScreen from './screens/UsernameCTAScreen'
import HandoffScreen from './screens/HandoffScreen'
import DoneScreen from './screens/DoneScreen'
import BootErrorScreen from './screens/BootErrorScreen'
import ErrorBoundary from './components/ErrorBoundary'
import { readInitialInput, subscribeInput } from './bridge/input'
import { subscribeAvailability } from './bridge/availability'
import { resetAttestations, subscribeAttestations, bufferedAttestationCount } from './bridge/attestations'
import { subscribeOutcome, readBufferedOutcome, resetOutcome } from './bridge/outcome'
import { sendFlowEvent } from './bridge/send'
import { fetchDisplayName } from './bridge/fetchName'
import type { GameResultsInput, GameOutcome, UsernameAvailability } from './bridge/types'
import { DEV_MOCKS } from './devMocks'

// Dev-mode helper: simulate native streaming attestations into the webview
// after a mock is loaded, then firing setGameOutcome the way native would
// (passed → at the 6th attestation; failed → a beat after the stream ends,
// standing in for native's ~10-min timeout). Spread across STREAM_DURATION_MS
// so the realistic "still streaming in" timing gets exercised.
const STREAM_DURATION_MS = 4_500

/** Generate a realistic native-shape attestation hash: `0x` + 64
 *  lowercase hex chars (32 bytes). The CollectableHashResolver-based
 *  resolver consumes the first 4 bytes to derive rarity + image pick. */
function mockAttestationHash(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let h = '0x'
  for (let i = 0; i < bytes.length; i++) h += bytes[i]!.toString(16).padStart(2, '0')
  return h
}

// If native never pushes input, the boot screen would otherwise spin
// forever. After this many ms we transition to BootErrorScreen with a
// retry button + a Close that fires flow.complete so native can dismiss.
const BOOT_TIMEOUT_MS = 30_000

// The reveal "settles" (stops waiting for more cards, enabling the finale)
// when the outcome resolves, the stream goes quiet for this long, all 10
// arrive, or an absolute cap is hit. Tunable on device — see
// STREAMING_OUTCOME_PROPOSAL.md §7.
const STALL_QUIET_MS = 9_000
const REVEAL_CAP_MS = 45_000

type Screen =
  | 'boot' | 'boot_error' | 'chest' | 'nft_reveal' | 'results'
  | 'prize_draw' | 'username_cta' | 'handoff' | 'done'

// The collectibles reveal is the FIRST beat (after the chest) so it can
// absorb the time while attestations stream in. The outcome — pass/fail and
// everything gated on it — is NOT known upfront; it arrives via
// setGameOutcome (or is synthesized from a legacy setGameResults). So we
// always open the chest and let the reveal + outcome resolve the rest.
function firstScreen(_input: GameResultsInput): Screen {
  return 'chest'
}

/** Back-compat: a legacy "outcome-known-upfront" setGameResults still carries
 *  `attestations.passed`. Its presence lets us synthesize a GameOutcome
 *  immediately instead of waiting for setGameOutcome. Returns null for the
 *  current streaming-native shape (no upfront `passed`). */
function synthOutcome(input: GameResultsInput): GameOutcome | null {
  if (typeof input.attestations.passed !== 'boolean') return null
  return {
    passed: input.attestations.passed,
    justBecameMember: input.member.justBecameMember,
    prizeDraw: input.prizeDraw,
    usernameClaim: input.usernameClaim
  }
}

// After the reveal: go to the verdict if the outcome resolved, else hand off
// ("collectibles still arriving — see your Pocket").
function nextAfterReveal(outcome: GameOutcome | null): Screen {
  return outcome ? 'results' : 'handoff'
}
function nextAfterVerdict(outcome: GameOutcome | null): Screen {
  // Prize draw is members-only + pass-gated; then the username CTA (new
  // members), else Done.
  if (outcome?.passed && outcome.prizeDraw) return 'prize_draw'
  return outcome?.usernameClaim.eligible ? 'username_cta' : 'done'
}
function nextAfterPrizeDraw(outcome: GameOutcome | null): Screen {
  return outcome?.usernameClaim.eligible ? 'username_cta' : 'done'
}

// Dev panel is visible ONLY when the URL has `?dev=1` — regardless of
// build mode. `npm run dev` no longer auto-shows the panel; testers
// (mobile or desktop) opt in explicitly by appending the query string.
const isDevMode =
  typeof window !== 'undefined' && /[?&]dev=1\b/.test(window.location.search)

// "Embedded" = the page is running inside a native WebView host rather
// than a desktop browser preview. The phone-frame mockup (.phone-frame)
// is sized for desktop and collapses to height: 0 on a phone-shaped
// viewport, so when embedded we apply `body.is-embedded` and let the
// CSS in styles.css flatten the frame to fill the viewport.
const isEmbedded =
  typeof window !== 'undefined' && (
    !!(window as unknown as { gameResults?: unknown }).gameResults ||
    !!window.webkit?.messageHandlers?.gameResults ||
    /[?&]embed=1\b/.test(window.location.search)
  )

export default function App() {
  const frameRef = useRef<HTMLDivElement>(null)
  const [input, setInput] = useState<GameResultsInput | null>(() => readInitialInput())
  const [screen, setScreen] = useState<Screen>(() => {
    const initial = readInitialInput()
    return initial ? firstScreen(initial) : 'boot'
  })
  // The resolved game outcome — from setGameOutcome, or synthesized from a
  // legacy setGameResults. null until it arrives (streaming-native path).
  const [outcome, setOutcome] = useState<GameOutcome | null>(() => {
    const buffered = readBufferedOutcome()
    if (buffered) return buffered
    const i = readInitialInput()
    return i ? synthOutcome(i) : null
  })
  // The reveal stops waiting for more cards (enables the finale) once true.
  const [streamSettled, setStreamSettled] = useState(false)
  // Lets the user X out the dev panel for this session — reloading restores it.
  const [devPanelOpen, setDevPanelOpen] = useState(true)
  const hasFiredReady = useRef(false)
  const hasFiredPackShown = useRef(false)
  const hasFiredResultsShown = useRef(false)
  const hasFiredAvailabilityNeeded = useRef(false)
  const hasFiredAssetErrors = useRef(false)

  // Username availability — pushed independently via
  // window.setUsernameAvailability(...), or bundled in the outcome's
  // usernameClaim. Seeds from whichever outcome source is present at mount.
  const [availability, setAvailability] = useState<UsernameAvailability | undefined>(() => {
    const buffered = readBufferedOutcome()
    if (buffered) return buffered.usernameClaim.availability
    const i = readInitialInput()
    return i ? synthOutcome(i)?.usernameClaim.availability : undefined
  })
  const [alternatives, setAlternatives] = useState<string[] | undefined>(() => {
    const buffered = readBufferedOutcome()
    if (buffered) return buffered.usernameClaim.alternatives
    const i = readInitialInput()
    return i ? synthOutcome(i)?.usernameClaim.alternatives : undefined
  })

  // Subscribe to late-arriving native input.
  useEffect(() => {
    const off = subscribeInput((incoming) => {
      setInput(incoming)
      // Only route to the flow from the boot screens. A late/repeat push
      // mid-flow updates the data WITHOUT yanking the user back to the start.
      setScreen((prev) => (prev === 'boot' || prev === 'boot_error') ? firstScreen(incoming) : prev)
      // Back-compat: legacy native delivers the outcome inside setGameResults.
      // Only adopt it if setGameOutcome hasn't already resolved one.
      setOutcome((prev) => prev ?? synthOutcome(incoming))
      if (incoming.usernameClaim.availability) setAvailability(incoming.usernameClaim.availability)
      if (incoming.usernameClaim.alternatives) setAlternatives(incoming.usernameClaim.alternatives)
    })
    return off
  }, [])

  // Subscribe to the game outcome (the streaming-native path). It arrives
  // when native's attestation count crosses the passing threshold, or as a
  // definitive { passed: false } at native's timeout.
  useEffect(() => {
    const off = subscribeOutcome((o) => {
      setOutcome(o)
      // A definitive FAIL means nothing more will stream → settle the reveal.
      // A PASS does NOT settle: native keeps streaming the pack (up to 10)
      // after firing the outcome at the 6th, so we wait for the full stream.
      if (!o.passed) setStreamSettled(true)
      if (o.usernameClaim.availability) setAvailability(o.usernameClaim.availability)
      if (o.usernameClaim.alternatives) setAlternatives(o.usernameClaim.alternatives)
    })
    return off
  }, [])

  // Subscribe to async availability pushes — native may push the result
  // of its People Chain query independently of the outcome.
  useEffect(() => {
    const off = subscribeAvailability((p) => {
      // Last-write-wins, EXCEPT don't let a later 'unknown' clobber an
      // already-resolved 'available'/'taken'.
      setAvailability((prev) =>
        p.availability === 'unknown' && (prev === 'available' || prev === 'taken')
          ? prev
          : p.availability
      )
      if (p.alternatives) setAlternatives(p.alternatives)
    })
    return off
  }, [])

  // Resolve `streamSettled` while the reveal is up. A definitive FAIL
  // outcome settles immediately (nothing more streams); otherwise we settle
  // on a quiet gap (no new attestation for STALL_QUIET_MS), all 10 arriving,
  // or an absolute cap. A PASS deliberately does NOT settle here — the pack
  // keeps streaming up to 10 after the outcome fires at the 6th.
  useEffect(() => {
    if (outcome && !outcome.passed) { setStreamSettled(true); return }
    if (screen !== 'nft_reveal') return
    if (bufferedAttestationCount() >= 10) { setStreamSettled(true); return }
    const cap = window.setTimeout(() => setStreamSettled(true), REVEAL_CAP_MS)
    let quiet = window.setTimeout(() => setStreamSettled(true), STALL_QUIET_MS)
    const off = subscribeAttestations(() => {
      if (bufferedAttestationCount() >= 10) { setStreamSettled(true); return }
      window.clearTimeout(quiet)
      quiet = window.setTimeout(() => setStreamSettled(true), STALL_QUIET_MS)
    })
    return () => { window.clearTimeout(cap); window.clearTimeout(quiet); off() }
  }, [screen, outcome])

  // Boot timeout — if input never arrives, transition to the error screen.
  useEffect(() => {
    if (screen !== 'boot') return
    const t = window.setTimeout(() => {
      sendFlowEvent({ type: 'flow.error', phase: 'boot_timeout' })
      setScreen('boot_error')
    }, BOOT_TIMEOUT_MS)
    return () => window.clearTimeout(t)
  }, [screen])

  // Nudge native to query username availability if it didn't include the
  // result. Keyed off the resolved outcome (so it fires once we know the
  // user is a new member who's eligible, with a suggested name to query).
  useEffect(() => {
    if (hasFiredAvailabilityNeeded.current) return
    if (!outcome) return
    const uc = outcome.usernameClaim
    if (!outcome.justBecameMember) return
    if (!uc.eligible) return
    if (!uc.suggestedUsername) return
    if (availability) return  // already known
    hasFiredAvailabilityNeeded.current = true
    sendFlowEvent({
      type: 'flow.username_availability_needed',
      name: uc.suggestedUsername
    })
  }, [outcome, availability])

  // If the initial input is missing the user's display name, ask native
  // for it. Once it arrives we splice it into the member state.
  useEffect(() => {
    if (!input) return
    if (input.member.displayName) return
    let cancelled = false
    fetchDisplayName().then((name) => {
      if (cancelled || !name) return
      setInput((prev) => prev
        ? { ...prev, member: { ...prev.member, displayName: name } }
        : prev)
    })
    return () => { cancelled = true }
  }, [input?.member.displayName, input])

  // Tag <body> when running inside a native WebView so CSS can flatten
  // the desktop-shaped phone-frame mockup into the viewport.
  useEffect(() => {
    if (!isEmbedded) return
    document.body.classList.add('is-embedded')
    return () => { document.body.classList.remove('is-embedded') }
  }, [])

  // flow.ready fires once per page lifetime, after first paint.
  useEffect(() => {
    if (hasFiredReady.current) return
    hasFiredReady.current = true
    sendFlowEvent({ type: 'flow.ready' })
  }, [])

  // flow.pack_shown fires the first time the treasure-chest screen mounts.
  useEffect(() => {
    if (screen !== 'chest') return
    if (hasFiredPackShown.current) return
    hasFiredPackShown.current = true
    sendFlowEvent({ type: 'flow.pack_shown' })
  }, [screen])

  // flow.results_shown fires when the membership verdict screen mounts
  // (now AFTER the reveal, as its own screen).
  useEffect(() => {
    if (screen !== 'results') return
    if (hasFiredResultsShown.current) return
    hasFiredResultsShown.current = true
    sendFlowEvent({ type: 'flow.results_shown' })
  }, [screen])

  // Drive transitions.
  function advance(): void {
    if (!input) return
    if (screen === 'chest') {
      setScreen('nft_reveal')
    } else if (screen === 'nft_reveal') {
      // Verdict if the outcome resolved; otherwise the Pocket handoff.
      setScreen(nextAfterReveal(outcome))
    } else if (screen === 'results') {
      setScreen(nextAfterVerdict(outcome))
    } else if (screen === 'prize_draw') {
      setScreen(nextAfterPrizeDraw(outcome))
    } else if (screen === 'username_cta') {
      setScreen('done')
    }
    // 'handoff' is terminal (HandoffScreen fires flow.complete itself).
  }

  // Asset-error rollup: fired once if we entered 'done' with composite
  // failures recorded.
  useEffect(() => {
    if (screen !== 'done') return
    if (hasFiredAssetErrors.current) return
    const w = window as unknown as { __ASSET_FAILURES__?: number }
    const failures = w.__ASSET_FAILURES__ ?? 0
    if (failures > 0) {
      hasFiredAssetErrors.current = true
      sendFlowEvent({
        type: 'flow.error',
        phase: 'assets',
        detail: `composite_failures=${failures}`
      })
    }
  }, [screen])

  function handleBootRetry(): void {
    const fresh = readInitialInput()
    if (fresh) {
      setInput(fresh)
      setOutcome(readBufferedOutcome() ?? synthOutcome(fresh))
      setStreamSettled(false)
      setScreen(firstScreen(fresh))
      return
    }
    setScreen('boot')
  }

  function handleBootClose(): void {
    sendFlowEvent({ type: 'flow.complete' })
  }

  // ── Dev-mode mock loading ──────────────────────────────────────────────
  // Reset shared channels + per-session state for a fresh mock run.
  function startMockSession(upfront: GameResultsInput): void {
    resetAttestations()
    resetOutcome()
    setInput(upfront)
    setOutcome(null)
    setStreamSettled(false)
    setAvailability(undefined)
    setAlternatives(undefined)
    hasFiredPackShown.current = false
    hasFiredResultsShown.current = false
    hasFiredAvailabilityNeeded.current = false
    hasFiredAssetErrors.current = false
    setScreen(firstScreen(upfront))
  }

  // Simulate native: stream attestations, then fire setGameOutcome the way
  // native would. passed → after the 6th attestation; failed → a beat after
  // the stream ends (standing in for native's ~10-min timeout signal).
  function simulateNativeStream(streamCount: number, payload: GameOutcome): void {
    const w = window as unknown as {
      pushAttestation?: (p: unknown) => void
      setGameOutcome?: (p: unknown) => void
    }
    const step = STREAM_DURATION_MS / Math.max(1, streamCount || 1)
    for (let i = 0; i < streamCount; i++) {
      const delay = 200 + i * step
      window.setTimeout(() => w.pushAttestation?.({ index: i, hash: mockAttestationHash() }), delay)
      if (payload.passed && i === 5) {
        window.setTimeout(() => w.setGameOutcome?.(payload), delay + 250)
      }
    }
    if (!payload.passed) {
      const lastDelay = 200 + Math.max(0, streamCount - 1) * step
      window.setTimeout(() => w.setGameOutcome?.(payload), lastDelay + 1500)
    }
  }

  // Translate a (legacy-shaped) mock into the new model: an outcome-
  // independent upfront input + a GameOutcome delivered over the simulated
  // stream. This exercises the real streaming-native path end to end.
  function loadMock(buildFn: () => GameResultsInput): void {
    const mock = buildFn()
    const passed = mock.attestations.passed === true
    const total = mock.attestations.total
    const streamCount = passed
      ? Math.min(10, total)
      : Math.max(0, Math.min(total, mock.attestations.score ?? 0))
    const upfront: GameResultsInput = {
      attestations: { total },
      member: mock.member.displayName
        ? { justBecameMember: false, displayName: mock.member.displayName }
        : { justBecameMember: false },
      prizeDraw: null,
      usernameClaim: { eligible: false }
    }
    const payload: GameOutcome = {
      passed,
      justBecameMember: mock.member.justBecameMember,
      prizeDraw: mock.prizeDraw,
      usernameClaim: mock.usernameClaim
    }
    startMockSession(upfront)
    simulateNativeStream(streamCount, payload)
  }

  // Dev helper: a passing-looking stream that NEVER resolves an outcome, so
  // the reveal stalls into the Prizes-chat handoff.
  function devSlowNoOutcome(): void {
    startMockSession({
      attestations: { total: 10 },
      member: { justBecameMember: false, displayName: 'BYTEBORO' },
      prizeDraw: null,
      usernameClaim: { eligible: false }
    })
    const w = window as unknown as { pushAttestation?: (p: unknown) => void }
    for (let i = 0; i < 3; i++) {
      window.setTimeout(() => w.pushAttestation?.({ index: i, hash: mockAttestationHash() }), 200 + i * 900)
    }
  }

  // Dev helper: simulate native pushing availability asynchronously.
  function devPushAvailability(value: UsernameAvailability, alts?: string[]): void {
    const w = window as unknown as { setUsernameAvailability?: (p: unknown) => void }
    w.setUsernameAvailability?.({ availability: value, alternatives: alts })
  }

  const userName = useMemo(() => input?.member.displayName ?? '', [input])

  return (
    <div className="page">
      <PhoneFrame ref={frameRef}>
        <ErrorBoundary
          fallback={<BootErrorScreen onRetry={() => window.location.reload()} onClose={handleBootClose} />}
        >
        {screen === 'boot' && (
          <div className="boot-screen" aria-live="polite">
            <div className="boot-mark">⬤</div>
            <div className="boot-copy">Waiting for results…</div>
          </div>
        )}
        {screen === 'boot_error' && (
          <BootErrorScreen onRetry={handleBootRetry} onClose={handleBootClose} />
        )}
        {screen === 'chest' && input && (
          <ChestScreen onOpen={advance} />
        )}
        {screen === 'nft_reveal' && input && (
          <NFTRevealScreen
            frameRef={frameRef}
            streamSettled={streamSettled}
            onContinue={advance}
          />
        )}
        {screen === 'results' && outcome && (
          <ResultsScreen
            outcome={outcome}
            {...(userName ? { displayName: userName } : {})}
            onContinue={advance}
          />
        )}
        {screen === 'prize_draw' && outcome?.prizeDraw && (
          <PrizeDrawScreen
            draw={outcome.prizeDraw}
            name={userName}
            justBecameMember={outcome.justBecameMember}
            onContinue={advance}
          />
        )}
        {screen === 'username_cta' && outcome && (
          <UsernameCTAScreen
            {...(availability ? { availability } : {})}
            {...(outcome.usernameClaim.suggestedUsername
              ? { suggestedUsername: outcome.usernameClaim.suggestedUsername }
              : {})}
            {...(outcome.usernameClaim.previousUsername
              ? { previousUsername: outcome.usernameClaim.previousUsername }
              : {})}
            {...(alternatives ? { alternatives } : {})}
            onContinue={advance}
          />
        )}
        {screen === 'handoff' && (
          <HandoffScreen />
        )}
        {screen === 'done' && (
          <DoneScreen />
        )}
        </ErrorBoundary>
      </PhoneFrame>

      {isDevMode && devPanelOpen && (
        <div className="dev-panel" role="group" aria-label="Dev mock inputs">
          <span className="dev-panel-label">↪ mock input</span>
          {DEV_MOCKS.map((m) => (
            <button
              key={m.label}
              type="button"
              className="dev-panel-btn"
              onClick={() => loadMock(m.build)}
            >
              {m.label}
            </button>
          ))}
          <button
            type="button"
            className="dev-panel-btn"
            onClick={devSlowNoOutcome}
            title="Stream a few attestations but never resolve an outcome — exercises the stall → Prizes-chat handoff"
          >
            slow → handoff
          </button>
          <span className="dev-panel-label">↪ push availability</span>
          <button
            type="button"
            className="dev-panel-btn"
            onClick={() => devPushAvailability('available')}
            title="Simulate native pushing availability='available' via setUsernameAvailability"
          >
            available
          </button>
          <button
            type="button"
            className="dev-panel-btn"
            onClick={() => devPushAvailability('taken', [
              'byteboro1', 'byteboro_42', 'byteboroo', 'realbyteboro'
            ])}
            title="Simulate native pushing availability='taken' with alternatives"
          >
            taken
          </button>
          <button
            type="button"
            className="dev-panel-btn"
            onClick={() => devPushAvailability('unknown')}
            title="Simulate native pushing availability='unknown'"
          >
            unknown
          </button>
          <button
            type="button"
            className="dev-panel-btn dev-panel-btn--reload"
            onClick={() => window.location.reload()}
            title="Reload to reset all state"
          >
            ↻ reload
          </button>
          <button
            type="button"
            className="dev-panel-close"
            onClick={() => setDevPanelOpen(false)}
            title="Hide dev panel for this session — reload to bring it back"
            aria-label="Close dev panel"
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}
