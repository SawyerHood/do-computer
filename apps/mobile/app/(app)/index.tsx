import type { AgentSummary, Person, WorkspaceSummary } from "@do-computer/protocol"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Stack, useRouter } from "expo-router"
import { useEffect, useMemo, useState } from "react"
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from "react-native"
import { isUnread, latestFirst, latestWords, when } from "@/lib/latest"
import { useHere } from "@/lib/presence"
import { keys, useAgents, useMe, useSeenHere, useWorkspaces } from "@/lib/queries"
import { storage } from "@/lib/storage"
import { useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import {
  Button,
  Empty,
  errorText,
  Face,
  Faces,
  haptic,
  HeaderItems,
  Icon,
  Menu,
  type MenuItem,
  Screen,
  tell,
  Text,
  Tile,
} from "@/ui"
import { Avatar, type Mood } from "@/ui/avatar"

const FOLDED_KEY = "dc.folded"

/** Which workspaces are folded shut in the list, kept across launches. */
function useFolded() {
  const [folded, setFolded] = useState<readonly string[]>(() => {
    try {
      return JSON.parse(storage.get(FOLDED_KEY) ?? "[]") as string[]
    } catch {
      return []
    }
  })
  const toggle = (workspaceId: string) =>
    setFolded((kept) => {
      const next = kept.includes(workspaceId)
        ? kept.filter((id) => id !== workspaceId)
        : [...kept, workspaceId]
      storage.set(FOLDED_KEY, JSON.stringify(next))
      return next
    })
  return { folded, toggle }
}

/** The time by which rows say "now" or "4m": told again every half minute while the list is up. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

/**
 * The agents, under the workspace each lives in: what the web app keeps in its sidebar. Choosing
 * one opens its main chat. Everything else of an agent is behind a hold on its row, and
 * everything of the person's own is behind their face.
 */
export default function Agents() {
  const theme = useTheme()
  const router = useRouter()
  const { client } = useSession()
  const queryClient = useQueryClient()
  const me = useMe()
  const agents = useAgents()
  const workspaces = useWorkspaces()
  const here = useHere()
  const seenHere = useSeenHere()
  const now = useNow()
  const { folded, toggle } = useFolded()
  const [search, setSearch] = useState("")
  const [refreshing, setRefreshing] = useState(false)
  const [making, setMaking] = useState<string>()
  const requests = useQuery({
    queryKey: keys.computerRequests,
    queryFn: () => client.computerRequests(),
  })

  const meId = me.data?.user.id ?? ""
  const all = workspaces.data?.workspaces ?? []
  const teams = all.some((workspace) => workspace.kind === "team")
  const people = useMemo(() => {
    const map = new Map<string, Person>()
    for (const workspace of all) for (const member of workspace.members) map.set(member.id, member)
    return map
  }, [all])

  const wanted = search.trim().toLowerCase()
  const listed = latestFirst(agents.data ?? []).filter(
    (agent) =>
      wanted === "" ||
      `${agent.name ?? ""} ${agent.tagline ?? ""} ${agent.latest?.text ?? ""}`
        .toLowerCase()
        .includes(wanted),
  )

  const newAgent = async (workspace?: WorkspaceSummary) => {
    if (making !== undefined) return
    setMaking(workspace?.id ?? "own")
    try {
      const agent = await client.createAgent(workspace?.kind === "team" ? workspace.id : undefined)
      await queryClient.invalidateQueries({ queryKey: keys.agents, exact: true })
      haptic.done()
      router.push(`/a/${agent.id}`)
    } catch (error) {
      tell("The agent could not be made", errorText(error))
    } finally {
      setMaking(undefined)
    }
  }

  const refresh = async () => {
    setRefreshing(true)
    await Promise.all([agents.refetch(), workspaces.refetch(), requests.refetch()])
    setRefreshing(false)
  }

  const create: MenuItem[] = [
    teams
      ? {
          title: "New agent in",
          inline: true,
          children: all.map((workspace) => ({
            title: workspace.kind === "team" ? workspace.name : "Personal",
            icon: workspace.kind === "team" ? "people" : "person",
            onPress: () => void newAgent(workspace),
          })),
        }
      : { title: "New agent", icon: "plus", onPress: () => void newAgent() },
    {
      title: "More",
      inline: true,
      children: [
        { title: "New team", icon: "people", onPress: () => router.push("/new-team") },
        { title: "Connect a computer", icon: "desktop", onPress: () => router.push("/pair") },
      ],
    },
  ]

  const row = (agent: AgentSummary) => (
    <AgentRow
      key={agent.id}
      agent={agent}
      meId={meId}
      people={people}
      now={now}
      unread={isUnread(agent, meId, seenHere[agent.id])}
      with={(here[agent.workspaceId ?? ""] ?? [])
        .filter((place) => place.agentId === agent.id && place.userId !== meId)
        .flatMap((place) => people.get(place.userId) ?? [])}
    />
  )

  const empty = agents.data !== undefined && agents.data.length === 0
  return (
    <Screen
      page
      onRefresh={refresh}
      refreshing={refreshing}
      contentContainerStyle={{ paddingTop: 0 }}
    >
      <Stack.Screen
        options={{
          headerLeft: () =>
            me.data === undefined ? null : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${me.data.user.name}: settings and signing out`}
                onPress={() => router.push("/settings")}
                hitSlop={8}
              >
                <Face person={me.data.user} size={34} />
                {(requests.data?.length ?? 0) > 0 ? (
                  <View
                    accessibilityLabel="An agent asks for a computer"
                    style={[styles.dot, { backgroundColor: theme.amber, borderColor: theme.page }]}
                  />
                ) : null}
              </Pressable>
            ),
        }}
      />
      {Platform.OS === "ios" ? (
        <Stack.SearchBar
          placeholder="Search"
          placement="integrated"
          onChangeText={(event) => setSearch(event.nativeEvent.text)}
          onCancelButtonPress={() => setSearch("")}
        />
      ) : null}
      <HeaderItems items={[{ icon: "compose", label: "New", menu: create }]} />

      {agents.data === undefined ? (
        agents.error ? (
          <Empty title="The agents could not be loaded">
            {errorText(agents.error, "Check your connection and pull down to try again.")}
          </Empty>
        ) : (
          <ActivityIndicator style={{ marginTop: 80 }} color={theme.ink2} />
        )
      ) : empty ? (
        <View style={{ gap: 4 }}>
          <Empty title="You have no agents yet">
            An agent is yours to talk to, with a computer to work on.
          </Empty>
          <Button
            title="New agent"
            icon="plus"
            onPress={() => void newAgent()}
            busy={making !== undefined}
            style={{ alignSelf: "center" }}
          />
        </View>
      ) : !teams ? (
        listed.map(row)
      ) : (
        all.map((workspace) => {
          const mine = listed.filter((agent) => (agent.workspaceId ?? all[0]?.id) === workspace.id)
          if (wanted !== "" && mine.length === 0) return null
          const shut = folded.includes(workspace.id) && wanted === ""
          const present = (here[workspace.id] ?? [])
            .filter((place) => place.userId !== meId)
            .flatMap((place) => people.get(place.userId) ?? [])
            .filter((person, at, list) => list.findIndex((each) => each.id === person.id) === at)
          return (
            <View key={workspace.id}>
              <WorkspaceHeader
                workspace={workspace}
                shut={shut}
                onToggle={() => {
                  haptic.tap()
                  toggle(workspace.id)
                }}
                present={present}
                news={shut && mine.some((agent) => isUnread(agent, meId, seenHere[agent.id]))}
                faces={shut ? mine.slice(0, 3) : []}
                onNew={() => void newAgent(workspace)}
                making={making === workspace.id}
              />
              {shut ? null : mine.length === 0 ? (
                <Text
                  variant="subhead"
                  tone="ink2"
                  style={{
                    paddingLeft: EDGE + FACE + GAP,
                    paddingRight: EDGE,
                    paddingVertical: 10,
                  }}
                >
                  {workspace.kind === "team"
                    ? "This team has no agents yet."
                    : "You have no agents of your own yet."}
                </Text>
              ) : (
                mine.map(row)
              )}
            </View>
          )
        })
      )}

      {wanted !== "" && listed.length === 0 && !empty ? (
        <Empty title="No agent matches">Nothing by that name, and nothing it last said.</Empty>
      ) : null}

      {wanted === "" && agents.data !== undefined ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 20, gap: 10 }}>
          {(workspaces.data?.invitations ?? []).map((invitation) => (
            <Pressable
              key={invitation.id}
              accessibilityRole="button"
              accessibilityLabel={`Invitation to ${invitation.workspace.name} from ${invitation.invitedBy.name}`}
              onPress={() => router.push(`/invite/${invitation.id}`)}
              style={[styles.invitation, { backgroundColor: theme.fill }]}
            >
              <Tile name={invitation.workspace.name} color={invitation.workspace.color} size={34} />
              <View style={{ flex: 1 }}>
                <Text weight="600" numberOfLines={1}>
                  {invitation.workspace.name}
                </Text>
                <Text variant="subhead" tone="ink2" numberOfLines={1}>
                  From {invitation.invitedBy.name}
                </Text>
              </View>
              <Text tone="tint" weight="600">
                View
              </Text>
            </Pressable>
          ))}
          {empty ? null : (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/new-team")}
              style={({ pressed }) => [styles.newTeam, { opacity: pressed ? 0.5 : 1 }]}
            >
              <View style={{ width: FACE, alignItems: "center" }}>
                <Icon name="people" size={22} color={theme.tint} weight="medium" />
              </View>
              <Text tone="tint" weight="600">
                New team
              </Text>
            </Pressable>
          )}
        </View>
      ) : null}
    </Screen>
  )
}

function WorkspaceHeader({
  workspace,
  shut,
  onToggle,
  present,
  news,
  faces,
  onNew,
  making,
}: {
  workspace: WorkspaceSummary
  shut: boolean
  onToggle: () => void
  present: Person[]
  news: boolean
  faces: AgentSummary[]
  onNew: () => void
  making: boolean
}) {
  const theme = useTheme()
  const router = useRouter()
  const team = workspace.kind === "team"
  const name = team ? workspace.name : "Personal"
  const canInvite = team && workspace.role !== "member"
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={name}
        accessibilityState={{ expanded: !shut }}
        onPress={onToggle}
        style={{ flexDirection: "row", alignItems: "center", gap: GAP, flex: 1, minWidth: 0 }}
      >
        {/* The arrow and the tile take the creatures' column, so the name starts where theirs do. */}
        <View style={styles.lead}>
          <View style={{ transform: [{ rotate: shut ? "-90deg" : "0deg" }] }}>
            <Icon name="chevronDown" size={13} color={theme.ink2} weight="bold" />
          </View>
          <Tile name={name} color={team ? workspace.color : theme.tint} size={24} />
        </View>
        <Text variant="title3" weight="700" numberOfLines={1} style={{ flexShrink: 1 }}>
          {name}
        </Text>
        {news ? (
          <View
            accessibilityLabel="Something new"
            style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.tint }}
          />
        ) : null}
        {faces.map((agent) => (
          <Avatar
            key={agent.id}
            avatar={agent.avatar}
            seed={agent.id}
            outfit={agent.outfit}
            size={22}
            hatched={agent.hatched}
            still
          />
        ))}
      </Pressable>
      {present.length === 0 ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${present.length} here now: ${present.map((person) => person.name).join(", ")}`}
          onPress={() => router.push(`/settings/w/${encodeURIComponent(workspace.id)}`)}
        >
          <Faces people={present} ring={theme.page} />
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name}: workspace settings`}
        hitSlop={8}
        onPress={() => router.push(`/settings/w/${encodeURIComponent(workspace.id)}`)}
        onLongPress={
          canInvite ? () => router.push(`/w/${encodeURIComponent(workspace.id)}/invite`) : undefined
        }
      >
        <Icon name="more" size={20} color={theme.tint} weight="semibold" />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={team ? `New agent in ${name}` : "New agent"}
        hitSlop={8}
        onPress={onNew}
        disabled={making}
      >
        {making ? (
          <ActivityIndicator />
        ) : (
          <Icon name="plus" size={20} color={theme.tint} weight="semibold" />
        )}
      </Pressable>
    </View>
  )
}

function AgentRow({
  agent,
  meId,
  people,
  now,
  unread,
  with: together,
}: {
  agent: AgentSummary
  meId: string
  people: ReadonlyMap<string, Person>
  now: number
  unread: boolean
  /** The teammates who have this agent open. */
  with: Person[]
}) {
  const theme = useTheme()
  const router = useRouter()
  const { client } = useSession()
  const name = agent.name ?? "New agent"
  const latest = agent.latest
  const line =
    latest === undefined
      ? (agent.tagline ?? (agent.name === null ? "Brand new, and not named yet" : ""))
      : latestWords(latest, meId, people)
  const mood: Mood = agent.working
    ? { state: "working" }
    : agent.asking
      ? { state: "waiting" }
      : { state: "idle" }
  const at = agent.working ? "now" : when(latest?.at ?? agent.createdAt, now)
  const base = `/a/${agent.id}`
  const said = [
    name,
    agent.working ? "working" : agent.asking ? "waiting on someone" : undefined,
    unread ? "something new" : undefined,
    line,
    at,
  ]
    .filter(Boolean)
    .join(", ")

  const content = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={said}
      testID={`agent-${agent.id}`}
      onPress={() => router.push(base)}
      style={({ pressed }) => [styles.row, pressed ? { backgroundColor: theme.fill } : null]}
    >
      {unread ? <View style={[styles.unread, { backgroundColor: theme.tint }]} /> : null}
      <View style={{ width: FACE, height: FACE }}>
        <Avatar
          avatar={agent.avatar}
          seed={agent.id}
          outfit={agent.outfit}
          size={FACE}
          hatched={agent.hatched}
          mood={mood}
        />
        {agent.asking ? (
          <View
            accessibilityLabel="Waiting on someone"
            style={[styles.mark, { backgroundColor: theme.amber, borderColor: theme.page }]}
          >
            <Text
              allowFontScaling={false}
              style={{ fontSize: 12, lineHeight: 16, fontWeight: "700", color: "#fff" }}
            >
              ?
            </Text>
          </View>
        ) : agent.working ? (
          <View
            accessibilityLabel="Working"
            style={[styles.mark, { backgroundColor: theme.page, borderColor: theme.page }]}
          >
            <ActivityIndicator
              size="small"
              color={theme.tint}
              style={{ transform: [{ scale: 0.7 }] }}
            />
          </View>
        ) : null}
      </View>
      <View style={[styles.words, { borderBottomColor: theme.sep }]}>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
          <Text variant="headline" numberOfLines={1} style={{ flex: 1 }}>
            {name}
          </Text>
          {together.length > 0 ? <Faces people={together} size={18} ring={theme.page} /> : null}
          {/* The arrow is centred on the time, which sits on the name's baseline. */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text variant="subhead" tone="ink2">
              {at}
            </Text>
            <Icon name="chevronRight" size={12} color={theme.ink3} weight="bold" />
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: 6, minHeight: 40 }}>
          {latest?.kind === "scheduled" ? (
            <View style={{ paddingTop: 3 }}>
              <Icon name="clock" size={14} color={theme.ink2} weight="medium" />
            </View>
          ) : null}
          <Text
            variant="subhead"
            tone={unread ? "ink" : "ink2"}
            numberOfLines={2}
            style={{ flex: 1 }}
            data-latest
          >
            {line}
          </Text>
        </View>
      </View>
    </Pressable>
  )

  // A hold on the row is the system's context menu, with everything of the agent in it.
  const items: MenuItem[] = [
    { title: "Library", icon: "folder", onPress: () => router.push(`${base}/library`) },
    { title: "Automations", icon: "clock", onPress: () => router.push(`${base}/automations`) },
    { title: "Side chats", icon: "chats", onPress: () => router.push(`${base}/side-chats`) },
    ...(agent.hatched
      ? [
          {
            title: "Wardrobe",
            icon: "hanger",
            onPress: () => router.push(`${base}/wardrobe`),
          } as const,
        ]
      : []),
    {
      title: "More",
      inline: true,
      children: [
        ...(unread
          ? [
              {
                title: "Mark as read",
                icon: "mail",
                onPress: () =>
                  void client
                    .agent(agent.id)
                    .seen()
                    .catch(() => {}),
              } as const,
            ]
          : []),
        { title: "Settings", icon: "slider", onPress: () => router.push(`${base}/info`) },
      ],
    },
  ]
  return (
    <Menu longPress items={items} title={name}>
      {content}
    </Menu>
  )
}

/**
 * The list's columns: the page's margin, a creature, and then the words. A workspace's name, an
 * agent's and "New team" all start at the same place, and what is on the right ends at one.
 */
const EDGE = 16
const FACE = 52
const GAP = 12

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: EDGE,
    paddingTop: 20,
    paddingBottom: 6,
  },
  lead: {
    width: FACE,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  newTeam: {
    flexDirection: "row",
    alignItems: "center",
    gap: GAP,
    minHeight: 44,
    alignSelf: "flex-start",
    paddingRight: EDGE,
  },
  row: { flexDirection: "row", alignItems: "center", gap: GAP, paddingLeft: EDGE },
  words: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 9,
    paddingRight: EDGE,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  unread: {
    position: "absolute",
    left: 4,
    top: "50%",
    marginTop: -4,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  mark: {
    position: "absolute",
    right: -4,
    bottom: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    position: "absolute",
    right: -2,
    top: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
  },
  invitation: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 18,
    borderCurve: "continuous",
  },
})
