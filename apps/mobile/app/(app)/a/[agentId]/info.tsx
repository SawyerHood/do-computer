import { type ChatSummary, chatUses, sentFiles, spanOf } from "@do-computer/protocol"
import { useQuery } from "@tanstack/react-query"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import { useMemo, useState } from "react"
import { ActivityIndicator, Pressable, View } from "react-native"
import {
  firstLine,
  modelName,
  startsMidway,
  useAgentAccent,
  useAgentPage,
  useJobs,
  useModels,
  useMoveAgent,
  useNow,
} from "@/agent/agent"
import { dollars } from "@/agent/usage"
import { isAtWork, mainChatOf, sideChatsOf, subagentsOf } from "@/chat/chats"
import { CreatureHero } from "@/creature/hero"
import { useHere } from "@/lib/presence"
import { keys, useMe } from "@/lib/queries"
import type { Accent } from "@/lib/theme"
import { useLiveChat } from "@/lib/use-live-chat"
import { PinnedSection } from "@/pins/shelf"
import { useSession } from "@/lib/use-session"
import {
  confirm,
  Empty,
  errorText,
  Face,
  haptic,
  HeaderItems,
  Icon,
  type IconName,
  type MenuItem,
  Pill,
  Row,
  Screen,
  Section,
  tell,
  Text,
} from "@/ui"

/** How far the page is scrolled before the bar takes the agent's name: past the name itself. */
const NAME_GONE = 250

/**
 * The agent's own page, as a contact's is in Messages: its creature large and alive, the ways
 * into its library and automations, what it is doing right now, what belongs to
 * its main chat, and every section of its settings as rows that push in.
 */
