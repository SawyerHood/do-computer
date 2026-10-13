import type { AgentSummary, InvitationPreview, WorkspaceSummary } from "@do-computer/protocol"
import { CaretRightIcon, PlusIcon } from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { type ReactNode, useState } from "react"
import { AgentFace } from "@/components/agent-avatar"
import { WorkspaceTile } from "@/components/people"
import { WorkspaceMark } from "@/components/shell/workspace-menu"
import { NewTeamDialog } from "@/components/team/new-team"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { client } from "@/lib/client"
import { computersKey, modelsKey } from "@/lib/collections"
import { useNewAgent } from "@/lib/new-agent"
import { useSettings } from "@/lib/settings"

const count = (many: number, one: string, more: string) => `${many} ${many === 1 ? one : more}`

/** One thing in a list that is gone inside of: its mark, its name, and a few words about it. */
function Row({
  mark,
  name,
  about,
  label,
  onClick,
}: {
  mark: ReactNode
  name: string
  about: string
  label: string
  onClick: () => void
}) {
  return (
    <li className="border-t first:border-t-0">
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className="group/row flex w-full items-center gap-3 rounded-lg px-1.5 py-2.5 text-left outline-none hover:bg-foreground/4 focus-visible:ring-3 focus-visible:ring-ring/40"
      >
        {mark}
        <span className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-3">
          <span className="block truncate font-medium">{name}</span>
          <span className="block truncate text-sm text-muted-foreground sm:ml-auto">{about}</span>
        </span>
        <CaretRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
    </li>
  )
}

const groupHeading = "text-[0.8125rem] font-medium text-muted-foreground"

/** A workspace's agents, and the way to make another there. */
function AgentsOf({
  workspace,
  agents,
  about,
}: {
  workspace: WorkspaceSummary
  agents: readonly AgentSummary[]
  about: (agent: AgentSummary) => string
}) {
  const { open } = useSettings()
  const { create, making, error } = useNewAgent(workspace.id)
  const heading = `agents-of-${workspace.id}`
  return (
    <section aria-labelledby={heading} className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3 px-1.5">
        <h3 id={heading} className={groupHeading}>
          {workspace.name}
        </h3>
        <Button
          variant="ghost"
          size="xs"
          disabled={making}
          aria-busy={making}
          aria-label={`New Dood in ${workspace.name}`}
          className="text-muted-foreground"
          onClick={() => void create()}
        >
          {making ? <Spinner /> : <PlusIcon />} New Dood
        </Button>
      </div>
      {error === undefined ? null : (
        <p role="alert" className="px-1.5 text-sm text-destructive">
          {error}
        </p>
      )}
      {agents.length === 0 ? (
        <p className="px-1.5 text-sm text-muted-foreground">No Doods here yet.</p>
      ) : (
        <ul>
          {agents.map((agent) => (
            <Row
              key={agent.id}
              mark={<AgentFace agent={agent} className="size-8" still />}
              name={agent.name ?? "New Dood"}
              about={about(agent)}
              label={`${agent.name ?? "New Dood"}'s settings`}
              onClick={() => open({ at: "agent", agentId: agent.id })}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * Every agent the user can set up, under the workspace it is in, with the one on screen first.
 * Each says what it thinks with and where it works; choosing one opens its own settings.
 */
export function AgentsList({
  agents,
  workspaces,
  current,
}: {
  agents: readonly AgentSummary[]
  workspaces: readonly WorkspaceSummary[]
  /** The workspace on screen, which is listed first. */
  current: string
}) {
  const { data: models } = useQuery({
    queryKey: modelsKey,
    queryFn: () => client.models(),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const { data: computers } = useQuery({
    queryKey: computersKey,
    queryFn: () => client.listComputers(),
  })
  const about = (agent: AgentSummary) => {
    const model =
      models?.find((entry) => entry.id === agent.model)?.name ?? agent.model.split("/").at(-1)!
    const on = (computers ?? [])
      .filter((computer) => computer.agentIds.includes(agent.id))
      .map((computer) => computer.name)
    return [model, ...(on.length > 2 ? [count(on.length, "computer", "computers")] : on)].join(
      " · ",
    )
  }
  const inOrder = [...workspaces].sort(
    (a, b) => Number(b.id === current) - Number(a.id === current),
  )
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Doods</h2>
        <p className="text-sm text-muted-foreground">
          Every Dood you can set up, by the workspace it is in. Choose one to change who it is, what
          it thinks with and what it may do.
        </p>
      </div>
      {inOrder.map((workspace) => (
        <AgentsOf
          key={workspace.id}
          workspace={workspace}
          agents={agents.filter((agent) => agent.workspaceId === workspace.id)}
          about={about}
        />
      ))}
    </div>
  )
}

/**
 * The user's own workspace and the teams they are in, the teams that have asked them to join,
 * and the way to start a team. Choosing a workspace opens its people, computers and models.
 */
export function WorkspacesList({
  workspaces,
  invitations,
  agents,
  me,
}: {
  workspaces: readonly WorkspaceSummary[]
  invitations: readonly InvitationPreview[]
  agents: readonly AgentSummary[]
  me: { id: string; name: string; image?: string | null }
}) {
  const { open } = useSettings()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Workspaces</h2>
        <p className="text-sm text-muted-foreground">
          Your own, and the teams you are in. A workspace has the computers its Doods work on and
          the models they can run on; a team has its people too.
        </p>
      </div>
      <ul>
        {workspaces.map((workspace) => {
          const has = count(
            agents.filter((agent) => agent.workspaceId === workspace.id).length,
            "Dood",
            "Doods",
          )
          return (
            <Row
              key={workspace.id}
              mark={<WorkspaceMark workspace={workspace} me={me} className="size-8" />}
              name={workspace.name}
              about={
                workspace.kind === "team"
                  ? `${count(workspace.members.length, "person", "people")} · ${has}`
                  : `Only you · ${has}`
              }
              label={`${workspace.name}: workspace settings`}
              onClick={() => open({ at: "workspace", workspaceId: workspace.id })}
            />
          )
        })}
      </ul>
      {invitations.length > 0 ? (
        <section aria-labelledby="invitations" className="flex flex-col gap-1.5">
          <h3 id="invitations" className={`${groupHeading} px-1.5`}>
            Invitations
          </h3>
          <ul>
            {invitations.map((invitation) => (
              <li
                key={invitation.id}
                className="flex items-center gap-3 border-t px-1.5 py-2.5 first:border-t-0"
              >
                <WorkspaceTile workspace={invitation.workspace} className="size-8" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{invitation.workspace.name}</span>
                  <span className="block truncate text-sm text-muted-foreground">
                    from {invitation.invitedBy.name}
                  </span>
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void navigate({ to: "/invite/$token", params: { token: invitation.id } })
                  }
                >
                  View
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div>
        <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
          <PlusIcon /> New team
        </Button>
      </div>
      <NewTeamDialog userId={me.id} open={creating} onOpenChange={setCreating} />
    </div>
  )
}
