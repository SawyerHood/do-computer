import { createFileRoute, redirect } from "@tanstack/react-router"
import { mainChatOf } from "@/lib/chats"
import { client } from "@/lib/client"
import { agentKey } from "@/lib/collections"
import { queryClient } from "@/lib/query"

/**
 * Choosing an agent is talking to it: this opens its main chat. The agent is given one the first
 * time it is opened, which for an agent that already had chats is the one it was last talked to
 * in.
 */
export const Route = createFileRoute("/_app/a/$agentId/")({
  beforeLoad: async ({ params, search }) => {
    const api = client.agent(params.agentId)
    const state = await queryClient.fetchQuery({
      queryKey: agentKey(params.agentId),
      queryFn: () => api.state(),
      staleTime: 0,
    })
    let chat = mainChatOf(state.chats)
    if (chat === undefined) {
      chat = await api.mainChat()
      await queryClient.invalidateQueries({ queryKey: agentKey(params.agentId) })
    }
    throw redirect({
      to: "/a/$agentId/c/$chatId",
      params: { agentId: params.agentId, chatId: chat.id },
      // A settings window that was asked for by address opens over the chat.
      search,
      replace: true,
    })
  },
})
