import { spawn, type Pool } from './pool'

const TAU = Math.PI * 2

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

export type Tint = [number, number, number]

export function dustBurst(
  pool: Pool,
  x: number,
  y: number,
  tint: Tint = [120, 90, 180]
): void {
  const count = 80
  for (let i = 0; i < count; i++) {
    const ang = rand(-Math.PI * 0.9, -Math.PI * 0.1)
    const speed = rand(40, 220)
    const jitter = rand(-12, 12)
    spawn(pool, {
      x: x + jitter,
      y: y + rand(-40, 40),
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      s: rand(2, 5),
      life: rand(0.5, 1.0),
      r: tint[0] + rand(-30, 30),
      g: tint[1] + rand(-30, 30),
      b: tint[2] + rand(-30, 30),
      grav: 620,
      drag: 0.7,
      blend: 'source-over',
      shape: 'soft'
    })
  }
}

// Generic card reveal: a shower of glowy blue/cyan sparkles radiating outward,
// plus some drifting "embers" that linger. Palette matches the reference shot.
export function sparkleBurst(pool: Pool, x: number, y: number): void {
  // Fast bright radial sparkles
  const fast = 180
  for (let i = 0; i < fast; i++) {
    const ang = rand(0, TAU)
    const speed = rand(240, 560)
    // Mostly bright cyan-white, a few pure whites for pop
    const white = Math.random() < 0.22
    const col: Tint = white
      ? [255, 255, 255]
      : [rand(120, 200), rand(210, 245), 255]
    spawn(pool, {
      x, y,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      s: rand(2.5, 5.5),
      life: rand(0.6, 1.1),
      r: col[0], g: col[1], b: col[2],
      drag: 1.6,
      blend: 'lighter',
      shape: 'circle'
    })
  }
  // Slow drifting embers that linger — bigger, softer
  const embers = 60
  for (let i = 0; i < embers; i++) {
    const ang = rand(0, TAU)
    const speed = rand(40, 140)
    spawn(pool, {
      x: x + rand(-20, 20),
      y: y + rand(-20, 20),
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed - rand(10, 60),
      s: rand(3, 6.5),
      life: rand(1.2, 2.0),
      r: rand(140, 200), g: rand(220, 240), b: 255,
      drag: 0.7,
      blend: 'lighter',
      shape: 'circle'
    })
  }
  // A small ring shockwave for that "pop" moment
  for (let i = 0; i < 18; i++) {
    const ang = (i / 18) * TAU
    spawn(pool, {
      x, y,
      vx: Math.cos(ang) * 520,
      vy: Math.sin(ang) * 520,
      s: 7,
      life: 0.3,
      r: 200, g: 240, b: 255,
      drag: 3.2,
      blend: 'lighter',
      shape: 'circle'
    })
  }
}

// Legendary / high-value reveal — warmer, bigger, wilder.
export function legendaryBurst(pool: Pool, x: number, y: number): void {
  const count = 280
  for (let i = 0; i < count; i++) {
    const ang = rand(0, TAU)
    const speed = rand(260, 640)
    const warm = Math.random() < 0.7
    const col: Tint = warm
      ? [255, rand(180, 230), rand(60, 120)]
      : [rand(180, 230), rand(210, 240), 255]
    spawn(pool, {
      x, y,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed - (warm ? 0 : rand(0, 120)),
      s: rand(2, 6),
      life: rand(0.9, 1.6),
      r: col[0], g: col[1], b: col[2],
      drag: 1.4,
      blend: 'lighter',
      shape: 'circle'
    })
  }
  for (let i = 0; i < 24; i++) {
    const ang = (i / 24) * TAU
    spawn(pool, {
      x, y,
      vx: Math.cos(ang) * 700,
      vy: Math.sin(ang) * 700,
      s: 8,
      life: 0.35,
      r: 255, g: 240, b: 200,
      drag: 3.5,
      blend: 'lighter',
      shape: 'circle'
    })
  }
}

export function badgeTrail(
  pool: Pool,
  x: number,
  y: number,
  tint?: Tint
): void {
  const count = 4
  for (let i = 0; i < count; i++) {
    spawn(pool, {
      x: x + rand(-6, 6),
      y: y + rand(-6, 6),
      vx: rand(-30, 30),
      vy: rand(-30, 30),
      s: rand(1.5, 3),
      life: rand(0.25, 0.5),
      r: tint?.[0] ?? 255,
      g: tint?.[1] ?? 240,
      b: tint?.[2] ?? 200,
      drag: 2,
      blend: 'lighter',
      shape: 'circle'
    })
  }
}

export function ambientStar(pool: Pool, width: number, height: number): void {
  spawn(pool, {
    x: rand(0, width),
    y: height + rand(0, 30),
    vx: rand(-12, 12),
    vy: rand(-60, -30),
    s: rand(1, 2.5),
    life: rand(1.8, 3.2),
    r: 255, g: rand(220, 250), b: rand(150, 200),
    drag: 0.3,
    blend: 'lighter',
    shape: 'circle'
  })
}

