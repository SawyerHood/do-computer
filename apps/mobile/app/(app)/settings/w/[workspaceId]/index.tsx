import { keepsSecrets, type WorkspaceSummary } from "@do-computer/protocol"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import { useEffect, useState } from "react"
import { ActivityIndicator } from "react-native"
import { keys, useAgents, useMe, useWorkspaces } from "@/lib/queries"
import { useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import { type Change, InvitationRow, invitationsKey, MemberRow, useChange } from "@/settings/team"
import { count } from "@/settings/who"
import { confirm, Empty, Field, Row, Screen, Section, Text } from "@/ui"

/** A team's name, to change in place. It is saved when the field is left or Return is pressed. */
function Name({ workspace, change }: { workspace: WorkspaceSummary; change: Change }) {
  const api = useSession().client.workspace(workspace.id)
  const [name, setName] = useState(workspace.name)
  // Someone else renaming it shows here too.
  useEffect(() => setName(workspace.name), [workspace.name])
  const save = async () => {
    const next = name.trim()
    if (next === "" || next === workspace.name) return setName(workspace.name)
    if (!(await change(() => api.update({ name: next })))) setName(workspace.name)
  }
  return (
    <Section>
      <Field
        label="Name"
        accessibilityLabel="Team name"
        value={name}
        maxLength={60}
        returnKeyType="done"
        onChangeText={setName}
        onBlur={() => void save()}
      />
    </Section>
  )
}

/**
 * One workspace: for a team its name, its people and who has been asked to join, and for every
 * workspace the way in to its computers, its model sign-ins and, where it keeps any for this
 * person, its saved logins and cards.
 */
export default function Workspace() {
  const { workspaceId } = useLocalSearchParams<{ workspaceId: string }>()
  const theme = useTheme()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { client } = useSession()
  const me = useMe()
  const workspaces = useWorkspaces()
  const agents = useAgents()
  const change = useChange()
  const [leaving, setLeaving] = useState(false)
  const workspace = workspaces.data?.workspaces.find((each) => each.id === workspaceId)
  const team = workspace?.kind === "team"

  const invitations = useQuery({
    queryKey: invitationsKey(workspaceId),
    queryFn: () => client.workspace(workspaceId).invitations(),
    enabled: team,
  })
  const computers = useQuery({ queryKey: keys.computers, queryFn: () => client.listComputers() })
  const providers = useQuery({
    queryKey: keys.workspace(workspaceId, "model-providers"),
    queryFn: () => client.workspace(workspaceId).modelProviders(),
    enabled: workspace !== undefined,
  })

  if (workspace === undefined || me.data === undefined) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "" }} />
        {workspaces.data === undefined || me.data === undefined ? (
          <ActivityIndicator style={{ marginTop: 40 }} />
        ) : (
          <Empty title="This workspace is gone.">You are no longer in it, or it was deleted.</Empty>
        )}
      </Screen>
    )
  }

  const admin = workspace.role !== "member"
  const has = count(
    (agents.data ?? []).filter((agent) => agent.workspaceId === workspace.id).length,
    "Dood",
    "Doods",
  )
  const signedIn = (providers.data ?? [])
    .filter((provider) => provider.signedIn !== null)
    .map((provider) => provider.name)
  const base = `/settings/w/${encodeURIComponent(workspace.id)}`

  /** Leave or delete the team, then go back to the list it is no longer in. */
  const gone = async (work: () => Promise<unknown>) => {
    setLeaving(true)
    const done = await change(async () => {
      await work()
      await queryClient.invalidateQueries({ queryKey: keys.agents, exact: true })
    })
    setLeaving(false)
    if (done) router.back()
  }

  return (
    <Screen
      onRefresh={() => {
        void workspaces.refetch()
        if (team) void invitations.refetch()
      }}
      refreshing={workspaces.isRefetching}
    >
      <Stack.Screen options={{ title: workspace.name, headerLargeTitle: true }} />
      <Text variant="subhead" tone="ink2" style={{ marginHorizontal: 20, marginBottom: 18 }}>
        {team
          ? `Team · ${count(workspace.members.length, "person", "people")} · ${has}\nEveryone here can use every Dood in this team, read its chats and make new Doods.`
          : `Only you · ${has}`}
      </Text>

      {team && admin ? <Name workspace={workspace} change={change} /> : null}

      {team ? (
        <Section
          title="People"
          footer="Members use every Dood here, start chats, read each other’s, and make new Doods. Admins also invite and remove people, rename the team, and move or delete its Doods. The owner also decides who is an admin, and can hand the team on or delete it."
        >
          {workspace.members.map((member) => (
            <MemberRow
              key={member.id}
              workspace={workspace}
              member={member}
              meId={me.data.user.id}
              change={change}
            />
          ))}
          {admin ? (
            <Row
              title="Invite people"
              tone="tint"
              // Comes up over the sheet, and gives way to this page again when it is done.
              onPress={() => router.push(`/w/${encodeURIComponent(workspace.id)}/invite`)}
            />
          ) : null}
        </Section>
      ) : null}

      {team && (invitations.data ?? []).length > 0 ? (
        <Section title={`Invited · ${invitations.data!.length}`}>
          {invitations.data!.map((invitation) => (
            <InvitationRow
              key={invitation.id}
              workspace={workspace}
              invitation={invitation}
              admin={admin}
              change={change}
            />
          ))}
        </Section>
      ) : null}

      <Section>
        <Row
          icon={["desktop", theme.blue]}
          title="Computers"
          value={
            computers.data === undefined
              ? undefined
              : String(computers.data.filter((each) => each.workspaceId === workspace.id).length)
          }
          go
          onPress={() => router.push(`${base}/computers` as never)}
        />
        <Row
          icon={["spark", "#7d5a9a"]}
          title="Models"
          subtitle={
            signedIn.length === 0
              ? undefined
              : `Signed in to ${
                  signedIn.length <= 2
                    ? signedIn.join(" and ")
                    : `${signedIn.slice(0, -1).join(", ")} and ${signedIn.at(-1)}`
                }`
          }
          go
          onPress={() => router.push(`${base}/models` as never)}
        />
        {/* Only where the workspace keeps logins or cards and this person may see them. */}
        {keepsSecrets(workspace) ? (
          <Row
            icon={["key", theme.green]}
            title="Passwords"
            subtitle={
              workspace.savedLogins && workspace.savedCards
                ? "Logins and cards"
                : workspace.savedCards
                  ? "Cards"
                  : "Logins"
            }
            go
            onPress={() => router.push(`${base}/passwords` as never)}
          />
        ) : null}
      </Section>

      {!team ? null : workspace.role === "owner" ? (
        <Section footer="A team can be deleted once it has no Doods: move or delete those first.">
          <Row
            title="Delete team"
            tone="red"
            busy={leaving}
            onPress={async () => {
              const sure = await confirm({
                title: `Delete ${workspace.name} for everyone in it?`,
                action: "Delete",
              })
              if (sure) void gone(() => client.workspace(workspace.id).remove())
            }}
          />
        </Section>
      ) : (
        <Section>
          <Row
            title="Leave team"
            tone="red"
            busy={leaving}
            onPress={async () => {
              const sure = await confirm({
                title: `Leave ${workspace.name}?`,
                message: "You will lose its Doods and their chats.",
                action: "Leave",
              })
              if (sure) {
                void gone(() => client.workspace(workspace.id).removeMember(me.data.user.id))
              }
            }}
          />
        </Section>
      )}
    </Screen>
  )
}
