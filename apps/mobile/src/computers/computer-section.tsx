import type {
  AgentSummary,
  ComputerKind,
  ComputerRequest,
  ComputerSummary,
  WorkspaceSummary,
} from "@do-computer/protocol"
import { isPersonalWorkspace } from "@do-computer/protocol"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "expo-router"
import { View } from "react-native"
import { keys } from "@/lib/queries"
import { radius, useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import { Button, Choice, confirm, haptic, Pill, Row, Section, Text } from "@/ui"
import { Avatar } from "@/ui/avatar"
import { ago, describe, isMachine, PLATFORMS, Problem } from "./shared"

/** What a computer's state means for whoever looks at it, in the web app's words. */
function standing(
  computer: ComputerSummary,
  everyone: string,
  update: { replaced: boolean; offered: boolean },
): string {
  const machine = isMachine(computer)
  if (machine && !computer.shareable) {
    return "It keeps its files with its agent, so no other agent can work on it."
  }
  if (machine && computer.access === "open") {
    return `${everyone} can work on it, each in a folder of its own.`
  }
  if (!computer.online) {
    return computer.lastSeenAt
      ? `Last connected ${ago(computer.lastSeenAt)}. Start the daemon there to bring it back.`
      : "Its daemon has not connected yet."
  }
  if (!machine && computer.daemon === "outdated") {
    if (update.replaced) return "Its daemon is being replaced. It will be back in a moment."
    return update.offered
      ? "Its daemon is out of date and does not update itself. Update it from here, or run the install command there again."
      : "Its daemon is out of date and does not update itself. Run the install command there again."
  }
  return computer.agentIds.length === 0
    ? "No agent can work on it until one is connected. An agent can also ask."
    : "Its agents can work on it now."
}

/**
 * One computer on the computers page: what it is, whose it is, who can use it and the agents
 * that do, with what can be done about it for those who may.
 */
export function ComputerSection({
  computer,
  meId,
  workspaceId,
  workspaces,
  agents,
  kinds,
}: {
  computer: ComputerSummary
  meId: string
  /** The workspace whose settings are open, which the screen of its agents is pushed under. */
  workspaceId: string
  workspaces: readonly WorkspaceSummary[]
  agents: ReadonlyMap<string, AgentSummary>
  kinds: readonly ComputerKind[]
}) {
  const theme = useTheme()
  const router = useRouter()
  const { client } = useSession()
  const queryClient = useQueryClient()
  const settled = () => queryClient.invalidateQueries({ queryKey: keys.computers })
  const remove = useMutation({
    mutationFn: () => client.removeComputer(computer.id),
    onSuccess: () => haptic.done(),
    onSettled: settled,
  })
  const move = useMutation({
    mutationFn: (to: string) => client.moveComputer(computer.id, to),
    onSettled: settled,
  })
  const share = useMutation({
    mutationFn: (access: ComputerSummary["access"]) => client.setComputerAccess(computer.id, access),
    onSettled: settled,
  })
  const update = useMutation({
    mutationFn: () => client.updateComputerDaemon(computer.id),
    onSuccess: () => haptic.done(),
    onSettled: settled,
  })

  const machine = isMachine(computer)
  const personal = isPersonalWorkspace(computer.workspaceId)
  const mine = computer.pairedBy.id === meId
  const team = workspaces.find((workspace) => workspace.id === computer.workspaceId)
  const teams = workspaces.filter((workspace) => workspace.kind === "team")
  const everyone = `Every agent in ${personal ? "your workspace" : (team?.name ?? "the team")}`
  const busy = move.isPending || remove.isPending || share.isPending || update.isPending
  const problem = [remove, move, share, update].find((mutation) => mutation.isError)?.error
  // A daemon from before daemons kept themselves up to date. It can be replaced from here by
  // whoever may remove the computer, unless it is read-only and so runs nothing it is sent.
  const stale = !machine && computer.online && computer.daemon === "outdated"
  const updatable = stale && computer.canManage && !computer.readOnly
  const owners = workspaces.map((workspace) => ({
    value: workspace.id,
    label: workspace.kind === "personal" ? "You" : workspace.name,
  }))
  const open = [
    { value: "open", label: everyone },
    { value: "chosen", label: "Chosen agents" },
  ] as const
  const names = computer.agentIds.map((id) => agents.get(id)?.name ?? "New agent")

  const give = async (next: string) => {
    const to = workspaces.find((workspace) => workspace.id === next)
    if (to === undefined || to.id === computer.workspaceId) return
    const losing = computer.agentIds.filter(
      (id) => to.kind === "team" && agents.get(id)?.workspaceId !== to.id,
    )
    if (
      losing.length > 0 &&
      !(await confirm({
        title: `Give ${computer.name} to ${to.name}?`,
        message: `Agents outside ${to.name} will be disconnected from it.`,
        action: `Give to ${to.name}`,
        destructive: false,
      }))
    ) {
      return
    }
    haptic.tap()
    move.mutate(to.id)
  }

  // Removing a paired computer only ends access to it. Removing a machine ends the machine.
  const ask = async () => {
    const agreed = await confirm(
      machine
        ? {
            title: `Delete ${computer.name}?`,
            message: "The machine and everything on it is deleted. This cannot be undone.",
            action: "Delete",
          }
        : {
            title: `Remove ${computer.name}?`,
            message: "Its agents lose access to it at once. Nothing on the computer is deleted.",
            action: "Remove",
          },
    )
    if (agreed) remove.mutate()
  }

  return (
    <Section
      title={computer.name}
      footer={
        <View style={{ gap: 4 }}>
          <Text variant="footnote" tone="ink2">
            {standing(computer, everyone, {
              replaced: update.isSuccess,
              offered: updatable,
            })}
          </Text>
          <Problem error={problem} />
        </View>
      }
    >
      <Row
        icon={[machine ? "terminal" : "desktop", machine ? theme.ink2 : theme.blue]}
        title={machine ? describe(computer, kinds) : computer.hostname}
        subtitle={
          machine
            ? undefined
            : [
                PLATFORMS[computer.platform] ?? computer.platform,
                computer.readOnly ? "read-only" : undefined,
                computer.screen ? "screen" : undefined,
                computer.browser ? "browser" : undefined,
              ]
                .filter((part) => part !== undefined)
                .join(" · ")
        }
        // A machine is started when an agent works on it, so it is never offline.
        tail={
          machine ? undefined : (
            <Pill label={computer.online ? "Online" : "Offline"} tone={computer.online ? "good" : "plain"} />
          )
        }
      />
      {!machine && mine && teams.length > 0 ? (
        // Whoever paired it says whose it is: it is their account there that agents act as.
        <Row
          title="Belongs to"
          tail={
            <Choice
              label={`Who ${computer.name} belongs to`}
              value={computer.workspaceId}
              options={owners}
              disabled={busy}
              onChange={(next) => void give(next)}
            />
          }
        />
      ) : (
        <Row
          title="Belongs to"
          subtitle={
            personal
              ? undefined
              : `${machine ? "added" : "paired"} by ${mine ? "you" : computer.pairedBy.name}`
          }
          value={personal ? "You" : (team?.name ?? "A team")}
        />
      )}
      {machine && computer.shareable ? (
        <Row
          title="Open to"
          tail={
            <Choice
              label={`Who can use ${computer.name}`}
              value={computer.access}
              options={open}
              disabled={busy}
              onChange={(next) => {
                haptic.tap()
                share.mutate(next)
              }}
            />
          }
        />
      ) : null}
      <Row
        title="Agents"
        value={names.length === 0 ? "None yet" : names.join(", ")}
        go
        accessibilityLabel={`Agents of ${computer.name}`}
        onPress={() =>
          router.push(
            `/settings/w/${encodeURIComponent(workspaceId)}/computers/${encodeURIComponent(computer.id)}`,
          )
        }
      />
      {updatable && !update.isSuccess ? (
        <Row
          title={update.isPending ? "Updating…" : "Update the daemon"}
          tone="tint"
          busy={update.isPending}
          disabled={busy}
          accessibilityLabel={`Update the daemon on ${computer.name}`}
          onPress={() => update.mutate()}
        />
      ) : null}
      {/* One whose files are with its agent goes when the agent is deleted, and not before. */}
      {computer.canManage && (!machine || computer.shareable) ? (
        <Row
          title="Remove"
          tone="red"
          busy={remove.isPending}
          disabled={busy}
          accessibilityLabel={`Remove ${computer.name}`}
          onPress={() => void ask()}
        />
      ) : null}
    </Section>
  )
}

/** An agent asking to use a computer, with the answer for whoever the computer belongs to. */
export function RequestCard({
  request,
  agent,
  team,
}: {
  request: ComputerRequest
  agent: AgentSummary | undefined
  /** The team the computer belongs to, if it is a team's. */
  team: WorkspaceSummary | undefined
}) {
  const theme = useTheme()
  const { client } = useSession()
  const queryClient = useQueryClient()
  const answer = useMutation({
    mutationFn: (approve: boolean) => client.answerComputerRequest(request.id, approve),
    onSuccess: () => haptic.done(),
    // Prefix of the requests too: the list of computers gains an agent when the answer is yes.
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.computers }),
  })
  const name = agent?.name ?? "An agent"
  return (
    <View
      style={{
        marginHorizontal: 16,
        marginBottom: 12,
        padding: 16,
        gap: 12,
        borderRadius: radius.group,
        borderCurve: "continuous",
        backgroundColor: theme.card,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        {agent === undefined ? null : (
          <Avatar
            avatar={agent.avatar}
            seed={agent.id}
            outfit={agent.outfit}
            size={40}
            hatched={agent.hatched}
            still
          />
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text weight="600">
            {name} asks to use {request.computer.name}
          </Text>
          {request.reason === "" ? null : (
            <Text variant="subhead" tone="ink2">
              “{request.reason}”
            </Text>
          )}
          <Text variant="subhead" tone="ink2">
            {team !== undefined
              ? `Anyone in ${team.name} can answer`
              : request.computer.readOnly
                ? "It will be able to read files there"
                : "It will be able to run commands and change files there"}
          </Text>
        </View>
      </View>
      <Problem error={answer.error} />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button
          kind="grey"
          size="medium"
          title="Don’t allow"
          style={{ flex: 1 }}
          disabled={answer.isPending}
          onPress={() => answer.mutate(false)}
        />
        <Button
          size="medium"
          title="Allow"
          style={{ flex: 1 }}
          busy={answer.isPending && answer.variables === true}
          disabled={answer.isPending}
          onPress={() => answer.mutate(true)}
        />
      </View>
    </View>
  )
}
