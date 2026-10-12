import type { ChatState, ChatSummary } from "@durable-computer/protocol"
import type { ReactNode } from "react"
import { ActivityIndicator } from "react-native"
import { mainChatOf } from "@/chat/chats"
import { useAgentState } from "@/lib/queries"
import { useLiveChat } from "@/lib/use-live-chat"
import { Empty, errorText } from "@/ui"

/**
 * The agent's main chat as it stands, for a page that lists something out of it (what was
 * shared there, what was done there). It listens to the chat for as long as the page is open,
 * so the list grows as the agent works. Until the chat has been heard from it shows a spinner.
 */
export function MainChatLive({
  agentId,
  children,
}: {
  agentId: string
  children: (state: ChatState, chat: ChatSummary) => ReactNode
}) {
  const query = useAgentState(agentId)
  const chat = mainChatOf(query.data?.chats)
  if (chat === undefined) {
    return query.error ? (
      <Empty title="This agent could not be loaded">{errorText(query.error)}</Empty>
    ) : query.data !== undefined ? (
      <Empty title="Nothing yet.">It has no main chat yet.</Empty>
    ) : (
      <ActivityIndicator style={{ marginTop: 80 }} />
    )
  }
  return (
    <Listening agentId={agentId} chat={chat}>
      {children}
    </Listening>
  )
}

function Listening({
  agentId,
  chat,
  children,
}: {
  agentId: string
  chat: ChatSummary
  children: (state: ChatState, chat: ChatSummary) => ReactNode
}) {
  const live = useLiveChat(agentId, chat.id)
  if (!live.loaded) return <ActivityIndicator style={{ marginTop: 80 }} />
  return <>{children(live.state, chat)}</>
}
