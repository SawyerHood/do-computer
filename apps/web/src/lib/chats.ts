import type { AgentState } from "@do-computer/client"
import type { ChatSummary } from "@do-computer/protocol"
import { agentKey } from "./collections.ts"
import { queryClient } from "./query.ts"

/** The agent's main chat: the one that opens when the agent is chosen. */
export const mainChatOf = (chats: readonly ChatSummary[] | undefined): ChatSummary | undefined =>
  chats?.find((chat) => chat.main === true)

const MAIN_CHATS_KEY = "dc-main-chats"
let mainChats: Record<string, string> | undefined

function knownMainChats(): Record<string, string> {
  if (mainChats === undefined) {
    mainChats = {}
    try {
      const found: unknown = JSON.parse(localStorage.getItem(MAIN_CHATS_KEY) ?? "{}")
      if (typeof found === "object" && found !== null) {
        for (const [agentId, chatId] of Object.entries(found)) {
          if (typeof chatId === "string") mainChats[agentId] = chatId
        }
      }
    } catch {
      // Storage can be unavailable, or hold something else; nothing is then remembered.
    }
  }
  return mainChats
}

/**
 * An agent's main chat as it was the last time the agent was open here. Which chat that is does
 * not change, so choosing the agent can go straight to it without first asking the agent.
 */
export const rememberedMainChat = (agentId: string): string | undefined => knownMainChats()[agentId]

/** Keep which chat is an agent's main one, or with none forget it. */
export function rememberMainChat(agentId: string, chatId: string | undefined): void {
  const known = knownMainChats()
  if (known[agentId] === chatId) return
  if (chatId === undefined) delete known[agentId]
  else known[agentId] = chatId
  try {
    localStorage.setItem(MAIN_CHATS_KEY, JSON.stringify(known))
  } catch {
    // It is then remembered for this page only.
  }
}

/**
 * Whether a chat is an old side chat: one someone talked in that is not the main one. Side chats
 * are from before a Dood was talked to in its main chat alone; they are kept, archived, to read.
 */
export const isSideChat = (chat: ChatSummary | undefined): chat is ChatSummary =>
  chat !== undefined && chat.kind === "chat" && chat.main !== true

/** The agent's old side chats, the one last used first. */
export const sideChatsOf = (chats: readonly ChatSummary[] | undefined): ChatSummary[] =>
  (chats ?? []).filter((chat) => isSideChat(chat)).sort((a, b) => b.updatedAt - a.updatedAt)

/**
 * Put a chat among an agent's chats as they are kept here, in place of what was kept of it. A
 * chat the server has just made or settled on is then on screen without asking the agent for
 * all of its state again.
 */
export function keepChat(agentId: string, chat: ChatSummary): void {
  queryClient.setQueryData<AgentState>(agentKey(agentId), (state) =>
    state === undefined
      ? state
      : { ...state, chats: [...state.chats.filter((entry) => entry.id !== chat.id), chat] },
  )
}
