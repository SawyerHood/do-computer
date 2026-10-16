import {
  type AgentSummary,
  chatActivity,
  type ChatMessage,
  type ChatState,
  chatUses,
  isAgentMessage,
  isMcpApp,
  isJobStart,
  isSentFile,
  isSiteShare,
  isSubagentStart,
  isUse,
  isVisual,
  type MessagePart,
  type NoticePart,
  type Person,
  readMcpApp,
} from "@do-computer/protocol"
import {
  type ComponentType,
  memo,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  ActivityIndicator,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  ScrollView,
  type ScrollViewProps,
  StyleSheet,
  View,
} from "react-native"
import { LinearGradient } from "expo-linear-gradient"
import { KeyboardChatScrollView } from "react-native-keyboard-controller"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useAgentState, useMe, useWorkspaces } from "@/lib/queries"
import { type Accent, mono, useTheme } from "@/lib/theme"
import type { useEarlierMessages } from "@/lib/use-live-chat"
import { Button, Face, GlassButton, haptic, Icon, type IconName, Text } from "@/ui"
import { Markdown } from "@/ui/markdown"
import { AgentMessageChip, AgentWord, PeerFace } from "./parts/agent-thread"
import { CommandChip, CommandWord } from "./parts/command"
import { ReplyError } from "./parts/error"
import { SentFile } from "./parts/file"
import { clockOf, isAtEnd, isUntouched, shownMessages, shownParts, textOf } from "./parts/logic"
import { drawNamed } from "./parts/named"
import { type Picture, SentPictures } from "./parts/pictures"
import {
  type ChatScope,
  ChatScopeContext,
  type ChatUses,
  Fold,
  NoticeLine,
  Pre,
  useChatScope,
  UsesContext,
} from "./parts/shared"
import { SiteCard } from "./parts/site"
import { StatusLine } from "./parts/status"
import { SubagentChip, SubagentWord } from "./parts/subagent"
import { UseView } from "./parts/use"
import { VisualFrame } from "./parts/visual"

export type TranscriptProps = {
  agentId: string
  chatId: string
  /** The chat as `useLiveChat` holds it. */
  state: ChatState
  /**
   * The messages in it that were sent and have not reached the agent, by id. They are marked
   * as on their way, and the last one it has been given is marked as delivered.
   */
  undelivered?: ReadonlySet<string>
  /** What `useEarlierMessages(agentId, chatId, state)` returned. */
  earlier: ReturnType<typeof useEarlierMessages>
  /** The agent as the list has it; undefined until that is in. */
  agent: AgentSummary | undefined
  /** The agent's accent: `soft`/`ink` for the reader's own messages, `a` for marks. */
  accent: Accent
  /** Shown in place of messages while the chat has none (the hello). */
  empty?: ReactNode
  /** Room to leave under the last message for what floats over the foot: the message box and any asks. */
  bottomInset: number
  /** Send the last message again after a failed reply ("Try again"). */
  onRetry?: () => void
}

/**
 * The team a chat is in, for the messages that show who said what: which person is reading,
 * and everyone in the team by id. Undefined in a personal workspace, where it is only ever you.
 */
type Team = { meId: string; people: Map<string, Person> }

/* ---------- what the agent says ---------- */

/** What the agent says: the page's own text, with nothing drawn around it. */
const Answer = memo(function Answer({ text }: { text: string }) {
  // Its words can be selected, which brings up the system's own Copy, Look Up and Share.
  return <Markdown text={text} image={drawNamed} />
})

const AssistantPart = memo(function AssistantPart({
  part,
  whole,
}: {
  part: MessagePart
  whole: string
}) {
  // A connector's own page for a tool is shown in a browser, where it can be kept apart as it
  // has to be. Here it is said to be there, and what the tool answered is in the reply.
  if (isMcpApp(part)) {
    const connector = readMcpApp(part.details)?.app.connector ?? "The connector"
    return <Marker icon="globe">{connector} has a page for this, shown in a browser.</Marker>
  }
  if (isSentFile(part)) return <SentFile part={part} />
  if (isVisual(part)) return <VisualFrame part={part} />
  if (isSiteShare(part)) return <SiteCard part={part} />
  if (isSubagentStart(part)) return <SubagentChip part={part} />
  if (isJobStart(part)) return <CommandChip part={part} />
  if (isUse(part)) return <UseView part={part} />
  if (isAgentMessage(part)) return <AgentMessageChip part={part} />
  switch (part.type) {
    case "text":
      return <Answer text={part.text} />
    case "notice":
      // Heads the report of a scheduled task.
      return <Marker icon="clock">Scheduled: {part.text}</Marker>
    default:
      return null
  }
})

