import { useQuery } from "@tanstack/react-query"
import { Stack, useLocalSearchParams } from "expo-router"
import { useEffect } from "react"
import { ActivityIndicator, View } from "react-native"
import { MAIN_CHATS_KEY, mainChatOf, mainChatsFrom } from "@/chat/chats"
import { ChatScreen } from "@/chat/screen"
import { useAgentState, useAgentSummary } from "@/lib/queries"
import { storage } from "@/lib/storage"
import { useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import { Text } from "@/ui"

/** Which chat is each agent's main one, as it was the last time the agent was open here. */
let remembered: Record<string, string> | undefined
const known = () => (remembered ??= mainChatsFrom(storage.get(MAIN_CHATS_KEY)))

/**
 * An agent's main chat: what opens when the agent is chosen. Which chat that is does not
 * change, so it is remembered and the chat opens at once; the first time, the agent is asked.
 */
export default function MainChat() {
  const { agentId } = useLocalSearchParams<{ agentId: string }>()
  const theme = useTheme()
  const { client } = useSession()
  const agent = useAgentSummary(agentId)
  const listed = mainChatOf(useAgentState(agentId).data?.chats)?.id
  const kept = known()[agentId]
  const asked = useQuery({
    queryKey: ["agents", agentId, "main-chat"],
    queryFn: () => client.agent(agentId).mainChat(),
    staleTime: Number.POSITIVE_INFINITY,
    enabled: listed === undefined && kept === undefined,
  })
  const chatId = listed ?? kept ?? asked.data?.id
  useEffect(() => {
    if (chatId === undefined || known()[agentId] === chatId) return
    known()[agentId] = chatId
    storage.set(MAIN_CHATS_KEY, JSON.stringify(known()))
  }, [agentId, chatId])

  if (chatId !== undefined)
    return <ChatScreen key={`${agentId}/${chatId}`} agentId={agentId} chatId={chatId} main />
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
        backgroundColor: theme.bg,
      }}
    >
      <Stack.Screen options={{ title: agent?.name ?? "New agent" }} />
      {asked.isError ? (
        <Text tone="ink2" accessibilityRole="alert" style={{ textAlign: "center" }}>
          This chat could not be opened. It may have been deleted.
        </Text>
      ) : (
        <ActivityIndicator color={theme.ink3} />
      )}
    </View>
  )
}