export default function AgentInfo() {
  const { agentId } = useLocalSearchParams<{ agentId: string }>()
  const router = useRouter()
  const { client } = useSession()
  const { state, query, agent, workspace, name } = useAgentPage(agentId)
  const accent = useAgentAccent(agent)
  const move = useMoveAgent(agentId, name)
  const [scrolled, setScrolled] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const base = `/a/${agentId}`

  const models = useModels(workspace?.id)
  const skills = useQuery({
    queryKey: keys.skills(agentId),
    queryFn: () => client.agent(agentId).skills(),
  })
  const connectors = useQuery({
    queryKey: keys.connectors(agentId),
    queryFn: () => client.agent(agentId).connectors(),
  })
  const usage = useQuery({
    queryKey: keys.usage(agentId),
    queryFn: () => client.agent(agentId).usage(),
  })

  const main = mainChatOf(state?.chats)
  const oldSideChats = sideChatsOf(state?.chats).length
  // A team's agent is everyone's, so deleting and moving it are for the people who run the team.
  const mayDelete = workspace?.role !== "member"
  const startDelete = () => router.push(`${base}/profile?delete=1`)

  const menu: MenuItem[] = [
    ...(move.may && move.elsewhere.length > 0
      ? [
          {
            title: "Move to…",
            icon: "move" as const,
            children: move.elsewhere.map((to) => ({
              title: to.name,
              onPress: () => void move.moveTo(to),
            })),
          },
        ]
      : []),
    ...(mayDelete
      ? [
          {
            title: `Delete ${name}`,
            icon: "trash" as const,
            destructive: true,
            onPress: startDelete,
          },
        ]
      : []),
  ]

  const refresh = async () => {
    setRefreshing(true)
    await Promise.all([query.refetch(), skills.refetch(), connectors.refetch(), usage.refetch()])
    setRefreshing(false)
  }

  const connected = connectors.data ?? []
  const connectorNames =
    connected.length === 0
      ? undefined
      : connected.length <= 2
        ? connected.map((entry) => entry.name).join(", ")
        : `${connected
            .slice(0, 2)
            .map((entry) => entry.name)
            .join(", ")} +${connected.length - 2}`

  return (
    <Screen
      onRefresh={refresh}
      refreshing={refreshing}
      scrollEventThrottle={32}
      onScroll={(event) => {
        const past = event.nativeEvent.contentOffset.y > NAME_GONE
        if (past !== scrolled) setScrolled(past)
      }}
    >
      <Stack.Screen options={{ title: scrolled ? name : "", headerLargeTitle: false }} />
      {menu.length === 0 ? null : (
        <HeaderItems items={[{ icon: "more", label: `More about ${name}`, menu }]} />
      )}

      {agent === undefined ? (
        query.error ? (
          <Empty title="This Dood could not be loaded">{errorText(query.error)}</Empty>
        ) : (
          <ActivityIndicator style={{ marginTop: 80 }} />
        )
      ) : (
        <>
          <View style={{ alignItems: "center", paddingHorizontal: 24, paddingBottom: 18, gap: 2 }}>
            <CreatureHero agentId={agentId} size={196} />
            <Text variant="title1" accessibilityRole="header" style={{ marginTop: 8 }}>
              {name}
            </Text>
            <Text variant="subhead" tone="ink2" style={{ textAlign: "center" }}>
              {[agent.tagline, workspace?.kind === "team" ? workspace.name : "Personal"]
                .filter((part) => part !== null && part !== undefined && part !== "")
                .join(" · ")}
            </Text>
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginHorizontal: 16, marginBottom: 22 }}>
            <Quick
              icon="folder"
              title="Library"
              accent={accent}
              onPress={() => router.push(`${base}/library`)}
            />
            <Quick
              icon="clock"
              title="Automations"
              accent={accent}
              onPress={() => router.push(`${base}/automations`)}
            />
          </View>

          {/* Under the face, as the web has them: what is worth a glance, before the rest. */}
          <PinnedSection agentId={agentId} name={name} />

          {main === undefined ? null : (
            <MainChat agentId={agentId} name={name} chat={main} chats={state?.chats ?? []} />
          )}

          {/* Side chats from before a Dood was talked to in its main chat alone, kept to read. */}
          {oldSideChats === 0 ? null : (
            <Section>
              <Row
                icon={["archive", "#6b7780"]}
                title="Old side chats"
                value={String(oldSideChats)}
                go
                onPress={() => router.push(`${base}/old-side-chats`)}
              />
            </Section>
          )}

          <Section title={name}>
            <Row
              icon={["person", "#b87a12"]}
              title="Profile"
              subtitle="Name, look and personality"
              go
              onPress={() => router.push(`${base}/profile`)}
            />
            <Row
              icon={["brain", "#d0577b"]}
              title="Memory"
              go
              onPress={() => router.push(`${base}/memory`)}
            />
            <Row
              icon={["cpu", "#2f7fd6"]}
              title="Model and computers"
              value={modelName(models.data, agent.model)}
              go
              onPress={() => router.push(`${base}/model`)}
            />
            <Row
              icon={["bolt", "#e2a400"]}
              title="Skills"
              value={skills.data === undefined ? undefined : String(skills.data.length)}
              go
              onPress={() => router.push(`${base}/skills`)}
            />
            <Row
              icon={["plug", "#2f9e63"]}
              title="Connectors"
              value={connectorNames}
              go
              onPress={() => router.push(`${base}/connectors`)}
            />
            <Row
              icon={["shield", "#127a78"]}
              title="Permissions"
              go
              onPress={() => router.push(`${base}/permissions`)}
            />
            <Row
              icon={["chart", "#6b7780"]}
              title="Usage"
              value={usage.data === undefined ? undefined : dollars(usage.data.total.cost)}
              go
              onPress={() => router.push(`${base}/usage`)}
            />
          </Section>

          {workspace?.kind === "team" ? <HereNow agentId={agentId} workspace={workspace} /> : null}

          {mayDelete ? (
            <Section>
              <Row title={`Delete ${name}`} tone="red" onPress={startDelete} />
            </Section>
          ) : null}
        </>
      )}
    </Screen>
  )
}

/** One of the ways out of the page, under the creature, in the agent's own color. */
function Quick({
  icon,
  title,
  accent,
  onPress,
}: {
  icon: IconName
  title: string
  accent: Accent
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        alignItems: "center",
        gap: 5,
        paddingVertical: 11,
        borderRadius: 16,
        borderCurve: "continuous",
        backgroundColor: accent.soft,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Icon name={icon} size={22} color={accent.ink} weight="medium" />
      <Text variant="caption" weight="600" color={accent.ink} numberOfLines={1}>
        {title}
      </Text>
    </Pressable>
  )
}

/**
 * What the agent is doing right now, and what belongs to its main chat. Both are read from the
 * main chat as it stands, so they are one piece: it listens to that chat for as long as it shows.
 */
