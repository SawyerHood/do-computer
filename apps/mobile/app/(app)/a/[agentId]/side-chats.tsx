import type { ChatSummary } from "@do-computer/protocol"
import { useQueryClient } from "@tanstack/react-query"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useState } from "react"
import { ActivityIndicator, View } from "react-native"
import { ago, isAtWork, mainChatOf, names, sideChatsOf, whoIs } from "@/chat/chats"
import { useHere } from "@/lib/presence"
import { keys, useAgentState, useAgentSummary, useMe, useWorkspaces } from "@/lib/queries"
import { useAgentAccent, useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import {
  confirm,
  errorText,
  Faces,
  haptic,
  Icon,
  Row,
  Screen,
  Section,
  SwipeRow,
  tell,
  Text,
} from "@/ui"

/**
 * The way to an agent's side chats, as a sheet from the main chat's bar. The list of agents
 * names agents and nothing else, and choosing one opens its main chat; its other conversations
 * are kept here.
 */
export default function SideChats() {
  const { agentId } = useLocalSearchParams<{ agentId: string }>()
  const theme = useTheme()
  const router = useRouter()
  const { client } = useSession()
  const queryClient = useQueryClient()
  const agent = useAgentSummary(agentId)
  const accent = useAgentAccent(agent)
  const state = useAgentState(agentId)
  const name = agent?.name ?? "New agent"
  const chats = sideChatsOf(state.data?.chats)
  const main = mainChatOf(state.data?.chats)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string>()
  const now = Date.now()

  const me = useMe().data?.user
  const workspace = useWorkspaces().data?.workspaces.find((each) => each.id === agent?.workspaceId)
  const team = workspace?.kind === "team" ? workspace : undefined
  const here = useHere()[team?.id ?? ""] ?? []
  const subagents = (state.data?.chats ?? []).filter((chat) => chat.kind === "subagent")
  // Someone reading a sub-agent's chat counts as being in the chat it was started in.
  const parentOf = new Map(subagents.map((subagent) => [subagent.id, subagent.parentId]))
  const atWork = (chat: ChatSummary) =>
    subagents.filter((subagent) => subagent.parentId === chat.id && isAtWork(subagent.status))
      .length
  const peopleIn = (chat: ChatSummary) =>
    whoIs(
      here,
      (place) =>
        place.agentId === agentId &&
        place.chatId !== null &&
        place.userId !== me?.id &&
        (parentOf.get(place.chatId) ?? place.chatId) === chat.id,
    ).flatMap((id) => team?.members.find((member) => member.id === id) ?? [])

  // The sheet goes, and the chat comes in over the main one.
  const open = (chatId: string) => {
    haptic.tap()
    router.back()
    router.push(`/a/${agentId}/c/${chatId}`)
  }
  const create = async () => {
    setCreating(true)
    setError(undefined)
    try {
      const chat = await client.agent(agentId).createChat()
      await queryClient.invalidateQueries({ queryKey: keys.agent(agentId) })
      open(chat.id)
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setCreating(false)
    }
  }
  const archive = async (chat: ChatSummary) => {
    const sure = await confirm({
      title: `Archive “${chat.title}”?`,
      message: "It is put away, out of the list of side chats.",
      action: "Archive",
    })
    if (!sure) return
    try {
      await client.agent(agentId).updateChat(chat.id, { archived: true })
      haptic.done()
    } catch (caught) {
      tell("The chat was not archived", errorText(caught))
    } finally {
      void queryClient.invalidateQueries({ queryKey: keys.agent(agentId) })
    }
  }

  return (
    <Screen
      onRefresh={() => void state.refetch()}
      refreshing={state.isRefetching}
      accessibilityLabel={`Side chats with ${name}`}
    >
      <Section
        footer={
          error ??
          (chats.length === 0 && state.data !== undefined
            ? `None yet. Start one to keep something out of the main chat, or to ask for something while ${name} is busy there.`
            : `Its own conversation with ${name} and the same memory, kept out of the main chat.`)
        }
      >
        <Row
          title="New side chat"
          tone="tint"
          lead={<Icon name="plus" size={20} color={theme.tint} weight="medium" />}
          busy={creating}
          disabled={creating || (state.data !== undefined && main === undefined)}
          onPress={() => void create()}
        />
      </Section>
      {state.data === undefined ? (
        <ActivityIndicator color={theme.ink3} />
      ) : chats.length === 0 ? null : (
        <Section>
          {chats.map((chat) => {
            const people = peopleIn(chat)
            const working = atWork(chat)
            return (
              <SwipeRow
                key={chat.id}
                actions={[
                  {
                    title: "Archive",
                    icon: "archive",
                    color: "grey",
                    onPress: () => void archive(chat),
                  },
                ]}
              >
                <Row
                  title={chat.title}
                  subtitle={
                    working > 0
                      ? `${working} ${working === 1 ? "sub-agent" : "sub-agents"} at work`
                      : people.length > 0
                        ? `${names(people)} ${people.length === 1 ? "is" : "are"} here`
                        : undefined
                  }
                  tail={
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      {people.length === 0 ? null : (
                        <Faces people={people} size={20} ring={theme.card} />
                      )}
                      {working > 0 ? (
                        <ActivityIndicator
                          size="small"
                          color={accent.a}
                          accessibilityLabel="Working"
                        />
                      ) : (
                        <Text tone="ink2">{ago(chat.updatedAt, now)}</Text>
                      )}
                    </View>
                  }
                  go
                  onPress={() => open(chat.id)}
                />
              </SwipeRow>
            )
          })}
        </Section>
      )}
    </Screen>
  )
}
