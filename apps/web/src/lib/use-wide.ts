import { useSyncExternalStore } from "react"

/** The width from which there is room for a column beside the chat: the agent's panel or a document. */
const WIDE = "(min-width: 80rem)"

/** Whether the screen answers to a media query, kept up as it changes. */
export function useMedia(media: string): boolean {
  return useSyncExternalStore(
    (changed) => {
      const query = matchMedia(media)
      query.addEventListener("change", changed)
      return () => query.removeEventListener("change", changed)
    },
    () => matchMedia(media).matches,
    // Not known on the server. The page is first drawn as for a narrow screen.
    () => false,
  )
}

/** Whether the screen is wide enough for something to be beside a page. */
export function useWide(): boolean {
  return useMedia(WIDE)
}
