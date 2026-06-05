// Tiny haptic-feedback engine for the pack-reveal flow.
//
// Lifecycle mirrors src/audio/engine.ts but is much simpler — no preload,
// no decode, no buffers. Just capability detection at module load, gesture
// init that mounts the iOS DOM helper, and a play(name) that dispatches
// to whichever backend(s) are available.
//
// Backends, picked once and used additively where supported:
//   1. Connected gamepad with vibrationActuator (Chrome/Edge desktop)
//   2. navigator.vibrate (Android Chrome / Edge / Samsung / Opera)
//   3. iOS Safari ≥18 switch+label trick (single light tap, no patterns)
//   4. else — silent no-op
//
// Sources of truth:
//   - https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate
//   - https://webkit.org/blog/15865/webkit-features-in-safari-18-0/  (switch haptics)
//   - https://developer.apple.com/design/human-interface-guidelines/playing-haptics
//
// Cross-cutting OS gates we cannot detect:
//   - System "haptics off" / Low Power Mode: OS swallows the call silently.
//   - prefers-reduced-motion: we honor it for celebration sequences.

export type HapticEvent =
  | 'silhouette-tap'
  | 'reveal-burst'
  | 'badge-land'
  | 'tap-store'
  | 'collect-all-appear'
  | 'cascade-start'
  | 'snap-fill'
  | 'legendary-flip'
  | 'legendary-reveal'
  | 'legendary-shimmer'
  | 'finale'
  | 'tap-view'
  // Scratch-card polish — added in the AAA polish pass.
  | 'scratch-tick'
  | 'threshold-cross'
  | 'reveal-win'
  | 'reveal-pity'
  | 'collect-confirm'

interface HapticPattern {
  // Android Chrome navigator.vibrate(): ms or [on,off,on,...] alternating.
  vibrate: number | number[] | null
  // iOS Safari ≥18 switch trick: number of switch fires, paced ~80 ms apart.
  // Each fire is a single light system tap; intensity is fixed by the OS.
  ios: number | null
  // Gamepad vibrationActuator dual-rumble. duration in ms, magnitudes 0..1.
  gamepad: { duration: number; strong: number; weak: number } | null
  // Whether this event is part of a "celebration sequence" — gated by
  // prefers-reduced-motion. Functional taps stay on; celebrations get
  // suppressed when the user has reduced motion enabled.
  celebration?: boolean
  // Per-pattern minimum gap override (ms). Defaults to MIN_GAP_MS (50).
  // scratch-tick uses 80 ms so per-stroke ticks don't jackhammer.
  minGapMs?: number
}

const PATTERNS: Record<HapticEvent, HapticPattern> = {
  // Light selection — discrete confirms / functional taps
  'silhouette-tap':     { vibrate: 8,  ios: 1, gamepad: { duration: 40, strong: 0.20, weak: 0.10 } },
  'tap-store':          { vibrate: 8,  ios: 1, gamepad: { duration: 40, strong: 0.20, weak: 0.10 } },
  'collect-all-appear': { vibrate: 6,  ios: 1, gamepad: { duration: 30, strong: 0.15, weak: 0.08 } },
  'tap-view':           { vibrate: 6,  ios: 1, gamepad: { duration: 30, strong: 0.15, weak: 0.08 } },

  // Medium impact — material landings, motion peaks
  'reveal-burst':       { vibrate: 18,             ios: 1, gamepad: { duration: 70, strong: 0.45, weak: 0.25 }, celebration: true },
  'badge-land':         { vibrate: [10, 30, 16],   ios: 1, gamepad: { duration: 80, strong: 0.55, weak: 0.30 } },

  // Heavy — legendary moments
  'legendary-flip':     { vibrate: 26,                       ios: 1, gamepad: { duration: 120, strong: 0.70, weak: 0.50 }, celebration: true },
  'legendary-reveal':   { vibrate: [20, 60, 30, 60, 40],     ios: 3, gamepad: { duration: 250, strong: 1.00, weak: 0.70 }, celebration: true },
  'legendary-shimmer':  { vibrate: [6, 120, 6, 120, 6],      ios: 3, gamepad: { duration: 180, strong: 0.30, weak: 0.20 }, celebration: true },

  // Hero / single-shot celebrations
  'cascade-start':      { vibrate: 16,                                ios: 1, gamepad: { duration: 80,  strong: 0.45, weak: 0.30 } },
  'snap-fill':          { vibrate: [0, 30, 30, 50],                   ios: 2, gamepad: { duration: 200, strong: 0.65, weak: 0.45 }, celebration: true },
  'finale':             { vibrate: [30, 80, 40, 80, 60, 100, 80],     ios: 3, gamepad: { duration: 400, strong: 0.55, weak: 0.45 }, celebration: true },

  // Scratch-card polish.
  // scratch-tick: per-stroke micro-tap. Throttled at 80 ms so even the
  // fastest pointermove sequence can't jackhammer. iOS skipped — the
  // switch trick is too coarse for a continuous gesture (and would feel
  // mechanical even if it weren't). Anti-fatigue research: 70–100 ms is
  // the sweet spot for stroke-scale haptics.
  'scratch-tick':       { vibrate: 6,  ios: null, gamepad: { duration: 25, strong: 0.18, weak: 0.10 }, minGapMs: 80 },
  // threshold-cross: the inflection beat. Two-tap "double knock" reads as
  // a discrete state change (vs the rolling micro-ticks of scratching).
  'threshold-cross':    { vibrate: [12, 40, 12], ios: 1, gamepad: { duration: 80, strong: 0.55, weak: 0.30 }, celebration: true },
  // reveal-win: heavy impact + warmer tail. Three iOS switch fires give
  // Safari users a felt crescendo within the OS's single-flavor limit.
  'reveal-win':         { vibrate: [22, 60, 16, 50, 14], ios: 3, gamepad: { duration: 200, strong: 0.85, weak: 0.55 }, celebration: true },
  // reveal-pity: nothing. The empathetic moment is silence — never give
  // the user a "you lost" buzz. Defined here for symmetry; play() no-ops.
  'reveal-pity':        { vibrate: null, ios: null, gamepad: null, celebration: true },
  // collect-confirm: discrete done-tap; lighter than tap-store.
  'collect-confirm':    { vibrate: 6,  ios: 1, gamepad: { duration: 30, strong: 0.18, weak: 0.10 } }
}

