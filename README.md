> [!WARNING]
> The following is a prototype, reference implementation, and proof-of-concept. This open source code is provided for research, experimentation, and developer education only. This code has not been audited, is actively experimental, and may contain bugs, vulnerabilities, or incomplete features. Use at your own risk.

<div align="center">

# game-results

*A prototype post-game celebration screen — a native-embedded WebView that reveals a player's collectibles, membership, prize-draw result, and new username as one animated sequence.*

![Platform: iOS and Android WebView](https://img.shields.io/badge/platform-iOS%20%2B%20Android%20WebView-1E88E5?style=flat-square)

<!-- TODO: hero demo GIF. Capture the full flow (chest → reveal → verdict → prize draw) on an iPhone with Kap or CleanShot X — ~12s, ≤5MB, save to assets/screenshots/demo.gif, then embed it here:
<img src="assets/screenshots/demo.gif" alt="game-results: opening the chest, revealing collectibles, and the membership verdict" width="320">
-->

</div>

This is a prototype. It's the celebration screen a native app shows when a game
ends: the app opens this single-page WebView and hands it the result over a
JavaScript bridge. It plays the whole "what did I earn?" moment — chest,
collectibles reveal, membership verdict, prize draw, username — then tells
native when to close.

---

## Features

- **Treasure-chest open** — a tap-to-open intro that sets the stakes and buys a beat while the player's collectibles stream in from the chain.
- **Live collectibles reveal** — a shelf fills card-by-card as each attestation arrives; tap to flip and store, or Collect-All to skip ahead.
- **Membership verdict** — the pass/fail moment, with a celebratory membership card for players who just crossed into membership.
- **Prize draw** — members who pass watch the weekly draw play out (win or near-miss), with the prize shown as `CASH`.
- **Username reveal** — brand-new members see the handle they can claim next.
- **Resilient to slow data** — the game outcome is derived from a real-time stream, so the flow waits for it and hands off gracefully ("…they'll show up in the app shortly") when the data lags.
- **Calm by default** — every beat has a reduced-motion path, and the native bridge tolerates late or malformed input.

---

## Quick start

You run this locally as an ordinary web app; when embedded, it runs inside a
native app (see [Native integration](#native-integration)).

<details>
<summary>Prerequisites</summary>

- Node.js 20+

</details>

```bash
npm install
npm run dev          # Vite dev server at http://localhost:5173
```

Nothing is feeding it data locally, so open it with the dev panel and drive it
from mock scenarios:

```
http://localhost:5173/?dev=1
```

---

## Usage

The dev panel (shown only with `?dev=1`) loads realistic mock scenarios — each
one simulates the full native sequence (streams attestations, fires the
outcome) so you can walk the entire flow:

- **mock buttons** — member win/loss, new member (won / name-taken / unknown / async availability), candidate, skunk, …
- **slow → handoff** — streams a few cards but never resolves an outcome, exercising the "still arriving → app" handoff.
- **push availability** — simulate native's async username-availability result (`available` / `taken` / `unknown`).
- **reduced motion** — toggle the `prefers-reduced-motion` path on/off (overriding the OS setting) and replay the current mock, so you can exercise the reduced-motion branches without changing system preferences.

### URL parameters

| Param | Effect |
|---|---|
| `?dev=1` | Show the dev mock panel. |
| `?embed=1` | Force the embedded-in-native layout (the desktop phone-frame mock collapses to fill the viewport) without a native host. |
| `?reduced=1` | Force the reduced-motion path on (overrides the OS `prefers-reduced-motion` setting). Reproducible from a URL; the dev panel has a live toggle for the same override. |

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run build` | Static single-file build → `dist/index.html`. |
| `npm run preview` | Serve the built bundle (`--host` to reach it from a phone on your LAN). |

> iOS-WebKit-specific rendering can only be verified on a real device. Open a
> pull request — CI builds a preview and posts a URL you can open on an iPhone.
> See [DEPLOY_DOC.md](./DEPLOY_DOC.md).

---

## How it works

The game's outcome isn't known up front — a player's attestations stream in
from the chain over seconds-to-minutes, and the attestations *are* the result.
So the reveal leads the flow (absorbing that streaming time) and pass/fail is
resolved from the stream:

```
chest → collectibles reveal → membership verdict → prize draw → username → done
                                   (members)        (new members)
        └─ outcome never resolves in time? → "still arriving → app" handoff
```

Native streams one attestation per `pushAttestation` and fires
`setGameOutcome` once the count crosses the passing threshold; the reveal waits
until the stream settles, then advances. If nothing resolves in the
foreground, the webview never guesses a verdict — it hands off to the app. The
complete bridge contract (every method, payload, event, and timing rule) is in
[NATIVE_SPEC.md](./NATIVE_SPEC.md).

---

## Project structure

```
src/
  App.tsx        screen state machine + native-input wiring
  screens/       one component per beat (Chest, NFTReveal, Results, PrizeDraw, UsernameCTA, Handoff, Done, BootError)
  bridge/        the native contract: input / outcome / attestations / availability channels + outbound events
  components/    shared UI (Stage = the reveal shelf, SlotGrid, MemberCard, …)
  reveal3d/      the WebGL reveal orb (react-three-fiber)
  draw/          prize-draw lane scene + result hero + ticket helpers
  attestations/  hash → image resolver + CID map
  anim/ audio/ haptics/ particles/   motion, sound, haptic, particle engines
  devMocks.ts    ?dev=1 scenario fixtures
scripts/         offline asset preprocessing (chest + tickets → transparent WebP)
art-src/         source art for the preprocessors
```

Built with React 18, TypeScript, Vite 5 (single-file output), GSAP, and
three.js / @react-three/fiber. No backend — the webview only consumes what
native pushes; chain reads happen natively and IPFS image fetches go straight
to the gateway.

---

## Native integration

When embedded, this loads inside a native WebView (iOS WKWebView / Android).
Native delivers the result and streams attestations over the `gameResults`
bridge; the webview emits flow events back. Everything native must implement —
methods, payloads, events, timing, and edge cases — is in
[NATIVE_SPEC.md](./NATIVE_SPEC.md).

## Hosting the build

`npm run build` produces a single static `dist/index.html` you can host
anywhere. The setup used here serves it from the Polkadot Bulletin Chain
(content-addressed) bound to a DotNS `.dot` name — see
[DEPLOY_DOC.md](./DEPLOY_DOC.md) for that path and the GitHub Action.

## Regenerating art

Static art (chest, prize-draw tickets) ships pre-processed — chroma-keyed and
cropped to transparent WebP at build time, because runtime keying would blow
the iOS WebView memory ceiling. Source lives in `art-src/`:

```bash
node scripts/preprocess-chest.mjs          # art-src/chest/ → public/assets/chest/
node scripts/preprocess-draw-tickets.mjs   # art-src/draw/  → public/assets/
```

## License

[MIT](./LICENSE) © Parity Technologies
