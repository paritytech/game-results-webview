// Custom shader material for the energy orb.
//
// Visual concept: a glowing fog/nebula sphere. Bright opaque core
// (color shifts with charge: cool blue → warm gold), softer
// translucent edges, animated 3D noise pattern flowing through the
// volume to sell "energy" rather than "solid object".
//
// Performance: fragment-heavy, vertex pass-through. Noise is a cheap
// hash-based pseudo-noise with 2 octaves — Perlin-quality coherent
// noise isn't necessary for a glowing orb effect and would tax mobile
// GPUs harder than the visual gain justifies.
//
// Uniforms driven from the React side:
//   uTime      — incremented each frame (drives animation)
//   uCharge    — 0..1, GSAP-tweened by Stage during tap-and-hold
//   uOpacity   — 0..1, faded by revealTimeline during spawn/burst
//   uColorIdle — base color when not charged (e.g. cool blue)
//   uColorPeak — peak color at full charge (e.g. warm gold; rare = warmer)

import * as THREE from 'three'

const VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vViewDir;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPos = viewMatrix * worldPos;
    vViewDir = normalize(-mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`

const FRAGMENT_SHADER = /* glsl */ `
  precision mediump float;

  uniform float uTime;
  uniform float uCharge;
  uniform float uOpacity;
  uniform vec3  uColorIdle;
  uniform vec3  uColorPeak;

  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vViewDir;

  // Hash-based pseudo-random in [0,1] per voxel — used as the source
  // for proper 3D value noise (full trilinear interpolation).
  float hash3(vec3 p) {
    p = fract(p * vec3(443.8975, 397.2973, 491.1871));
    p += dot(p, p.yxz + 19.19);
    return fract((p.x + p.y) * p.z);
  }

  // 3D value noise — samples all 8 voxel corners and interpolates
  // trilinearly with a smoothstep cubic for C1 continuity. Critical
  // for the wispy look: the previous 1-axis-interpolation version
  // produced banded artifacts that read as "flat color" rather than
  // visible turbulence.
  float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float c000 = hash3(i);
    float c100 = hash3(i + vec3(1.0, 0.0, 0.0));
    float c010 = hash3(i + vec3(0.0, 1.0, 0.0));
    float c110 = hash3(i + vec3(1.0, 1.0, 0.0));
    float c001 = hash3(i + vec3(0.0, 0.0, 1.0));
    float c101 = hash3(i + vec3(1.0, 0.0, 1.0));
    float c011 = hash3(i + vec3(0.0, 1.0, 1.0));
    float c111 = hash3(i + vec3(1.0, 1.0, 1.0));
    float x00 = mix(c000, c100, f.x);
    float x10 = mix(c010, c110, f.x);
    float x01 = mix(c001, c101, f.x);
    float x11 = mix(c011, c111, f.x);
    float y0 = mix(x00, x10, f.y);
    float y1 = mix(x01, x11, f.y);
    return mix(y0, y1, f.z);
  }

  // 3-octave fractal brownian motion — the visible "wisp" texture.
  // Each octave doubles in frequency, halves in weight. Per-octave
  // time offset directions vary so the layers swirl independently
  // rather than all moving in lockstep.
  float fbm(vec3 p, float t) {
    float a = vnoise(p + vec3(t * 0.12, t * 0.08, t * 0.17));
    a += 0.5  * vnoise(p * 2.3 + vec3(t * 0.35, t * 0.2, 0.0));
    a += 0.25 * vnoise(p * 5.1 + vec3(0.0, t * 0.4, t * 0.6));
    return a / 1.75;   // normalize to ~[0,1]
  }

  void main() {
    // dot(N, V) is 1.0 at center facing camera, 0.0 at silhouette
    // edges. coreGlow falls off softly across the surface; the
    // exponent SHARPENS with charge so idle reads as diffuse fog
    // and charge focuses it into a tight core.
    float centerWeight = max(dot(vNormal, vViewDir), 0.0);
    float coreGlow = pow(centerWeight, 0.7 + uCharge * 1.6);

    // Wisp texture — fbm at scale 1.2 gives ~2 visible features
    // across the orb diameter, large enough to read as wisps rather
    // than fine grain. Frequency rises with charge to add visual
    // turbulence as the orb winds up.
    float n = fbm(vWorldPos * (1.2 + uCharge * 0.9), uTime);

    // Color: idle base modulated by noise (bright wisps, dim valleys
    // — gives the surface visible variation rather than uniform
    // color). Charge tightens toward the peak color + adds a bright
    // white core flash.
    vec3 base = mix(uColorIdle, uColorPeak, uCharge);
    vec3 col = base * (0.3 + 1.0 * n) * (0.4 + 0.6 * coreGlow);
    col += vec3(1.0) * pow(uCharge, 2.5) * coreGlow * 0.7;

    // Alpha: at idle the alpha is MODULATED by the noise (creates
    // visible wisps + holes — the user sees through gaps in the orb).
    // Charge fills it in to uniform-ish opacity so the orb gathers
    // into a focused glow ready to burst.
    float baseAlpha = mix(0.05, 0.42, coreGlow);
    float wispyAlpha = baseAlpha * (0.25 + 1.2 * n);
    float chargedAlpha = mix(0.22, 0.82, coreGlow);
    float a = mix(wispyAlpha, chargedAlpha, uCharge) * uOpacity;

    gl_FragColor = vec4(col, a);
  }
`

export interface OrbUniformValues {
  uTime: number
  uCharge: number
  uOpacity: number
  uColorIdle: THREE.Color
  uColorPeak: THREE.Color
}

/** Build the orb shader material with default uniforms. The caller
 *  mutates `uniforms.<name>.value` from React refs / useFrame.
 *
 *  Palette philosophy: idle colors are saturated (orange-gold for
 *  rare, deep cyan-blue for common) so the un-charged orb reads as
 *  colored energy, never as a generic white glow. The peak (charged)
 *  colors warm toward white-gold for both — that's the "winding up"
 *  cue that pairs with the shader's increasing brightness. */
export function makeOrbMaterial(isRare: boolean): THREE.ShaderMaterial {
  const colorIdle = isRare
    ? new THREE.Color(0xd89030)   // deep amber gold (saturated, not pale)
    : new THREE.Color(0x4c70c8)   // deep cyan-blue (saturated, not pale)
  const colorPeak = isRare
    ? new THREE.Color(0xffe8a0)   // warm cream-gold at peak charge
    : new THREE.Color(0xd8e6ff)   // cool white-blue at peak charge

  return new THREE.ShaderMaterial({
    uniforms: {
      uTime:      { value: 0 },
      uCharge:    { value: 0 },
      uOpacity:   { value: 1 },
      uColorIdle: { value: colorIdle },
      uColorPeak: { value: colorPeak },
    },
    vertexShader:   VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.FrontSide,
  })
}
