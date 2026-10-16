import { callPhaseWords } from "@do-computer/client"
import type { ChatState } from "@do-computer/protocol"
import { useRouter } from "expo-router"
import { useEffect, useMemo } from "react"
import { ActivityIndicator, Pressable, View } from "react-native"
import { useTheme } from "@/lib/theme"
import { Glass, Icon, Text } from "@/ui"
import { useCallClock, LiveDot } from "./call-screen"
import { caller, useCaller } from "./caller"

/** The ids of the calls whose records a chat already has. */
function recordedIn(state: ChatState): Set<string> {
  const ids = new Set<string>()
  for (const message of state.messages) {
    for (const part of message.parts) {
      if (part.type === "notice" && part.kind === "call" && part.call !== undefined) {
        ids.add(part.call.id)
      }
    }
  }
  return ids
}

/**
 * What a chat shows of a call, at its top: one that is on, with any Dood, which leads back to
 * its screen; why one with this Dood ended by itself; and, in the chat it was held in, that its
 * record is being written, until the record is there.
 */
export function CallBar({
  agentId,
  chatId,
  state,
}: {
  agentId: string
  chatId: string
  state: ChatState
}) {
  const theme = useTheme()
  const router = useRouter()
  const { call, problem, wrapUp } = useCaller()
  const clock = useCallClock(call?.startedAt)
  const mine = wrapUp?.agentId === agentId && wrapUp.chatId === chatId ? wrapUp : undefined
  const recorded = useMemo(() => recordedIn(state), [state])
  const written = mine !== undefined && recorded.has(mine.callId)
  // Its record is in the chat: the line that stood in for it has done its work.
  useEffect(() => {
    if (written) caller.clearWrapUp()
  }, [written])

  if (call !== undefined) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`On a call with ${call.agentName}, ${callPhaseWords(call)}. Back to the call`}
        onPress={() => router.push(`/a/${call.agentId}/call`)}
      >
        <Glass
          interactive
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            borderRadius: 999,
            paddingHorizontal: 14,
            height: 36,
          }}
        >
          <LiveDot />
          <Text variant="footnote" weight="600" numberOfLines={1}>
            {call.startedAt === undefined ? `Calling ${call.agentName}…` : call.agentName}
          </Text>
          {call.startedAt === undefined ? null : (
            <Text
              variant="footnote"
              tone="ink2"
              numberOfLines={1}
              style={{ fontVariant: ["tabular-nums"] }}
            >
              {clock} · {callPhaseWords(call)}
            </Text>
          )}
        </Glass>
      </Pressable>
    )
  }
  if (problem?.agentId === agentId) {
    return (
      <View accessibilityRole="alert">
        <Glass
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            borderRadius: 18,
            paddingLeft: 14,
            paddingRight: 6,
            paddingVertical: 6,
            maxWidth: 360,
          }}
        >
          <Icon name="phoneDown" size={16} color={theme.ink2} />
          <Text variant="footnote" style={{ flexShrink: 1 }}>
            {problem.text}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="OK"
            onPress={() => caller.clearProblem()}
            style={{ paddingHorizontal: 10, paddingVertical: 6 }}
          >
            <Text variant="footnote" weight="600" tone="tint">
              OK
            </Text>
          </Pressable>
        </Glass>
      </View>
    )
  }
  if (mine === undefined || written) return null
  return (
    <View accessibilityRole="text">
      <Glass
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          borderRadius: 999,
          paddingHorizontal: 14,
          height: 36,
        }}
      >
        <ActivityIndicator size="small" color={theme.ink2} />
        <Text variant="footnote" tone="ink2">
          The call is over. Writing it up…
        </Text>
      </Glass>
    </View>
  )
}

/** Whether there is anything for the bar to show, so that room is kept for it only then. */
export function useCallBarShown(agentId: string, chatId: string): boolean {
  const { call, problem, wrapUp } = useCaller()
  return (
    call !== undefined ||
    problem?.agentId === agentId ||
    (wrapUp?.agentId === agentId && wrapUp.chatId === chatId)
  )
}