/* ---------- marks ---------- */

/** A few quiet words that mark something in the chat, with a symbol before them. */
function Marker({ icon, children }: { icon?: IconName; children: ReactNode }) {
  const theme = useTheme()
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      {icon === undefined ? null : <Icon name={icon} size={14} color={theme.ink2} />}
      <Text variant="subhead" tone="ink2" style={{ flexShrink: 1 }}>
        {children}
      </Text>
    </View>
  )
}

/** A mark across the page, where the chat's context changed: a rule, the words, a rule. */
function Separator({ children }: { children: string }) {
  const theme = useTheme()
  const rule = { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: theme.sep }
  return (
    <View accessibilityRole="text" style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <View style={rule} />
      <Icon name="refresh" size={12} color={theme.ink2} />
      <Text variant="footnote" tone="ink2">
        {children}
      </Text>
      <View style={rule} />
    </View>
  )
}

/** A name of something (a computer, a secret) inside a notice, in the face code is written in. */
function Code({ children }: { children: ReactNode }) {
  const theme = useTheme()
  return (
    <Text
      variant="subhead"
      weight="500"
      style={{ fontFamily: mono, fontSize: 14, color: theme.ink }}
    >
      {children}
    </Text>
  )
}

/** A notice: something that happened in the chat that is nobody's message. */
function Notice({ part }: { part: NoticePart | undefined }) {
  if (part?.kind === "subagent") return <SubagentWord part={part} />
  if (part?.kind === "agent") return <AgentWord part={part} />
  if (part?.kind === "command") return <CommandWord part={part} />
  if (part?.kind === "call") {
    // A voice call that was held in the chat, from a browser or the desktop app: how long it
    // was, what came of it, and what was said. A call cannot be started from the phone yet.
    const call = part.call
    return (
      <NoticeLine icon="mic">
        <Text variant="subhead" tone="ink2">
          A call of {part.text}
        </Text>
        {call?.summary.map((line, index) => (
          <Text key={index} variant="subhead" tone="ink2">
            {line}
          </Text>
        ))}
        {call === undefined || call.lines.length === 0 ? null : (
          <Fold label="What was said">
            <Pre
              text={call.lines
                .map((line) => `${line.who === "you" ? "You" : "Dood"}: ${line.text}`)
                .join("\n")}
              maxHeight={320}
            />
          </Fold>
        )}
      </NoticeLine>
    )
  }
  if (part?.kind === "computer") {
    // The answer to the agent's asking to use a computer.
    return (
      <NoticeLine icon="desktop">
        <Text variant="subhead" tone="ink2">
          {part.by ?? "Someone"} {part.approved ? "said yes to" : "said no to"} using{" "}
          <Code>{part.text}</Code>
        </Text>
      </NoticeLine>
    )
  }
  if (part?.kind === "secret") {
    // The answer to the agent's asking for secrets: which, and where they went. Never what.
    // A login is told in words, "a login for github.com", where secrets are told by their names.
    const login = part.text === "" && /^a login for \S+$/.test(part.detail ?? "")
    return (
      <NoticeLine icon="key">
        <Text variant="subhead" tone="ink2">
          {part.by ?? "Someone"} {part.approved ? "gave" : "chose not to give"}{" "}
          {login ? part.detail : <Code>{part.detail}</Code>}
          {part.text === "" ? null : (
            <>
              {part.approved ? ", saved to " : " for "}
              <Text variant="subhead" tone="ink2" style={{ fontFamily: mono, fontSize: 14 }}>
                {part.text}
              </Text>
            </>
          )}
        </Text>
      </NoticeLine>
    )
  }
  if (part?.kind === "connector") {
    // How a sign-in to a connector the agent asked for went.
    return (
      <NoticeLine icon="plug">
        <Text variant="subhead" tone="ink2">
          {part.by ?? "Someone"} {part.approved ? "connected" : "did not connect"}{" "}
          <Text variant="subhead" weight="500">
            {part.text}
          </Text>
          {part.detail ? `: ${part.detail}` : null}
        </Text>
      </NoticeLine>
    )
  }
  return (
    <Separator>
      {part?.kind === "compaction"
        ? "Earlier messages were summarized"
        : part?.kind === "branch"
          ? // The server says how much of the main chat it carries.
            part.text || "Continues from the main chat"
          : "New context"}
    </Separator>
  )
}

