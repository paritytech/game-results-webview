import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { sfx } from '../audio/engine'

interface CollectAllButtonProps {
  visible: boolean
  onTap: () => void
  disabled?: boolean
  // True after the user taps but while we're waiting for the last few
  // composites to finish loading. Swaps the label and disables clicks
  // — the tap is "received" but the store-all is queued, not running.
  pending?: boolean
}

export default function CollectAllButton({ visible, onTap, disabled, pending }: CollectAllButtonProps) {
  const ref = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!ref.current) return
    if (visible) {
      gsap.fromTo(
        ref.current,
        { opacity: 0, y: 30, scale: 0.8 },
        { opacity: 1, y: 0, scale: 1, duration: 0.45, ease: 'back.out(1.6)' }
      )
      sfx.play('collect-all-appear')
    }
  }, [visible])

  if (!visible) return null
  return (
    <button
      type="button"
      ref={ref}
      className="collect-all-button"
      onClick={onTap}
      disabled={!!disabled || !!pending}
    >
      {pending ? 'Collecting…' : 'Collect all ⏭'}
    </button>
  )
}
