import { useSyncExternalStore } from "react"

/** The width from which there is room for a column beside the chat: the agent's panel, a document, a side chat. */
const WIDE = "(min-width: 80rem)"

/** Whether the screen is wide enough for something to be beside a page. */
export function useWide(): boolean {
  return useSyncExternalStore(
    (changed) => {
      const query = matchMedia(WIDE)
      query.addEventListener("change", changed)
      return () => query.removeEventListener("change", changed)
    },
    () => matchMedia(WIDE).matches,
    // Not known on the server. The page is first drawn as for a narrow screen.
    () => false,
  )
}
