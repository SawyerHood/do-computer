import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "expo-router"
import { useState } from "react"
import { ActivityIndicator, View } from "react-native"
import { useAgents, useMe, useWorkspaces } from "@/lib/queries"
import { setAgentId } from "@/lib/session"
import { useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import { forgetPush, useNotificationsState } from "@/settings/notifications"
import { count } from "@/settings/who"
import { Button, confirm, Face, HeaderItems, Row, Screen, Section, Text, Tile } from "@/ui"
import { Avatar } from "@/ui/avatar"

/** The address of the server without its scheme: "do.computer". */
const hostOf = (server: string) => {
  try {
    return new URL(server).host
  } catch {
    return server
  }
}

/**
 * The first page of the settings sheet: what is the person's own, then the workspaces and the
 * agents to go inside, in the order of the web's one settings window.
 */
export default function Settings() {
  const theme = useTheme()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { client, auth, server } = useSession()
  const me = useMe()
  const workspaces = useWorkspaces()
  const agents = useAgents()
  const [notifications] = useNotificationsState()
  const [leaving, setLeaving] = useState(false)

  /** Close the sheet, then go somewhere in the app behind it. */
  const leaveFor = (href: string) => {
    router.dismiss()
    router.push(href as never)
  }

  const signOut = async () => {
    if (!(await confirm({ title: "Sign out of Do Computer?", action: "Sign out" }))) return
    setLeaving(true)
    // While the session still stands: the server is told to stop notifying this phone.
    await forgetPush(client)
    await auth.signOut().catch(() => {})
    queryClient.clear()
    setAgentId(null)
    // The server's address is kept, so that signing in again starts from it.
    router.replace("/connect")
  }

  const user = me.data?.user
  const list = workspaces.data?.workspaces ?? []
  const invitations = workspaces.data?.invitations ?? []
  // Every agent, under the workspace it is in, in the order the workspaces are listed.
  const place = (workspaceId: string | undefined) => {
    const at = list.findIndex((workspace) => workspace.id === workspaceId)
    return at === -1 ? list.length : at
  }
  const inOrder = [...(agents.data ?? [])].sort(
    (a, b) => place(a.workspaceId) - place(b.workspaceId),
  )

  return (
    <Screen>
      <HeaderItems
        items={[{ label: "Done", text: "Done", prominent: true, onPress: () => router.dismiss() }]}
      />
      {user === undefined ? (
        <ActivityIndicator style={{ marginVertical: 24 }} />
      ) : (
        <Section>
          <Row
            lead={<Face person={{ id: user.id, name: user.name, image: user.image }} size={54} />}
            title={
              <Text variant="title3" numberOfLines={1}>
                {user.name}
              </Text>
            }
            subtitle={
              <Text variant="footnote" tone="ink2" numberOfLines={1}>
                {user.email} · {hostOf(server)}
              </Text>
            }
          />
        </Section>
      )}

      <Section>
        <Row
          icon={["gear", "#8b949a"]}
          title="General"
          subtitle="Appearance and defaults"
          go
          onPress={() => router.push("/settings/general")}
        />
        <Row
          icon={["bell", theme.red]}
          title="Notifications"
          value={notifications === undefined ? undefined : notifications === "on" ? "On" : "Off"}
          go
          onPress={() => router.push("/settings/general")}
        />
      </Section>

      <Section title="Workspaces">
        {list.map((workspace) => {
          const has = count(
            (agents.data ?? []).filter((agent) => agent.workspaceId === workspace.id).length,
            "Dood",
            "Doods",
          )
          const team = workspace.kind === "team"
          return (
            <Row
              key={workspace.id}
              lead={<Tile name={workspace.name} color={team ? workspace.color : theme.tint} />}
              title={workspace.name}
              subtitle={
                team
                  ? `Team · ${count(workspace.members.length, "person", "people")} · ${has}`
                  : `Only you · ${has}`
              }
              accessibilityLabel={`${workspace.name}: workspace settings`}
              go
              onPress={() => router.push(`/settings/w/${encodeURIComponent(workspace.id)}`)}
            />
          )
        })}
        {invitations.map((invitation) => (
          <Row
            key={invitation.id}
            lead={<Tile name={invitation.workspace.name} color={invitation.workspace.color} />}
            title={invitation.workspace.name}
            subtitle={`${invitation.invitedBy.name} invited you`}
            tail={
              <Button
                kind="grey"
                size="small"
                title="View"
                onPress={() => leaveFor(`/invite/${invitation.id}`)}
              />
            }
          />
        ))}
        <Row title="New team" tone="tint" onPress={() => leaveFor("/new-team")} />
      </Section>

      <Section title="Doods">
        {inOrder.map((agent) => (
          <Row
            key={agent.id}
            lead={
              <View style={{ width: 34, height: 34 }}>
                <Avatar avatar={agent.avatar} seed={agent.id} outfit={agent.outfit} size={34} hatched={agent.hatched} still />
              </View>
            }
            title={agent.name ?? "New Dood"}
            subtitle={list.find((workspace) => workspace.id === agent.workspaceId)?.name}
            accessibilityLabel={`${agent.name ?? "New Dood"}'s settings`}
            go
            onPress={() => leaveFor(`/a/${agent.id}/info`)}
          />
        ))}
      </Section>

      {me.data?.admin === true ? (
        <Section title="Server">
          <Row icon={["cpu", theme.blue]} title="Models" go onPress={() => router.push("/settings/models")} />
          {me.data.signup === "waitlist" ? (
            <Row
              icon={["clock", theme.amber]}
              title="Waiting list"
              go
              onPress={() => router.push("/settings/waitlist")}
            />
          ) : null}
        </Section>
      ) : null}

      <Section>
        <Row title="Sign out" tone="red" busy={leaving} onPress={() => void signOut()} />
      </Section>
    </Screen>
  )
}