// Reveal atmosphere — bright scattered game-particle stars across the whole
// stage. Fires once at the flip reveal moment. Three tiers: pinprick, medium,
// hero. The renderer's additive two-pass (soft halo + bright inner) gives
// each particle the natural "glowing star" look without any extra effort.
export function revealStarfield(pool: Pool, width: number, height: number): void {
  const count = 60
  for (let i = 0; i < count; i++) {
    const roll = Math.random()
    let s: number
    let life: number
    if (roll < 0.55) {
      // Pinpricks — dense, quick-to-fade
      s = rand(1.0, 1.8)
      life = rand(0.8, 1.3)
    } else if (roll < 0.90) {
      // Medium stars
      s = rand(2.2, 3.2)
      life = rand(1.0, 1.5)
    } else {
      // Hero stars — the big bright ones with ~9–12px natural halos
      s = rand(4.0, 5.5)
      life = rand(1.1, 1.6)
    }
    // Cyan-white spectrum, with a minority of pure whites for sparkle variety
    const white = Math.random() < 0.15
    const col: Tint = white
      ? [245, 250, 255]
      : [rand(190, 225), rand(230, 250), 255]
    spawn(pool, {
      x: rand(0, width),
      y: rand(0, height),
      vx: rand(-15, 15),
      vy: rand(-15, 15),
      s,
      life,
      r: col[0], g: col[1], b: col[2],
      drag: 0.4,
      blend: 'lighter',
      shape: 'circle'
    })
  }
}

// Wispy nebula — 4 clusters of soft violet/indigo/cyan particles that
// overlap additively to read as drifting clouds rather than a uniform haze.
// Slightly longer lifetime than the stars so the nebula is the last thing
// to fade out as the card settles.
export function nebulaWisps(pool: Pool, width: number, height: number): void {
  const clusters = 4
  const perCluster: readonly number[] = [6, 6, 5, 5] // 22 total
  for (let c = 0; c < clusters; c++) {
    const ax = rand(width * 0.1, width * 0.9)
    const ay = rand(height * 0.1, height * 0.9)
    // Per-cluster drift direction so a whole wisp moves together.
    const driftX = rand(-20, 20)
    const driftY = rand(-15, 15)
    for (let i = 0; i < perCluster[c]!; i++) {
      // Palette mix: violet / indigo / cyan
      const tone = Math.random()
      let r: number
      let g: number
      let b: number
      if (tone < 0.4) {
        r = rand(100, 140); g = rand(60, 90);  b = rand(200, 240) // violet
      } else if (tone < 0.75) {
        r = rand(70, 110);  g = rand(90, 130); b = rand(210, 240) // indigo
      } else {
        r = rand(60, 100);  g = rand(160, 200); b = rand(230, 255) // cyan
      }
      spawn(pool, {
        x: ax + rand(-40, 40),
        y: ay + rand(-40, 40),
        vx: driftX + rand(-10, 10),
        vy: driftY + rand(-10, 10),
        s: rand(7, 14),
        life: rand(1.4, 2.1),
        r, g, b,
        drag: 0.6,
        blend: 'lighter',
        shape: 'circle'
      })
    }
  }
}

// Second wave for the legendary celebration — fires ~0.3 s after
// `legendaryBurst` to re-light the scene as the warm gold burst fades.
// Smaller count (100) keeps total in-flight headroom under the 400-pool
// even when ambientStar is also running.
export function legendaryFollowup(pool: Pool, x: number, y: number): void {
  // Bright cyan-white sparkle wave
  for (let i = 0; i < 80; i++) {
    const ang = rand(0, TAU)
    const speed = rand(180, 480)
    spawn(pool, {
      x, y,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      s: rand(2, 4.5),
      life: rand(0.55, 0.95),
      r: rand(180, 220), g: rand(230, 245), b: 255,
      drag: 1.4,
      blend: 'lighter',
      shape: 'circle'
    })
  }
  // Inner ring of pure white pinpricks for crispness on top of the gold
  for (let i = 0; i < 20; i++) {
    const ang = (i / 20) * TAU
    spawn(pool, {
      x, y,
      vx: Math.cos(ang) * 360,
      vy: Math.sin(ang) * 360,
      s: 5,
      life: 0.28,
      r: 255, g: 255, b: 255,
      drag: 3.0,
      blend: 'lighter',
      shape: 'circle'
    })
  }
}

// Instant tap feedback when the user taps a silhouette. Small bright pulse
// from the silhouette's center — the tap registers visually in the same
// frame as the click, so the 0.5 s cardEnter never feels like dead air.
export function silhouetteTap(pool: Pool, x: number, y: number): void {
  // Shockwave ring
  for (let i = 0; i < 14; i++) {
    const ang = (i / 14) * TAU
    spawn(pool, {
      x, y,
      vx: Math.cos(ang) * 320,
      vy: Math.sin(ang) * 320,
      s: 4,
      life: 0.28,
      r: 200, g: 240, b: 255,
      drag: 3.5,
      blend: 'lighter',
      shape: 'circle'
    })
  }
  // Cyan-white sparkles radiating
  for (let i = 0; i < 22; i++) {
    const ang = rand(0, TAU)
    const speed = rand(120, 300)
    spawn(pool, {
      x, y,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      s: rand(1.5, 3),
      life: rand(0.35, 0.65),
      r: rand(180, 220), g: rand(230, 250), b: 255,
      drag: 1.6,
      blend: 'lighter',
      shape: 'circle'
    })
  }
}
