import type { StreamStatus } from "@durable-computer/client"
import { type ChatMessage, type ChatState, EMPTY_CHAT } from "@durable-computer/protocol"
import { atom } from "jotai"

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

/** What the user has typed but not sent, per chat. */
export const draftAtom = atomFamily(() => atom(""))

/** Whether the chat list is shown (wide screens) or open as a sheet (narrow ones). */
export const chatListOpenAtom = atom(true)

export const chatKey = (agentId: string, chatId: string) => `${agentId}/${chatId}`
