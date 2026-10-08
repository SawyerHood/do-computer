import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "expo-router"
import { Pressable, View } from "react-native"
import { Avatar } from "@/components/avatar"
import { Icon } from "@/components/icons"
import { Screen } from "@/components/screen"
import { Empty, ErrorText, Text } from "@/components/ui"
import { radius, space, useTheme } from "@/lib/theme"
import { keys, useAgent } from "@/lib/use-agent"
import { useSession } from "@/lib/use-session"

const when = (at: number) =>
  new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(at))

/** The agent's chats, newest first. Scheduled runs have their own chats and are not listed here. */
export default function Chats() {
  const theme = useTheme()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { client } = useSession()
  const { agentId, state, error } = useAgent()
  const chats = (state?.chats ?? []).filter((chat) => chat.kind === "chat" && !chat.archived)

  const start = async () => {
    if (agentId === undefined) return
    const chat = await client.agent(agentId).createChat()
    await queryClient.invalidateQueries({ queryKey: keys.agent(agentId) })
    router.push(`/chat/${chat.id}`)
  }

  return (
    <Screen
      title={state?.agent.name ?? "Your agent"}
      subtitle={
        state?.agent.tagline ??
        (state && !state.agent.name ? "Brand new, and not named yet. Say hello." : undefined)
      }
      action={
        state ? (
          <Avatar
            avatar={state.agent.avatar}
            seed={state.agent.id}
            outfit={state.agent.outfit}
            size={48}
            hatched={state.agent.hatched}
          />
        ) : null
      }
    >
      <ErrorText>{error?.message}</ErrorText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="New chat"
        // Until the agent has loaded there is nothing to start a chat with.
        disabled={agentId === undefined}
        accessibilityState={{ disabled: agentId === undefined }}
        onPress={start}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: space(2),
          padding: space(3.5),
          borderRadius: radius.md,
          backgroundColor: theme.primary,
          opacity: agentId === undefined ? 0.5 : pressed ? 0.8 : 1,
        })}
      >
        <Icon.plus color={theme.onPrimary} size={20} />
        <Text tone="onPrimary" weight="500">
          New chat
        </Text>
      </Pressable>
      {state && chats.length === 0 ? <Empty>No chats yet.</Empty> : null}
      <View style={{ gap: space(2) }}>
        {chats.map((chat) => (
          <Pressable
            key={chat.id}
            accessibilityRole="link"
            accessibilityLabel={chat.title}
            onPress={() => router.push(`/chat/${chat.id}`)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: space(3),
              padding: space(3.5),
              borderRadius: radius.md,
              backgroundColor: pressed ? theme.raised : theme.surface,
            })}
          >
            <Text style={{ flex: 1 }} numberOfLines={1}>
              {chat.title}
            </Text>
            <Text tone="muted" size={13}>
              {when(chat.updatedAt)}
            </Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  )
}
