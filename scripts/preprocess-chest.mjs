// Slice the green-chroma treasure-chest sheet into 5 transparent WebP
// layers for ChestScreen: base / lid / treasure / lock / sparkles.
//
//   art-src/chest/chest-sheet.png  →  public/assets/chest/<name>.webp
//
// Uses the SAME real green-chroma key as the ticket preprocessor
// (greenness = g - max(r,b) → alpha ramp). The treasure's green emerald is
// keyed out along with the background — that's intentional, the gem doesn't
// matter. It still differs in one way: connected-component slicing. The
// sheet packs 5 sprites; we label opaque islands and bucket them by position
// into the 5 layers (the loose sparkles are many small islands unioned).
//
// Requires `sharp` (falls back to the sibling game-end project's copy).
// Usage:  node scripts/preprocess-chest.mjs

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..')
let sharp
try { sharp = require('sharp') }
catch { sharp = require(path.resolve(repo, '../game-end/node_modules/sharp')) }

const SRC = path.join(repo, 'art-src/chest/chest-sheet.png')
const OUT_DIR = path.join(repo, 'public/assets/chest')

// Green-chroma key tuning (matches the ticket preprocessor exactly).
const GREEN_CUT = 28   // greenness above this starts the alpha ramp
const GREEN_RAMP = 55  // ramp width (greenness) from opaque → transparent
const ALPHA_T = 28 // a pixel counts as "solid" for component labelling
const MIN_AREA = 24
const PAD = 4
const WEBP = { quality: 92, alphaQuality: 100, effort: 6 }

// Position buckets (centroid as a fraction of the sheet) → which sprite a
// component belongs to. Derived from the sheet layout (lid TL, treasure TR,
// base BL, lock mid-right, loose sparkles BR).
function bucketFor(cx, cy) {
  if (cy < 0.45 && cx < 0.55) return 'lid'
  if (cy < 0.46 && cx >= 0.55) return 'treasure'
  if (cy >= 0.45 && cx < 0.58) return 'base'
  if (cy >= 0.46 && cy < 0.66 && cx >= 0.58) return 'lock'
  if (cy >= 0.62 && cx >= 0.5) return 'sparkles'
  return null
}

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const W = info.width, H = info.height
const N = W * H

console.log(`sheet ${W}x${H}`)

// Real green-chroma key in place (greenness = g - max(r,b)). The treasure's
// emerald is green and gets keyed out too — intentional now.
for (let i = 0; i < data.length; i += 4) {
  const r = data[i], g = data[i + 1], b = data[i + 2]
  const maxRB = Math.max(r, b)
  const greenness = g - maxRB
  if (greenness > GREEN_CUT) {
    const alpha = Math.max(0, 1 - (greenness - GREEN_CUT) / GREEN_RAMP)
    data[i + 3] = Math.round(alpha * 255)
    // De-green semi-transparent edge pixels so they don't fringe.
    if (alpha > 0 && alpha < 1) data[i + 1] = maxRB
  }
}

// Connected-component labelling (8-connectivity) over alpha >= ALPHA_T.
const visited = new Uint8Array(N)
const stack = new Int32Array(N)
const comps = []
for (let p = 0; p < N; p++) {
  if (visited[p] || data[p * 4 + 3] < ALPHA_T) continue
  let sp = 0; stack[sp++] = p; visited[p] = 1
  let minX = W, minY = H, maxX = -1, maxY = -1, area = 0, sumX = 0, sumY = 0
  while (sp > 0) {
    const q = stack[--sp]
    const x = q % W, y = (q / W) | 0
    area++; sumX += x; sumY += y
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      const nq = ny * W + nx
      if (visited[nq] || data[nq * 4 + 3] < ALPHA_T) continue
      visited[nq] = 1; stack[sp++] = nq
    }
  }
  if (area >= MIN_AREA) comps.push({ minX, minY, maxX, maxY, area, cx: sumX / area / W, cy: sumY / area / H })
}
console.log(`components (area >= ${MIN_AREA}): ${comps.length}`)

// Bucket → unioned bbox.
const boxes = {}
for (const c of comps) {
  const name = bucketFor(c.cx, c.cy)
  if (!name) continue
  const b2 = boxes[name] ?? (boxes[name] = { minX: W, minY: H, maxX: -1, maxY: -1, area: 0 })
  b2.minX = Math.min(b2.minX, c.minX); b2.minY = Math.min(b2.minY, c.minY)
  b2.maxX = Math.max(b2.maxX, c.maxX); b2.maxY = Math.max(b2.maxY, c.maxY); b2.area += c.area
}

await mkdir(OUT_DIR, { recursive: true })
const base = sharp(data, { raw: { width: W, height: H, channels: 4 } })
for (const name of ['base', 'lid', 'treasure', 'lock', 'sparkles']) {
  const b2 = boxes[name]
  if (!b2 || b2.maxX < 0) { console.log(`  ${name.padEnd(9)} — NOT FOUND`); continue }
  const left = Math.max(0, b2.minX - PAD), top = Math.max(0, b2.minY - PAD)
  const right = Math.min(W - 1, b2.maxX + PAD), bottom = Math.min(H - 1, b2.maxY + PAD)
  const w = right - left + 1, h = bottom - top + 1
  const buf = await base.clone().extract({ left, top, width: w, height: h }).webp(WEBP).toBuffer()
  await writeFile(path.join(OUT_DIR, `${name}.webp`), buf)
  console.log(`  ${name.padEnd(9)} ${String(w).padStart(4)}x${String(h).padStart(4)}  ${(buf.length / 1024).toFixed(1)} KB`)
}
console.log('\nDone → public/assets/chest/')
