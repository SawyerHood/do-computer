import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useEffect } from "react"
import { ChatPlaceholder } from "@/components/chat/chat-placeholder"
import { ChatView } from "@/components/chat/chat-view"
import { rememberedMainChat, rememberMainChat } from "@/lib/chats"
import { agentQuery } from "@/lib/collections"
import { warmChat } from "@/lib/use-live-chat"
import { useWide } from "@/lib/use-wide"
import { useListedAgent } from "@/lib/workspaces"

export const Route = createFileRoute("/_app/a/$agentId/c/$chatId")({
  // A side chat that is open beside this chat, which is the agent's main one. A chat's id is a
  // number, and is kept as one here so that the address says `side=7` and not `side="7"`.
  validateSearch: (search: Record<string, unknown>): { side?: number } => {
    const side = typeof search.side === "string" ? Number(search.side) : search.side
    return typeof side === "number" && Number.isSafeInteger(side) && side >= 0 ? { side } : {}
  },
  // Pointing at a link to the chat fetches it ahead, so it is often here when it is opened.
  // Opened, it is followed by the page itself.
  loader: ({ params, preload }) => {
    if (preload) warmChat(params.agentId, params.chatId)
  },
  component: ChatPage,
})

function ChatPage() {
  const { agentId, chatId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const side = search.side === undefined ? undefined : String(search.side)
  const wide = useWide()
  // Shares the layout's query, so this never fetches on its own.
  const { data } = useQuery(agentQuery(agentId))
  // Until the agent's own state is here it is drawn from the list of agents, and its chat is
  // opened meanwhile: the two are fetched side by side.
  const listed = useListedAgent(agentId)
  const agent = data?.agent ?? listed
  // Arrived at as the agent's main chat from memory, and the agent has no such chat: what was
  // remembered is forgotten, and the agent is asked.
  const gone =
    data !== undefined &&
    rememberedMainChat(agentId) === chatId &&
    !data.chats.some((chat) => chat.id === chatId)
  useEffect(() => {
    if (!gone) return
    rememberMainChat(agentId, undefined)
    void navigate({ to: "/a/$agentId", params: { agentId }, replace: true })
  }, [gone, agentId, navigate])
  if (agent === undefined || gone) return <ChatPlaceholder agent={agent} />
  // Keyed by chat so switching chats starts a fresh stream and scroll position. Two agents can
  // both have a chat 1, so the agent is part of the key.
  // Where there is no room for two chats, the side chat is the one shown.
  const shown = side !== undefined && !wide ? side : chatId
  return (
    <ChatView
      key={`${agentId}/${shown}`}
      agent={agent}
      chatId={shown}
      sideId={wide ? side : undefined}
    />
  )
}
