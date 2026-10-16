import {
  DIAGRAM_DRAW,
  type DiagramAsk,
  type DiagramSaid,
  diagramMessage,
} from "@do-computer/protocol"
import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { drawDiagram } from "@/components/markdown/mermaid"

/**
 * `/embed/diagram`: a page that draws one Mermaid diagram, for the phone app, which has no page
 * of its own to draw one on. It is shown in a web view, or in a frame by the phone app's
 * browser build, and is the same drawing a reply has in the web app.
 *
 * It knows nobody and asks the server for nothing. What to draw is handed to it by a call to
 * `window.dcDraw`, which only a page of this origin or the app around a web view can make: the
 * diagram is never in the address, so a link to this page draws nothing.
 */
export const Route = createFileRoute("/embed/diagram")({
  ssr: false,
  head: () => ({ meta: [{ title: "Diagram" }, { name: "robots", content: "noindex" }] }),
  component: DiagramPage,
})

type Host = Window & {
  [DIAGRAM_DRAW]?: (ask: DiagramAsk) => void
  ReactNativeWebView?: { postMessage(message: string): void }
}

/** Say something to whatever is showing this page: the app around a web view, or the page around a frame. */
function tell(said: DiagramSaid) {
  const host = window as Host
  const message = diagramMessage(said)
  if (host.ReactNativeWebView !== undefined) {
    return host.ReactNativeWebView.postMessage(JSON.stringify(message))
  }
  // Only a page of this origin is told anything: no other could have asked.
  if (window.parent !== window) window.parent.postMessage(message, window.location.origin)
}

function DiagramPage() {
  const [svg, setSvg] = useState<string>()
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const host = window as Host
    const root = document.documentElement
    // The page is part of a reply: it has no ground of its own.
    root.style.background = "transparent"
    document.body.style.background = "transparent"
    let asked = 0
    host[DIAGRAM_DRAW] = (ask) => {
      const mine = ++asked
      root.classList.toggle("dark", ask.dark)
      if (typeof ask.color === "string") root.style.setProperty("--agent-color", ask.color)
      void drawDiagram(`diagram-${mine}`, String(ask.code), ask.dark).then(
        (drawn) => {
          if (mine === asked) setSvg(drawn)
        },
        () => {
          // Mermaid leaves what it could not draw on the page.
          document.getElementById(`ddiagram-${mine}`)?.remove()
          document.getElementById(`diagram-${mine}`)?.remove()
          if (mine === asked) tell({ kind: "failed" })
        },
      )
    }
    tell({ kind: "ready" })
    return () => {
      delete host[DIAGRAM_DRAW]
    }
  }, [])
  // How large Mermaid drew it, which its picture says: the page itself is whatever size it is
  // shown at, and the drawing fills it.
  useLayoutEffect(() => {
    const drawn = box.current?.querySelector("svg")
    if (svg === undefined || drawn === null || drawn === undefined) return
    const view = drawn.viewBox.baseVal
    const width = Number(/max-width:\s*([\d.]+)px/.exec(svg)?.[1] ?? view.width)
    if (!(width > 0) || !(view.width > 0)) return tell({ kind: "failed" })
    drawn.style.maxWidth = "none"
    drawn.style.width = "100%"
    drawn.style.height = "auto"
    drawn.style.display = "block"
    tell({ kind: "drawn", width, height: (view.height * width) / view.width })
  }, [svg])
  return (
    <div
      ref={box}
      role="img"
      aria-label="Diagram"
      // Mermaid's own drawing, which it has already cleaned.
      // biome-ignore lint/security/noDangerouslySetInnerHtml: see above
      dangerouslySetInnerHTML={{ __html: svg ?? "" }}
    />
  )
}
