import { type VisualTheme, visualThemeFragment, visualThemeMessage } from "@do-computer/protocol"
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react"

const ACCENT_CHANGED = "dc-accent-changed"

/**
 * Said by whatever sets the open agent's color on the root, once it has: a page that is shown
 * in the app's colors is then told the new one.
 */
export const accentChanged = () => void window.dispatchEvent(new Event(ACCENT_CHANGED))

/** The app's colors as they were last read: light or dark, then the agent's color. */
let read: string | undefined

/** Told whenever the app goes from light to dark or back, which is a class on its root, or the agent's color changes. */
function watchColors(changed: () => void): () => void {
  const again = () => {
    read = undefined
    changed()
  }
  // Whatever was read while nobody was watching may be old.
  read = undefined
  const observer = new MutationObserver(again)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
  window.addEventListener(ACCENT_CHANGED, again)
  return () => {
    observer.disconnect()
    window.removeEventListener(ACCENT_CHANGED, again)
  }
}

const colors = () =>
  (read ??= `${document.documentElement.classList.contains("dark") ? "dark" : "light"}\n${getComputedStyle(
    document.documentElement,
  )
    .getPropertyValue("--agent-color")
    .trim()}`)

/**
 * The colors the app is in, for a page to be shown in the same: light or dark, with the open
 * agent's own color. It changes when either does.
 */
export function useAppColors(): VisualTheme {
  const now = useSyncExternalStore(watchColors, colors, () => "dark\n")
  return useMemo(() => {
    const [mode, color] = now.split("\n")
    return {
      appearance: mode === "light" ? "light" : "dark",
      ...(color === undefined || color === "" ? {} : { color }),
    }
  }, [now])
}

/**
 * What a frame needs to show a page of the library in the app's colors. The page starts in
 * them, since they ride on its address, and is told when they change, so that it follows
 * without being loaded again. `loaded` changes when the page is to be loaded anew, and the
 * address is then made with the colors as they are at that moment.
 */
export function useThemedFrame(url: string, loaded: unknown = "") {
  const theme = useAppColors()
  const frame = useRef<HTMLIFrameElement>(null)
  const latest = useRef(theme)
  latest.current = theme
  // biome-ignore lint/correctness/useExhaustiveDependencies: `loaded` is what asks for a new address
  const src = useMemo(() => `${url}${visualThemeFragment(latest.current)}`, [url, loaded])
  // Its origin is nobody's, so "*" is the only address that reaches it; the window is what
  // makes sure it is this frame that hears.
  const tell = useCallback(
    () => frame.current?.contentWindow?.postMessage(visualThemeMessage(theme), "*"),
    [theme],
  )
  useEffect(() => void tell(), [tell])
  return { frame, src, onLoad: tell, theme }
}
