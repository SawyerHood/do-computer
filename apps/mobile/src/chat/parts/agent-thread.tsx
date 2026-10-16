import type { NoticePart, ToolPart } from "@do-computer/protocol"
import { useRouter } from "expo-router"
import { memo } from "react"
import { Pressable, View } from "react-native"
import { useAgents } from "@/lib/queries"
import { radius, useTheme } from "@/lib/theme"
import { Icon, type IconName, Text } from "@/ui"
import { Avatar } from "@/ui/avatar"
import { Markdown } from "@/ui/markdown"
import { drawNamed } from "./named"
import { drawDiagram } from "./diagram"
import { Chip, Fold, NoticeLine } from "./shared"

/** Where a conversation is: the chat of that id on the agent that holds it. */
const chatOf = (agentId: string, chatId: string) =>
  `/a/${encodeURIComponent(agentId)}/c/${encodeURIComponent(chatId)}` as const

/**
 * Another agent's creature, small and still. One that is not on the list of agents, because the
 * list is not in yet or the agent was deleted, is a plain circle of the same size.
 */
export const PeerFace = memo(function PeerFace({
  agentId,
  size = 28,
}: {
  agentId: string
  size?: number
}) {
  const theme = useTheme()
  const agent = useAgents().data?.find((each) => each.id === agentId)
  if (agent === undefined) {
    return (
      <View
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: theme.fill2 }}
      />
    )
  }
  return (
    <Avatar
      avatar={agent.avatar}
      seed={agent.id}
      outfit={agent.outfit}
      size={size}
      hatched={agent.hatched}
      still
    />
  )
})

/**
 * Where the agent wrote to another agent, in its message: a way into what the two said, which
 * is a chat of the other agent's.
 */
export const AgentMessageChip = memo(function AgentMessageChip({ part }: { part: ToolPart }) {
  const theme = useTheme()
  const router = useRouter()
  const { agentId, name, chatId } = part.details as {
    agentId: string
    name: string
    chatId: string
  }
  const peer = useAgents().data?.find((each) => each.id === agentId)
  return (
    <Chip
      lead={<PeerFace agentId={agentId} size={32} />}
      title={`Asked ${peer?.name ?? name}`}
      tail={<Icon name="chevronRight" size={13} color={theme.ink3} weight="semibold" />}
      onPress={() => router.push(chatOf(agentId, chatId))}
    />
  )
})

const MARKS: Record<NonNullable<NoticePart["outcome"]>, IconName> = {
  reported: "checkCircle",
  failed: "warning",
  stopped: "stop",
}

/**
 * Another agent's reply, in the chat the message was sent from: how it went, a way into the
 * conversation, and what it said, folded away.
 */
export const AgentWord = memo(function AgentWord({ part }: { part: NoticePart }) {
  const theme = useTheme()
  const router = useRouter()
  const { agentId, chatId } = part
  const peer = useAgents().data?.find((each) => each.id === agentId)
  return (
    <NoticeLine icon={MARKS[part.outcome ?? "reported"]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {agentId === undefined ? null : <PeerFace agentId={agentId} size={20} />}
        <Text variant="subhead" tone="ink2" style={{ flexShrink: 1 }}>
          <Text variant="subhead" weight="600">
            {peer?.name ?? part.text}
          </Text>{" "}
          {part.outcome === "stopped"
            ? "was stopped before it answered"
            : part.outcome === "failed"
              ? "could not answer"
              : "replied"}
        </Text>
      </View>
      {agentId === undefined || chatId === undefined ? null : (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Open their conversation"
          hitSlop={8}
          onPress={() => router.push(chatOf(agentId, chatId))}
          style={({ pressed }) => ({
            alignSelf: "flex-start",
            paddingVertical: 4,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text variant="footnote" tone="ink2" style={{ textDecorationLine: "underline" }}>
            Open their conversation
          </Text>
        </Pressable>
      )}
      {part.detail === undefined ? null : (
        <Fold label={part.outcome === "failed" ? "What went wrong" : "What it said"}>
          <View
            style={{
              borderRadius: radius.sm,
              backgroundColor: theme.fill,
              paddingHorizontal: 12,
              paddingVertical: 8,
            }}
          >
            <Markdown text={part.detail} image={drawNamed} diagram={drawDiagram} />
          </View>
        </Fold>
      )}
    </NoticeLine>
  )
})
