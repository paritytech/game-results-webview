export const POOL_SIZE = 400

export type ParticleBlend = 'lighter' | 'source-over'
export type ParticleShape = 'circle' | 'soft'

export interface Particle {
  on: boolean
  x: number
  y: number
  vx: number
  vy: number
  s: number
  life: number
  max: number
  r: number
  g: number
  b: number
  grav: number
  drag: number
  blend: ParticleBlend
  shape: ParticleShape
}

export type Pool = Particle[]

// Spawn config: x and y are required; everything else falls back to a sane
// default in spawn(). Aliased to a partial Particle minus the `on`/`max`
// internal fields, plus required position.
export type ParticleConfig =
  Partial<Omit<Particle, 'on' | 'max' | 'x' | 'y'>> &
  { x: number; y: number }

export function createPool(): Pool {
  return Array.from({ length: POOL_SIZE }, () => ({
    on: false,
    x: 0, y: 0,
    vx: 0, vy: 0,
    s: 0,
    life: 0,
    max: 1,
    r: 255, g: 255, b: 255,
    grav: 0,
    drag: 0,
    blend: 'lighter' as ParticleBlend,
    shape: 'circle' as ParticleShape
  }))
}

export function spawn(pool: Pool, cfg: ParticleConfig): Particle | null {
  for (const p of pool) {
    if (p.on) continue
    p.on = true
    p.x = cfg.x
    p.y = cfg.y
    p.vx = cfg.vx ?? 0
    p.vy = cfg.vy ?? 0
    p.s = cfg.s ?? 3
    p.life = cfg.life ?? 0.7
    p.max = p.life
    p.r = cfg.r ?? 255
    p.g = cfg.g ?? 255
    p.b = cfg.b ?? 255
    p.grav = cfg.grav ?? 0
    p.drag = cfg.drag ?? 0
    p.blend = cfg.blend ?? 'lighter'
    p.shape = cfg.shape ?? 'circle'
    return p
  }
  return null
}
