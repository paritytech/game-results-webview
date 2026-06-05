// The energy-orb mesh. Uses a custom ShaderMaterial (orbShader.ts)
// for the glowing-fog look; uniforms are advanced each frame via
// useFrame (uTime) and read from refs the parent owns (uCharge,
// uOpacity).
//
// The geometry is a low-poly icosahedron — the surface detail comes
// from the fragment shader's noise pattern, not from triangle density,
// so we keep the vertex count tiny (mobile-friendly).

import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { makeOrbMaterial } from './orbShader'

interface OrbProps {
  isRare: boolean
  /** Mutable ref the parent (OrbScene) owns — populated with the
   *  THREE.Group once mounted, used by Stage/revealTimeline to drive
   *  scale via GSAP. The group contains BOTH the outer energy shell
   *  AND the inner solid core, so scaling the group scales them
   *  together. */
  meshRef: MutableRefObject<THREE.Mesh | null>
  /** Live charge value (0..1), GSAP-tweened by Stage during
   *  tap-and-hold. Drives the shader's uCharge uniform each frame. */
  chargeRef: MutableRefObject<{ value: number }>
  /** Live opacity value (0..1), GSAP-tweened during spawn/burst by
   *  the reveal timeline. Drives the shader's uOpacity uniform. */
  opacityRef: MutableRefObject<{ value: number }>
  /** Fired the moment the orb group is committed to the Three.js
   *  scene (R3F's ref callback fires). Used by Stage to trigger the
   *  spawn timeline at the EXACT moment the mesh is ready, instead
   *  of polling via rAF retries. Removes the desktop/mobile timing
   *  variance that caused "tap+hold doesn't work" symptoms. */
  onReady?: () => void
}

export default function Orb({ isRare, meshRef, chargeRef, opacityRef, onReady }: OrbProps) {
  // Outer energy shell — the custom shader gives the noise + fresnel
  // "energy glow" feel.
  const shellMaterial = useMemo(() => makeOrbMaterial(isRare), [isRare])

  // Inner core — a small ADDITIVE glow that adds brightness through
  // the shell rather than blocking it. At idle it's barely visible
  // (a soft spark); charge ramps its intensity dramatically so the
  // orb "ignites from within" as the user holds. Additive blending
  // is critical here: the previous opaque core sat ON TOP of the
  // shell's transparency, hiding the wispy texture behind a solid
  // disc — exactly the "massive white circle" the user saw.
  const coreMaterial = useMemo(() => {
    const color = isRare
      ? new THREE.Color(0xffd680)   // warm gold spark
      : new THREE.Color(0x90b8ff)   // cool blue spark
    return new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.0,            // hidden at idle (useFrame ramps with charge)
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  }, [isRare])

  const coreRef = useRef<THREE.Mesh>(null)

  // Drive shader uniforms each frame and animate idle rotation.
  // Both core + shell respect the same opacity envelope (driven by
  // revealSpawn/revealBurst) so they fade together. The core's
  // opacity ramps with charge so the orb visibly IGNITES from
  // within — invisible at idle, bright spark at peak charge.
  useFrame((_, delta) => {
    const c = chargeRef.current.value
    const o = opacityRef.current.value
    shellMaterial.uniforms.uTime.value += delta
    shellMaterial.uniforms.uCharge.value = c
    shellMaterial.uniforms.uOpacity.value = o
    // Core opacity: 0.0 idle → 1.0 at full charge (with a small
    // baseline floor so a hint of spark is visible mid-charge).
    // Cubic ramp so most of the core's appearance is biased toward
    // the END of the hold — feels like a sudden ignition rather
    // than a linear ramp.
    coreMaterial.opacity = c * c * 0.95 * o
    const m = meshRef.current
    if (m) {
      m.rotation.y += delta * 0.18
      m.rotation.x += delta * 0.11
    }
  })

  useEffect(() => () => {
    shellMaterial.dispose()
    coreMaterial.dispose()
  }, [shellMaterial, coreMaterial])

  return (
    // Group holds both shell + core so the timeline's scale animations
    // affect them together. Render order matters: the inner core
    // renders FIRST (behind), the shell renders SECOND (over the
    // core's additive glow). With both at the same z position, JSX
    // order controls Three.js's transparent render queue.
    <group
      ref={(g) => {
        meshRef.current = g as unknown as THREE.Mesh
        if (g && onReady) onReady()
      }}
      scale={0}
    >
      {/* Inner core — tiny additive spark (radius 0.22). Hidden at
          idle, ignites with charge. Rendered FIRST so the shell
          renders OVER it — without that ordering the core's solid
          shape covers the shell's wispy turbulence and the orb
          looks like a solid circle. */}
      <mesh ref={coreRef} material={coreMaterial} renderOrder={0}>
        <sphereGeometry args={[0.22, 24, 12]} />
      </mesh>
      {/* Outer energy shell — translucent, fresnel-glowing wisps.
          Radius 1.0 (was 0.85) for more on-screen presence at the
          camera's z=6 distance. */}
      <mesh material={shellMaterial} renderOrder={1}>
        <icosahedronGeometry args={[1.0, 3]} />
      </mesh>
    </group>
  )
}
