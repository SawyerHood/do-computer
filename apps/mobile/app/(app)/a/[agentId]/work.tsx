import {
  type ChatRun,
  chatRuns,
  toolActivity,
  type ToolPart,
  toolSummary,
  useOf,
} from "@durable-computer/protocol"
import { Stack, useLocalSearchParams } from "expo-router"
import { useState } from "react"
import { ActivityIndicator, Pressable, View } from "react-native"
import { useAgentPage } from "@/agent/agent"
import { MainChatLive } from "@/agent/main-chat"
import { mono, useTheme } from "@/lib/theme"
import { Empty, haptic, Icon, Screen, Section, Text } from "@/ui"

/** How many of the latest pieces of work are listed. */
const SHOWN = 30
/** How much of what a step returned is shown: the start of it. */
const OUTPUT_CHARS = 4000

const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })

/**
 * What the agent did in its main chat: each piece of substantial work it wrote an entry for,
 * newest first. The chat keeps only what was said; this is where the work behind an answer
 * can be opened and read, step by step.
 */
export default function WorkHere() {
  const { agentId } = useLocalSearchParams<{ agentId: string }>()
  const { name } = useAgentPage(agentId)
  return (
    <Screen>
      <Stack.Screen options={{ title: "What it did here" }} />
      <MainChatLive agentId={agentId}>
        {(state) => {
          const runs = chatRuns(state).slice(-SHOWN).reverse()
          if (runs.length === 0) {
            return (
              <Empty title="Nothing yet.">
                {`When ${name} gets something substantial done in this chat, it notes it here, with its steps inside.`}
              </Empty>
            )
          }
          return (
            <Section>
              {runs.map((run) => (
                <Work key={run.id} run={run} />
              ))}
            </Section>
          )
        }}
      </MainChatLive>
    </Screen>
  )
}

/** One piece of work: what it was, what came of it, and its steps for whoever wants them. */
function Work({ run }: { run: ChatRun }) {
  const theme = useTheme()
  const [open, setOpen] = useState(false)
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={run.entry.title}
        onPress={() => {
          haptic.light()
          setOpen(!open)
        }}
        style={({ pressed }) => ({
          minHeight: 50,
          paddingHorizontal: 16,
          paddingVertical: 11,
          flexDirection: "row",
          alignItems: open ? "flex-start" : "center",
          gap: 12,
          backgroundColor: pressed ? theme.fill : undefined,
        })}
      >
        <View style={{ width: 22, alignItems: "center", paddingTop: open ? 1 : 0 }}>
          {run.status === "working" ? (
            <ActivityIndicator size="small" />
          ) : run.status === "failed" ? (
            <Icon name="warning" size={19} color={theme.red} />
          ) : (
            <Icon name="checkCircle" size={19} color={theme.ink3} />
          )}
        </View>
        <Text
          weight={open ? "600" : undefined}
          numberOfLines={open ? undefined : 1}
          style={{ flex: 1 }}
        >
          {run.entry.title}
        </Text>
        <View
          style={{ transform: [{ rotate: open ? "180deg" : "0deg" }], paddingTop: open ? 5 : 0 }}
        >
          <Icon name="chevronDown" size={13} color={theme.ink3} weight="semibold" />
        </View>
      </Pressable>
      {open ? (
        <View style={{ paddingLeft: 50, paddingRight: 16, paddingBottom: 12, gap: 6 }}>
          <Text variant="subhead" tone="ink2" selectable>
            {run.entry.outcome}
          </Text>
          <Text variant="footnote" tone="ink3">
            {run.at === undefined ? "" : `${clock.format(run.at)} · `}
            {run.steps.length} {run.steps.length === 1 ? "step" : "steps"}
            {run.status === "stopped" ? " · stopped" : ""}
          </Text>
          <View accessibilityLabel="Steps" style={{ marginTop: 2 }}>
            {run.steps.map((part) => (
              <Step key={part.toolCallId} part={part} />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  )
}

/** One step of a piece of work, which opens to show what came back. */
function Step({ part }: { part: ToolPart }) {
  const theme = useTheme()
  const [open, setOpen] = useState(false)
  const going = part.status === "pending" || part.status === "running"
  const output = part.output?.trim() ?? ""
  // A step on a screen says what it did there, not only that it used it.
  const words = useOf(part)?.say ?? (going ? toolActivity(part) : toolSummary(part))
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={words}
        onPress={() => setOpen(!open)}
        hitSlop={2}
        style={{ flexDirection: "row", alignItems: "flex-start", gap: 9, paddingVertical: 5 }}
      >
        <View
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            marginTop: 7,
            backgroundColor: part.status === "error" ? theme.red : going ? theme.amber : theme.ink3,
          }}
        />
        <Text
          variant="footnote"
          tone={open ? "ink" : "ink2"}
          numberOfLines={open ? undefined : 1}
          style={{ flex: 1 }}
        >
          {words}
        </Text>
      </Pressable>
      {open ? (
        <View
          style={{
            marginLeft: 15,
            marginTop: 2,
            marginBottom: 6,
            padding: 9,
            borderRadius: 10,
            borderCurve: "continuous",
            backgroundColor: theme.fill,
          }}
        >
          <Text
            selectable
            tone="ink2"
            style={{ fontFamily: mono, fontSize: 12, lineHeight: 17, letterSpacing: 0 }}
          >
            {output === ""
              ? going
                ? "Still going."
                : "It returned nothing."
              : output.length > OUTPUT_CHARS
                ? `${output.slice(0, OUTPUT_CHARS)}\n…`
                : output}
          </Text>
        </View>
      ) : null}
    </View>
  )
}
