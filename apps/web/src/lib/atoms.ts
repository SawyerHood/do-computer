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
 * Whether the sidebar is shown on wide screens: the workspace and its agents.
 * Closed until asked for, so the chat and the agent have the room; the choice is remembered by
 * the shell.
 */
export const sidebarOpenAtom = atom(kept(SIDEBAR_OPEN_KEY, false))

/**
 * Whether the agent's panel is wanted beside its pages, where there is room for it. One choice
 * for every tab, so that changing tab does not move anything. Remembered by the shell.
 */
export const agentPanelOpenAtom = atom(kept(AGENT_PANEL_OPEN_KEY, true))

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

/**
 * The place in the sidebar where the library puts its list of files while the Library tab is
 * showing, in place of the agents. Null when the sidebar is not on screen.
 */
export const sidebarSlotAtom = atom<HTMLElement | null>(null)

export const chatKey = (agentId: string, chatId: string) => `${agentId}/${chatId}`
