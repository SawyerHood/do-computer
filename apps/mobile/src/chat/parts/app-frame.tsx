import { createElement, type ReactNode, useEffect, useRef } from "react"

/** What whoever shows a connector's page is given to speak to it with, filled in by the page. */
export type AppBridge = {
  /** Say something to the page. */
  post: (message: unknown) => void
  /** Whether the reader has just pressed something in the page. */
  pressed: () => Promise<boolean>
}

export type AppPageProps = {
  /** Where the page is served from. It must not change while shown. */
  src: string
  /** The session, which the page is asked for with on a phone, and which the page never has. */
  headers: Record<string, string>
  title: string
  bridge: AppBridge
  /** What the page posted. */
  onMessage: (data: unknown) => void
}

/** The little of a browser's frame that is used here, so that this file needs no DOM types. */
type Frame = { contentWindow: { postMessage(data: unknown, target: string): void } | null }
type Heard = { source: unknown; data: unknown }
type Host = {
  addEventListener(type: "message", listener: (event: Heard) => void): void
  removeEventListener(type: "message", listener: (event: Heard) => void): void
  document: { activeElement: unknown }
  navigator: { userActivation?: { isActive: boolean } }
}

/**
 * A connector's page in a browser: a frame kept apart from the app, exactly as the web app
 * shows it. (On a phone it is a web view: see app-frame.native.tsx.)
 */
export function AppPage({ src, title, bridge, onMessage }: AppPageProps): ReactNode {
  const frame = useRef<Frame>(null)
  const heard = useRef(onMessage)
  heard.current = onMessage
  useEffect(() => {
    const host = globalThis as unknown as Host
    // Its origin is nobody's, so "*" is the only address that reaches it.
    bridge.post = (message) => frame.current?.contentWindow?.postMessage(message, "*")
    // The frame has the reader's attention, and the browser says someone has just acted. Word
    // of the press can reach the app a moment after what the page said because of it.
    bridge.pressed = async () => {
      const now = () =>
        host.document.activeElement === frame.current &&
        host.navigator.userActivation?.isActive !== false
      const until = Date.now() + 600
      while (!now() && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 20))
      return now()
    }
    const onHeard = (event: Heard) => {
      if (frame.current !== null && event.source === frame.current.contentWindow) {
        heard.current(event.data)
      }
    }
    host.addEventListener("message", onHeard)
    return () => host.removeEventListener("message", onHeard)
  }, [bridge])
  return createElement("iframe", {
    ref: frame,
    src,
    title,
    // No `allow-same-origin`: the page must not be the app, though the app serves it.
    sandbox: "allow-scripts allow-forms",
    style: {
      display: "block",
      width: "100%",
      height: "100%",
      border: 0,
      background: "transparent",
    },
  })
}
