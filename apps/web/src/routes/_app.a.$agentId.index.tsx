import { createFileRoute, redirect } from "@tanstack/react-router"
import { client } from "@/lib/client"
import { agentKey } from "@/lib/collections"
import { queryClient } from "@/lib/query"

/** Open the agent's most recent chat, or start its first one. */
export const Route = createFileRoute("/_app/a/$agentId/")({
  beforeLoad: async ({ params }) => {
    const api = client.agent(params.agentId)
    const state = await queryClient.fetchQuery({
      queryKey: agentKey(params.agentId),
      queryFn: () => api.state(),
      staleTime: 0,
    })
    let chat = state.chats.find((candidate) => !candidate.archived)
    if (chat === undefined) {
      chat = await api.createChat()
      await queryClient.invalidateQueries({ queryKey: agentKey(params.agentId) })
    }
    throw redirect({
      to: "/a/$agentId/c/$chatId",
      params: { agentId: params.agentId, chatId: chat.id },
      replace: true,
    })
  },
})
