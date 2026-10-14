import type { WorkspaceSummary } from "@do-computer/protocol"
import {
  DotsThreeIcon,
  GearIcon,
  PlusIcon,
  SortAscendingIcon,
  UserPlusIcon,
} from "@phosphor-icons/react"
import { useNavigate } from "@tanstack/react-router"
import { useAtom } from "jotai"
import { useState } from "react"
import { PersonFace, WorkspaceTile } from "@/components/people"
import { InviteDialog } from "@/components/team/invite"
import { NewTeamDialog } from "@/components/team/new-team"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { agentOrderAtom } from "@/lib/atoms"
import { useSettings } from "@/lib/settings"
import { useWorkspaces } from "@/lib/workspaces"

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

/**
 * What a workspace has besides its agents, from the heading over them in the sidebar: its
 * settings, and for a team, asking people in. Where its agents were put in an order by hand,
 * that is given up here, for the one last heard from first.
 */
export function WorkspaceMenu({
  workspace,
  onNavigate,
}: {
  workspace: WorkspaceSummary
  onNavigate?: (() => void) | undefined
}) {
  const { open: openSettings } = useSettings()
  const [inviting, setInviting] = useState(false)
  const [orders, putInOrder] = useAtom(agentOrderAtom)
  const invites = workspace.kind === "team" && workspace.role !== "member"
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`${workspace.name}: workspace menu`}
          title="Workspace menu"
          render={<Button variant="ghost" size="icon-xs" className="text-muted-foreground" />}
        >
          <DotsThreeIcon weight="bold" className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end" className="w-52">
          <DropdownMenuItem
            onClick={() => {
              onNavigate?.()
              openSettings({ at: "workspace", workspaceId: workspace.id })
            }}
          >
            <GearIcon /> Workspace settings
          </DropdownMenuItem>
          {invites ? (
            <DropdownMenuItem onClick={() => setInviting(true)}>
              <UserPlusIcon /> Invite people
            </DropdownMenuItem>
          ) : null}
          {orders[workspace.id] === undefined ? null : (
            <DropdownMenuItem onClick={() => putInOrder(workspace.id, undefined)}>
              <SortAscendingIcon /> Sort by latest
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {invites ? (
        <InviteDialog workspace={workspace} open={inviting} onOpenChange={setInviting} />
      ) : null}
    </>
  )
}

/**
 * The workspaces that are not the user's yet, at the foot of the sidebar's list: the
 * invitations waiting for them, and starting a team.
 */
export function MoreWorkspaces({
  me,
  onNavigate,
}: {
  me: Me
  onNavigate?: (() => void) | undefined
}) {
  const navigate = useNavigate()
  const state = useWorkspaces()
  const [creating, setCreating] = useState(false)
  const row =
    "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[0.8125rem] text-muted-foreground outline-none hover:bg-foreground/6 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
  return (
    <div className="mt-3 flex shrink-0 flex-col gap-0.5 border-t pt-2">
      {(state?.invitations ?? []).map((invitation) => (
        <button
          key={invitation.id}
          type="button"
          title={`From ${invitation.invitedBy.name}`}
          onClick={() => {
            onNavigate?.()
            void navigate({ to: "/invite/$token", params: { token: invitation.id } })
          }}
          className={row}
        >
          <WorkspaceTile workspace={invitation.workspace} className="size-4" />
          <span className="min-w-0 flex-1 truncate">{invitation.workspace.name} invited you</span>
          <Badge>View</Badge>
        </button>
      ))}
      <button type="button" onClick={() => setCreating(true)} className={row}>
        <PlusIcon aria-hidden className="size-4 shrink-0" />
        New team
      </button>
      <NewTeamDialog userId={me.id} open={creating} onOpenChange={setCreating} />
    </div>
  )
}
