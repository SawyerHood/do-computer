/**
 * A diagram drawn for a client that cannot draw one itself. The phone app has no page to draw
 * Mermaid on, so it asks the deployment's own `/embed/diagram`, in a frame or a web view, to
 * draw what it is given and to say how large the drawing is.
 *
 * The page is given the diagram by a call to `window.dcDraw`, which only something of the same
 * origin, or the app the web view belongs to, can make. Nothing of the diagram is in the
 * address, so nothing of it reaches the server.
 */

/** Where the page that draws a diagram is, on a deployment. */
export const DIAGRAM_PATH = "/embed/diagram"

/** The name of the function the page puts on its window, to be handed a diagram. */
export const DIAGRAM_DRAW = "dcDraw"

/** What the page is asked to draw, and in which colors. */
export type DiagramAsk = {
  code: string
  dark: boolean
  /** The open Dood's own color, as CSS, where there is one. */
  color?: string
}

/** What the page says back: that it can be asked, how large what it drew is, or that it could not. */
export type DiagramSaid =
  { kind: "ready" } | { kind: "drawn"; width: number; height: number } | { kind: "failed" }

const TYPE = "dc-diagram"

/** What the page posts to whatever shows it. */
export function diagramMessage(said: DiagramSaid): { type: typeof TYPE } & DiagramSaid {
  return { type: TYPE, ...said }
}

/** What a diagram's page said, where `data` is that: the message itself, or it written out. */
export function readDiagramMessage(data: unknown): DiagramSaid | undefined {
  let value = data
  if (typeof value === "string") {
    try {
      value = JSON.parse(value)
    } catch {
      return undefined
    }
  }
  if (typeof value !== "object" || value === null) return undefined
  const { type, kind, width, height } = value as Record<string, unknown>
  if (type !== TYPE) return undefined
  if (kind === "ready" || kind === "failed") return { kind }
  if (kind !== "drawn") return undefined
  const sized = (size: unknown): size is number =>
    typeof size === "number" && Number.isFinite(size) && size > 0 && size < 100_000
  return sized(width) && sized(height) ? { kind, width, height } : undefined
}

/** The least of its drawn width a diagram is made: smaller than this its words cannot be read. */
const SMALLEST = 0.8

/**
 * How large a diagram is shown where there is `room` across: as it was drawn where it fits,
 * made smaller where it nearly does, and otherwise four fifths of its size, to be scrolled.
 */
export function diagramFit(
  drawn: { width: number; height: number },
  room: number,
): { width: number; height: number } {
  const width =
    drawn.width <= room ? drawn.width : Math.max(room, Math.ceil(drawn.width * SMALLEST))
  return { width, height: Math.ceil((drawn.height * width) / drawn.width) }
}
