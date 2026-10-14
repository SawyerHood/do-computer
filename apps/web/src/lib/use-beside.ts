import { useSetAtom } from "jotai"
import { useEffect, useRef } from "react"
import { besideWidthAtom } from "./columns.ts"

/**
 * For what is beside a chat, in the panel's place: says how wide it is for as long as it is
 * there, so that what floats over the page at that edge keeps clear of it. Gives the ref to
 * put on it.
 */
export function useBeside<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const setWidth = useSetAtom(besideWidthAtom)
  useEffect(() => {
    const element = ref.current
    if (element === null) return
    const measure = () => {
      // One that a narrow screen hides takes no room.
      const margin = Number.parseFloat(getComputedStyle(element).marginRight) || 0
      setWidth(element.offsetWidth === 0 ? 0 : Math.round(element.offsetWidth + margin))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => {
      observer.disconnect()
      setWidth(0)
    }
  }, [setWidth])
  return ref
}
