import { useAtom } from "jotai"
import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react"
import type { Column } from "@/lib/columns"
import { cn } from "@/lib/utils"

/** How far one press of an arrow key moves the edge. */
const STEP = 16

/**
 * The edge of a column, which can be dragged to make the column wider or narrower. It lies over
 * the column's border, on the side away from the column's own scrollbar, and shows as a line
 * only while it is pointed at or held. The arrow keys move it too, and pressing it twice puts
 * the column back to the width it started at. The column it is in has to be `relative`.
 *
 * A column that can be shut is shut by it too: dragged in past half way to its narrowest it is
 * shut, and it is pulled open again from there. Shut, it is as wide as `shut.width` says.
 */
export function ResizeHandle({
  column,
  edge,
  label,
  shut,
  quiet = false,
}: {
  column: Column
  /** Which edge of the column this is: the one that moves. */
  edge: "left" | "right"
  label: string
  /** For a column that shuts: whether it is, how wide it is then, and the way to say otherwise. */
  shut?: { is: boolean; width: number; set: (shut: boolean) => void }
  /** No line is drawn along it. The pointer's own shape is what says it can be dragged. */
  quiet?: boolean
}) {
  const [width, setWidth] = useAtom(column.width)
  const [dragging, setDragging] = useState(false)
  // Where the pointer and the edge were when the drag began.
  const from = useRef({ x: 0, width: 0 })
  // Dragging away from the column widens it.
  const outward = edge === "right" ? 1 : -1

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    // No text is selected by the drag.
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    // From where the edge is on screen: a column can be shown narrower than the width kept for it.
    const shown = event.currentTarget.parentElement?.getBoundingClientRect().width
    from.current = { x: event.clientX, width: shown ?? width }
    setDragging(true)
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    const wanted = from.current.width + (event.clientX - from.current.x) * outward
    if (shut !== undefined) {
      const now = wanted < (shut.width + column.min) / 2
      if (now !== shut.is) shut.set(now)
      if (now) return
    }
    setWidth(wanted)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (shut !== undefined) {
      const wider = event.key === (edge === "right" ? "ArrowRight" : "ArrowLeft")
      const narrower = event.key === (edge === "right" ? "ArrowLeft" : "ArrowRight")
      // One step out of being shut is being open, at the width it was left. One step in from
      // its narrowest is being shut.
      if (
        shut.is
          ? wider || event.key === "End"
          : (narrower && width <= column.min) || event.key === "Home"
      ) {
        event.preventDefault()
        shut.set(!shut.is)
        return
      }
      if (shut.is) return
    }
    const to =
      event.key === "ArrowRight"
        ? width + STEP * outward
        : event.key === "ArrowLeft"
          ? width - STEP * outward
          : event.key === "Home"
            ? column.min
            : event.key === "End"
              ? column.max
              : undefined
    if (to === undefined) return
    event.preventDefault()
    setWidth(to)
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={shut?.is ? shut.width : width}
      aria-valuemin={shut?.width ?? column.min}
      aria-valuemax={column.max}
      title={quiet ? undefined : "Drag to resize"}
      tabIndex={0}
      data-dragging={dragging ? "" : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      onLostPointerCapture={() => setDragging(false)}
      onDoubleClick={() => (shut?.is ? shut.set(false) : setWidth(column.start))}
      onKeyDown={onKeyDown}
      className={cn(
        "group/resize absolute inset-y-0 z-20 w-2 cursor-col-resize touch-none outline-none select-none",
        edge === "right" ? "-right-2" : "-left-px",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-0 left-0 w-0.5 bg-primary opacity-0 transition-opacity group-focus-visible/resize:opacity-100",
          // Seen only by whoever moves it with the keys, who has no pointer to tell them where it is.
          !quiet &&
            "group-hover/resize:opacity-60 group-hover/resize:delay-150 group-data-dragging/resize:opacity-100",
        )}
      />
      {/* A page shown in a frame would take the pointer as it passed over, and the drag would stop. */}
      {dragging ? <span aria-hidden className="fixed inset-0" /> : null}
    </div>
  )
}
