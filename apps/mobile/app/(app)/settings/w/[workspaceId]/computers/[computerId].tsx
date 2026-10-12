import type { AgentSummary } from "@do-computer/protocol"
import { isPersonalWorkspace } from "@do-computer/protocol"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Stack, useLocalSearchParams } from "expo-router"
import { ActivityIndicator, View } from "react-native"
import {
  connectable,
  isChosen,
  isMachine,
  Problem,
  useAgentsById,
  useComputers,
  useRefresh,
} from "@/computers/shared"
import { keys, useWorkspaces } from "@/lib/queries"
import { mono } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import { Button, Empty, haptic, Row, Screen, Section, Text } from "@/ui"
import { Avatar } from "@/ui/avatar"

/**
 * The agents that work on one computer, each with the folder it has there, and the ones that
 * could: connected and disconnected one by one where the computer is for chosen agents.
 */
export default function ComputerAgents() {
  const { computerId } = useLocalSearchParams<{ workspaceId: string; computerId: string }>()
  const { client } = useSession()
  const queryClient = useQueryClient()
  const computers = useComputers()
  const agents = useAgentsById()
  const workspaces = useWorkspaces().data?.workspaces ?? []
  const computer = computers.data?.find((each) => each.id === computerId)
  const refresh = useRefresh(() => computers.refetch())
  const settled = () => queryClient.invalidateQueries({ queryKey: keys.computers })
  const connect = useMutation({
    mutationFn: (agentId: string) => client.connectComputer(computerId, agentId),
    onSuccess: () => haptic.done(),
    onSettled: settled,
  })
  const disconnect = useMutation({
    mutationFn: (agentId: string) => client.disconnectComputer(computerId, agentId),
    onSettled: settled,
  })

  if (computer === undefined) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Agents" }} />
        {computers.data === undefined ? (
          <ActivityIndicator style={{ marginVertical: 32 }} />
        ) : (
          <Empty title="That computer is gone">It was removed, or is no longer shared with you.</Empty>
        )}
      </Screen>
    )
  }

  const chosen = isChosen(computer)
  const personal = isPersonalWorkspace(computer.workspaceId)
  const teams = workspaces.filter((workspace) => workspace.kind === "team")
  const team = workspaces.find((workspace) => workspace.id === computer.workspaceId)
  const everyone = `Every agent in ${personal ? "your workspace" : (team?.name ?? "the team")}`
  const offered = connectable(computer, agents)
  const busy = connect.isPending || disconnect.isPending
  const face = (agent: AgentSummary | undefined) =>
    agent === undefined ? undefined : (
      <Avatar
        avatar={agent.avatar}
        seed={agent.id}
        outfit={agent.outfit}
        size={32}
        hatched={agent.hatched}
        still
      />
    )

  return (
    <Screen {...refresh}>
      <Stack.Screen options={{ title: computer.name }} />
      <Section
        title="Agents"
        footer={
          <View style={{ gap: 4 }}>
            <Text variant="footnote" tone="ink2">
              {isMachine(computer) && !computer.shareable
                ? "It keeps its files with its agent, so no other agent can work on it."
                : chosen
                  ? "An agent that is not connected can ask for it, and is answered under Computers or in its chat."
                  : `${everyone} can work on it, each in a folder of its own.`}
            </Text>
            <Problem error={disconnect.error ?? connect.error} />
          </View>
        }
      >
        {computer.agentIds.length === 0 ? <Row title={<Text tone="ink2">None yet</Text>} /> : null}
        {computer.agentIds.map((id) => {
          const agent = agents.get(id)
          const name = agent?.name ?? "New agent"
          const folder = computer.folders.find((entry) => entry.agentId === id)?.path
          return (
            <Row
              key={id}
              lead={face(agent)}
              title={name}
              subtitle={
                folder === undefined ? undefined : (
                  <Text
                    variant="footnote"
                    tone="ink2"
                    numberOfLines={1}
                    ellipsizeMode="middle"
                    accessibilityLabel={`${name}’s folder on ${computer.name}: ${folder}`}
                    style={{ fontFamily: mono, letterSpacing: 0 }}
                  >
                    {folder}
                  </Text>
                )
              }
              tail={
                chosen ? (
                  <Button
                    kind="plain"
                    size="small"
                    destructive
                    title="Disconnect"
                    accessibilityLabel={`Disconnect ${name} from ${computer.name}`}
                    busy={disconnect.isPending && disconnect.variables === id}
                    disabled={busy}
                    onPress={() => disconnect.mutate(id)}
                  />
                ) : undefined
              }
            />
          )
        })}
      </Section>

      {offered.length === 0 ? null : (
        // Not a choice that is kept: each agent picked is connected, and leaves the list.
        <Section title={computer.agentIds.length === 0 ? "Connect an agent…" : "Connect another…"}>
          {offered.map((agent) => (
            <Row
              key={agent.id}
              lead={face(agent)}
              title={agent.name ?? "New agent"}
              subtitle={
                personal && teams.length > 0
                  ? workspaces.find((workspace) => workspace.id === agent.workspaceId)?.name
                  : undefined
              }
              tail={
                <Button
                  kind="grey"
                  size="small"
                  title="Connect"
                  accessibilityLabel={`Connect ${agent.name ?? "New agent"} to ${computer.name}`}
                  busy={connect.isPending && connect.variables === agent.id}
                  disabled={busy}
                  onPress={() => connect.mutate(agent.id)}
                />
              }
            />
          ))}
        </Section>
      )}
    </Screen>
  )
}
