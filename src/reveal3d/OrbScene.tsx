// OrbScene — replaces the old Card DOM as the visual host for an
// in-progress reveal.
//
// Composition:
//   1. R3F <Canvas> rendering the 3D energy orb (custom shader).
//      Mounted lazily by Stage when a reveal starts.
//   2. DOM <img> overlay for the IPFS-loaded collectible image.
//      Initially hidden; revealTimeline fades + scales it in once
//      the orb has burst (Phase 3 may move it into the 3D scene
//      for a dissolve shader effect).
//
// Imperative API (OrbApi) — Stage drives the reveal via these refs:
//   root      — wrapper div, used by cardStore for dissolve-on-store
//   center    — viewport coords for particle-burst origin
//   orb       — Three.js mesh ref for direct GSAP mutation
//   image     — DOM <img> for opacity/scale tweens
//   charge    — { value: number } target for GSAP charge-up tween;
//               read by the orb shader uniform each frame
//   opacity   — { value: number } target for spawn/burst fade
//
// The root/center signatures intentionally mirror the OLD CardApi so
// cardStore consumes them unchanged.

import { Canvas } from '@react-three/fiber'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import * as THREE from 'three'
import Orb from './Orb'
import OrbParticles from './OrbParticles'
import { prefersReducedMotion } from '../anim/easings'

/** Module-level WebGL-lost flag. Set by the canvas's webglcontextlost
 *  listener on the first occurrence; checked by subsequent OrbScene
 *  mounts so they skip Three.js entirely (fall back to reduced-motion
 *  DOM-only reveal). Recovery would require a full screen remount;
 *  for the duration of the NFT-reveal session, once lost we stay
 *  lost — better than a flickering broken canvas. */
let webglLost = false
function isWebGLLost(): boolean { return webglLost }
function markWebGLLost(): void {
  if (webglLost) return
  webglLost = true
  console.warn('[reveal3d] webgl context lost — falling back to reduced-motion reveal for remaining collectibles')
}

/** Low-end heuristic: phones reporting <= 2GB device memory get the
 *  scaled-down particle path. `navigator.deviceMemory` is not always
 *  present (Safari hides it); absence is treated as "modern". */
function isLowEndDevice(): boolean {
  const dm = (navigator as unknown as { deviceMemory?: number }).deviceMemory
  return typeof dm === 'number' && dm <= 2
}

export interface OrbApi {
  /** Wrapper div — passed to cardStore for dissolve-on-store. */
  root: () => HTMLDivElement | null
  /** Center of the wrapper in viewport coords — for particle origin
   *  (matches CardApi.center signature so cardStore consumes it). */
  center: () => { x: number; y: number }
  /** Three.js mesh of the orb — for GSAP to drive scale. */
  orb: () => THREE.Mesh | null
  /** DOM image overlay — for GSAP to fade/scale during materialize. */
  image: () => HTMLImageElement | null
  /** Tween target for the tap-and-hold charge value (0..1). Read by
   *  the orb shader's uCharge uniform each frame; GSAP-tweened by
   *  Stage during hold. */
  charge: () => { value: number }
  /** Tween target for the orb's opacity (0..1). Driven by the reveal
   *  timeline during spawn (0→1) and burst (1→0). */
  opacity: () => { value: number }
}

interface OrbSceneProps {
  badgeSrc: string
  isRare: boolean
  /** Fired the moment R3F has committed the orb mesh to the scene.
   *  Stage uses this to trigger the spawn timeline at the exact
   *  ready-moment, no polling. */
  onOrbReady?: () => void
}

