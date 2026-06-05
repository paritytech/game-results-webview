// Orbiting energy particles around the orb.
//
// ~80 small additive points distributed on a sphere around the orb.
// Each particle has a unique phase + frequency so they twinkle and
// drift independently. As charge ramps, the particles contract
// inward toward the orb (orbit radius shrinks) and speed up.
//
// Implementation: a single THREE.Points with a custom shader. All
// per-particle state is encoded in vertex attributes; the vertex
// shader computes the live position per frame using uTime + uCharge
// uniforms, so there's NO CPU work per particle per frame (just one
// uniform write).
//
// Cost: 80 vertices, 1 draw call, simple vertex shader, soft circular
// fragment with alpha falloff. Negligible on mobile.

import { useEffect, useMemo, type MutableRefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const PARTICLE_COUNT = 100
// Camera at z=6 / fov 35° gives ~1.89 half-height world-unit
// visibility, so BASE_RADIUS at 1.40 sits at 74% of the visible
// frame — well clear of the canvas edge with room to drift.
const BASE_RADIUS = 1.40        // idle orbit radius (orb shell is r 1.0)
const CONTRACT_RADIUS = 1.05    // peak-charge orbit radius (just outside shell)

const VERTEX = /* glsl */ `
  precision mediump float;
  uniform float uTime;
  uniform float uCharge;
  uniform float uOpacity;
  uniform float uBaseRadius;
  uniform float uContractRadius;

  attribute vec3 aDir;       // unit vector — particle's home direction
  attribute float aPhase;    // 0..2pi twinkle/drift phase offset
  attribute float aFreq;     // 0.4..1.4 drift frequency multiplier
  attribute float aSize;     // 2..7 base point size px

  varying float vAlpha;

  void main() {
    // Live orbit radius — base contracts toward orb as charge ramps.
    float r = mix(uBaseRadius, uContractRadius, uCharge);

    // Drift: rotate the home direction by a small per-particle angle
    // that evolves over time, faster when charged. Cheap 2D rotation
    // around the y-axis (so particles orbit-equator-style).
    float t = uTime * (0.6 + uCharge * 1.4) * aFreq + aPhase;
    float c = cos(t);
    float s = sin(t);
    vec3 dir = vec3(
      aDir.x * c - aDir.z * s,
      aDir.y + sin(t * 1.3) * 0.04,  // gentle vertical bob (reduced
                                     // from 0.08 so particles stay
                                     // within the orbit-radius aura
                                     // rather than drifting past the
                                     // visible canvas frame)
      aDir.x * s + aDir.z * c
    );

    vec4 mvPos = modelViewMatrix * vec4(dir * r, 1.0);
    gl_Position = projectionMatrix * mvPos;

    // Size: a bit bigger when charged. Perspective scaling.
    float sz = aSize * (1.0 + uCharge * 0.6);
    gl_PointSize = sz / -mvPos.z * 60.0;

    // Twinkle: alpha oscillates per-particle.
    float twinkle = 0.55 + 0.45 * sin(t * 2.3);
    vAlpha = twinkle * uOpacity;
  }
`

const FRAGMENT = /* glsl */ `
  precision mediump float;
  uniform vec3 uColor;
  varying float vAlpha;

  void main() {
    // Soft circular falloff — distance from the point's centre.
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(uColor, a * vAlpha);
  }
`

interface OrbParticlesProps {
  isRare: boolean
  chargeRef: MutableRefObject<{ value: number }>
  opacityRef: MutableRefObject<{ value: number }>
}

export default function OrbParticles({
  isRare, chargeRef, opacityRef
}: OrbParticlesProps) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const positions = new Float32Array(PARTICLE_COUNT * 3)  // unused but
    const aDir = new Float32Array(PARTICLE_COUNT * 3)       // shader needs SOMETHING in position
    const aPhase = new Float32Array(PARTICLE_COUNT)
    const aFreq = new Float32Array(PARTICLE_COUNT)
    const aSize = new Float32Array(PARTICLE_COUNT)
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      // Uniformly-distributed point on a unit sphere (Marsaglia method).
      let x = 0, y = 0, z = 0, len = 0
      do {
        x = Math.random() * 2 - 1
        y = Math.random() * 2 - 1
        z = Math.random() * 2 - 1
        len = x * x + y * y + z * z
      } while (len === 0 || len > 1)
      const inv = 1 / Math.sqrt(len)
      aDir[i * 3 + 0] = x * inv
      aDir[i * 3 + 1] = y * inv
      aDir[i * 3 + 2] = z * inv
      // Position attribute satisfies THREE.Points; actual position is
      // computed in the vertex shader from aDir.
      positions[i * 3 + 0] = 0
      positions[i * 3 + 1] = 0
      positions[i * 3 + 2] = 0
      aPhase[i] = Math.random() * Math.PI * 2
      aFreq[i] = 0.4 + Math.random() * 1.0
      aSize[i] = 2.0 + Math.random() * 5.0
    }
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    g.setAttribute('aDir', new THREE.BufferAttribute(aDir, 3))
    g.setAttribute('aPhase', new THREE.BufferAttribute(aPhase, 1))
    g.setAttribute('aFreq', new THREE.BufferAttribute(aFreq, 1))
    g.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1))
    return g
  }, [])

  const material = useMemo(() => {
    const color = isRare
      ? new THREE.Color(0xffe8a8)   // warm gold for rare
      : new THREE.Color(0xc8d8ff)   // soft cyan-white for common
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime:           { value: 0 },
        uCharge:         { value: 0 },
        uOpacity:        { value: 1 },
        uBaseRadius:     { value: BASE_RADIUS },
        uContractRadius: { value: CONTRACT_RADIUS },
        uColor:          { value: color },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  }, [isRare])

  useFrame((_, delta) => {
    material.uniforms.uTime.value += delta
    material.uniforms.uCharge.value = chargeRef.current.value
    material.uniforms.uOpacity.value = opacityRef.current.value
  })

  useEffect(() => () => {
    material.dispose()
    geometry.dispose()
  }, [material, geometry])

  return <points geometry={geometry} material={material} />
}
