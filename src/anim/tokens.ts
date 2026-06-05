// Central design tokens for scratch-card polish work. Numeric defaults
// here come from the AAA-polish research synthesis (haptics, brush
// mechanics, holo foil, sound design, reveal spectacle, pacing,
// debris). Treat as starting values to tune in QA.
//
// Importers should pull from this module rather than hard-coding so the
// tuning surface is one file.

// ---- Phase durations (ms) -------------------------------------------------
// The full scratch flow is 8 phases. Approach + Afterglow are the two
// most-cut beats in cheap implementations; we lengthen them deliberately.
export const PHASE = {
  approach: 900,            // entrance + settle before user can scratch
  invitationHintAt: 1500,   // ms of inactivity before first hint sweep
  invitationHintEvery: 5000,
  thresholdReveal: 0.58,    // sampled-erase fraction that triggers reveal
  thresholdRescue: 0.50,    // fallback threshold if user gets stuck near 45%
  thresholdBeat: 220,       // ms between threshold-cross and reveal start
  revealWin: 1400,          // total ms of win-reveal timeline
  revealPity: 600,          // total ms of pity-reveal timeline
  afterglow: 1200,          // hold before continue button appears
  collect: 550,             // prize-to-corner with squash
  return: 350,              // screen cross-fade out
  // Compressed timings used after the user has seen the ceremony once
  // in this session (localStorage 'scratch-card-seen-count' >= 1).
  approachNth: 600,
  afterglowNth: 900
} as const

// ---- Anti-frustration (scratching) ----------------------------------------
export const SCRATCH_FEEL = {
  velocityEMAAlpha: 0.2,    // smoothing on instantaneous stroke speed
  emitVelocityFloor: 0.05,  // px/ms — below this no debris, no audio loop
  tickThrottleMs: 80,       // minimum gap between scratch-tick haptics
  audioTickMinGapMs: 70,    // minimum gap between audio scratch-tick stamps
  slowScratchAfterMs: 2500, // hold-without-progress before brush widens
  slowScratchBoost: 1.5,    // brush radius multiplier when slow-scratching
  stuckRescueAfterMs: 2000, // hold near threshold before lowering it
  stuckRescueAt: 0.45       // sampled fraction that arms the rescue
} as const

// ---- Holo foil palette ----------------------------------------------------
// Simon Goellner's six-stop "sunpillar" palette — proven across thousands
// of holo cards. Intended use: a repeating-linear-gradient stop list for
// the foil shimmer layer with mix-blend-mode: color-dodge.
export const HOLO = {
  sunpillar: [
    'hsl(2, 100%, 73%)',
    'hsl(53, 100%, 69%)',
    'hsl(93, 100%, 69%)',
    'hsl(176, 100%, 76%)',
    'hsl(228, 100%, 74%)',
    'hsl(283, 100%, 73%)'
  ]
} as const

// ---- Debris particle physics ---------------------------------------------
// Two particle types: foil flakes (visible, bright, tumble) + dust motes
// (small, low-alpha, drift). Spawned tangent to stroke direction so
// material reads as flying off the brush, not radial.
export const DEBRIS = {
  emitPerEvent: { min: 1, max: 2, cap: 3 },
  flake: {
    sizeRange: [3, 6] as [number, number],   // px (logical / CSS)
    aspect: [1, 3] as [number, number],
    speedRange: [60, 140] as [number, number], // px/s along tangent
    tangentSpread: 0.25,                       // ±25% perpendicular jitter
    angleSpread: Math.PI / 7,                  // ±~25° emit cone
    gravity: 200,                              // px/s² — leaf-like
    drag: 0.96,                                // per frame at ~60fps
    angularVelocity: 6,                        // rad/s, ±
    lifetimeRange: [600, 1200] as [number, number], // ms
    shimmerPeriod: [600, 1000] as [number, number], // ms between flashes
    shimmerHotMs: 64,                          // ~4 frames at 60 fps
    backwardKick: 0.3                          // small negative-tangent fraction
  },
  dust: {
    sizeRange: [1, 2] as [number, number],
    speedRange: [20, 60] as [number, number],
    tangentSpread: 0.4,
    angleSpread: Math.PI / 4,                  // ±~45°
    gravity: 60,
    drag: 0.92,
    lifetimeRange: [300, 600] as [number, number]
  },
  // Rendering and quality scaling
  pool: 200,                                   // pre-allocated max
  maxAlive: { low: 40, mid: 80, high: 150 },
  groundOffsetPx: 8,                           // settle Y below card bottom
  settleHoldMs: 400,
  settleFadeMs: 300,
  fpsGuard: { window: 60, threshold: 50, downshiftAfterMs: 2000 },
  // Ratio of flake : dust spawns. ~70% flakes, 30% dust.
  flakeBias: 0.7
} as const

// ---- Scratch audio loop driver -------------------------------------------
// The scratch-loop sample is held at gain that scales with stroke speed.
// A biquad lowpass cutoff also rises with speed so the loop sounds bright
// when scratching fast and muffled when slow.
export const SCRATCH_AUDIO = {
  loopGainMaxAtVelocity: 2.0,   // px/ms — clamps to gain 0.9
  loopGainMax: 0.9,
  loopGainSmoothing: 0.04,      // setTargetAtTime time-constant
  filterFreqMin: 600,           // Hz — slow stroke
  filterFreqMax: 6000,          // Hz — fast stroke
  filterFreqVelocityScale: 3.0, // velocity / this clamps 0..1
  filterQ: 1.2,
  filterFreqSmoothing: 0.05,
  loopFadeOutSec: 0.06,         // quick stop on pointerup
  loopFadeOutAtThreshold: 0.15  // fade across threshold-cross beat
} as const

// ---- Reveal spectacle (win path) -----------------------------------------
// Beat boundaries inside the reveal timeline (ms from reveal-start).
export const REVEAL_BEATS = {
  anticipationStart: 0,
  anticipationEnd: 80,        // slow-mo + compress
  burstStart: 80,
  burstEnd: 180,              // light burst + chromatic
  particlesStart: 180,
  particlesEnd: 500,          // particles + card lift + light-rays appear
  holoPassStart: 500,
  holoPassEnd: 1200,          // gradient sweep + spring settle
  readyStart: 1200,
  readyEnd: 1400              // brief idle before afterglow continues
} as const

export const REVEAL_FX = {
  anticipationCompressScale: 0.97,
  burstFlashOpacity: 0.6,
  chromaticPx: 5,
  screenRumblePx: 6,
  screenRumbleMs: 200,
  cardLiftY: -20,
  cardLiftScale: 1.07,
  lightRays: {
    bladeCount: 12,
    rotationRadPerSec: 0.06,
    fadeInMs: 200,
    maxOpacity: 0.18
  },
  flakeBurstCount: 50,
  microStarBurstCount: 18,
  flakeBurstLifetimeMs: 1200,
  vignetteDarkOpacity: 0.35,
  vignetteSettleOpacity: 0.15,
  holoPassDurationMs: 700,
  holoPassWinkAt: 800,           // afterglow second wink
  holoPassWinkOpacity: 0.30
} as const

// ---- Card surface (idle / press) -----------------------------------------
export const SURFACE = {
  breathScale: 1.005,
  breathDurationSec: 4,          // sine in-out, yoyo, infinite
  pressSquashX: 1.005,
  pressSquashY: 0.995,
  pressSquashHoldMs: 80,
  pressSquashReleaseMs: 220,
  pressDebounceMs: 400,          // skip squash on rapid repeat presses
  shineTranslateMaxPx: { x: 60, y: 30 } // existing shine layer mapping
} as const
