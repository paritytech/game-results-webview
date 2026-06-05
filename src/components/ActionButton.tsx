// Informational text shown during the reveal flow — NOT a button.
// The actual tap target is a full-area overlay in Stage.tsx so the user
// can tap anywhere on the card (or its surrounding area) to advance.
//
// The DOM node is stable across mode changes — text and a data attr swap
// in place so a CSS opacity transition handles "open" → "store" without
// the unmount-flicker that a `key={mode}` would cause.

export type ActionMode = 'open' | 'store' | 'release' | null

interface ActionLabelProps {
  mode: ActionMode
}

export default function ActionLabel({ mode }: ActionLabelProps) {
  const visible = !!mode
  // Empty fallback when mode is null — element fades out cleanly without
  // leaving any ghost text behind in the DOM during the opacity transition.
  // Mode progression during a single reveal:
  //   open    → "Tap and hold"  (idle / held but not yet past threshold)
  //   release → "Reveal!"       (past the commit threshold; let go)
  //   store   → "Tap for next"  (post-reveal, awaiting next-card tap)
  const text =
    mode === 'store' ? 'Tap for next' :
    mode === 'open' ? 'Tap and hold' :
    mode === 'release' ? 'Reveal!' :
    ''
  return (
    <div
      className="action-label"
      data-mode={mode ?? 'none'}
      data-visible={visible ? 'true' : 'false'}
      aria-hidden={!visible}
    >
      {text}
    </div>
  )
}
