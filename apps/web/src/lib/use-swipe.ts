import { useEffect, useRef } from "react"

/** How far a finger moves before it is known which way it is going, in pixels. */
const SLOP = 10
/** How far it must then have gone across before that is a swipe. */
const FAR = 48

/**
 * Whether a touch that begins here is spoken for: something under it scrolls sideways or follows
 * the finger itself, or there is text selected, whose handles are dragged the same way.
 */
function taken(target: EventTarget | null, within: HTMLElement): boolean {
  if (getSelection()?.isCollapsed === false) return true
  for (
    let element = target instanceof Element ? target : null;
    element !== null && element !== within;
    element = element.parentElement
  ) {
    if (element instanceof HTMLInputElement && element.type === "range") return true
    const style = getComputedStyle(element)
    if (style.touchAction === "none") return true
    const scrolls = style.overflowX === "auto" || style.overflowX === "scroll"
    if (scrolls && element.scrollWidth > element.clientWidth) return true
  }
  return false
}

/**
 * A swipe across something with one finger, to the left or to the right. It is one once the
 * finger has gone far enough, without waiting for it to lift. A finger that sets off up or down
 * is scrolling, and is not a swipe however it wanders afterwards.
 *
 * Listened for on the element itself, so a touch on a window or a menu over it is not one here.
 */
export function useSwipe(on: HTMLElement | null, towards: "left" | "right", swiped: () => void) {
  const latest = useRef(swiped)
  latest.current = swiped
  useEffect(() => {
    if (on === null) return
    const sign = towards === "right" ? 1 : -1
    // Where the finger went down, and whether it has been seen to be going across.
    let from: { x: number; y: number; across: boolean } | null = null
    const start = (event: TouchEvent) => {
      const touch = event.touches[0]
      // A second finger is a pinch.
      from =
        event.touches.length !== 1 || touch === undefined || taken(event.target, on)
          ? null
          : { x: touch.clientX, y: touch.clientY, across: false }
    }
    const move = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (from === null || touch === undefined) return
      const across = (touch.clientX - from.x) * sign
      const along = Math.abs(touch.clientY - from.y)
      if (!from.across) {
        if (Math.max(Math.abs(across), along) < SLOP) return
        if (across < along * 1.5) {
          from = null
          return
        }
        from.across = true
      }
      if (across < FAR) return
      from = null
      latest.current()
    }
    const end = () => {
      from = null
    }
    on.addEventListener("touchstart", start, { passive: true })
    on.addEventListener("touchmove", move, { passive: true })
    on.addEventListener("touchend", end)
    on.addEventListener("touchcancel", end)
    return () => {
      on.removeEventListener("touchstart", start)
      on.removeEventListener("touchmove", move)
      on.removeEventListener("touchend", end)
      on.removeEventListener("touchcancel", end)
    }
  }, [on, towards])
}

/** What a pull is told of: that it began, how far across it has gone, and where it ended. */
export type Pull = {
  /** The finger is known to be going across. What follows it can get ready to. */
  start: () => void
  /** How far it is from where it went down, in pixels: to the right is more than nothing. */
  move: (across: number) => void
  /** It lifted, that far from where it went down. */
  end: (across: number) => void
}

/**
 * A finger drawn across something, to either side, which is followed for as long as it is down
 * rather than taken as a swipe once it has gone far enough. What makes a touch one, and what
 * keeps it from being one, are what they are for a swipe.
 */
export function usePull(on: HTMLElement | null, pull: Pull) {
  const latest = useRef(pull)
  latest.current = pull
  useEffect(() => {
    if (on === null) return
    let from: { x: number; y: number; across: boolean; last: number } | null = null
    const start = (event: TouchEvent) => {
      const touch = event.touches[0]
      // A finger put down beside one that is pulling ends the pull where it is.
      if (from?.across) latest.current.end(from.last)
      from =
        event.touches.length !== 1 || touch === undefined || taken(event.target, on)
          ? null
          : { x: touch.clientX, y: touch.clientY, across: false, last: 0 }
    }
    const move = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (from === null || touch === undefined) return
      const across = touch.clientX - from.x
      if (!from.across) {
        const along = Math.abs(touch.clientY - from.y)
        if (Math.max(Math.abs(across), along) < SLOP) return
        if (Math.abs(across) < along * 1.5) {
          from = null
          return
        }
        from.across = true
        latest.current.start()
      }
      from.last = across
      latest.current.move(across)
    }
    const end = () => {
      if (from?.across) latest.current.end(from.last)
      from = null
    }
    on.addEventListener("touchstart", start, { passive: true })
    on.addEventListener("touchmove", move, { passive: true })
    on.addEventListener("touchend", end)
    on.addEventListener("touchcancel", end)
    return () => {
      on.removeEventListener("touchstart", start)
      on.removeEventListener("touchmove", move)
      on.removeEventListener("touchend", end)
      on.removeEventListener("touchcancel", end)
    }
  }, [on])
}
