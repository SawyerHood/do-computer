import { continuesMain, type MessageImage, randomId } from "@do-computer/protocol"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { type Href, Stack, useFocusEffect, useRouter } from "expo-router"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  useWindowDimensions,
  View,
} from "react-native"
import { LinearGradient } from "expo-linear-gradient"
import { KeyboardStickyView } from "react-native-keyboard-controller"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { messageOrigin } from "@/lib/origin"
import { sayWhere, useHere } from "@/lib/presence"
import {
  keys,
  useAgentLive,
  useAgentState,
  useAgentSummary,
  useMarkSeen,
  useMe,
  useWorkspaces,
} from "@/lib/queries"
import { radius, useAgentAccent, useTheme } from "@/lib/theme"
import { useEarlierMessages, useLiveChat } from "@/lib/use-live-chat"
import { useMood } from "@/lib/use-mood"
import { useSession } from "@/lib/use-session"
import {
  confirm,
  errorText,
  Glass,
  haptic,
  type HeaderItem,
  HeaderItems,
  type MenuItem,
  tell,
  Text,
} from "@/ui"
import { Avatar } from "@/ui/avatar"
import { Asks } from "./asks"
import {
  GIVE_UP_MS,
  isAtWork,
  isSideChat,
  mainChatOf,
  type Sending,
  sideChatsOf,
  slackPlace,
  startsMidway,
  subagentSeed,
  subagentsOf,
  subagentWords,
  threadWords,
  whoIs,
  withSending,
} from "./chats"
import { Composer } from "./composer"
import { ReadOnlyFoot, RenameBar, TypingLine } from "./footers"
import { ChatTitle } from "./header"
import { Hello, SideChatHello, useMarkHatched } from "./hello"
import { Transcript } from "./transcript"

/** The chat screen that last told the team where this phone is. */
let placed: object | undefined

/** How long after the last key the team is still told that the reader is writing. */
const TYPING_MS = 4_000

/**
 * One chat of an agent: its bar, the transcript kept live by its event stream, and floating
 * over the foot what the agent asks and the message box. A chat the reader does not write in
 * (a sub-agent's, another agent's, a Slack thread) says so where the box would be.
 */
