import type { ChatSummary } from "@durable-computer/protocol"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useCallback } from "react"
import { client } from "./client.ts"
import { chatsCollection } from "./collections.ts"
import { useWide } from "./use-wide.ts"

/** The agent's main chat: the one that opens when the agent is chosen. */
export const mainChatOf = (chats: readonly ChatSummary[] | undefined): ChatSummary | undefined =>
  chats?.find((chat) => chat.main === true)

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

/** Starts a side chat with the agent and opens it. */
export function useNewSideChat(agentId: string, mainId: string | undefined) {
  const open = useOpenSideChat(agentId, mainId)
  return useCallback(async () => {
    const chat = await client.agent(agentId).createChat()
    await chatsCollection(agentId).utils.refetch()
    await open(chat.id)
  }, [agentId, open])
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
