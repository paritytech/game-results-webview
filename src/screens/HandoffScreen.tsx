// HandoffScreen — shown when the reveal finishes but the game outcome never
// resolved in the foreground (the attestation stream went quiet without
// crossing the passing threshold, and no setGameOutcome arrived).
//
// We deliberately do NOT declare failure here — a late-but-passing player
// and a true failer are indistinguishable at this point — so we hand off to
// the user's Pocket, where the collectibles land once the chain settles.
// Terminal screen: its button fires flow.complete so native can dismiss.

import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { sendFlowEvent } from '../bridge/send'
import { prefersReducedMotion } from '../anim/easings'

export default function HandoffScreen() {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!rootRef.current) return
    if (prefersReducedMotion()) {
      gsap.set(rootRef.current, { opacity: 1, y: 0 })
      return
    }
    gsap.fromTo(rootRef.current,
      { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out' }
    )
  }, [])

  function handleDone() {
    sendFlowEvent({ type: 'flow.complete' })
  }

  return (
    <div className="handoff-screen" ref={rootRef}>
      <div className="handoff-mark" aria-hidden="true">✦</div>
      <h1 className="handoff-headline">Still rolling in.</h1>
      <p className="handoff-sub">
        Your collectibles are still being secured — they'll show up in your
        Pocket shortly.
      </p>
      <button type="button" className="handoff-cta" onClick={handleDone}>
        Got it
      </button>
    </div>
  )
}
