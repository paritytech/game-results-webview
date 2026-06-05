// Prize-draw asset loader. The three ticket assets ship pre-chroma-keyed
// and alpha-cropped (transparent WebP — see scripts/preprocess-draw-tickets.mjs),
// so this module does NO runtime getImageData/toDataURL chroma work; it
// just references the static URLs. iOS WKWebView has a hard per-renderer
// memory ceiling and the old runtime keying (per-pixel loop + toDataURL
// per ticket on entering the draw) spiked it enough to kill the WebContent
// process — moving it to build time removes that spike.
//
// The lane scene still needs portrait (end-on) tickets, so we rotate the
// landscape art 90° CW at runtime via a single cheap canvas draw
// (rotate90CW). That's deliberately kept in code so none of the
// translation/layout logic downstream has to change.
//
// Results are memoized (the rotation cache + the module-level
// cachedAssets), so a re-mount of PrizeDrawScreen is free.
//
// Three logical assets:
//   - ticket           — red standard ticket. Used for anonymous + user's
//                        ticket in the lane scene (before ignition).
//                        Both landscape (sealed/hero) and portrait (lane).
//   - goldenTicket     — bespoke gold variant for the gold band in the
//                        lane scene (after cut-line passes) AND the result
//                        hero on win. Both landscape and portrait.
//   - winningTicket    — the "winning ticket" landscape art used for the
//                        result hero's flipped face. Landscape only.

const ROTATE_CACHE = new Map<string, Promise<string>>()

/** Rotate a data URL image 90° clockwise (landscape → portrait). The
 *  landscape ticket has its "POLKADOT PRIZES" header at top-right; CW
 *  rotation maps that to the top-right of the portrait too (which is
 *  what reads as "top of the ticket" when viewed end-on in the lane).
 *
 *  Memoized by input URL so repeats are free. */
function rotate90CW(dataUrl: string): Promise<string> {
  const cached = ROTATE_CACHE.get(dataUrl)
  if (cached) return cached
  const work = new Promise<string>((resolve) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.height
      canvas.height = img.width
      const ctx = canvas.getContext('2d')
      if (!ctx) { resolve(dataUrl); return }
      // 90° CW: shift origin right by the new canvas width, then rotate +90°.
      // (x, y)_src → (height - y, x)_dst.
      ctx.translate(canvas.width, 0)
      ctx.rotate(Math.PI / 2)
      ctx.drawImage(img, 0, 0)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
  ROTATE_CACHE.set(dataUrl, work)
  return work
}

export interface DrawAssets {
  ticketLandscape: string
  ticketPortrait: string
  goldenLandscape: string
  goldenPortrait: string
  winningLandscape: string
  /** Natural aspect ratio (width / height) of the GOLD landscape ticket
   *  AFTER chroma-key crop. Used for the WIN lift — the win hero ticket
   *  renders `goldenLandscape` at width:340 + height:auto, so its visible
   *  height = 340 / heroAspect. The lift computes its target scaleX/Y
   *  from this so the lifted ticket lands at exactly the same dimensions
   *  as the win hero ticket. */
  heroAspect: number
  /** Natural aspect ratio (width / height) of the RED landscape ticket
   *  AFTER chroma-key crop. Used for the LOSS lift — the loss hero ticket
   *  renders `ticketLandscape`, NOT `goldenLandscape`, and the two crops
   *  may produce slightly different aspect ratios (the gold art has
   *  different padding/silhouette than the red). Without measuring them
   *  separately, the loss lift would land at gold-aspect dimensions but
   *  the hero ticket would render at red-aspect dimensions → visible
   *  size mismatch on the swap. */
  lossAspect: number
  ready: true
}

/** Measure an image's natural aspect ratio (width / height). Falls
 *  back to a reasonable landscape default if the image fails to load. */
function measureAspect(src: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const w = img.naturalWidth || 1
      const h = img.naturalHeight || 1
      resolve(w / h)
    }
    img.onerror = () => resolve(2.74)
    img.src = src
  })
}

let cachedAssets: Promise<DrawAssets> | null = null

/** Load + process all draw-stage assets. Result is cached across calls
 *  so a re-mount of PrizeDrawScreen is instant. */
export function loadDrawAssets(): Promise<DrawAssets> {
  if (cachedAssets) return cachedAssets
  cachedAssets = (async () => {
    // Pre-keyed transparent assets — used directly, no runtime processing.
    const ticketLandscape = './assets/ticket.webp'
    const goldenLandscape = './assets/golden_ticket.webp'
    const winningLandscape = './assets/winning_ticket.webp'
    // The only runtime canvas work left: rotate landscape → portrait for
    // the lane scene (cheap drawImage), plus two natural-size aspect reads.
    const [ticketPortrait, goldenPortrait, heroAspect, lossAspect] = await Promise.all([
      rotate90CW(ticketLandscape),
      rotate90CW(goldenLandscape),
      measureAspect(goldenLandscape),
      measureAspect(ticketLandscape)
    ])
    return {
      ticketLandscape,
      ticketPortrait,
      goldenLandscape,
      goldenPortrait,
      winningLandscape,
      heroAspect,
      lossAspect,
      ready: true
    }
  })()
  return cachedAssets
}
