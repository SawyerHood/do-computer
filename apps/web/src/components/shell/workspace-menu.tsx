import {
  type InvitationPreview,
  isPersonalWorkspace,
  type WorkspaceSummary,
} from "@durable-computer/protocol"
import { CaretUpDownIcon, CheckIcon, PlusIcon, UsersIcon } from "@phosphor-icons/react"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { FaceStack, PersonFace, WorkspaceTile } from "@/components/people"
import { NewTeamDialog } from "@/components/team/new-team"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { client } from "@/lib/client"
import { agentsCollection } from "@/lib/collections"
import { useSettings } from "@/lib/settings"
import { useHere, usePeople, useWorkspaces, whoIs } from "@/lib/workspaces"

type Me = { id: string; name: string; image?: string | null }

/** A workspace's mark: a team's tile, or for a personal one its owner's face. */
export function WorkspaceMark({
  workspace,
  me,
  className,
}: {
  workspace: WorkspaceSummary
  me: Me
  className?: string
}) {
  return workspace.kind === "personal" ? (
    <PersonFace
      person={{ id: me.id, name: me.name, image: me.image ?? null }}
      title=""
      className={className}
    />
  ) : (
    <WorkspaceTile workspace={workspace} className={className} />
  )
}

function TeamRow({ workspace, me }: { workspace: WorkspaceSummary; me: Me }) {
  const here = useHere(workspace.id)
  const people = usePeople(workspace)
  const others = whoIs(here, (place) => place.userId !== me.id).flatMap(
    (id) => people.get(id) ?? [],
  )
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground [--face-ring:var(--popover)]">
      {workspace.members.length} {workspace.members.length === 1 ? "person" : "people"}
      {others.length > 0 ? (
        <>
          <span aria-hidden>·</span>
          <FaceStack people={others} className="size-4" />
          here now
        </>
      ) : null}
    </span>
  )
}

/**
 * The way between workspaces, at the top of the sidebar: the user's own, their teams, the
 * invitations waiting for them, and starting a new team.
 */
export function WorkspaceMenu({ workspace, me }: { workspace: WorkspaceSummary; me: Me }) {
  const navigate = useNavigate()
  const { openWorkspace } = useSettings()
  const state = useWorkspaces()
  const [creating, setCreating] = useState(false)

  /** A team opens on its home. One's own workspace opens on its first agent, made if need be. */
  const open = async (target: WorkspaceSummary) => {
    if (target.kind === "team") {
      await navigate({ to: "/w/$workspaceId", params: { workspaceId: target.id } })
      return
    }
    const agents = await client.listAgents()
    const agent =
      agents.find((candidate) => candidate.workspaceId === target.id) ??
      (await client.createAgent(target.id))
    await agentsCollection.utils.refetch()
    await navigate({ to: "/a/$agentId", params: { agentId: agent.id } })
  }
  const view = (invitation: InvitationPreview) =>
    navigate({ to: "/invite/$token", params: { token: invitation.id } })

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Workspace: ${workspace.name}. Switch workspace`}
          title="Switch workspace"
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl py-1.5 pr-2 pl-1.5 text-left outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/40 aria-expanded:bg-accent"
        >
          <WorkspaceMark workspace={workspace} me={me} className="size-7" />
          <span className="min-w-0 truncate text-sm font-semibold">{workspace.name}</span>
          <CaretUpDownIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          {(state?.invitations.length ?? 0) > 0 ? (
            <Badge
              aria-label={`${state!.invitations.length} invitations`}
              className="h-4 min-w-4 rounded-full px-1 text-[0.625rem] font-bold"
            >
              {state!.invitations.length}
            </Badge>
          ) : null}
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="start" className="w-76">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
            {(state?.workspaces ?? [workspace]).map((entry) => (
              <DropdownMenuItem key={entry.id} onClick={() => void open(entry)}>
                <WorkspaceMark workspace={entry} me={me} className="size-8" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{entry.name}</span>
                  {entry.kind === "personal" ? (
                    <span className="block text-xs text-muted-foreground">Only you</span>
                  ) : (
                    <TeamRow workspace={entry} me={me} />
                  )}
                </span>
                {entry.id === workspace.id ? <CheckIcon className="size-4" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          {(state?.invitations.length ?? 0) > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Invitations</DropdownMenuLabel>
                {state!.invitations.map((invitation) => (
                  <DropdownMenuItem key={invitation.id} onClick={() => void view(invitation)}>
                    <WorkspaceTile workspace={invitation.workspace} className="size-8" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{invitation.workspace.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        from {invitation.invitedBy.name}
                      </span>
                    </span>
                    <Badge>View</Badge>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setCreating(true)}>
            <PlusIcon /> New team
          </DropdownMenuItem>
          {isPersonalWorkspace(workspace.id) ? null : (
            <DropdownMenuItem onClick={() => openWorkspace("team")}>
              <UsersIcon /> People in {workspace.name}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <NewTeamDialog userId={me.id} open={creating} onOpenChange={setCreating} />
    </>
  )
}
