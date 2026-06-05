// revealTimeline — orchestrates a single reveal end-to-end:
//   spawn  → (charge → release → burst) → materialize → onRevealed
//
// Phase 2 implementation: real spawn animation that fades the orb in
// and breathes; charge mechanic lives in Stage.tsx (tap-and-hold);
// burst uses the existing ParticleCanvas dustBurst + a quick orb
// scale-up-then-fade. Phase 3 will add the dissolve shader on the
// materialized image. Phase 4 will add the pre-baked sprite-sheet
// burst + rare amplification.
//
// Replaces the old cardEnter + cardFlip + cardFlipLegendary trio.
// cardStore is unchanged (still handles badge arc-fly to slot).

import { gsap } from 'gsap'
import { EASE } from '../anim/easings'
import { sfx } from '../audio/engine'
import { haptic } from '../haptics/engine'
import type { OrbApi } from './OrbScene'
import type { ParticleCanvasApi } from '../components/ParticleCanvas'

interface SpawnOptions {
  /** Skip animations (reduced motion). Snap to final state. */
  reduced?: boolean
}

/** Spawn the orb: scale + opacity from 0 → 1 with a small overshoot,
 *  then a gentle breathing idle. Returns the GSAP timeline so callers
 *  can register an onComplete (e.g., transition to 'ready' phase). */
export function revealSpawn(
  api: OrbApi,
  particles: ParticleCanvasApi | null,
  stageRect: DOMRect,
  { reduced = false }: SpawnOptions = {}
): gsap.core.Timeline {
  const orb = api.orb()
  const opacity = api.opacity()
  const charge = api.charge()
  if (!orb) return gsap.timeline()

  // Reset state — orb invisible + uncharged at start of every reveal.
  orb.scale.set(0, 0, 0)
  opacity.value = 0
  charge.value = 0

  if (reduced) {
    // Snap to final visible state, no animation.
    orb.scale.set(1, 1, 1)
    opacity.value = 1
    return gsap.timeline()
  }

  sfx.play('card-enter')

  const tl = gsap.timeline()
  // Scale-in with overshoot.
  tl.to(orb.scale, {
    x: 1, y: 1, z: 1,
    duration: 0.55,
    ease: EASE.entrance,
    onUpdate: () => {
      const s = orb.scale.x
      orb.scale.y = s
      orb.scale.z = s
    }
  }, 0)
  // Opacity in parallel — fades faster than scale so the orb feels
  // "lit up" the moment it appears, then settles.
  tl.to(opacity, {
    value: 1,
    duration: 0.4,
    ease: 'power2.out'
  }, 0)
  // Tiny anchor pulse in 2D particles so the spawn is felt outside
  // the canvas too. Same pattern the silhouette tap uses.
  if (particles) {
    const c = api.center()
    tl.call(() => {
      particles.silhouetteTap(
        c.x - stageRect.left,
        c.y - stageRect.top
      )
    }, undefined, 0.05)
  }
  return tl
}

interface RevealOptions {
  isRare: boolean
  reduced?: boolean
  /** The user's released charge value (0..1) at commit time. Drives
   *  burst intensity — a fuller charge produces a bigger pop. */
  charge?: number
  /** Optional environment refs for rare-tier amplification — drive
   *  the screen-dim fade and screen-flash pulse during the burst.
   *  Stage owns these shared overlay elements and threads them
   *  through to the timeline. Common reveals still use flashEl for
   *  a brief white pop at burst. */
  env?: {
    dimEl?: HTMLElement | null
    flashEl?: HTMLElement | null
  }
}

/** Burst + materialize sequence — fires when the user commits to the
 *  reveal (Phase 1: single tap; Phase 2: release of a held charge).
 *  Orb scales out + fades; ParticleCanvas fires a dustBurst + sparkle;
 *  DOM image fades + scales in. Calls onRevealed once the image is
 *  fully visible. */
