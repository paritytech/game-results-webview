// Lightweight diagnostic logger for the WebView host. The host's
// WebChromeClient pipes console.* calls into logcat under tag "PrizeJS",
// so anything written here lands in `adb logcat -s PrizeJS:*` in the
// Android app, and in Safari Web Inspector / Xcode Console on iOS.
//
// The whole module is a no-op-ish set of one-shot diagnostics that
// answer two questions whenever the bundle fails to render fully:
//
//   1. WHERE IS THE DOCUMENT LOADED FROM?  We log document.location.href
//      at module-init time. If it starts with `file://`, the host's
//      remote-loader fell back to the bundled offline copy; if it's
//      `https://...`, the live deploy is in use. Subresource paths are
//      relative-to-document, so this single log answers most "why are
//      images 404'ing" questions on its own.
//
//   2. WHICH SUBRESOURCE FAILED?  We attach a capture-phase 'error'
//      listener that logs any image / script / link / iframe / video /
//      audio / source element that fails to load, with its absolute
//      resolved URL. Combined with (1), this tells us the exact path
//      the WebView tried to fetch and whether it was http or file.
//
// The cost is a single addEventListener and one console.log on boot —
// imperceptible. Designed to be left on in production-debug builds.

declare global {
  interface Window {
    __PCR_DIAG_INSTALLED__?: boolean
  }
}

export function installDiagnostics(): void {
  if (typeof window === 'undefined') return
  if (window.__PCR_DIAG_INSTALLED__) return
  window.__PCR_DIAG_INSTALLED__ = true

  // (1) Document origin tracer.
  // Logs the FIRST thing the host should see in logcat — confirms which
  // bundle is actually rendering. If this is `file://...`, we know the
  // host's remote-loader fell back to the offline copy.
  try {
    const here = window.location.href
    const ua = navigator.userAgent
    // eslint-disable-next-line no-console
    console.log(`[diag] boot href=${here} ua=${ua}`)
  } catch { /* unreachable in a browser */ }

  // (2) Subresource error capture. Capture phase so we see errors that
  // bubble up from <img>, <script>, <link>, <iframe>, <video>, <audio>,
  // and <source> — exactly the elements that fail silently otherwise.
  // We log the element's resolved src/href URL (always the absolute one
  // the network layer actually requested), not the literal attribute
  // string. That distinction matters: a "./assets/x.png" attribute in a
  // file://-loaded page resolves differently than in a https:// one,
  // and we want the post-resolution URL so a developer can curl it.
  window.addEventListener(
    'error',
    (e) => {
      const target = e.target
      if (!target || target === window) return
      const tag = (target as HTMLElement).tagName?.toLowerCase()
      if (!tag) return
      // Pull resolved URL based on element kind. The DOM properties
      // (src/href) return the absolute URL automatically; the
      // getAttribute equivalents do not.
      let url: string | null = null
      const t = target as HTMLImageElement &
        HTMLScriptElement &
        HTMLLinkElement &
        HTMLMediaElement &
        HTMLSourceElement
      if (typeof t.src === 'string' && t.src) url = t.src
      else if (typeof t.href === 'string' && t.href) url = t.href
      if (!url) return
      // eslint-disable-next-line no-console
      console.warn(`[diag] subresource error tag=${tag} url=${url}`)
    },
    /* useCapture */ true
  )

  // (3) Unhandled promise rejection — fetch() failures, async render
  // crashes, etc. The default promise rejection handler in WebView is
  // silent unless someone subscribes; this surfaces them.
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason
    const msg = r instanceof Error ? `${r.name}: ${r.message}` : String(r)
    // eslint-disable-next-line no-console
    console.warn(`[diag] unhandledrejection ${msg}`)
  })
}
