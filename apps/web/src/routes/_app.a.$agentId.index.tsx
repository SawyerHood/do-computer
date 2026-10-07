import { createFileRoute, redirect } from "@tanstack/react-router"
import { client } from "@/lib/client"
import { agentKey } from "@/lib/collections"
import { queryClient } from "@/lib/query"

/**
 * Open the agent's most recent chat, or start its first one. A scheduled run has a chat of its own,
 * which is reached from the automations page and is not where a visit begins.
 */
export const Route = createFileRoute("/_app/a/$agentId/")({
  beforeLoad: async ({ params, search }) => {
    const api = client.agent(params.agentId)
    const state = await queryClient.fetchQuery({
      queryKey: agentKey(params.agentId),
      queryFn: () => api.state(),
      staleTime: 0,
    })
    let chat = state.chats.find((candidate) => candidate.kind === "chat" && !candidate.archived)
    if (chat === undefined) {
      chat = await api.createChat()
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