/* ---------- what is said to the agent ---------- */

/** Words in a bubble at the reader's side of the page. Held down, it offers to copy them. */
function Bubble({ text, own, caption }: { text: string; own: boolean; caption?: string }) {
  const theme = useTheme()
  const { accent } = useChatScope()
  return (
    <View style={{ alignSelf: "flex-end", maxWidth: "100%" }}>
      <View
        style={{
          borderRadius: 20,
          borderBottomRightRadius: 6,
          paddingHorizontal: 14,
          paddingVertical: 9,
          backgroundColor: own ? accent.soft : theme.fill,
        }}
      >
        {caption === undefined ? null : (
          <Text variant="caption" tone="ink2" style={{ marginBottom: 2 }}>
            {caption}
          </Text>
        )}
        <Text
          selectable
          variant="body"
          color={own ? accent.ink : theme.ink}
          style={{ lineHeight: 24 }}
        >
          {text}
        </Text>
      </View>
    </View>
  )
}

/** A message from somebody who is not the reader: their face beside it, their name and the time over it. */
function FromSomeone({
  face,
  name,
  at,
  slack = false,
  children,
}: {
  face: ReactNode
  name: string
  at: number | undefined
  /** It was written in Slack, and says so. */
  slack?: boolean
  children: ReactNode
}) {
  const theme = useTheme()
  return (
    <View
      style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "flex-end", gap: 8 }}
    >
      <View style={{ flexShrink: 1, alignItems: "flex-end", gap: 4, maxWidth: "82%" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingRight: 4 }}>
          <Text variant="caption" weight="600" numberOfLines={1} style={{ flexShrink: 1 }}>
            {name}
          </Text>
          {at === undefined ? null : (
            <Text variant="caption" tone="ink2">
              {clockOf(at)}
            </Text>
          )}
          {slack ? (
            <>
              <Icon name="hash" size={11} color={theme.ink2} />
              <Text variant="caption" tone="ink2">
                in Slack
              </Text>
            </>
          ) : null}
        </View>
        {children}
      </View>
      {face}
    </View>
  )
}