const STORAGE_KEY = 'haptic-muted'
const MIN_GAP_MS = 50         // anti-fatigue floor between any two fires
const IOS_SWITCH_GAP_MS = 80  // pacing between repeated iOS switch taps

interface Backends {
  vibrate: boolean
  ios: boolean
  // Gamepad is queried lazily — connections come and go during a session.
  hasGamepadAPI: boolean
}

function detectBackends(): Backends {
  if (typeof navigator === 'undefined') return { vibrate: false, ios: false, hasGamepadAPI: false }
  const ua = navigator.userAgent
  const isFirefoxAndroid = /Firefox/.test(ua) && /Android/.test(ua)
  const isIPhone = /iPhone|iPod/.test(ua) && !(window as unknown as { MSStream?: unknown }).MSStream
  // Match Safari version >= 18 in the iPhone UA. Apple bumps Version/X.Y on
  // Safari major releases; matches double-digit 18..99.
  const isSafari18Plus = isIPhone && /Version\/(1[89]|[2-9]\d)/.test(ua)
  return {
    vibrate: 'vibrate' in navigator && !isFirefoxAndroid,
    ios: isSafari18Plus,
    hasGamepadAPI: typeof navigator.getGamepads === 'function'
  }
}

function getActiveGamepad(): Gamepad | null {
  try {
    const pads = navigator.getGamepads ? navigator.getGamepads() : []
    for (const p of pads) {
      // The vibrationActuator property is present on a connected pad whose
      // hardware supports rumble. Some pads expose it as an object only after
      // the first input event — we still try.
      if (p && (p as Gamepad).vibrationActuator) return p
    }
  } catch {
    // Some browsers throw on getGamepads() before user activation.
  }
  return null
}

class HapticEngine {
  private backends: Backends = detectBackends()
  private muted: boolean = readMuted()
  // Reduced-motion is read once and watched — users can flip it mid-session
  // (system accessibility settings) and we honor it without reload.
  private reducedMotion: boolean = false
  private rmQuery: MediaQueryList | null = null
  // iOS switch+label DOM, mounted lazily on first gesture so non-iOS pages
  // never pay for the inert nodes.
  private iosLabel: HTMLLabelElement | null = null
  // Anti-fatigue: drop play()s arriving inside MIN_GAP_MS of the last fire.
  private lastFireAt: number = 0
  // Once the iOS switch click() ever throws, downgrade to no-op silently.
  private iosBroken: boolean = false