const OrbScene = forwardRef<OrbApi, OrbSceneProps>(function OrbScene(
  { badgeSrc, isRare, onOrbReady },
  ref
) {
  const rootRef = useRef<HTMLDivElement>(null)
  const orbRef = useRef<THREE.Mesh | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  // Plain object targets — GSAP tweens them, the orb shader reads
  // from them in useFrame. Using `useRef({ value })` instead of React
  // state so updates don't trigger re-renders.
  const chargeRef = useRef<{ value: number }>({ value: 0 })
  const opacityRef = useRef<{ value: number }>({ value: 1 })
  // R3F's WebGLRenderer, captured on canvas creation so we can free its
  // GPU context on unmount (see the teardown effect below).
  const glRef = useRef<THREE.WebGLRenderer | null>(null)
  // True only while THIS component is tearing itself down — lets the
  // contextlost listener ignore the loss WE deliberately trigger via
  // forceContextLoss (otherwise our own teardown would flip the whole
  // session into DOM-fallback for the remaining cards).
  const tearingDownRef = useRef(false)

  useImperativeHandle(ref, () => ({
    root: () => rootRef.current,
    center: () => {
      const el = rootRef.current
      if (!el) return { x: 0, y: 0 }
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    },
    orb: () => orbRef.current,
    image: () => imageRef.current,
    charge: () => chargeRef.current,
    opacity: () => opacityRef.current,
  }), [])

  // Determine the rendering path:
  //   - DOM-only fallback when reduced-motion OR WebGL was lost
  //     earlier this session. Skips the Canvas entirely — no shader
  //     compile, no GPU work, just an img.
  //   - Full 3D path otherwise.
  const useFallback = prefersReducedMotion() || isWebGLLost()
  const isLowEnd = isLowEndDevice()

  // Attach a webglcontextlost listener on the canvas the FIRST time
  // it mounts. Once a context is lost we treat the session as "no
  // more 3D" and subsequent reveals use the DOM fallback.
  const canvasContainerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (useFallback) return
    const container = canvasContainerRef.current
    if (!container) return
    const canvas = container.querySelector('canvas')
    if (!canvas) return
    const onLost = (e: Event) => {
      e.preventDefault()
      // Ignore the loss we deliberately cause during unmount teardown.
      if (tearingDownRef.current) return
      markWebGLLost()
    }
    canvas.addEventListener('webglcontextlost', onLost as EventListener)
    return () => canvas.removeEventListener('webglcontextlost', onLost as EventListener)
  }, [useFallback])

  // Free the WebGL context the moment this orb unmounts. Stage remounts a
  // fresh OrbScene (new <Canvas> → new context) for EVERY card, so a
  // 10-card reveal churns up to 10 contexts. iOS WKWebView caps live
  // WebGL contexts far lower than desktop and drops/kills the renderer
  // past the cap (black screen). R3F disposes on unmount, but
  // forceContextLoss() releases the GPU context IMMEDIATELY instead of
  // waiting on GC — the difference that matters on WebKit.
  useEffect(() => {
    return () => {
      const gl = glRef.current
      glRef.current = null
      if (!gl) return
      tearingDownRef.current = true
      try {
        gl.dispose()
        gl.forceContextLoss()
      } catch { /* already disposed / context already lost */ }
    }
  }, [])

  // Fallback path: snap the image to fully visible immediately. The
  // reveal timeline's `reduced` branch in revealSpawn/revealBurst
  // also short-circuits the animation, so the user sees the
  // collectible without any 3D ceremony.
  const initialImgStyle = useFallback
    ? { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' }
    : { opacity: 0, transform: 'translate(-50%, -50%) scale(0.6)' }

  return (
    <div
      className="orb-scene"
      ref={rootRef}
      data-rare={isRare ? 'true' : 'false'}
      data-fallback={useFallback ? 'true' : 'false'}
      // Expose the collectible's IPFS URL as a CSS variable so the
      // shimmer + aura pseudo-elements can use it as an alpha mask —
      // confining their effect to the IMAGE'S silhouette rather than
      // a rectangular bounding box.
      style={{ '--orb-image-url': `url("${badgeSrc}")` } as React.CSSProperties}
    >
      {!useFallback && (
        <div ref={canvasContainerRef} style={{ position: 'absolute', inset: 0 }}>
          <Canvas
            className="orb-canvas"
            gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
            onCreated={({ gl }) => { glRef.current = gl }}
            dpr={[1, 1.5]}
            // Camera at z=6 — pulled in from z=8 so the orb fills
            // ~53% of the canvas height instead of 34%. Combined
            // with the orb's geometry bump (radius 1.0 → from 0.85),
            // the orb has substantial on-screen presence again.
            // Visible half-height at z=6 / fov 35° = ~1.89 world
            // units, so particles at radius 1.4 sit at 74% of half-
            // height with comfortable margin from the canvas edge.
            camera={{ position: [0, 0, 6], fov: 35 }}
            frameloop="always"
          >
            {/* Light setup: the inner core mesh uses
                MeshStandardMaterial which needs scene lights. The
                outer shell shader is fully emissive so it ignores
                lights. Ambient + one warm key gives the core a
                subtle gradient. */}
            <ambientLight intensity={0.4} />
            <pointLight position={[2, 2.5, 3]} intensity={1.8} color="#fff5d0" />
            <Orb
              meshRef={orbRef}
              isRare={isRare}
              chargeRef={chargeRef}
              opacityRef={opacityRef}
              {...(onOrbReady ? { onReady: onOrbReady } : {})}
            />
            {!isLowEnd && (
              <OrbParticles
                isRare={isRare}
                chargeRef={chargeRef}
                opacityRef={opacityRef}
              />
            )}
          </Canvas>
        </div>
      )}
      {/* IPFS-loaded collectible image. In the 3D path, starts hidden
          and is faded in by revealTimeline.materialize. In fallback,
          starts visible immediately. */}
      <img
        className="orb-image"
        ref={imageRef}
        src={badgeSrc}
        alt=""
        draggable="false"
        style={initialImgStyle}
      />
      {/* Shockwave ring — CSS-animated by revealTimeline.burst via the
          data-shockwave attribute on .orb-scene. Sits on its own DOM
          element so it can coexist with the rare aura (::before) and
          shimmer (::after). */}
      <div className="orb-shockwave" aria-hidden="true" />
    </div>
  )
})

export default OrbScene
