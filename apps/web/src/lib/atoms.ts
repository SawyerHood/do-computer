import type { StreamStatus } from "@do-computer/client"
import { type ChatMessage, type ChatState, EMPTY_CHAT } from "@do-computer/protocol"
import { atom } from "jotai"
import type { Sending } from "./sending.ts"

export type LiveChat = { state: ChatState; status: StreamStatus; loaded: boolean }

const INITIAL: LiveChat = { state: EMPTY_CHAT, status: "connecting", loaded: false }

/** One atom per key, created on first use and reused after. */
function atomFamily<T>(create: (key: string) => T): (key: string) => T {
  const atoms = new Map<string, T>()
  return (key) => {
    let existing = atoms.get(key)
    if (existing === undefined) {
      existing = create(key)
      atoms.set(key, existing)
    }
    return existing
  }
}

/** The live state of one chat, keyed `agentId/chatId`, fed by its event stream. */
export const liveChatAtom = atomFamily(() => atom<LiveChat>(INITIAL))

export type EarlierMessages = {
  /** The first message of the live transcript these lead up to. */
  anchor?: string
  messages: ChatMessage[]
  /** Where the next page ends. Undefined until the first page is asked for; null at the start. */
  before: string | null | undefined
  loading: boolean
}

/** Messages from before the live transcript, loaded on request, per chat. */
export const earlierAtom = atomFamily(() =>
  atom<EarlierMessages>({ messages: [], before: undefined, loading: false }),
)

/** Messages the user has sent that the chat does not have yet, per chat. */
export const sendingAtom = atomFamily(() => atom<readonly Sending[]>([]))

/** What the user has typed but not sent, per chat. */
export const draftAtom = atomFamily(() => atom(""))

/**
 * Whether something that is open or shut was left open. What was kept is read when the page
 * loads rather than after it is drawn, so it is not seen one way and then the other.
 */
function kept(key: string, start: boolean): boolean {
  if (typeof window === "undefined") return start
  try {
    const found = localStorage.getItem(key)
    return found === "open" ? true : found === "closed" ? false : start
  } catch {
    // Storage can be unavailable; it is then as it starts.
    return start
  }
}

export const SIDEBAR_OPEN_KEY = "dc-chat-list"
export const AGENT_PANEL_OPEN_KEY = "dc-agent-panel"

/**
 * Whether the sidebar is opened out on wide screens, into its agents by name under their
 * workspaces. A column of faces until asked for, so the chat has the room; the choice is
 * remembered by the shell.
 */
export const sidebarOpenAtom = atom(kept(SIDEBAR_OPEN_KEY, false))

/**
 * Whether the agent's panel is wanted beside its pages, where there is room for it. One choice
 * for every page, so that changing page does not move anything. Away until asked for, from the
 * menu on the agent's name, so the chat has the room; the choice is remembered by the shell.
 */
export const agentPanelOpenAtom = atom(kept(AGENT_PANEL_OPEN_KEY, false))

const FOLDED_WORKSPACES_KEY = "dc-folded-workspaces"

function keptIds(key: string): readonly string[] {
  if (typeof window === "undefined") return []
  try {
    const found: unknown = JSON.parse(localStorage.getItem(key) ?? "[]")
    return Array.isArray(found) ? found.filter((id) => typeof id === "string") : []
  } catch {
    // Storage can be unavailable, or hold something else; then none are folded.
    return []
  }
}

const foldedWorkspaces = atom(keptIds(FOLDED_WORKSPACES_KEY))

/**
 * The workspaces whose agents are folded away in the sidebar, by id. Writing one folds it, or
 * opens it if it was folded; they stay as they were left.
 */
export const foldedWorkspacesAtom = atom(
  (get) => get(foldedWorkspaces),
  (get, set, workspaceId: string) => {
    const folded = get(foldedWorkspaces)
    const next = folded.includes(workspaceId)
      ? folded.filter((id) => id !== workspaceId)
      : [...folded, workspaceId]
    set(foldedWorkspaces, next)
    try {
      localStorage.setItem(FOLDED_WORKSPACES_KEY, JSON.stringify(next))
    } catch {
      // The choice then lasts for this page only.
    }
  },
)

