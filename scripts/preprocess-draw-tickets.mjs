// Pre-process the prize-draw ticket art OFFLINE so the webview ships
// transparent, alpha-cropped WebP assets and does ZERO runtime
// chroma-keying. iOS WKWebView has a hard per-renderer memory ceiling;
// the old path ran getImageData() + a per-pixel JS loop + toDataURL()
// per ticket on entering the draw, which spiked memory and killed the
// WebContent process (black screen). This moves that work to build time.
//
// What it does (identical algorithm to the former src/draw/chromaKey.ts):
//   1. read the green-chroma source from art-src/draw/<name>.webp
//   2. key out the green to transparency (greenness > 28 → alpha ramp)
//   3. crop to the alpha bounding box (+3px padding)
//   4. encode a transparent WebP to public/assets/<name>.webp
//
// It does NOT rotate — the lane scene's landscape→portrait rotation
// stays a runtime step (src/draw/assets.ts rotate90CW) so none of the
// translation/layout logic has to change.
//
// Requires `sharp`. If it isn't installed here, the script borrows it
// from the sibling game-end project so it can run as-is; run
// `npm i -D sharp` to make it self-contained.
//
// Usage:  node scripts/preprocess-draw-tickets.mjs

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..')

let sharp
try {
  sharp = require('sharp')
} catch {
  // Fallback to the sibling game-end project's sharp so this runs without
  // a local install.
  sharp = require(path.resolve(repo, '../game-end/node_modules/sharp'))
}

const SRC_DIR = path.join(repo, 'art-src/draw')
const OUT_DIR = path.join(repo, 'public/assets')
const ASSETS = ['ticket', 'golden_ticket', 'winning_ticket']

// Matches the former runtime chroma-key thresholds exactly.
const GREEN_CUT = 28
const GREEN_RAMP = 55
const ALPHA_THRESHOLD = 24
const PAD = 3
const WEBP = { quality: 92, alphaQuality: 100, effort: 6 }

/** Key out the green chroma in-place on an RGBA buffer. */
function chromaKey(data) {
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
}

/** Bounding box of pixels with alpha above the threshold. */
function alphaBBox(data, W, H) {
  let minX = W, minY = H, maxX = -1, maxY = -1
  for (let y = 0; y < H; y++) {
    const row = y * W * 4 + 3
    for (let x = 0; x < W; x++) {
      if (data[row + x * 4] > ALPHA_THRESHOLD) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  return { minX, minY, maxX, maxY }
}

async function process(name) {
  const srcPath = path.join(SRC_DIR, `${name}.webp`)
  const outPath = path.join(OUT_DIR, `${name}.webp`)

  const { data, info } = await sharp(srcPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { width: W, height: H } = info

  chromaKey(data)
  const { minX, minY, maxX, maxY } = alphaBBox(data, W, H)

  const raw = sharp(data, { raw: { width: W, height: H, channels: 4 } })
  let outW = W, outH = H
  let pipeline = raw
  if (maxX >= 0) {
    const left = Math.max(0, minX - PAD)
    const top = Math.max(0, minY - PAD)
    const right = Math.min(W - 1, maxX + PAD)
    const bottom = Math.min(H - 1, maxY + PAD)
    outW = right - left + 1
    outH = bottom - top + 1
    pipeline = raw.extract({ left, top, width: outW, height: outH })
  }

  const buf = await pipeline.webp(WEBP).toBuffer()
  await writeFile(outPath, buf)
  return { name, srcSize: [W, H], outSize: [outW, outH], aspect: (outW / outH).toFixed(4), bytes: buf.length }
}

await mkdir(OUT_DIR, { recursive: true })
console.log(`sharp ${sharp.versions?.sharp ?? '?'} — keying ${ASSETS.length} tickets\n`)
for (const name of ASSETS) {
  const r = await process(name)
  console.log(
    `  ${name.padEnd(16)} ${r.srcSize.join('x').padEnd(9)} → ${r.outSize.join('x').padEnd(9)} ` +
    `aspect ${r.aspect}  ${(r.bytes / 1024).toFixed(1)} KB  → public/assets/${name}.webp`
  )
}
console.log('\nDone. Transparent, alpha-cropped assets written to public/assets/.')
