import type { VisualTheme } from "@do-computer/protocol"
import { useMemo, useSyncExternalStore } from "react"

/** Told whenever the page goes from light to dark or back, which is a class on its root. */
function watchAppearance(changed: () => void): () => void {
  const observer = new MutationObserver(changed)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
  return () => observer.disconnect()
}

const appearance = () => (document.documentElement.classList.contains("dark") ? "dark" : "light")

/**
 * The colors the app is in, for a visual to be shown in the same: light or dark, with the open
 * agent's own color.
 */
export function useAppColors(): VisualTheme {
  const mode = useSyncExternalStore(watchAppearance, appearance, () => "dark" as const)
  return useMemo(() => {
    const color = getComputedStyle(document.documentElement)
      .getPropertyValue("--agent-color")
      .trim()
    return { appearance: mode, ...(color === "" ? {} : { color }) }
  }, [mode])
}