export const AGENT_ORDER_KEY = "dc-agent-order"

type AgentOrder = Readonly<Record<string, readonly string[]>>

function keptOrder(): AgentOrder {
  if (typeof window === "undefined") return {}
  try {
    const found: unknown = JSON.parse(localStorage.getItem(AGENT_ORDER_KEY) ?? "{}")
    if (typeof found !== "object" || found === null) return {}
    return Object.fromEntries(
      Object.entries(found).filter((entry): entry is [string, string[]] => {
        return Array.isArray(entry[1]) && entry[1].every((id) => typeof id === "string")
      }),
    )
  } catch {
    // Storage can be unavailable, or hold something else; then nothing was put in order.
    return {}
  }
}

const agentOrder = atom(keptOrder())
// Another tab of this browser put them in order: this one follows.
agentOrder.onMount = (set) => {
  const changed = (event: StorageEvent) => {
    if (event.key === AGENT_ORDER_KEY) set(keptOrder())
  }
  window.addEventListener("storage", changed)
  return () => window.removeEventListener("storage", changed)
}

/**
 * The order each workspace's agents were put in by hand in the sidebar, by workspace: their
 * ids, the top one first. A workspace that is not here was never put in order, and has the one
 * last heard from first. Writing a list keeps it, and writing none forgets it. It is kept in
 * this browser and nowhere else, so another browser has an order of its own.
 */
export const agentOrderAtom = atom(
  (get) => get(agentOrder),
  (_get, set, workspaceId: string, ids: readonly string[] | undefined) => {
    // On top of what is kept now, which another tab may have added to since this one read it.
    const { [workspaceId]: _was, ...rest } = keptOrder()
    const next = ids === undefined ? rest : { ...rest, [workspaceId]: ids }
    set(agentOrder, next)
    try {
      localStorage.setItem(AGENT_ORDER_KEY, JSON.stringify(next))
    } catch {
      // The order then lasts for this page only.
    }
  },
)

const PANEL_FOLDS_KEY = "dc-panel-folds"

function keptFolds(): Readonly<Record<string, boolean>> {
  if (typeof window === "undefined") return {}
  try {
    const found: unknown = JSON.parse(localStorage.getItem(PANEL_FOLDS_KEY) ?? "{}")
    if (typeof found !== "object" || found === null) return {}
    return Object.fromEntries(
      Object.entries(found).filter((entry): entry is [string, boolean] => {
        return typeof entry[1] === "boolean"
      }),
    )
  } catch {
    // Storage can be unavailable, or hold something else; then each is as it starts.
    return {}
  }
}

const panelFolds = atom(keptFolds())

/**
 * The sections of an agent's panel that were folded or opened by hand, by section: true where it
 * was left folded. One that was never touched is not here and is as it starts. They are kept for
 * every agent alike, so a section put away once is away beside all of them.
 */
export const panelFoldsAtom = atom(
  (get) => get(panelFolds),
  (get, set, section: string, folded: boolean) => {
    const next = { ...get(panelFolds), [section]: folded }
    set(panelFolds, next)
    try {
      localStorage.setItem(PANEL_FOLDS_KEY, JSON.stringify(next))
    } catch {
      // The choice then lasts for this page only.
    }
  },
)

/**
 * The room either side of the agent's name, above its pages: where a page that has a bar of its
 * own puts it, so that there is one row above the page and not two. What says where it is goes
 * at the start, and what is done to it at the end. Null where the row has no such room.
 */
export const stripStartAtom = atom<HTMLElement | null>(null)
export const stripEndAtom = atom<HTMLElement | null>(null)

export const chatKey = (agentId: string, chatId: string) => `${agentId}/${chatId}`
