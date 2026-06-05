// On-demand display-name fetch.
//
// If the initial GameResultsInput omits `member.displayName`, the
// webview emits `flow.request_display_name` and waits for native to
// call window.setDisplayName(name). A short timeout keeps the UI from
// hanging if native doesn't respond — callers can fall back to "no
// name" without blocking the flow.
//
// In plain-browser dev there is no native, so this always times out.
// Bridge log messages still print so the contract is observable.

import { subscribeDisplayName } from './input'
import { sendFlowEvent } from './send'

const REQUEST_TIMEOUT_MS = 3000

export function fetchDisplayName(): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    let settled = false
    const off = subscribeDisplayName((name) => {
      if (settled) return
      settled = true
      off()
      resolve(name)
    })
    sendFlowEvent({ type: 'flow.request_display_name' })
    window.setTimeout(() => {
      if (settled) return
      settled = true
      off()
      resolve(null)
    }, REQUEST_TIMEOUT_MS)
  })
}
