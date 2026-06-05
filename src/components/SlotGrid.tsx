import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react'

// Imperative handle exposed to Stage so it can ask for slot elements/centers
// when a card is being stored.
export interface SlotGridApi {
  getSlotEl: (i: number) => HTMLDivElement | null
  getSlotCenter: (i: number) => { x: number; y: number } | null
}

interface SlotGridProps {
  filled: (string | null)[]
  silhouettes: (string | null)[]
  readySlots: Set<number>
  onSilhouetteClick?: (i: number) => void
  active?: boolean
  isFinale?: boolean
  onBadgeClick?: (i: number) => void
  /** Total card count for this session. 1..10. Drives the grid layout. */
  cardCount: number
}

// Per-count layout. cols picked so the shelf reads well on a portrait phone
// (390px wide); rows = ceil(count / cols). Last row centers its leftovers.
function pickLayout(count: number): { rows: number; cols: number } {
  if (count <= 1) return { rows: 1, cols: 1 }
  if (count === 2) return { rows: 1, cols: 2 }
  if (count === 3) return { rows: 1, cols: 3 }
  if (count === 4) return { rows: 2, cols: 2 }
  if (count <= 6) return { rows: 2, cols: 3 }
  if (count <= 9) return { rows: 3, cols: 3 }
  return { rows: 5, cols: 2 } // 10
}

const SlotGrid = forwardRef<SlotGridApi, SlotGridProps>(function SlotGrid(
  { filled, silhouettes, readySlots, onSilhouetteClick, active, isFinale, onBadgeClick, cardCount },
  ref
) {
  const slotRefs = useRef<(HTMLDivElement | null)[]>([])

  useImperativeHandle(ref, () => ({
    getSlotEl: (i) => slotRefs.current[i] ?? null,
    getSlotCenter: (i) => {
      const el = slotRefs.current[i]
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    }
  }), [])

  const { rows, cols } = useMemo(() => pickLayout(cardCount), [cardCount])

  // Build row → indices for layout. Last row may be partial; we let
  // flex justify-content:space-around center the leftovers naturally.
  const rowIndices = useMemo<number[][]>(() => {
    const out: number[][] = []
    let i = 0
    for (let r = 0; r < rows; r++) {
      const row: number[] = []
      for (let c = 0; c < cols && i < cardCount; c++) row.push(i++)
      out.push(row)
    }
    return out
  }, [rows, cols, cardCount])

  return (
    <div
      className={`slot-grid ${active ? 'is-active' : ''} ${isFinale ? 'is-finale' : ''}`}
      data-count={cardCount}
      data-cols={cols}
      aria-label="Collectibles shelf"
    >
      <div className="slot-grid-bg" aria-hidden="true" />
      {rowIndices.map((row, rowIdx) => (
        <div className="slot-row" key={rowIdx}>
          {row.map((i) => {
            const badge = filled?.[i]
            const silhouette = !badge ? silhouettes?.[i] : null
            const isReady = !!readySlots?.has(i)
            // Empty placeholder is shown whenever the slot has neither a
            // stored badge nor a tappable silhouette — i.e., before its
            // attestation arrives, or permanently if the user passed
            // fewer than 10. Makes the 10-slot shelf visually consistent
            // regardless of attestation count.
            const isEmpty = !badge && !silhouette
            return (
              <div
                className="slot"
                key={i}
                ref={(el) => { slotRefs.current[i] = el }}
              >
                {isEmpty && (
                  <span className="slot-empty" aria-hidden="true" />
                )}
                {badge && (
                  isFinale && onBadgeClick ? (
                    <button
                      type="button"
                      className="slot-badge-button"
                      onClick={() => onBadgeClick(i)}
                      aria-label={`View collectible ${i + 1}`}
                    >
                      <img
                        className="slot-badge"
                        src={badge}
                        alt=""
                        draggable={false}
                      />
                    </button>
                  ) : (
                    <img
                      className="slot-badge"
                      src={badge}
                      alt=""
                      draggable={false}
                    />
                  )
                )}
                {silhouette && (
                  <button
                    type="button"
                    className={`silhouette ${isReady ? 'is-ready' : ''}`}
                    onClick={() => { if (isReady) onSilhouetteClick?.(i) }}
                    disabled={!isReady}
                    aria-label={isReady ? `Reveal card ${i + 1}` : `Card ${i + 1} not ready yet`}
                  >
                    <span className="silhouette-ring" aria-hidden="true" />
                    <img
                      src={silhouette}
                      alt=""
                      draggable={false}
                    />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
})

export default SlotGrid
