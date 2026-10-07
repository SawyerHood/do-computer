import { useQuery } from "@tanstack/react-query"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { useEffect } from "react"
import { ChatPlaceholder } from "@/components/chat/chat-placeholder"
import { mainChatOf, rememberedMainChat } from "@/lib/chats"
import { agentQuery } from "@/lib/collections"
import { queryClient } from "@/lib/query"
import { useListedAgent } from "@/lib/workspaces"

/**
 * Choosing an agent is talking to it: this opens its main chat. The agent is given one the first
 * time it is opened, which for an agent that already had chats is the one it was last talked to
 * in.
 */
export const Route = createFileRoute("/_app/a/$agentId/")({
  // Nothing is asked for here. Which chat is the main one is known for any agent that has been
  // open before, and going to it is then immediate: the chat is fetched once it is on screen.
  beforeLoad: ({ params, search }) => {
    const chatId =
      mainChatOf(queryClient.getQueryData(agentQuery(params.agentId).queryKey)?.chats)?.id ??
      rememberedMainChat(params.agentId)
    if (chatId === undefined) return
    throw redirect({
      to: "/a/$agentId/c/$chatId",
      params: { agentId: params.agentId, chatId },
      // A settings window that was asked for by address opens over the chat.
      search,
      replace: true,
    })
  },
  component: OpeningAgent,
})

/**
 * An agent that has not been open here before, while it says which of its chats is the main one.
 * The frame around this is already the agent's; this is the chat's place until it can be opened.
 */
function OpeningAgent() {
  const { agentId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  // Shares the layout's query, which also gives the agent a main chat if it has none.
  const { data: state } = useQuery(agentQuery(agentId))
  const listed = useListedAgent(agentId)
  const chatId = mainChatOf(state?.chats)?.id
  useEffect(() => {
    if (chatId === undefined) return
    void navigate({
      to: "/a/$agentId/c/$chatId",
      params: { agentId, chatId },
      search,
      replace: true,
    })
  }, [agentId, chatId, search, navigate])
  return <ChatPlaceholder agent={state?.agent ?? listed} />
}
