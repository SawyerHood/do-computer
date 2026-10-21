import type { NoticePart, SubagentStatus, ToolPart } from "@do-computer/protocol"
import { useRouter } from "expo-router"
import { memo } from "react"
import { Pressable, View } from "react-native"
import { useAgentState } from "@/lib/queries"
import { radius, useTheme } from "@/lib/theme"
import { Icon, type IconName, Text } from "@/ui"
import { Avatar } from "@/ui/avatar"
import { Markdown } from "@/ui/markdown"
import { drawNamed } from "./named"
import { drawDiagram } from "./diagram"
import { Chip, Fold, NoticeLine, useChatScope } from "./shared"

/**
 * What a sub-agent's creature grows from. It has no look of its own on record: its shape and
 * color come from which sub-agent it is, so it is the same creature wherever it is drawn.
 */
const subagentSeed = (agentId: string, chatId: string) => `${agentId}/sub/${chatId}`

const WORDS: Record<SubagentStatus, string> = {
  working: "Working",
  waiting: "Waiting for your OK",
  done: "Reported back",
  stopped: "Stopped",
  failed: "Did not finish",
}

/** How a sub-agent is getting on, in a word or two. One nothing is known of has reported. */
const subagentWords = (status: SubagentStatus | undefined) => WORDS[status ?? "done"]

/** Where a sub-agent's own chat is. */
const chatOf = (agentId: string, chatId: string) =>
  `/a/${encodeURIComponent(agentId)}/c/${encodeURIComponent(chatId)}` as const

/** A sub-agent's creature, small, as a picture that holds still. */
function SubagentFace({
  agentId,
  chatId,
  size,
}: {
  agentId: string
  chatId: string
  size: number
}) {
  return <Avatar avatar={null} seed={subagentSeed(agentId, chatId)} size={size} still />
}

/**
 * Where the agent started a sub-agent, in its message: who it is, how it is getting on, and a
 * way into its own chat. How it is getting on is read from the agent's list of chats, which the
 * agent's socket keeps current, so nothing is asked for on a timer.
 */
export const SubagentChip = memo(function SubagentChip({ part }: { part: ToolPart }) {
  const { agentId } = useChatScope()
  const theme = useTheme()
  const router = useRouter()
  const { data } = useAgentState(agentId)
  const { chatId, title } = part.details as { chatId: string; title: string }
  const status = data?.chats.find((chat) => chat.id === chatId)?.status
  return (
    <Chip
      lead={<SubagentFace agentId={agentId} chatId={chatId} size={32} />}
      title={title}
      subtitle={subagentWords(status)}
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
 * Word from a sub-agent in the chat that started it: how it ended, a way into its chat, and
 * what it reported, shown open.
 */
export const SubagentWord = memo(function SubagentWord({ part }: { part: NoticePart }) {
  const { agentId } = useChatScope()
  const theme = useTheme()
  const router = useRouter()
  const chatId = part.chatId
  const name = (
    <Text variant="subhead" weight="600">
      {part.text}
    </Text>
  )
  return (
    <NoticeLine icon={MARKS[part.outcome ?? "reported"]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {chatId === undefined ? null : <SubagentFace agentId={agentId} chatId={chatId} size={20} />}
        <Text variant="subhead" tone="ink2" style={{ flexShrink: 1 }}>
          {part.outcome === "stopped" ? (
            <>You stopped {name}</>
          ) : (
            <>
              {name} {part.outcome === "failed" ? "did not finish" : "reported back"}
            </>
          )}
        </Text>
      </View>
      {chatId === undefined ? null : (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Open its chat"
          hitSlop={8}
          onPress={() => router.push(chatOf(agentId, chatId))}
          style={({ pressed }) => ({
            alignSelf: "flex-start",
            paddingVertical: 4,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text variant="footnote" tone="ink2" style={{ textDecorationLine: "underline" }}>
            Open its chat
          </Text>
        </Pressable>
      )}
      {part.detail === undefined ? null : (
        <Fold
          defaultOpen
          label={part.outcome === "failed" ? "What went wrong" : "What it reported"}
        >
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
