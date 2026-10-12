import {
  readVisualHeight,
  readVisualLink,
  visualResult,
  type VisualTheme,
  visualThemeMessage,
} from "@durable-computer/protocol"
import { createElement, type ReactNode, useEffect, useRef } from "react"

export type VisualPageProps = {
  /** The page's address, with the colors it starts in on its end. It must not change while shown. */
  src: string
  title: string
  /** The app's colors now; the page is told when they change. */
  theme: VisualTheme
  /** The page said how tall it is. */
  onHeight: (height: number) => void
}

/** The little of a browser's frame that is used here, so that this file needs no DOM types. */
type Frame = { contentWindow: { postMessage(data: unknown, target: string): void } | null }
type Heard = { source: unknown; data: unknown }
type Host = {
  addEventListener(type: "message", listener: (event: Heard) => void): void
  removeEventListener(type: "message", listener: (event: Heard) => void): void
  open(url: string, target: string, features: string): void
  document: { activeElement: unknown }
  navigator: { userActivation?: { isActive: boolean } }
}

/**
 * A visual's page in a browser: a frame kept apart from the app, exactly as the web app shows
 * it. (On a phone it is a web view: see visual-frame.native.tsx.)
 */
export function VisualPage({ src, title, theme, onHeight }: VisualPageProps): ReactNode {
  const frame = useRef<Frame>(null)
  const heard = useRef(onHeight)
  heard.current = onHeight
  // Its origin is nobody's, so "*" is the only address that reaches it; the window is what
  // makes sure it is this frame that hears.
  const say = () => frame.current?.contentWindow?.postMessage(visualThemeMessage(theme), "*")
  useEffect(say, [theme])
  useEffect(() => {
    const host = globalThis as unknown as Host
    const onMessage = (event: Heard) => {
      const target = frame.current
      if (target === null || event.source !== target.contentWindow) return
      const tall = readVisualHeight(event.data)
      if (tall !== undefined) return heard.current(tall)
      const link = readVisualLink(event.data)
      if (link === undefined) return
      // Only on the reader's own click in the page: a page cannot open tabs by itself.
      if (
        host.document.activeElement === target &&
        host.navigator.userActivation?.isActive !== false
      ) {
        host.open(link.url, "_blank", "noopener,noreferrer")
      }
      target.contentWindow?.postMessage(visualResult(link.id), "*")
    }
    host.addEventListener("message", onMessage)
    return () => host.removeEventListener("message", onMessage)
  }, [])
  return createElement("iframe", {
    ref: frame,
    src,
    title,
    onLoad: say,
    // No `allow-same-origin`: the page must not be the app, though the app serves it.
    sandbox: "allow-scripts allow-popups allow-forms allow-modals",
    style: {
      display: "block",
      width: "100%",
      height: "100%",
      border: 0,
      background: "transparent",
    },
  })
}
