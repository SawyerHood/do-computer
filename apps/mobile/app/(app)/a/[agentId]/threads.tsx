import type { ChatSummary } from "@durable-computer/protocol"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import { type ReactNode, useState } from "react"
import { ActivityIndicator } from "react-native"
import { colorHex, useAgentPage } from "@/agent/agent"
import { ago, slackPlace, threadWords } from "@/chat/chats"
import { useAgents } from "@/lib/queries"
import { accentOf, useTheme } from "@/lib/theme"
import { Empty, errorText, Icon, IconTile, Pill, Row, Screen, Section, Text, Tile } from "@/ui"

/** Slack's own color, for the mark where a face would be. */
const SLACK = "#611f69"

const newestFirst = (chats: readonly ChatSummary[], kind: ChatSummary["kind"]) =>
  chats
    .filter((chat) => chat.kind === kind && !chat.archived)
    .sort((a, b) => b.updatedAt - a.updatedAt)

/**
 * The conversations the agent has had that are not with its people: those other agents
 * started with it, and the threads in Slack it was spoken to in. Each opens to be read.
 */
export default function Threads() {
  const { agentId, kind } = useLocalSearchParams<{ agentId: string; kind?: string }>()
  const router = useRouter()
  const theme = useTheme()
  const { state, query, name } = useAgentPage(agentId)
  const agents = useAgents().data ?? []
  const [refreshing, setRefreshing] = useState(false)
  const now = Date.now()

  const threads = newestFirst(state?.chats ?? [], "agent")
  const slack = newestFirst(state?.chats ?? [], "slack")
  const open = (chat: ChatSummary) => router.push(`/a/${agentId}/c/${encodeURIComponent(chat.id)}`)

  /** How it stands, at the end of its row: at work, waiting on someone, failed, or how long ago. */
  const mark = (chat: ChatSummary): ReactNode =>
    chat.status === "working" ? (
      <ActivityIndicator size="small" />
    ) : chat.status === "waiting" ? (
      <Pill label="Needs your OK" tone="busy" />
    ) : chat.status === "failed" ? (
      <Icon name="warning" size={17} color={theme.red} />
    ) : (
      <Text variant="footnote" tone="ink3">
        {ago(chat.updatedAt, now)}
      </Text>
    )

  const fromAgents =
    threads.length === 0 ? null : (
      <Section key="agents" title="From other agents">
        {threads.map((thread) => {
          const peer = agents.find((agent) => agent.id === thread.peer?.agentId)
          const peerName = peer?.name ?? thread.peer?.name ?? "An agent"
          return (
            <Row
              key={thread.id}
              lead={
                <Tile
                  name={peerName}
                  color={accentOf(colorHex(peer?.avatar?.color), theme.dark).a}
                />
              }
              title={thread.title}
              subtitle={`${peerName} · ${threadWords(thread.status).toLowerCase()}`}
              tail={mark(thread)}
              go
              accessibilityLabel={`${thread.title}, from ${peerName}, ${threadWords(thread.status).toLowerCase()}`}
              onPress={() => open(thread)}
            />
          )
        })}
      </Section>
    )
  const fromSlack =
    slack.length === 0 ? null : (
      <Section key="slack" title="From Slack">
        {slack.map((thread) => (
          <Row
            key={thread.id}
            lead={<IconTile icon="hash" color={SLACK} />}
            title={thread.title}
            subtitle={`${slackPlace(thread)} · ${threadWords(thread.status).toLowerCase()}`}
            tail={mark(thread)}
            go
            accessibilityLabel={`${thread.title}, ${slackPlace(thread)}, ${threadWords(thread.status).toLowerCase()}`}
            onPress={() => open(thread)}
          />
        ))}
      </Section>
    )

  const refresh = async () => {
    setRefreshing(true)
    await query.refetch()
    setRefreshing(false)
  }

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <Stack.Screen options={{ title: kind === "slack" ? "From Slack" : "From other agents" }} />
      {state === undefined ? (
        query.error ? (
          <Empty title="This agent could not be loaded">{errorText(query.error)}</Empty>
        ) : (
          <ActivityIndicator style={{ marginTop: 80 }} />
        )
      ) : threads.length === 0 && slack.length === 0 ? (
        <Empty title="Nothing yet.">
          {`When another agent writes to ${name}, or someone speaks to it in Slack, the conversation is kept here to be read.`}
        </Empty>
      ) : kind === "slack" ? (
        [fromSlack, fromAgents]
      ) : (
        [fromAgents, fromSlack]
      )}
    </Screen>
  )
}
