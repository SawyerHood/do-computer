import { type VisualTheme, visualThemeFragment, visualThemeMessage } from "@do-computer/protocol"
import { createElement, useEffect, useRef } from "react"

/** The little of a browser's frame that is used here, so that this file needs no DOM types. */
type Frame = { contentWindow: { postMessage(data: unknown, target: string): void } | null }

/**
 * An HTML page of the library shown in a frame as the page it is. The
 * frame keeps it apart from the app, as the web app's does. The browser's stand-in for the web
 * view the phones have (see page-view.tsx).
 *
 * With `colors`, the page is in the app's look: they ride on the address it starts at, and it
 * is told when they change.
 */
export function PageView({
  uri,
  title,
  colors,
}: {
  uri: string
  headers?: Record<string, string>
  title: string
  colors?: VisualTheme
}) {
  const frame = useRef<Frame>(null)
  // The page keeps the address it was first given: a new one would load it again.
  const first = useRef(colors)
  // Its origin is nobody's, so "*" is the only address that reaches it.
  const say = () => {
    if (colors !== undefined) {
      frame.current?.contentWindow?.postMessage(visualThemeMessage(colors), "*")
    }
  }
  useEffect(say, [colors])
  return createElement("iframe", {
    ref: frame,
    src: first.current === undefined ? uri : `${uri}${visualThemeFragment(first.current)}`,
    title,
    onLoad: say,
    // No `allow-same-origin`: the page must not be the app, though the app serves it.
    sandbox: "allow-scripts allow-popups allow-forms allow-modals",
    style: { flex: 1, width: "100%", height: "100%", border: 0, backgroundColor: "#fff" },
  })
}