/** Where a face would be, for someone known only from Slack. */
function SlackMark() {
  const theme = useTheme()
  return (
    <View
      accessibilityLabel="Slack"
      style={{
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: theme.fill,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon name="hash" size={14} color={theme.ink2} weight="semibold" />
    </View>
  )
}

/** The words and pictures of a message somebody sent, each in its place. */
function SentParts({ message, own }: { message: ChatMessage; own: boolean }) {
  // Made once for a message, not each time the chat changes: a picture's data is long.
  const pictures = useMemo(
    () =>
      message.parts.flatMap((part): Picture[] =>
        part.type === "image" ? [{ uri: `data:${part.mimeType};base64,${part.data}` }] : [],
      ),
    [message.parts],
  )
  return (
    <>
      <SentPictures pictures={pictures} />
      {message.parts.map((part, index) =>
        part.type === "text" && part.text !== "" ? (
          <Bubble key={index} text={part.text} own={own} />
        ) : null,
      )}
    </>
  )
}

/* ---------- one message ---------- */

type RowProps = {
  message: ChatMessage
  failures: number
  /** Have another go at a reply that failed. Offered on the last message, while nothing is running. */
  onRetry: (() => void) | undefined
  team: Team | undefined
  /** In a sub-agent's chat: the agent that gave it its task, by name. */
  asker: string | undefined
  /** For a message of the reader's: whether the agent has it. Undefined where that is not said. */
  delivery: "sent" | "delivered" | undefined
}

/**
 * Whether a message of one's own has reached the agent, said the way a message app says it: a
 * ring while it is on its way, and a check once the agent has it.
 */
function Delivery({ delivered }: { delivered: boolean }) {
  const theme = useTheme()
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={delivered ? "Delivered" : "Not delivered yet"}
      style={{ marginTop: -2, marginRight: 2 }}
    >
      <Icon name={delivered ? "checkCircle" : "circle"} size={13} color={theme.ink3} />
    </View>
  )
}

/**
 * One message. It is drawn again only when the message itself changes, so an answer being
 * written costs the ones above it nothing.
 */
const MessageRow = memo(function MessageRow({
  message,
  failures,
  onRetry,
  team,
  asker,
  delivery,
}: RowProps) {
  if (message.role === "notice") {
    const part = message.parts[0]
    return <Notice part={part?.type === "notice" ? part : undefined} />
  }
  if (message.role === "user" && message.agent !== undefined) {
    // A message another agent sent, in its conversation with this one.
    return (
      <FromSomeone
        face={<PeerFace agentId={message.agent.id} size={28} />}
        name={message.agent.name}
        at={message.createdAt}
      >
        <SentParts message={message} own={false} />
      </FromSomeone>
    )
  }
  if (message.role === "user" && message.slack !== undefined) {
    // Someone whose address in Slack is an account's here has their face. Anyone else is known
    // only from Slack, and the Slack mark stands where a face would be.
    const person =
      message.author === undefined
        ? undefined
        : (team?.people.get(message.author.id) ?? { ...message.author, image: null })
    return (
      <FromSomeone
        face={person === undefined ? <SlackMark /> : <Face person={person} size={28} />}
        name={message.slack.name}
        at={message.createdAt}
        slack
      >
        <SentParts message={message} own={false} />
      </FromSomeone>
    )
  }
  const other =
    team !== undefined && message.author !== undefined && message.author.id !== team.meId
      ? (team.people.get(message.author.id) ?? { ...message.author, image: null })
      : undefined
  if (message.role === "user" && asker !== undefined) {
    // In a sub-agent's chat this side is its agent's: what it was asked to do. The exception is
    // the reader's answer to something it asked leave for. In a team, anyone may have answered.
    const text = message.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n")
    const answered = /^(Approved|Not allowed): /.test(text)
    const answerer = other === undefined ? "You" : other.name.split(" ")[0]
    return (
      <View style={{ alignItems: "flex-end", paddingLeft: "12%" }}>
        <Bubble
          text={text}
          own={false}
          caption={answered ? `${answerer} answered` : `${asker} asked`}
        />
      </View>
    )
  }
  if (message.role === "user") {
    // In a team, someone else's message is theirs to the eye: their face, their name, and not
    // the color of one's own.
    if (other !== undefined) {
      return (
        <FromSomeone
          face={<Face person={other} size={28} />}
          name={other.name}
          at={message.createdAt}
        >
          <SentParts message={message} own={false} />
        </FromSomeone>
      )
    }
    return (
      <View style={{ alignItems: "flex-end", gap: 6, paddingLeft: "14%" }}>
        {message.spoken ? (
          // Said out loud, on a call, and handed on by the Dood's voice.
          <Text variant="caption" tone="ink3">
            Said on a call
          </Text>
        ) : null}
        <SentParts message={message} own />
        {delivery === undefined ? null : <Delivery delivered={delivery === "delivered"} />}
      </View>
    )
  }
  const whole = textOf(message)
  return (
    <View style={{ gap: 12 }}>
      {shownParts(message.parts).map((part, index) => (
        <AssistantPart
          key={part.type === "tool" ? part.toolCallId : index}
          part={part}
          whole={whole}
        />
      ))}
      {message.status === "error" ? (
        <ReplyError error={message.error} failures={failures} onRetry={onRetry} />
      ) : null}
      {message.status === "aborted" ? <Marker>Stopped</Marker> : null}
    </View>
  )
})

/* ---------- the list ---------- */

/**
 * The page's own color under the bar, thinning to nothing below it. The bar is glass buttons
 * with no background of their own, and without this the words scroll up through them.
 */
function TopFade() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  if (Platform.OS !== "ios") return null
  const clear = theme.dark ? "rgba(11, 13, 13, 0)" : "rgba(255, 255, 255, 0)"
  return (
    <LinearGradient
      pointerEvents="none"
      colors={[theme.page, theme.page, clear]}
      locations={[0, 0.78, 1]}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: insets.top + 72,
        zIndex: 1,
      }}
    />
  )
}

/**
 * The scroll view the messages are in. On a phone it is the one that knows the keyboard, and
 * lifts the last message with it when the reader is at the end; a browser has no keyboard to know.
 */
const List = (Platform.OS === "web"
  ? ScrollView
  : KeyboardChatScrollView) as unknown as ComponentType<
  ScrollViewProps & { ref?: Ref<ScrollView>; keyboardLiftBehavior?: "whenAtEnd" }
>
const KEYBOARD = Platform.OS === "web" ? {} : ({ keyboardLiftBehavior: "whenAtEnd" } as const)

