import type { StreamStatus } from "@durable-computer/client"
import { type ChatState, EMPTY_CHAT } from "@durable-computer/protocol"
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

/** What the user has typed but not sent, per chat. */
export const draftAtom = atomFamily(() => atom(""))

/** Whether the chat list is shown (wide screens) or open as a sheet (narrow ones). */
export const chatListOpenAtom = atom(true)

export const chatKey = (agentId: string, chatId: string) => `${agentId}/${chatId}`
