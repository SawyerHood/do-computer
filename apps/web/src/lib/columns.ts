import { atom, type WritableAtom } from "jotai"

/** A column whose width can be dragged: how wide it is, in pixels, and how far it can go. */
export type Column = {
  width: WritableAtom<number, [number], void>
  min: number
  max: number
  /** How wide it is until it has been dragged, and again when it is put back. */
  start: number
}

/**
 * A column that stays as wide as it was left. What was kept is read when the page loads rather
 * than after it is drawn, so the column is not seen at one width and then another. These pages
 * are drawn in the browser only, so there is nothing drawn on the server to differ from.
 */
function column(key: string, bounds: { min: number; max: number; start: number }): Column {
  const within = (width: number) => Math.round(Math.min(bounds.max, Math.max(bounds.min, width)))
  let kept = bounds.start
  if (typeof window !== "undefined") {
    try {
      const found = Number.parseFloat(localStorage.getItem(key) ?? "")
      if (Number.isFinite(found)) kept = within(found)
    } catch {
      // Storage can be unavailable; it is then as it starts.
    }
  }
  const held = atom(kept)
  const width = atom(
    (get) => get(held),
    (_get, set, wanted: number) => {
      const next = within(wanted)
      set(held, next)
      try {
        localStorage.setItem(key, String(next))
      } catch {
        // The width then lasts for this page only.
      }
    },
  )
  return { width, ...bounds }
}

/*
 * The bounds leave the chat at least 20rem between the two, at the narrowest screen each is
 * shown on: the sidebar from 48rem, and the agent's panel with it from 80rem.
 */

/** The sidebar, on wide screens: the workspace and its agents. */
export const sidebarColumn = column("dc-sidebar-width", { min: 208, max: 448, start: 288 })

/** The agent's panel, beside its pages. One width for every tab, so changing tab moves nothing. */
export const agentPanelColumn = column("dc-agent-panel-width", { min: 256, max: 512, start: 320 })

/**
 * A document open beside a chat, in the panel's place. On a wide screen it can be most of it, so
 * its upper bound is generous, and what keeps the chat its room is `DOC_PANEL_LEAVES`: however
 * wide it was left, the document is shown no wider than leaves the chat that much.
 */
export const docPanelColumn = column("dc-doc-panel-width", { min: 352, max: 1280, start: 640 })
export const DOC_PANEL_LEAVES = "20rem"
/** What is beside a chat is a card in the page, with this much between it and the page's edge. */
export const BESIDE_GAP = "0.625rem"

/**
 * How much of the right of the window is taken by what is beside the chat, in pixels, its margin
 * and all: a document, in the panel's place. Zero while nothing is. What floats
 * over the page at that edge keeps clear of it by this much.
 */
export const besideWidthAtom = atom(0)
