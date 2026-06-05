// BootErrorScreen — shown when the boot screen has been spinning past
// BOOT_TIMEOUT_MS without native pushing input. Two affordances:
//
//   - Retry: re-reads window.__GAME_RESULTS__ in case native finally
//            set it after our initial check. If still missing, returns
//            to the boot screen and re-arms the same timeout.
//   - Close: fires flow.complete so native can dismiss the webview
//            (or surface its own error surface). User-facing escape
//            hatch; can be safely tapped at any time.
//
// flow.error{phase: 'boot_timeout'} is already fired by App when this
// screen mounts, so native sees the event regardless of which button
// the user picks (or if they pick neither).

import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { prefersReducedMotion } from '../anim/easings'

interface BootErrorScreenProps {
  onRetry: () => void
  onClose: () => void
}

export default function BootErrorScreen({ onRetry, onClose }: BootErrorScreenProps) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    if (prefersReducedMotion()) {
      gsap.set(root, { opacity: 1, y: 0 })
      return
    }
    gsap.fromTo(root,
      { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out' }
    )
  }, [])

  return (
    <div className="boot-error-screen" ref={rootRef} aria-live="polite">
      <div className="boot-error-headline">Couldn't load your results.</div>
      <div className="boot-error-sub">Check your connection and try again.</div>
      <button
        type="button"
        className="boot-error-retry"
        onClick={onRetry}
      >
        Try again
      </button>
      <button
        type="button"
        className="boot-error-close"
        onClick={onClose}
      >
        Close
      </button>
    </div>
  )
}
