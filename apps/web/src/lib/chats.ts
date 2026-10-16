import type { AgentState } from "@do-computer/client"
import type { ChatSummary } from "@do-computer/protocol"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useCallback, useRef, useState } from "react"
import { client } from "./client.ts"
import { agentKey, chatsCollection } from "./collections.ts"
import { queryClient } from "./query.ts"
import { useWide } from "./use-wide.ts"

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

/** Whether a chat is a side chat: one someone talks in that is not the main one. */
export const isSideChat = (chat: ChatSummary | undefined): chat is ChatSummary =>
  chat !== undefined && chat.kind === "chat" && chat.main !== true

/** The agent's side chats that have not been put away, the one last used first. */
export const sideChatsOf = (chats: readonly ChatSummary[] | undefined): ChatSummary[] =>
  (chats ?? [])
    .filter((chat) => isSideChat(chat) && !chat.archived)
    .sort((a, b) => b.updatedAt - a.updatedAt)

/**
 * Opens a side chat. With the main chat on screen and room beside it, the side chat goes
 * beside it, so the main chat stays where it is. Otherwise it takes the middle.
 */
export function useOpenSideChat(agentId: string, mainId: string | undefined) {
  const navigate = useNavigate()
  const { chatId } = useParams({ strict: false })
  const wide = useWide()
  return useCallback(
    (sideId: string) =>
      wide && mainId !== undefined && chatId === mainId
        ? navigate({
            to: "/a/$agentId/c/$chatId",
            params: { agentId, chatId: mainId },
            search: { side: Number(sideId) },
          })
        : navigate({ to: "/a/$agentId/c/$chatId", params: { agentId, chatId: sideId } }),
    [navigate, agentId, mainId, chatId, wide],
  )
}

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

/**
 * Starts a side chat with the agent and opens it. `creating` is true from the press until the
 * chat is made, and `error` says why there is none where it could not be.
 */
export function useNewSideChat(agentId: string, mainId: string | undefined) {
  const open = useOpenSideChat(agentId, mainId)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string>()
  // One id for a chat until it is known to be made. A press after one that failed asks for the
  // same chat, so that a chat whose answer never arrived is opened and no second one is made.
  const request = useRef<string>(undefined)
  const create = useCallback(async (): Promise<boolean> => {
    setCreating(true)
    setError(undefined)
    try {
      request.current ??= crypto.randomUUID()
      const chat = await client.agent(agentId).createChat({ requestId: request.current })
      request.current = undefined
      keepChat(agentId, chat)
      // The agent says its chats changed, which asks for them again. Nothing waits for that,
      // nor for the chat's page, which says for itself what it waits on.
      void open(chat.id)
      return true
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The chat could not be started.")
      return false
    } finally {
      setCreating(false)
    }
  }, [agentId, open])
  return { create, creating, error }
}

/** Puts a side chat away, and goes back to the main chat. */
export function useArchiveSideChat(agentId: string, mainId: string | undefined) {
  const navigate = useNavigate()
  return useCallback(
    async (chatId: string) => {
      chatsCollection(agentId).update(chatId, (draft) => {
        draft.archived = true
      })
      if (mainId === undefined) await navigate({ to: "/a/$agentId", params: { agentId } })
      else await navigate({ to: "/a/$agentId/c/$chatId", params: { agentId, chatId: mainId } })
    },
    [navigate, agentId, mainId],
  )
}