export function ChatScreen({
  agentId,
  chatId,
  main: opensAsMain = false,
}: {
  agentId: string
  chatId: string
  /** It was opened as the agent's main chat, which is known before the list of its chats is in. */
  main?: boolean
}) {
  const theme = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const window = useWindowDimensions()
  const { client } = useSession()
  const queryClient = useQueryClient()
  const api = useMemo(() => client.agent(agentId), [client, agentId])

  useAgentLive(agentId)
  useMarkSeen(agentId)
  const agent = useAgentSummary(agentId)
  const { data: agentState } = useAgentState(agentId)
  const accent = useAgentAccent(agent)
  const name = agent?.name ?? "New Dood"

  const live = useLiveChat(agentId, chatId)
  const earlier = useEarlierMessages(agentId, chatId, live.state)

  // What kind of chat this is.
  const chats = agentState?.chats
  const chat = chats?.find((entry) => entry.id === chatId)
  const main = mainChatOf(chats)
  const isMain = opensAsMain || chat?.main === true
  const aside = main !== undefined && isSideChat(chat) ? chat : undefined
  const sub = chat?.kind === "subagent" ? chat : undefined
  const parent = chats?.find((entry) => entry.id === sub?.parentId)
  const thread = chat?.kind === "agent" && chat.peer !== undefined ? chat : undefined
  const peerName = thread?.peer?.name ?? "the other Dood"
  const slack = chat?.kind === "slack" ? chat : undefined
  // Whether this chat is the reader's to write in.
  const own = sub === undefined && thread === undefined && slack === undefined
  const atWork = useMemo(
    () => subagentsOf(chats, chatId).filter((entry) => isAtWork(entry.status)),
    [chats, chatId],
  )
  const sideCount = sideChatsOf(chats).length
  /** Where a chat of this agent is: its main chat is the agent's own address. */
  const hrefOf = (id: string): Href => (id === main?.id ? `/a/${agentId}` : `/a/${agentId}/c/${id}`)

  /* ---------- sending ---------- */

  const [sending, setSending] = useState<readonly Sending[]>([])
  const [now, setNow] = useState(() => Date.now())
  const shown = useMemo(() => withSending(live.state, sending, now), [live.state, sending, now])
  useEffect(() => {
    if (shown.left !== sending) setSending(shown.left)
  }, [shown.left, sending])
  // One the server took and the chat never shows is looked at again once it is due to be given up on.
  const accepted = sending.find((send) => send.acceptedAt !== undefined)?.acceptedAt
  useEffect(() => {
    if (accepted === undefined) return
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(accepted + GIVE_UP_MS + 100 - Date.now(), 0),
    )
    return () => clearTimeout(timer)
  }, [accepted])
  const state = shown.state

  const [sendError, setSendError] = useState<string>()
  const latest = useRef(live.state)
  latest.current = live.state
  const send = useCallback(
    async (text: string, images: MessageImage[] = []) => {
      setSendError(undefined)
      const id = randomId()
      const known = new Set(
        [...latest.current.messages, ...latest.current.queued].map((entry) => entry.id),
      )
      setSending((current) => [...current, { id, text, at: Date.now(), known }])
      try {
        await api.send(chatId, {
          text,
          ...(images.length > 0 ? { images } : {}),
          requestId: id,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          from: messageOrigin(),
        })
        setNow(Date.now())
        setSending((current) =>
          current.map((entry) => (entry.id === id ? { ...entry, acceptedAt: Date.now() } : entry)),
        )
        return true
      } catch (error) {
        // It did not go, so it is taken back out of the chat, and left in the box.
        setSending((current) => current.filter((entry) => entry.id !== id))
        setSendError(
          `That was not sent: ${error instanceof Error ? error.message : "something went wrong"}. Try again.`,
        )
        return false
      }
    },
    [api, chatId],
  )
  // There is no running a reply again as such: asking again is what works.
  const retry = useCallback(() => void send("Try again"), [send])
  const stop = useCallback(() => void api.abort(chatId).catch(() => {}), [api, chatId])

  /* ---------- the team: where this phone is, and who is writing ---------- */

  const me = useMe().data?.user.id
  const workspace = useWorkspaces().data?.workspaces.find((each) => each.id === agent?.workspaceId)
  const team = workspace?.kind === "team" ? workspace : undefined
  const teamId = team?.id
  const here = useHere()[teamId ?? ""] ?? []
  const typing = whoIs(
    here,
    (place) =>
      place.agentId === agentId && place.chatId === chatId && place.typing && place.userId !== me,
  ).flatMap((id) => team?.members.find((member) => member.id === id) ?? [])
  // Said while this chat is the screen in front. Leaving for another chat, that one says where
  // the phone is; which of the two speaks last is not known, so only the latest may say "nowhere".
  useFocusEffect(
    useCallback(() => {
      const mine = {}
      placed = mine
      sayWhere(teamId, { agentId, chatId, typing: false })
      return () => {
        if (placed !== mine) return
        placed = undefined
        sayWhere(teamId, { agentId: null, chatId: null })
      }
    }, [teamId, agentId, chatId]),
  )
  const typingTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const wasTyping = useRef(false)
  const noteTyping = useCallback(
    (writing: boolean) => {
      clearTimeout(typingTimer.current)
      // Said when it changes, and not at every key. It lapses when they pause.
      if (writing !== wasTyping.current) sayWhere(teamId, { agentId, chatId, typing: writing })
      wasTyping.current = writing
      if (!writing) return
      typingTimer.current = setTimeout(() => {
        wasTyping.current = false
        sayWhere(teamId, { agentId, chatId, typing: false })
      }, TYPING_MS)
    },
    [teamId, agentId, chatId],
  )
  useEffect(() => () => clearTimeout(typingTimer.current), [])

  /* ---------- the creature, and what the model can take ---------- */

  const [typed, setTyped] = useState(0)
  const mood = useMood(agentId, state, typed)
  const { data: models } = useQuery({
    queryKey: keys.models(agent?.workspaceId),
    queryFn: () => client.models(agent?.workspaceId),
    staleTime: Number.POSITIVE_INFINITY,
    enabled: agent !== undefined,
  })
  const sees = models?.find((model) => model.id === agent?.model)?.images === true

  // Someone who starts talking before the egg has opened has met their agent all the same.
  const markHatched = useMarkHatched(agentId)
  const talked = live.loaded && live.state.messages.length > 0
  const unhatched = agent !== undefined && !agent.hatched
  useEffect(() => {
    if (talked && unhatched) void markHatched()
  }, [talked, unhatched, markHatched])

  /* ---------- the bar ---------- */

  const welcoming = live.loaded && state.messages.length === 0 && !state.busy
  // The stream was turned away, which it will be again: there is no such chat to show.
  const refused = live.status === "closed" && !live.loaded
  const reconnecting = live.status === "reconnecting"
  const status = reconnecting
    ? "reconnecting…"
    : mood.state === "waiting"
      ? "Waiting for you"
      : state.busy
        ? "Working"
        : undefined

  // What is in the bar is made again only when what it shows changes: the bar is told of every
  // new one. The chats it reads are named piece by piece, as the objects are new at every fetch.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these are what the title shows
  const title = useMemo(() => {
    if (sub !== undefined) {
      return (
        <ChatTitle
          face={
            <Avatar
              avatar={null}
              seed={subagentSeed(agentId, chatId)}
              size={32}
              still={!isAtWork(sub.status)}
              mood={
                sub.status === "working"
                  ? { state: "thinking" }
                  : sub.status === "waiting"
                    ? { state: "waiting" }
                    : undefined
              }
            />
          }
          title={sub.title}
          subtitle={
            reconnecting ? "reconnecting…" : `${subagentWords(sub.status)} · sub-agent of ${name}`
          }
          strong={sub.status === "waiting"}
        />
      )
    }
    if (thread !== undefined) {
      return (
        <ChatTitle
          title={thread.title}
          subtitle={`${peerName} · ${threadWords(thread.status)}`}
          strong={thread.status === "waiting"}
        />
      )
    }
    if (slack !== undefined) {
      return (
        <ChatTitle
          title={slack.title}
          subtitle={`${slackPlace(slack)} · ${threadWords(slack.status)}`}
          strong={slack.status === "waiting"}
        />
      )
    }
    const face = (
      <Avatar
        avatar={agent?.avatar}
        seed={agentId}
        outfit={agent?.outfit}
        size={34}
        mood={{ state: mood.state, variant: mood.variant }}
        hatched={agent?.hatched ?? true}
        still={welcoming}
      />
    )
    const toPage = () => router.push(`/a/${agentId}/info`)
    if (aside !== undefined) {
      return (
        <ChatTitle
          face={face}
          title={aside.title}
          subtitle={reconnecting ? "reconnecting…" : `Side chat with ${name}`}
          label={`${name}'s page`}
          onPress={toPage}
        />
      )
    }
    if (!isMain) {
      return (
        <ChatTitle
          face={face}
          title={chat?.title ?? name}
          subtitle={status ?? (chat === undefined ? undefined : name)}
          label={`${name}'s page`}
          onPress={toPage}
        />
      )
    }
    return (
      <ChatTitle
        face={face}
        title={name}
        subtitle={status}
        strong={status === "Waiting for you"}
        label={`${name}'s page`}
        onPress={toPage}
      />
    )
  }, [
    agentId,
    chatId,
    name,
    status,
    reconnecting,
    welcoming,
    peerName,
    isMain,
    router,
    agent?.avatar,
    agent?.outfit,
    agent?.hatched,
    mood.state,
    mood.variant,
    chat?.kind,
    chat?.title,
    chat?.status,
    aside?.id,
    slack?.slack?.channel,
    slack?.slack?.direct,
  ])
  const chatTitle = chat?.title
  const options = useMemo(
    () => ({
      title: isMain ? name : (chatTitle ?? name),
      headerTitle: () => title,
      headerTitleAlign: "center" as const,
    }),
    [title, name, chatTitle, isMain],
  )

  const canStartFresh =
    own && live.state.messages.length > 0 && !startsMidway(live.state.messages.at(-1))
  const startFresh = async () => {
    const sure = await confirm({
      title: "Start fresh?",
      message: `${name} stops carrying this chat's earlier messages. Its memory is kept, and you can still read them.`,
      action: "Start fresh",
      destructive: false,
    })
    if (!sure) return
    try {
      await api.resetChat(chatId)
      haptic.done()
    } catch (error) {
      tell("That did not work", errorText(error))
    }
  }

  const [renaming, setRenaming] = useState(false)
  const rename = async (next: string) => {
    setRenaming(false)
    if (next.trim() === "" || next.trim() === chat?.title) return
    try {
      await api.updateChat(chatId, { title: next.trim() })
      await queryClient.invalidateQueries({ queryKey: keys.agent(agentId) })
    } catch (error) {
      tell("The chat was not renamed", errorText(error))
    }
  }
  const askName = () => {
    if (Platform.OS !== "ios") return setRenaming(true)
    Alert.prompt(
      "Rename",
      undefined,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Save", onPress: (value?: string) => void rename(value ?? "") },
      ],
      "plain-text",
      chat?.title,
    )
  }
  const archive = async () => {
    const sure = await confirm({
      title: "Archive this side chat?",
      message: "It is put away, out of the list of side chats.",
      action: "Archive",
    })
    if (!sure) return
    try {
      await api.updateChat(chatId, { archived: true })
      await queryClient.invalidateQueries({ queryKey: keys.agent(agentId) })
      haptic.done()
      if (router.canGoBack()) router.back()
      else router.replace(`/a/${agentId}`)
    } catch (error) {
      tell("The chat was not archived", errorText(error))
    }
  }

  const toMain: MenuItem = {
    title: "Main chat",
    icon: "chats",
    onPress: () => router.dismissTo(`/a/${agentId}`),
  }
  const fresh: MenuItem = {
    title: "Start fresh",
    icon: "refresh",
    disabled: !canStartFresh || live.state.busy,
    onPress: () => void startFresh(),
  }
  const stopItem: HeaderItem = {
    text: "Stop",
    label: "Stop",
    hidden: !isAtWork(chat?.status),
    onPress: () => {
      haptic.medium()
      stop()
      void queryClient.invalidateQueries({ queryKey: keys.agent(agentId) })
    },
  }
  const slackUrl = slack?.slack?.url
  const items: HeaderItem[] =
    sub !== undefined || thread !== undefined
      ? [stopItem]
      : slack !== undefined
        ? [
            stopItem,
            {
              icon: "more",
              label: "More",
              menu: [
                ...(slackUrl
                  ? [
                      {
                        title: "Open in Slack",
                        icon: "arrowUpRight",
                        onPress: () => void Linking.openURL(slackUrl),
                      } satisfies MenuItem,
                    ]
                  : []),
                toMain,
              ],
            },
          ]
        : !isMain
          ? [
              {
                icon: "more",
                label: "More",
                menu: [
                  ...(aside === undefined
                    ? []
                    : ([
                        { title: "Rename", icon: "pencil", onPress: askName },
                        { title: "Archive", icon: "archive", onPress: () => void archive() },
                      ] satisfies MenuItem[])),
                  toMain,
                  fresh,
                ],
              },
            ]
          : [
              {
                icon: "chats",
                label:
                  sideCount === 0 ? `${name}'s side chats` : `${name}'s side chats, ${sideCount}`,
                onPress: () => router.push(`/a/${agentId}/side-chats`),
              },
              {
                icon: "more",
                label: "More",
                menu: [
                  {
                    title: "Library",
                    icon: "folder",
                    onPress: () => router.push(`/a/${agentId}/library`),
                  },
                  {
                    title: "Automations",
                    icon: "clock",
                    onPress: () => router.push(`/a/${agentId}/automations`),
                  },
                  fresh,
                ],
              },
            ]

  /* ---------- the page ---------- */

  const [foot, setFoot] = useState(0)
  const empty = refused ? (
    <Text
      tone="ink2"
      accessibilityRole="alert"
      style={{ textAlign: "center", paddingHorizontal: 32 }}
    >
      This chat could not be opened. It may have been deleted.
    </Text>
  ) : !live.loaded ? (
    // What it holds is on its way. Not the hello of an empty chat.
    <ActivityIndicator color={theme.ink3} />
  ) : !own ? null : aside !== undefined ? (
    <SideChatHello name={agent?.name ?? "Your Dood"} carried={continuesMain(state.messages)} />
  ) : agent === undefined ? null : (
    <Hello agent={agent} mood={mood} accent={accent} onSay={(text) => void send(text)} />
  )

  const smallFace = (
    <Avatar avatar={agent?.avatar} seed={agentId} outfit={agent?.outfit} size={28} still />
  )

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Stack.Screen options={options} />
      <HeaderItems items={items} />
      <Transcript
        agentId={agentId}
        chatId={chatId}
        state={state}
        earlier={earlier}
        agent={agent}
        accent={accent}
        empty={empty}
        bottomInset={foot}
        onRetry={own ? retry : undefined}
      />
      {atWork.length === 0 ? null : (
        <View
          pointerEvents="box-none"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: (Platform.OS === "ios" ? insets.top + 44 : 0) + 8,
            alignItems: "center",
          }}
        >
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(`/a/${agentId}/subagents?chatId=${chatId}`)}
          >
            <Glass
              interactive
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                borderRadius: radius.pill,
                paddingHorizontal: 14,
                height: 36,
              }}
            >
              <ActivityIndicator size="small" color={theme.ink2} />
              <Text variant="footnote" weight="600">
                {atWork.length} {atWork.length === 1 ? "sub-agent" : "sub-agents"} at work
              </Text>
            </Glass>
          </Pressable>
        </View>
      )}
      <KeyboardStickyView
        offset={{ closed: 0, opened: insets.bottom }}
        style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}
        pointerEvents="box-none"
      >
        <View
          pointerEvents="box-none"
          onLayout={(event) => setFoot(Math.ceil(event.nativeEvent.layout.height))}
          style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: insets.bottom + 8, gap: 8 }}
        >
          {/* The page's color behind the box, thinning upward, so that what is said does not
              show through the glass as it passes under. */}
          <LinearGradient
            pointerEvents="none"
            colors={[
              theme.dark ? "rgba(11, 13, 13, 0)" : "rgba(255, 255, 255, 0)",
              theme.page,
              theme.page,
            ]}
            locations={[0, 0.45, 1]}
            style={{ position: "absolute", left: 0, right: 0, top: -22, bottom: 0 }}
          />
          {refused ? null : (
            <Asks
              agentId={agentId}
              agentName={agent?.name ?? "Your Dood"}
              chatId={chatId}
              accent={accent}
              team={team?.name}
              maxHeight={Math.round(window.height * 0.5)}
            />
          )}
          {refused || (chat === undefined && !live.loaded) ? null : sub !== undefined ? (
            <ReadOnlyFoot
              face={smallFace}
              words={`Only ${name} talks to its sub-agents. To change what this one is doing, tell ${name}.`}
              action={{
                title: `Back to ${parent?.title ?? name}`,
                onPress: () => router.dismissTo(hrefOf(sub.parentId ?? chatId)),
              }}
            />
          ) : thread?.peer !== undefined ? (
            <ReadOnlyFoot
              face={smallFace}
              words={`Only ${name} and ${peerName} write here. To change what ${name} is doing in it, tell ${peerName}.`}
              action={{
                title: `Back to ${peerName}`,
                onPress: () => router.push(`/a/${thread.peer?.agentId}/c/${thread.peer?.chatId}`),
              }}
            />
          ) : slack !== undefined ? (
            <ReadOnlyFoot
              words="This conversation is in Slack. Reply there to carry it on."
              action={
                slackUrl
                  ? { title: "Open in Slack", onPress: () => void Linking.openURL(slackUrl) }
                  : undefined
              }
            />
          ) : (
            <>
              {renaming && chat !== undefined ? (
                <RenameBar
                  title={chat.title}
                  onSave={(next) => void rename(next)}
                  onCancel={() => setRenaming(false)}
                />
              ) : null}
              <TypingLine people={typing} />
              <Composer
                key={chatId}
                agentId={agentId}
                chatId={chatId}
                accent={accent}
                placeholder={
                  aside !== undefined
                    ? `Message ${name} in this side chat`
                    : agent?.name
                      ? `Message ${agent.name}`
                      : "Say hello"
                }
                busy={live.state.busy}
                queued={state.queued}
                waits={agentState?.whenBusy === "queue"}
                onSend={send}
                error={sendError}
                onStop={stop}
                sees={sees}
                agentName={name}
                onTyping={team === undefined ? undefined : noteTyping}
                onKey={() => setTyped((count) => count + 1)}
              />
            </>
          )}
        </View>
      </KeyboardStickyView>
    </View>
  )
}
