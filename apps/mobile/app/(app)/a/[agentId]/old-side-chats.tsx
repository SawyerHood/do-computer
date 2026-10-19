import { useLocalSearchParams, useRouter } from "expo-router"
import { ActivityIndicator } from "react-native"
import { ago, sideChatsOf } from "@/chat/chats"
import { useAgentState, useAgentSummary } from "@/lib/queries"
import { useTheme } from "@/lib/theme"
import { haptic, Row, Screen, Section, Text } from "@/ui"

/**
 * An agent's old side chats, as a sheet from its page, to read. A Dood is talked to in its main
 * chat alone; the side chats from before that are kept, archived, and nothing new is started here.
 */
export default function OldSideChats() {
  const { agentId } = useLocalSearchParams<{ agentId: string }>()
  const theme = useTheme()
  const router = useRouter()
  const agent = useAgentSummary(agentId)
  const state = useAgentState(agentId)
  const name = agent?.name ?? "New Dood"
  const chats = sideChatsOf(state.data?.chats)
  const now = Date.now()

  // The sheet goes, and the chat comes in over the main one.
  const open = (chatId: string) => {
    haptic.tap()
    router.back()
    router.push(`/a/${agentId}/c/${chatId}`)
  }

  return (
    <Screen
      onRefresh={() => void state.refetch()}
      refreshing={state.isRefetching}
      accessibilityLabel={`Old side chats with ${name}`}
    >
      {state.data === undefined ? (
        <ActivityIndicator color={theme.ink3} />
      ) : (
        <Section
          footer={
            chats.length === 0
              ? `${name} has no old side chats.`
              : `From before everything with ${name} went to its main chat. Kept to read.`
          }
        >
          {chats.map((chat) => (
            <Row
              key={chat.id}
              title={chat.title}
              tail={<Text tone="ink2">{ago(chat.updatedAt, now)}</Text>}
              go
              onPress={() => open(chat.id)}
            />
          ))}
        </Section>
      )}
    </Screen>
  )
}
