import { callClock, callPhaseWords, type CallView } from "@do-computer/client"
import { avatarLook } from "@do-computer/protocol"
import { useKeepAwake } from "expo-keep-awake"
import { useRouter } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { useEffect, useState } from "react"
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useAgentSummary } from "@/lib/queries"
import { accentOf, radius } from "@/lib/theme"
import { Button, haptic, Icon, type IconName, Text } from "@/ui"
import { Avatar } from "@/ui/avatar"
import { caller, callMood, useCaller } from "./caller"

/** How long the call has lasted, as a clock that ticks. */
export function useCallClock(startedAt: number | undefined): string {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (startedAt === undefined) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [startedAt])
  return callClock(startedAt, now)
}

/** The words of a call are white on its dark ground, a little less so for what is lesser. */
const WHITE = "#ffffff"
const WHITE2 = "rgba(255, 255, 255, 0.68)"
const WHITE3 = "rgba(255, 255, 255, 0.14)"
const RED = "#eb4e3d"
const GREEN = "#34c759"

/** One round button of a call, with what it does under it, as the phone's own calls have. */
function Control({
  icon,
  label,
  on = false,
  hangUp = false,
  onPress,
}: {
  icon: IconName
  label: string
  /** Pressed in: the microphone is muted. */
  on?: boolean
  hangUp?: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={hangUp ? undefined : { selected: on }}
      onPress={onPress}
      style={({ pressed }) => ({ alignItems: "center", gap: 8, opacity: pressed ? 0.7 : 1 })}
    >
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: hangUp ? RED : on ? WHITE : WHITE3,
        }}
      >
        <Icon name={icon} size={30} color={on ? "#16191a" : WHITE} weight="semibold" />
      </View>
      <Text variant="footnote" color={WHITE2} importantForAccessibility="no">
        {label}
      </Text>
    </Pressable>
  )
}

/** The dot that says a call is live. */
export function LiveDot() {
  return <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: GREEN }} />
}

/**
 * A call, as the phone shows it: the whole screen, in the Dood's own color, as a call on the
 * phone itself is. Its creature talks and listens, what is said is under it, and what was
 * handed on to the Dood is said with what the Dood is doing about it. Swiped down, the call goes
 * on, and its chat leads back here.
 */
export function CallScreen({ agentId }: { agentId: string }) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const agent = useAgentSummary(agentId)
  const { call, problem } = useCaller()
  const mine = call?.agentId === agentId ? call : undefined
  const failed = mine === undefined && problem?.agentId === agentId ? problem : undefined
  const color = agent === undefined ? undefined : avatarLook(agent.avatar, agent.id).color
  const ground = accentOf(color, true).soft
  const name = mine?.agentName ?? agent?.name ?? "Your Dood"

  const leave = () => {
    if (router.canGoBack()) router.back()
    else router.replace(`/a/${agentId}`)
  }
  // Nothing to show: the call is over, and its chat is where its record will be.
  const over = mine === undefined && failed === undefined
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when it ends
  useEffect(() => {
    if (over) leave()
  }, [over])

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: ground,
        paddingTop: insets.top + 16,
        paddingBottom: insets.bottom + 20,
        paddingHorizontal: 24,
      }}
    >
      <StatusBar style="light" />
      {mine === undefined ? null : <Awake />}
      {mine !== undefined ? (
        <OnCall call={mine} agentName={name} agent={agent} onLeave={leave} />
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 18 }}>
          <Avatar avatar={agent?.avatar} seed={agentId} outfit={agent?.outfit} size={132} still />
          <Text variant="title2" color={WHITE}>
            {name}
          </Text>
          <Text
            accessibilityRole="alert"
            color={WHITE2}
            style={{ textAlign: "center", maxWidth: 320 }}
          >
            {failed?.text ?? "The call is over."}
          </Text>
          <Button
            title="Close"
            kind="filled"
            color={WHITE3}
            onPress={() => {
              caller.clearProblem()
              leave()
            }}
            style={{ minWidth: 160, marginTop: 8 }}
          />
        </View>
      )}
    </View>
  )
}

