import { useAtomValue } from "jotai"
import { stripEndAtom, stripStartAtom } from "./atoms.ts"
import { useMedia } from "./use-wide.ts"

/** The width from which there is room either side of the agent's name for a page's own bar. */
const ROOM = "(min-width: 64rem)"

/** Where a page's bar goes in the row above it: its start and its end. */
export type StripBar = { start: HTMLElement; end: HTMLElement }

/**
 * The two places either side of the agent's name, for a page to put its own bar in. Undefined
 * where there is no room for that, on a narrow screen, and the page keeps its bar under the name.
 */
export function useStripBar(): StripBar | undefined {
  const start = useAtomValue(stripStartAtom)
  const end = useAtomValue(stripEndAtom)
  const room = useMedia(ROOM)
  return room && start !== null && end !== null ? { start, end } : undefined
}
