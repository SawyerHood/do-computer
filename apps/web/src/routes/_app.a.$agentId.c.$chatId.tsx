import type { AgentState } from "@durable-computer/client"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { ChatView } from "@/components/chat/chat-view"
import { client } from "@/lib/client"
import { agentKey } from "@/lib/collections"

export const Route = createFileRoute("/_app/a/$agentId/c/$chatId")({ component: ChatPage })

function ChatPage() {
  const { agentId, chatId } = Route.useParams()
  // Shares the layout's query, so this never fetches on its own.
  const { data } = useQuery<AgentState>({
    queryKey: agentKey(agentId),
    queryFn: () => client.agent(agentId).state(),
  })
  if (data === undefined) return null
  // Keyed by chat so switching chats starts a fresh stream and scroll position. Two agents can
  // both have a chat 1, so the agent is part of the key.
  return <ChatView key={`${agentId}/${chatId}`} agent={data.agent} chatId={chatId} />
}