/**
 * The message list. It rests at the newest message and follows it as it grows, the way a chat
 * does, unless the reader has scrolled up to look at something.
 */
export function Transcript({
  agentId,
  chatId,
  state,
  earlier,
  agent,
  accent,
  empty,
  bottomInset,
  onRetry,
  undelivered,
}: TranscriptProps): ReactNode {
  const theme = useTheme()
  const scope = useMemo(
    (): ChatScope => ({ agentId, chatId, workspaceId: agent?.workspaceId, accent }),
    [agentId, chatId, agent?.workspaceId, accent],
  )

  // Who is who, where the agent is a team's.
  const meId = useMe().data?.user.id
  const workspace = useWorkspaces().data?.workspaces.find(
    (entry) => entry.id === agent?.workspaceId,
  )
  const team = useMemo(
    (): Team | undefined =>
      workspace?.kind === "team" && meId !== undefined
        ? { meId, people: new Map(workspace.members.map((member) => [member.id, member])) }
        : undefined,
    [workspace, meId],
  )
  // A sub-agent's chat is between it and its agent, and says so.
  const chat = useAgentState(agentId).data?.chats.find((entry) => entry.id === chatId)
  const asker = chat?.kind === "subagent" ? (agent?.name ?? "Your Dood") : undefined

  // Everything on the page: what was loaded from before, then the chat as it is now.
  const all = useMemo(
    () => ({
      messages:
        earlier.messages.length === 0 ? state.messages : [...earlier.messages, ...state.messages],
      busy: state.busy,
    }),
    [earlier.messages, state.messages, state.busy],
  )
  // The steps an agent takes on a screen are shown as one thing, where the first of them is.
  const uses = useMemo((): ChatUses => {
    const found = chatUses(all)
    return { all: found, byId: new Map(found.map((use) => [use.id, use])), busy: all.busy }
  }, [all])
  const shown = useMemo(() => shownMessages(all, uses.byId), [all, uses])
  const untouched = earlier.messages.length === 0 && isUntouched(state.messages)
  // What the agent is doing, when its answer is not already being written on screen. While a
  // step on a screen is under way, the window of the screen says what it is.
  const activity = chatActivity(state)
  const stepping = uses.all.some((use) => {
    const status = use.steps.at(-1)?.status
    return status === "pending" || status === "running"
  })

  // `onRetry` is made anew by whoever draws this; the rows are given one that never changes.
  const retry = useRef(onRetry)
  retry.current = onRetry
  const tryAgain = useCallback(() => retry.current?.(), [])

  /* Staying at the end, and only while the reader is there. */
  const list = useRef<ScrollView>(null)
  const atEnd = useRef(true)
  // Until when a scroll of our own making is under way: what it passes on its way is not the
  // reader leaving the end.
  const pinned = useRef(0)
  // Whether the reader's finger is moving the page, or it is still coasting from their flick.
  const handled = useRef(false)
  const coasting = useRef(false)
  const [away, setAway] = useState(false)
  // How tall the view is and how much of its foot is covered, as the last scroll said.
  const seen = useRef({ viewport: 0, inset: 0 })
  const toEnd = useCallback((animated: boolean) => {
    atEnd.current = true
    pinned.current = animated ? Date.now() + 700 : 0
    setAway(false)
    list.current?.scrollToEnd({ animated })
  }, [])
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize, contentInset } = event.nativeEvent
    seen.current = { viewport: layoutMeasurement.height, inset: contentInset?.bottom ?? 0 }
    const there = isAtEnd({
      offset: contentOffset.y,
      viewport: layoutMeasurement.height,
      content: contentSize.height,
      inset: contentInset?.bottom ?? 0,
    })
    if (!there && Date.now() < pinned.current) return
    // Only the reader's own hand takes them away from the end. The page also moves by itself,
    // as it is first laid out under the bar and as the box at its foot is measured, and none
    // of that is somebody scrolling up to read.
    if (!there && !handled.current) return
    atEnd.current = there
    setAway(!there)
  }, [])
  const letGo = useCallback(() => {
    // A flick carries on after the finger lifts; a slow drag does not.
    setTimeout(() => {
      if (!coasting.current) handled.current = false
    }, 120)
  }, [])
  // What is written grows the page under a reader who is at the end; one who has scrolled up
  // is left where they are.
  const onGrown = useCallback((_width: number, height: number) => {
    if (!atEnd.current) return
    // To the very end, counting what the keyboard and the box over the foot take of the view:
    // the scroll view's own "to the end" stops short of those.
    const { viewport, inset } = seen.current
    if (viewport === 0) return list.current?.scrollToEnd({ animated: false })
    list.current?.scrollTo({ y: Math.max(0, height - viewport + inset), animated: false })
  }, [])
  // The end comes into view when the reader sends something, wherever they had scrolled to.
  // It does not come again when the agent takes the message up: by then the reader may be
  // looking at something else.
  const onTheirWay = undelivered?.size ?? 0
  const wereOnTheirWay = useRef(onTheirWay)
  useEffect(() => {
    const more = onTheirWay > wereOnTheirWay.current
    wereOnTheirWay.current = onTheirWay
    if (more) toEnd(true)
  }, [onTheirWay, toEnd])
  // The newest message a person wrote here that the agent has.
  const lastDelivered =
    undelivered === undefined || asker !== undefined
      ? undefined
      : state.messages.findLast(
          (message) =>
            message.role === "user" &&
            message.agent === undefined &&
            message.slack === undefined &&
            !undelivered.has(message.id),
        )?.id
  // The box at the foot is measured after the page is first laid out, and grows with what is
  // typed in it: a reader at the end stays there.
  useEffect(() => {
    if (!atEnd.current) return
    const frame = requestAnimationFrame(() => list.current?.scrollToEnd({ animated: false }))
    return () => cancelAnimationFrame(frame)
  }, [bottomInset])
  // Another chat starts at its end.
  useEffect(() => {
    atEnd.current = true
    setAway(false)
  }, [agentId, chatId])

  const greeting = untouched && !state.busy ? empty : null
  return (
    <ChatScopeContext.Provider value={scope}>
      <UsesContext.Provider value={uses}>
        <View style={{ flex: 1 }}>
          <TopFade />
          <List
            ref={list}
            {...KEYBOARD}
            style={{ flex: 1, backgroundColor: theme.page }}
            contentInsetAdjustmentBehavior="automatic"
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            scrollEventThrottle={32}
            onScroll={onScroll}
            onScrollBeginDrag={() => {
              pinned.current = 0
              handled.current = true
            }}
            onScrollEndDrag={letGo}
            onMomentumScrollBegin={() => {
              coasting.current = true
            }}
            onMomentumScrollEnd={() => {
              coasting.current = false
              handled.current = false
            }}
            onContentSizeChange={onGrown}
            // What is loaded from before goes in above; the reader stays on what they were reading.
            maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
            contentContainerStyle={{
              flexGrow: 1,
              // A short chat sits at the bottom, next to the box the next message is typed in.
              justifyContent: greeting == null ? "flex-end" : "center",
              paddingHorizontal: 16,
              paddingTop: 12,
              paddingBottom: bottomInset + 12,
              gap: 20,
            }}
          >
            {/* Always the first thing in the list, so that what follows it keeps its place. */}
            <View style={{ alignItems: "center" }}>
              {!earlier.hasEarlier ? null : earlier.loading ? (
                <ActivityIndicator accessibilityLabel="Loading…" style={{ height: 34 }} />
              ) : (
                <Button
                  title="Show earlier messages"
                  kind="plain"
                  size="small"
                  color={accent.a}
                  onPress={() => void earlier.load()}
                />
              )}
            </View>
            {greeting}
            {shown.map(({ message, failures }, index) => (
              <MessageRow
                key={message.id}
                message={message}
                failures={failures}
                onRetry={
                  index === shown.length - 1 && !state.busy && onRetry !== undefined
                    ? tryAgain
                    : undefined
                }
                team={team}
                asker={asker}
                delivery={
                  undelivered?.has(message.id) === true
                    ? "sent"
                    : message.id === lastDelivered
                      ? "delivered"
                      : undefined
                }
              />
            ))}
            {activity === null || stepping ? null : <StatusLine activity={activity} />}
          </List>
          {away ? (
            <View
              pointerEvents="box-none"
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: bottomInset + 12,
                alignItems: "center",
              }}
            >
              <GlassButton
                icon="arrowDown"
                label="Scroll to end"
                size={38}
                onPress={() => {
                  haptic.light()
                  toEnd(true)
                }}
              />
            </View>
          ) : null}
        </View>
      </UsesContext.Provider>
    </ChatScopeContext.Provider>
  )
}
