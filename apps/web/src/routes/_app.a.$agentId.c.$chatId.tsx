import type { AgentState } from "@durable-computer/client"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { ChatView } from "@/components/chat/chat-view"
import { client } from "@/lib/client"
import { agentKey } from "@/lib/collections"
import { useWide } from "@/lib/use-wide"

export const Route = createFileRoute("/_app/a/$agentId/c/$chatId")({
  // A side chat that is open beside this chat, which is the agent's main one. A chat's id is a
  // number, and is kept as one here so that the address says `side=7` and not `side="7"`.
  validateSearch: (search: Record<string, unknown>): { side?: number } => {
    const side = typeof search.side === "string" ? Number(search.side) : search.side
    return typeof side === "number" && Number.isSafeInteger(side) && side >= 0 ? { side } : {}
  },
  component: ChatPage,
})

function ChatPage() {
  const { agentId, chatId } = Route.useParams()
  const search = Route.useSearch()
  const side = search.side === undefined ? undefined : String(search.side)
  const wide = useWide()
  // Shares the layout's query, so this never fetches on its own.
  const { data } = useQuery<AgentState>({
    queryKey: agentKey(agentId),
    queryFn: () => client.agent(agentId).state(),
  })
  if (data === undefined) return null
  // Keyed by chat so switching chats starts a fresh stream and scroll position. Two agents can
  // both have a chat 1, so the agent is part of the key.
  // Where there is no room for two chats, the side chat is the one shown.
  const shown = side !== undefined && !wide ? side : chatId
  return (
    <ChatView
      key={`${agentId}/${shown}`}
      agent={data.agent}
      chatId={shown}
      sideId={wide ? side : undefined}
    />
  )
}
