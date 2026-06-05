// Render error boundary — last line of defense.
//
// Even with input normalized at the bridge boundary, a render-time
// throw (an unforeseen data shape, a GSAP/WebGL hiccup, a logic bug)
// would otherwise white-screen the whole webview with no way out. This
// catches it, reports a `flow.error{phase:'render'}` for native telemetry,
// and shows a fallback (BootErrorScreen) with retry/close affordances so
// the user is never stranded on a blank page.

import { Component, type ReactNode } from 'react'
import { sendFlowEvent } from '../bridge/send'

interface Props {
  children: ReactNode
  fallback: ReactNode
}
interface State {
  hasError: boolean
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: unknown): void {
    // A boundary must never throw from its own handler.
    try {
      const detail = String((error as { message?: unknown })?.message ?? error).slice(0, 200)
      sendFlowEvent({ type: 'flow.error', phase: 'render', detail })
    } catch { /* swallow */ }
    if (typeof console !== 'undefined') {
      console.error('[ErrorBoundary] render failure', error)
    }
  }

  render(): ReactNode {
    return this.state.hasError ? this.props.fallback : this.props.children
  }
}