  constructor() {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      this.rmQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
      this.reducedMotion = this.rmQuery.matches
      const onChange = (e: MediaQueryListEvent) => { this.reducedMotion = e.matches }
      // addEventListener is the modern API; fall back to deprecated addListener
      // for older Safaris that haven't migrated.
      if (typeof this.rmQuery.addEventListener === 'function') {
        this.rmQuery.addEventListener('change', onChange)
      } else if (typeof (this.rmQuery as MediaQueryList & { addListener?: (cb: (e: MediaQueryListEvent) => void) => void }).addListener === 'function') {
        ;(this.rmQuery as MediaQueryList & { addListener: (cb: (e: MediaQueryListEvent) => void) => void }).addListener(onChange)
      }
    }
  }

  isSupported(): boolean {
    return this.backends.vibrate || this.backends.ios || this.backends.hasGamepadAPI
  }

  isMuted(): boolean { return this.muted }

  setMuted(muted: boolean): void {
    this.muted = muted
    try { window.localStorage.setItem(STORAGE_KEY, muted ? 'true' : 'false') } catch { /* private mode etc */ }
  }

  // Must be called from a user-gesture handler (the first silhouette tap).
  // Mounts the iOS DOM helper if applicable, and primes navigator.vibrate's
  // sticky user-activation by firing a zero-duration vibrate. Idempotent.
  initFromGesture(): void {
    if (this.backends.ios && !this.iosLabel) this.mountIosSwitch()
    if (this.backends.vibrate) {
      try { navigator.vibrate(0) } catch { /* harmless */ }
    }
  }

  play(name: HapticEvent): void {
    if (this.muted) return
    const pattern = PATTERNS[name]
    if (!pattern) return

    // prefers-reduced-motion gate: only fire functional taps in reduced mode.
    if (this.reducedMotion && pattern.celebration) return

    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now())
    const gap = pattern.minGapMs ?? MIN_GAP_MS
    if (now - this.lastFireAt < gap) return
    this.lastFireAt = now

    // pattern.vibrate=null AND pattern.ios=null AND pattern.gamepad=null
    // is a deliberate "no-op" entry (e.g. reveal-pity). Don't bother
    // touching backends — the symmetric play(name) call still served as
    // an explicit "this is the moment" landmark for callers.
    if (pattern.vibrate === null && pattern.ios === null && pattern.gamepad === null) return

    // Backends fire additively — a desktop user with a connected gamepad on
    // Chrome will get the gamepad rumble even though no other backend applies.
    if (this.backends.vibrate && pattern.vibrate !== null) {
      try { navigator.vibrate(pattern.vibrate) } catch { /* harmless */ }
    }
    if (this.backends.ios && !this.iosBroken && pattern.ios !== null) {
      this.fireIos(pattern.ios)
    }
    if (this.backends.hasGamepadAPI && pattern.gamepad) {
      this.fireGamepad(pattern.gamepad)
    }
  }

  private mountIosSwitch(): void {
    try {
      const input = document.createElement('input')
      input.type = 'checkbox'
      // The non-standard `switch` attribute is what Safari 18+ couples to
      // the system haptic. Setting it via setAttribute keeps TS happy and
      // applies even on browsers that don't recognise it (no-op there).
      input.setAttribute('switch', '')
      input.style.position = 'absolute'
      input.style.opacity = '0'
      input.style.pointerEvents = 'none'
      input.style.width = '0'
      input.style.height = '0'
      input.id = '__haptic_ios_switch__'
      const label = document.createElement('label')
      label.htmlFor = input.id
      label.style.position = 'absolute'
      label.style.opacity = '0'
      label.style.pointerEvents = 'none'
      label.style.width = '0'
      label.style.height = '0'
      label.setAttribute('aria-hidden', 'true')
      document.body.appendChild(input)
      document.body.appendChild(label)
      this.iosLabel = label
    } catch {
      this.iosBroken = true
    }
  }

  private fireIos(count: number): void {
    if (!this.iosLabel) return
    const label = this.iosLabel
    // First fire is synchronous (preserves user-activation context for the
    // current gesture); the rest are scheduled. Apple iOS ≥26.5 may have
    // patched programmatic firing; if click() ever throws we mark iosBroken
    // and stop trying for this session.
    const fireOnce = () => {
      try { label.click() } catch { this.iosBroken = true }
    }
    fireOnce()
    for (let i = 1; i < count; i++) {
      setTimeout(fireOnce, IOS_SWITCH_GAP_MS * i)
    }
  }

  private fireGamepad(spec: { duration: number; strong: number; weak: number }): void {
    const pad = getActiveGamepad()
    const actuator = pad?.vibrationActuator
    if (!actuator) return
    try {
      // playEffect returns a Promise on Chromium; ignore failures silently.
      const result = actuator.playEffect('dual-rumble', {
        duration: spec.duration,
        strongMagnitude: spec.strong,
        weakMagnitude: spec.weak
      })
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        ;(result as Promise<unknown>).catch(() => { /* ignored */ })
      }
    } catch {
      // Some implementations throw on bad params or detached pad — silent.
    }
  }
}

function readMuted(): boolean {
  try { return window.localStorage.getItem(STORAGE_KEY) === 'true' } catch { return false }
}

export const haptic = new HapticEngine()
