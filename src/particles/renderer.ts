import type { Pool } from './pool'

// Single canvas renderer: manages particle update + draw.
// Pauses on visibilitychange. Clamps dt to survive tab-switches.

export interface Renderer {
  dimensions(): { width: number; height: number }
  destroy(): void
}

export function createRenderer(canvas: HTMLCanvasElement, pool: Pool): Renderer {
  // desynchronized: low-latency presentation on Android Chrome.
  const maybeCtx = canvas.getContext('2d', { alpha: true, desynchronized: true })
  if (!maybeCtx) throw new Error('createRenderer: 2D context unavailable')
  // Re-bind to a const after the null guard so closures below see a
  // non-nullable type. (TS doesn't preserve narrowings into nested
  // function expressions even with const variables.)
  const ctx: CanvasRenderingContext2D = maybeCtx

  let width = 0
  let height = 0
  let dpr = 1
  let running = false
  let last = 0
  let rafId = 0

  function resize(): void {
    // Cap DPR at 1.75. On 3×+ phones this cuts particle fill by ~23% vs a
    // cap of 2; for soft glowing dots the extra resolution is invisible.
    dpr = Math.min(window.devicePixelRatio || 1, 1.75)
    const r = canvas.getBoundingClientRect()
    width = r.width
    height = r.height
    canvas.width = Math.floor(width * dpr)
    canvas.height = Math.floor(height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  function tick(t: number): void {
    if (!running) return
    const now = t / 1000
    const dt = last ? Math.min(0.032, now - last) : 0.016
    last = now

    ctx.clearRect(0, 0, width, height)

    // --- Particles: two passes to batch composite-operation changes ---
    // Pass 1: additive (glow)
    ctx.globalCompositeOperation = 'lighter'
    for (const p of pool) {
      if (!p.on || p.blend !== 'lighter') continue
      p.life -= dt
      if (p.life <= 0) { p.on = false; continue }
      p.vx -= p.vx * p.drag * dt
      p.vy -= p.vy * p.drag * dt
      p.vy += p.grav * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      const a = Math.max(0, p.life / p.max)
      // outer soft
      ctx.globalAlpha = a * 0.4
      ctx.fillStyle = `rgb(${p.r | 0},${p.g | 0},${p.b | 0})`
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.s * 2.2, 0, Math.PI * 2)
      ctx.fill()
      // inner bright
      ctx.globalAlpha = a
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2)
      ctx.fill()
    }

    // Pass 2: normal (dust)
    ctx.globalCompositeOperation = 'source-over'
    for (const p of pool) {
      if (!p.on || p.blend === 'lighter') continue
      p.life -= dt
      if (p.life <= 0) { p.on = false; continue }
      p.vx -= p.vx * p.drag * dt
      p.vy -= p.vy * p.drag * dt
      p.vy += p.grav * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      const a = Math.max(0, p.life / p.max)
      ctx.globalAlpha = a * 0.8
      ctx.fillStyle = `rgb(${p.r | 0},${p.g | 0},${p.b | 0})`
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.globalAlpha = 1
    rafId = requestAnimationFrame(tick)
  }

  function start(): void {
    if (running) return
    running = true
    last = 0
    rafId = requestAnimationFrame(tick)
  }

  function stop(): void {
    running = false
    cancelAnimationFrame(rafId)
  }

  function onVis(): void {
    if (document.hidden) stop()
    else start()
  }

  resize()
  window.addEventListener('resize', resize)
  document.addEventListener('visibilitychange', onVis)
  start()

  return {
    dimensions: () => ({ width, height }),
    destroy() {
      stop()
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVis)
    }
  }
}