function MainChat({
  agentId,
  name,
  chat,
  chats,
}: {
  agentId: string
  name: string
  chat: ChatSummary
  chats: readonly ChatSummary[]
}) {
  const router = useRouter()
  const { client } = useSession()
  const live = useLiveChat(agentId, chat.id)
  const jobs = useJobs(agentId)
  const [starting, setStarting] = useState(false)
  const base = `/a/${agentId}`

  const atWork = useMemo(
    () => subagentsOf(chats, chat.id).filter((entry) => isAtWork(entry.status)),
    [chats, chat.id],
  )
  const running = useMemo(
    () => (jobs.data ?? []).filter((job) => job.status === "running"),
    [jobs.data],
  )
  const now = useNow(1000, running.length > 0)
  const using = useMemo(() => chatUses(live.state).findLast((use) => use.going), [live.state])
  const files = useMemo(() => sentFiles(live.state), [live.state])
  const threads = chats.filter((entry) => entry.kind === "agent" && !entry.archived)
  const slack = chats.filter((entry) => entry.kind === "slack" && !entry.archived)
  const canStartFresh =
    live.loaded && live.state.messages.length > 0 && !startsMidway(live.state.messages.at(-1))

  const startFresh = async () => {
    const went = await confirm({
      title: "Start fresh",
      message:
        "The Dood stops carrying this chat's earlier messages. Its memory is kept, and you can still read them.",
      action: "Start fresh",
    })
    if (!went) return
    setStarting(true)
    try {
      await client.agent(agentId).resetChat(chat.id)
      haptic.done()
    } catch (error) {
      haptic.fail()
      tell("It could not start fresh", errorText(error))
    } finally {
      setStarting(false)
    }
  }

  const first = running[0]
  return (
    <>
      <Section title="At work now">
        {atWork.length === 0 ? null : (
          <Row
            lead={<ActivityIndicator style={{ width: 30 }} />}
            title={`${atWork.length} ${atWork.length === 1 ? "sub-agent" : "sub-agents"}`}
            subtitle={atWork.map((entry) => entry.title).join(", ")}
            go
            onPress={() => router.push(`${base}/subagents?chatId=${encodeURIComponent(chat.id)}`)}
          />
        )}
        {first === undefined ? null : (
          <Row
            icon={["terminal", "#4b5559"]}
            title={`${running.length} ${running.length === 1 ? "command" : "commands"} in the background`}
            subtitle={
              running.length === 1
                ? `${firstLine(first.command)} · ${spanOf(now - first.startedAt)}`
                : running.map((job) => firstLine(job.command)).join(", ")
            }
            go
            onPress={() => router.push(`${base}/jobs`)}
          />
        )}
        {using === undefined ? null : (
          <Row
            icon={["desktop", "#2f7fd6"]}
            title={`Using ${using.computer.name}`}
            subtitle={using.what === "browser" ? "Browser" : "Screen"}
            tail={<Pill label="Live" tone="good" />}
            go
            onPress={() => router.dismissTo(base)}
          />
        )}
      </Section>

      <Section
        title="In the main chat"
        footer={`Start fresh drops the earlier conversation and keeps what ${name} remembers.`}
      >
        {files.length === 0 ? null : (
          <Row
            icon={["clip", "#8a6fd1"]}
            title="Shared here"
            value={`${files.length} ${files.length === 1 ? "file" : "files"}`}
            go
            onPress={() => router.push(`${base}/shared`)}
          />
        )}
        {threads.length === 0 ? null : (
          <Row
            icon={["people", "#c0607a"]}
            title="From other Doods"
            value={String(threads.length)}
            go
            onPress={() => router.push(`${base}/threads`)}
          />
        )}
        {slack.length === 0 ? null : (
          <Row
            icon={["hash", "#611f69"]}
            title="From Slack"
            value={String(slack.length)}
            go
            onPress={() => router.push(`${base}/threads?kind=slack`)}
          />
        )}
        <Row
          title="Start fresh"
          tone="tint"
          busy={starting}
          disabled={!canStartFresh || live.state.busy}
          onPress={() => void startFresh()}
        />
      </Section>
    </>
  )
}

/** In a team: who has this agent open right now. */
function HereNow({
  agentId,
  workspace,
}: {
  agentId: string
  workspace: { id: string; members: readonly { id: string; name: string; image: string | null }[] }
}) {
  const here = useHere()
  const me = useMe()
  const present = workspace.members.filter((member) =>
    (here[workspace.id] ?? []).some(
      (place) => place.userId === member.id && place.agentId === agentId,
    ),
  )
  if (present.length === 0) return null
  return (
    <Section title="Here now">
      {present.map((person) => (
        <Row
          key={person.id}
          lead={<Face person={person} size={30} />}
          title={person.id === me.data?.user.id ? "You" : person.name}
        />
      ))}
    </Section>
  )
}
