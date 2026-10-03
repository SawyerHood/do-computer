import { useLocalSearchParams, useRouter } from "expo-router"
import { useMemo } from "react"
import { KeyboardAvoidingView, Platform, Pressable, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { PendingApprovals } from "@/components/approvals"
import { Avatar } from "@/components/avatar"
import { Composer, Transcript } from "@/components/chat"
import { Icon } from "@/components/icons"
import { Button, Text } from "@/components/ui"
import { space, useTheme } from "@/lib/theme"
import { useAgent } from "@/lib/use-agent"
import { useEarlierMessages, useLiveChat } from "@/lib/use-live-chat"
import { useSession } from "@/lib/use-session"

export default function ChatScreen() {
  const { chatId } = useLocalSearchParams<{ chatId: string }>()
  const { agentId, state } = useAgent()
  if (agentId === undefined || state === undefined) return null
  return <Chat agentId={agentId} chatId={chatId} />
}

function Chat({ agentId, chatId }: { agentId: string; chatId: string }) {
  const theme = useTheme()
  const router = useRouter()
  const { client } = useSession()
  const { state } = useAgent()
  const live = useLiveChat(agentId, chatId)
  const earlier = useEarlierMessages(agentId, chatId, live.state)
  const transcript = useMemo(
    () =>
      earlier.messages.length === 0
        ? live.state
        : { ...live.state, messages: [...earlier.messages, ...live.state.messages] },
    [earlier.messages, live.state],
  )
  const agent = state!.agent
  const api = client.agent(agentId)

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.canvas }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space(2.5),
            paddingHorizontal: space(3),
            paddingVertical: space(2),
            borderBottomWidth: 1,
            borderBottomColor: theme.border,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to chats"
            hitSlop={10}
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/(app)"))}
          >
            <Icon.back color={theme.ink} />
          </Pressable>
          <Avatar avatar={agent.avatar} seed={agent.id} size={30} />
          <Text weight="500" style={{ flex: 1 }} numberOfLines={1}>
            {agent.name ?? "New agent"}
          </Text>
          {live.status === "reconnecting" ? (
            <Text tone="muted" size={12}>
              reconnecting…
            </Text>
          ) : null}
        </View>
        <View style={{ flex: 1 }}>
          <Transcript
            state={transcript}
            agentId={agentId}
            header={
              earlier.hasEarlier ? (
                <Button
                  label="Show earlier messages"
                  variant="ghost"
                  busy={earlier.loading}
                  onPress={() => void earlier.load()}
                />
              ) : null
            }
            empty={
              live.loaded ? (
                <View
                  style={{
                    flex: 1,
                    alignItems: "center",
                    justifyContent: "center",
                    gap: space(3),
                    padding: space(6),
                  }}
                >
                  <Avatar avatar={agent.avatar} seed={agent.id} size={84} />
                  <Text size={20} weight="500">
                    {agent.name ?? "Say hello"}
                  </Text>
                  <Text tone="muted" size={14} style={{ textAlign: "center" }}>
                    {agent.name
                      ? (agent.tagline ?? "What would you like to do?")
                      : "Your agent is brand new. It has no name yet. Start talking and work out together who it is."}
                  </Text>
                </View>
              ) : null
            }
          />
        </View>
        <PendingApprovals
          agentId={agentId}
          agentName={agent.name ?? "Your agent"}
          chatId={chatId}
        />
        <Composer
          placeholder={agent.name ? `Message ${agent.name}` : "Say hello"}
          busy={live.state.busy}
          queued={live.state.queued}
          onSend={(text) =>
            void api.send(chatId, {
              text,
              requestId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            })
          }
          onStop={() => void api.abort(chatId)}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
