// Web→native event channel.
//
// Picks a transport at runtime, in priority order:
//   1. window.webkit.messageHandlers.gameResults  (iOS WKWebView)
//   2. window.gameResults with a postMessage(json) (Android pattern)
//   3. console.debug fallback (dev / plain browser)

import type { FlowEvent } from './types'

const BRIDGE_NAME = 'gameResults'

interface IOSBridge { postMessage(payload: unknown): void }
interface AndroidBridge { postMessage(payload: string): void }

declare global {
  interface Window {
    webkit?: { messageHandlers?: Record<string, IOSBridge | undefined> }
  }
}

export function sendFlowEvent(event: FlowEvent): void {
  try {
    // Dev-only: assert the event survives a JSON round-trip cleanly.
    // Catches future event variants that accidentally contain Date,
    // BigInt, undefined, or other non-serializable fields — bugs that
    // would otherwise manifest only on Android (which stringifies)
    // while passing silently on iOS (which sends objects). Production
    // behavior unchanged; this only logs a warning in dev builds.
    if (import.meta.env.DEV) {
      try {
        const round = JSON.parse(JSON.stringify(event))
        if (round?.type !== event.type) {
          console.warn('[bridge] event lost type field after round-trip', event)
        }
      } catch (rtErr) {
        console.warn('[bridge] event failed JSON round-trip', event, rtErr)
      }
    }

    const ios = window.webkit?.messageHandlers?.[BRIDGE_NAME]
    if (ios && typeof ios.postMessage === 'function') {
      ios.postMessage(event)
      return
    }
    const android = (window as unknown as Record<string, unknown>)[BRIDGE_NAME] as AndroidBridge | undefined
    if (android && typeof android.postMessage === 'function') {
      android.postMessage(JSON.stringify(event))
      return
    }
    if (typeof console !== 'undefined') {
      console.debug('[bridge]', event)
    }
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.warn('[bridge] send failed', err)
    }
  }
}