/** The screen is kept on while a call is: a phone that locks takes the call's sound with it. */
function Awake() {
  useKeepAwake("call")
  return null
}

function OnCall({
  call,
  agentName,
  agent,
  onLeave,
}: {
  call: CallView
  agentName: string
  agent: ReturnType<typeof useAgentSummary>
  onLeave: () => void
}) {
  const clock = useCallClock(call.startedAt)
  const you = call.you.trim() || call.lines.findLast((line) => line.who === "you")?.text
  const dood = call.dood.trim() || call.lines.findLast((line) => line.who === "dood")?.text
  const working = call.works.filter((work) => !work.done)
  const live = call.startedAt !== undefined
  return (
    <>
      <View
        accessibilityRole="header"
        style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}
      >
        <LiveDot />
        <Text variant="subhead" weight="600" color={WHITE}>
          {live ? "On a call" : "Calling"}
        </Text>
        {live ? (
          <Text variant="subhead" color={WHITE2} style={{ fontVariant: ["tabular-nums"] }}>
            {clock}
          </Text>
        ) : null}
      </View>

      <View style={{ alignItems: "center", marginTop: 28, gap: 6 }}>
        <Avatar
          avatar={agent?.avatar}
          seed={call.agentId}
          outfit={agent?.outfit}
          size={156}
          mood={callMood(call.phase)}
        />
        <Text variant="title1" color={WHITE} numberOfLines={1} style={{ marginTop: 10 }}>
          {agentName}
        </Text>
        <Text
          variant="callout"
          color={call.phase === "speaking" || call.phase === "working" ? WHITE : WHITE2}
          weight={call.phase === "speaking" || call.phase === "working" ? "600" : undefined}
          accessibilityRole="text"
          accessibilityLiveRegion="polite"
          testID="call-status"
        >
          {callPhaseWords(call)}
        </Text>
      </View>

      <ScrollView
        style={{ flex: 1, marginTop: 24 }}
        contentContainerStyle={{ gap: 10, paddingBottom: 12 }}
        showsVerticalScrollIndicator={false}
      >
        <View
          accessibilityLabel="What is being said"
          style={{
            borderRadius: radius.lg,
            borderCurve: "continuous",
            backgroundColor: "rgba(255, 255, 255, 0.08)",
            paddingHorizontal: 16,
            paddingVertical: 14,
            gap: 6,
            minHeight: 96,
          }}
        >
          {you === undefined ? null : (
            <Text variant="subhead" color={WHITE2} numberOfLines={2}>
              <Text variant="subhead" weight="600" color={WHITE2}>
                You{" "}
              </Text>
              {you}
            </Text>
          )}
          <Text variant="body" color={dood === undefined ? WHITE2 : WHITE} numberOfLines={5}>
            {dood ?? (live ? `Go ahead. ${agentName} is listening.` : `Calling ${agentName}…`)}
          </Text>
        </View>
        {working.map((work) => (
          <View
            key={work.id}
            accessibilityRole="text"
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              borderRadius: radius.md,
              borderCurve: "continuous",
              backgroundColor: "rgba(255, 255, 255, 0.08)",
              paddingHorizontal: 14,
              paddingVertical: 10,
            }}
          >
            <ActivityIndicator size="small" color={WHITE} />
            <Text variant="subhead" color={WHITE} style={{ flex: 1 }} numberOfLines={2}>
              {work.step ?? `Handed to ${agentName}`}
            </Text>
          </View>
        ))}
      </ScrollView>

      <View style={{ flexDirection: "row", justifyContent: "space-evenly", paddingTop: 12 }}>
        <Control
          icon={call.muted ? "micSlash" : "mic"}
          label={call.muted ? "Unmute" : "Mute"}
          on={call.muted}
          onPress={() => {
            haptic.light()
            caller.setMuted(!call.muted)
          }}
        />
        <Control
          icon="phoneDown"
          label="End"
          hangUp
          onPress={() => {
            haptic.medium()
            void caller.end()
          }}
        />
        <Control icon="chats" label="Chat" onPress={onLeave} />
      </View>
    </>
  )
}
