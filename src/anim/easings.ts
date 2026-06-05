// Named easing presets following GSAP game-animation guidance.
// Entrances overshoot/settle, exits accelerate, symmetrical motion uses inOut.
export const EASE = {
  entrance: 'back.out(1.3)',
  entranceSoft: 'power3.out',
  exit: 'power2.in',
  flipIn: 'power2.in',
  flipOut: 'power2.out',
  flipInOut: 'power2.inOut',
  settle: 'elastic.out(1, 0.5)',
  settleSoft: 'back.out(1.8)',
  linear: 'none',
  float: 'sine.inOut',
  // Scratch-card polish — research-validated curves.
  // anticipation: a brief overshoot-then-back, sells weighty wind-up
  //   before a release. Disney "anticipation" principle.
  anticipation: 'back.out(1.7)',
  // impact: sharp ease-out, no anticipation; lands a hit and decays fast.
  impact: 'expo.out',
  // holoPass: smooth bidirectional sine for a gradient sweep across art.
  holoPass: 'sine.inOut',
  // settleSpring: a slightly more elastic settle for the reveal's card
  //   spring-rest (stiffness ~220, damping ~22 in spring physics terms).
  settleSpring: 'elastic.out(1, 0.55)'
} as const

/** True if the user has requested reduced motion in their OS / browser.
 *  GSAP timelines should check this and either short-circuit celebration
 *  beats entirely or replace springy curves with quick fades.
 *
 *  Read on each call (not cached) so the screen reacts if the user
 *  toggles the OS setting while the app is open. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches === true
}
