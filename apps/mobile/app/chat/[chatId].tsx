import type { AgentSummary } from "@durable-computer/protocol"
import { useQueryClient } from "@tanstack/react-query"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { KeyboardAvoidingView, Platform, Pressable, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { PendingApprovals } from "@/components/approvals"
import { Avatar } from "@/components/avatar"
import { Composer, Transcript } from "@/components/chat"
import { Icon } from "@/components/icons"
import { Button, Text } from "@/components/ui"
import { space, useTheme } from "@/lib/theme"
import { keys, useAgent } from "@/lib/use-agent"
import { useEarlierMessages, useLiveChat } from "@/lib/use-live-chat"
import { useMood } from "@/lib/use-mood"
import { useSession } from "@/lib/use-session"

export default function ChatScreen() {
  const { chatId } = useLocalSearchParams<{ chatId: string }>()
  const { agentId, state } = useAgent()
  if (agentId === undefined || state === undefined) return null
  return <Chat agentId={agentId} chatId={chatId} />
}

/** How long a new agent sits in its egg before it starts to hatch. */
const EGG_MS = 1_600

/** Records that the agent's owner has seen it out of its egg, so it is shown hatched from now on. */
function useMarkHatched(agentId: string) {
  const { client } = useSession()
  const queryClient = useQueryClient()
  return useCallback(async () => {
    queryClient.setQueryData(
      keys.agent(agentId),
      await client.agent(agentId).update({ hatched: true }),
    )
    await queryClient.invalidateQueries({ queryKey: keys.agents })
  }, [agentId, client, queryClient])
}

/** What an empty chat shows: the agent, which a new owner first meets as an egg that hatches. */
function Welcome({ agent }: { agent: AgentSummary }) {
  const markHatched = useMarkHatched(agent.id)
  const [phase, setPhase] = useState<"egg" | "hatching" | "out">(agent.hatched ? "out" : "egg")
  useEffect(() => {
    if (phase !== "egg") return
    const timer = setTimeout(() => setPhase("hatching"), EGG_MS)
    return () => clearTimeout(timer)
  }, [phase])
  const told = useRef(agent.hatched)
  const hatched = useCallback(() => {
    setPhase("out")
    if (told.current) return
    told.current = true
    void markHatched()
  }, [markHatched])
  const face = (
    <Avatar
      avatar={agent.avatar}
      seed={agent.id}
      size={176}
      hatched={phase === "out"}
      hatching={phase === "hatching"}
      onHatched={hatched}
    />
  )
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: space(3),
        padding: space(6),
      }}
    >
      <View style={{ marginBottom: space(6) }}>
        {phase === "out" ? (
          face
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Skip the hatching"
            // Leaving the hatch while it plays jumps to its end.
            onPress={() => (phase === "hatching" ? setPhase("out") : hatched())}
          >
            {face}
          </Pressable>
        )}
      </View>
      <Text size={20} weight="500">
        {agent.name ?? "Say hello"}
      </Text>
      <Text tone="muted" size={14} style={{ textAlign: "center" }}>
        {agent.name
          ? (agent.tagline ?? "What would you like to do?")
          : "Your agent is brand new. It has no name yet. Start talking and work out together who it is."}
      </Text>
    </View>
  )
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
  const [typed, setTyped] = useState(0)
  const mood = useMood(agentId, live.state, typed)
  // Someone who starts talking before the egg has opened has met their agent all the same.
  const markHatched = useMarkHatched(agentId)
  const talked = live.loaded && live.state.messages.length > 0
  useEffect(() => {
    if (talked && !agent.hatched) void markHatched()
  }, [talked, agent.hatched, markHatched])

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
          <Avatar
            avatar={agent.avatar}
            seed={agent.id}
            size={30}
            mood={mood}
            hatched={agent.hatched}
          />
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
            face={
              <Avatar
                avatar={agent.avatar}
                seed={agent.id}
                size={28}
                mood={mood}
                hatched={agent.hatched}
              />
            }
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
            empty={live.loaded ? <Welcome agent={agent} /> : null}
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
          onType={() => setTyped((count) => count + 1)}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
