// DoneScreen — the explicit exit point.
//
// Single CTA fires `flow.complete` so native can dismiss the webview.
// Native may also choose to close itself based on the event; the
// button is the user-controlled fallback either way.

import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { sendFlowEvent } from '../bridge/send'
import { prefersReducedMotion } from '../anim/easings'

interface DoneScreenProps {
  /** Optional copy below the headline (e.g., "Next game · Wednesday, 7 PM"). */
  nextGameHint?: string
}

export default function DoneScreen({ nextGameHint }: DoneScreenProps) {
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
    <div className="done-screen" ref={rootRef}>
      <h1 className="done-headline">See you<br />next time.</h1>
      {nextGameHint && <div className="done-hint">{nextGameHint}</div>}
      <button type="button" className="done-cta" onClick={handleDone}>
        Done
      </button>
    </div>
  )
}
