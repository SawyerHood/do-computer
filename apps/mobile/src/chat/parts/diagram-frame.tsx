import {
  DIAGRAM_DRAW,
  type DiagramAsk,
  type DiagramSaid,
  readDiagramMessage,
} from "@do-computer/protocol"
import { createElement, type ReactNode, useEffect, useRef } from "react"

export type DiagramPageProps = {
  /** The address of the deployment's page that draws a diagram. */
  src: string
  /** What it is to draw, and in which colors: asked again whenever this changes. */
  ask: DiagramAsk
  /** What the page said: that it drew, and how large, or that it could not. */
  onSaid: (said: DiagramSaid) => void
}

/** The little of a browser's frame that is used here, so that this file needs no DOM types. */
type Frame = { contentWindow: Record<string, unknown> | null }
type Heard = { source: unknown; data: unknown }
type Host = {
  addEventListener(type: "message", listener: (event: Heard) => void): void
  removeEventListener(type: "message", listener: (event: Heard) => void): void
}

/**
 * The page that draws a diagram, in a browser: a frame on the deployment's own page. The app
 * and the page are of one origin there, so the diagram is handed over by calling the page's
 * own function. (On a phone it is a web view: see diagram-frame.native.tsx.)
 */
export function DiagramPage({ src, ask, onSaid }: DiagramPageProps): ReactNode {
  const frame = useRef<Frame>(null)
  const ready = useRef(false)
  const now = useRef({ ask, onSaid })
  now.current = { ask, onSaid }
  const draw = () => {
    try {
      const page = frame.current?.contentWindow?.[DIAGRAM_DRAW]
      if (typeof page !== "function") throw new Error("The page cannot be asked.")
      ;(page as (ask: DiagramAsk) => void)(now.current.ask)
    } catch {
      // A page of another origin, or one that is not the page asked for.
      now.current.onSaid({ kind: "failed" })
    }
  }
  useEffect(() => {
    const host = globalThis as unknown as Host
    const onMessage = (event: Heard) => {
      if (frame.current === null || event.source !== frame.current.contentWindow) return
      const said = readDiagramMessage(event.data)
      if (said === undefined) return
      if (said.kind !== "ready") return now.current.onSaid(said)
      ready.current = true
      draw()
    }
    host.addEventListener("message", onMessage)
    return () => host.removeEventListener("message", onMessage)
  }, [])
  useEffect(() => {
    if (ready.current) draw()
  }, [ask.code, ask.dark, ask.color])
  return createElement("iframe", {
    ref: frame,
    src,
    title: "Diagram",
    style: {
      display: "block",
      width: "100%",
      height: "100%",
      border: 0,
      background: "transparent",
    },
  })
}
