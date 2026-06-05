import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { installDiagnostics } from './diag'
import { sfx } from './audio/engine'
// Side-effect import: subscribes to attestation pushes and prefetches
// each resolved image early, so the cold IPFS-gateway fetch is paid in
// the background (boot → results → prize draw) rather than blocking the
// NFT reveal. See src/bridge/prefetchAttestations.ts.
import './bridge/prefetchAttestations'

installDiagnostics()

// SFX globally disabled for now. Calling setMuted(true) at boot
// zeros the master gain, stops any in-flight loops, and short-circuits
// future play()/loop() calls — so every existing sfx.play(...) site
// in the codebase silently no-ops. Haptics are unaffected.
sfx.setMuted(true)

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('#root not found in index.html')

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>
)