export function revealBurst(
  api: OrbApi,
  particles: ParticleCanvasApi | null,
  stageRect: DOMRect,
  { isRare, reduced = false, charge = 1.0, env }: RevealOptions,
  onRevealed: () => void
): gsap.core.Timeline {
  const orb = api.orb()
  const opacity = api.opacity()
  const img = api.image()
  if (!orb || !img) {
    onRevealed()
    return gsap.timeline()
  }

  if (reduced) {
    // Snap: orb gone, image instantly visible.
    orb.scale.set(0, 0, 0)
    opacity.value = 0
    gsap.set(img, { opacity: 1, scale: 1 })
    onRevealed()
    return gsap.timeline()
  }

  haptic.play('reveal-burst')
  sfx.play('reveal-burst')

  const tl = gsap.timeline({ onComplete: onRevealed })

  // Burst: orb scales up briefly (anticipation peak), then collapses
  // toward zero while fading out. Charge level scales the peak.
  const burstScale = 1.3 + charge * 0.4

  tl.to(orb.scale, {
    x: burstScale, y: burstScale, z: burstScale,
    duration: 0.18,
    ease: 'power2.out',
    onUpdate: () => {
      const s = orb.scale.x
      orb.scale.y = s
      orb.scale.z = s
    }
  }, 0)
  tl.to(orb.scale, {
    x: 0, y: 0, z: 0,
    duration: 0.22,
    ease: 'power2.in',
    onUpdate: () => {
      const s = orb.scale.x
      orb.scale.y = s
      orb.scale.z = s
    }
  }, 0.18)
  tl.to(opacity, {
    value: 0,
    duration: 0.28,
    ease: 'power2.in'
  }, 0.12)

  // Particle burst at the orb's center as it pops. Rare reveals use
  // the full legendary stack (richer + longer + warmer); common use a
  // simpler dust + sparkle pair.
  if (particles) {
    const c = api.center()
    const cx = c.x - stageRect.left
    const cy = c.y - stageRect.top
    if (isRare) {
      tl.call(() => {
        particles.legendaryBurst(cx, cy)
      }, undefined, 0.12)
      tl.call(() => {
        particles.legendaryFollowup(cx, cy)
      }, undefined, 0.32)
    } else {
      tl.call(() => {
        const tint: [number, number, number] = [180, 200, 255]
        particles.dustBurst(cx, cy, tint)
        particles.sparkleBurst(cx, cy)
      }, undefined, 0.15)
    }
  }

  // Rare-only environment dim — the rest of the screen falls back as
  // the burst commits, focusing the user's eye on the materializing
  // collectible. Restores after materialize so subsequent reveals
  // don't inherit a dimmed screen.
  if (isRare && env?.dimEl) {
    const dimEl = env.dimEl
    tl.to(dimEl, {
      opacity: 0.42,
      duration: 0.28,
      ease: 'power2.out'
    }, 0)
    tl.to(dimEl, {
      opacity: 0,
      duration: 0.45,
      ease: 'power2.inOut'
    }, 0.22 + (isRare ? 0.7 : 0.5) + 0.35)
  }

  // Screen-flash pulse at the burst peak — a brief white-out that
  // sells the "energy released" moment. Rare gets a stronger flash;
  // common gets a softer one. Carried over from the legacy
  // legendary-card path, where it was the most "wow" beat in the
  // reveal sequence.
  if (env?.flashEl) {
    const flashEl = env.flashEl
    const peakOpacity = isRare ? 0.85 : 0.4
    tl.to(flashEl, {
      opacity: peakOpacity,
      duration: 0.08,
      ease: 'power3.out'
    }, 0.12)
    tl.to(flashEl, {
      opacity: 0,
      duration: 0.35,
      ease: 'power2.in'
    }, 0.20)
  }

  // Rare-only shockwave — a ring of light expands outward from the
  // orb at the burst moment. Reserved for the rare tier so the common
  // burst stays clean and the rare reveal earns its escalation. CSS
  // owns the animation; we just toggle the data attribute.
  if (isRare) {
    tl.call(() => {
      const root = api.root()
      if (!root) return
      root.dataset.shockwave = 'true'
      window.setTimeout(() => {
        if (root.dataset.shockwave === 'true') root.dataset.shockwave = 'false'
      }, 700)
    }, undefined, 0.12)
  }

  // Materialize the image in parallel with the orb's collapse.
  //
  // The image "precipitates into existence" via a 3-property
  // animation:
  //   - opacity 0 → 1 + scale 0.55 → 1.0 (standard reveal)
  //   - filter blur(18px) → blur(0) (focuses into existence)
  //   - filter brightness(2.4) → brightness(1) (hot-bloom decay,
  //     so the image first appears overexposed and settles to its
  //     natural exposure as if photons just resolved into matter)
  //
  // This reads more "energy → matter" than a simple fade and aligns
  // with the orb-burst visual register. Rare reveals get a longer
  // hold + slower bloom decay (Phase 4 adds the rare amplification).
  const materializeDur = isRare ? 0.7 : 0.5
  tl.fromTo(img,
    {
      opacity: 0,
      scale: 0.55,
      filter: 'blur(18px) brightness(2.4)'
    },
    {
      opacity: 1,
      scale: 1,
      filter: 'blur(0px) brightness(1)',
      duration: materializeDur,
      ease: EASE.entrance
    },
    0.22
  )

  // Light-sweep shimmer overlay — a brief diagonal highlight wipes
  // across the image as it materializes, like a freshly-conjured
  // surface catching the light. Implemented as a CSS pseudo-element
  // animation (orb-image::after, see styles.css); GSAP triggers it
  // by toggling a data attribute on the orb-scene root.
  tl.call(() => {
    const root = api.root()
    if (!root) return
    root.dataset.shimmer = 'true'
    // Auto-cleanup after the CSS animation completes.
    window.setTimeout(() => {
      if (root.dataset.shimmer === 'true') root.dataset.shimmer = 'false'
    }, 900)
  }, undefined, 0.4)

  // Rare-only persistent aura — toggled on after materialize completes.
  // CSS owns the pulsing animation (.orb-scene[data-rare-revealed=true]
  // ::before, see styles.css). Lives until the orb-scene unmounts on
  // store, no JS cleanup needed.
  if (isRare) {
    tl.call(() => {
      const root = api.root()
      if (root) root.dataset.rareRevealed = 'true'
    }, undefined, 0.22 + (isRare ? 0.7 : 0.5))
  }

  return tl
}

/** Cancel an in-progress charge — orb shrinks the bright peak back
 *  toward idle and the charge value tweens to 0. Called when the
 *  user releases below the commit threshold. */
export function revealChargeCancel(api: OrbApi): gsap.core.Tween {
  const charge = api.charge()
  return gsap.to(charge, {
    value: 0,
    duration: 0.28,
    ease: 'power2.out'
  })
}
