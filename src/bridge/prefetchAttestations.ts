// Attestation image prefetch.
//
// Warms the browser cache (and the IPFS gateway) for each attestation
// image as soon as its push arrives — which can be well before the NFT
// reveal screen mounts (pushes are buffered/streamed during boot →
// results → prize draw). The reveal screen later sets the SAME gateway
// URLs on its <img> elements, so by then they're cache hits and the
// gateway's cold-fetch latency has already been paid in the background.
//
// Only the user's actual attestations are prefetched (one per push,
// ≤ shelf size) — never the whole catalog. Best-effort and self-
// subscribing at import; failures are swallowed here (Stage.tsx owns
// real image-load-error accounting via __ASSET_FAILURES__).
//
// NOTE: this hides cold-gateway latency within a session and warms the
// gateway for later visitors, but it is not a substitute for pinning
// the CIDs on the gateway — the first global fetch of an unpinned CID
// is still slow. Re-upload/pin new cid_map entries via the resolver
// tool when the catalog changes.

import { subscribeAttestations } from './attestations'
import { resolveAttestationAsset } from '../attestations/resolver'

// Dedup by hash so duplicate / replayed pushes don't refetch.
const seen = new Set<string>()
// Hold references so the in-flight fetches aren't garbage-collected
// before they complete (and stay decoded/warm for the reveal).
const warming: HTMLImageElement[] = []

subscribeAttestations((payload) => {
  if (seen.has(payload.hash)) return
  seen.add(payload.hash)
  resolveAttestationAsset(payload.hash)
    .then(({ url }) => {
      const img = new Image()
      img.decoding = 'async'
      img.src = url
      warming.push(img)
    })
    .catch(() => { /* best-effort; reveal screen handles real errors */ })
})
