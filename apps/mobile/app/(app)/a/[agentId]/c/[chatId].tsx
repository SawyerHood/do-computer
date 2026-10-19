import { useLocalSearchParams } from "expo-router"
import { ChatScreen } from "@/chat/screen"

/** Any chat of an agent but its main one: a side chat, a sub-agent's, a scheduled run, a thread. */
export default function Chat() {
  const { agentId, chatId } = useLocalSearchParams<{ agentId: string; chatId: string }>()
  return <ChatScreen key={`${agentId}/${chatId}`} agentId={agentId} chatId={chatId} />
}
