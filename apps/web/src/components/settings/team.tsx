import type {
  Invitation,
  SentInvitation,
  WorkspaceMember,
  WorkspaceRole,
  WorkspaceSummary,
} from "@do-computer/protocol"
import { EnvelopeSimpleIcon, GithubLogoIcon, PlusIcon } from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { useNavigate, useRouteContext } from "@tanstack/react-router"
import { useState } from "react"
import { useConfirm } from "@/components/confirm"
import { PersonFace, WorkspaceTile } from "@/components/people"
import { InviteDialog } from "@/components/team/invite"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { client } from "@/lib/client"
import { agentsCollection } from "@/lib/collections"
import { queryClient } from "@/lib/query"
import { invitationsKey, refreshWorkspaces, useHere, whoIs } from "@/lib/workspaces"

const heading = "mt-9 mb-2.5 text-[0.8125rem] font-medium text-muted-foreground"
const ROLE_WORDS: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
}
const ROLES = (["member", "admin", "owner"] as const).map((role) => ({
  value: role,
  label: ROLE_WORDS[role],
}))
const day = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" })

/** Run something that changes the team, and say what went wrong if it did not work. */
function useChange(): [string | undefined, (work: () => Promise<unknown>) => Promise<void>] {
  const [error, setError] = useState<string>()
  return [
    error,
    async (work) => {
      setError(undefined)
      try {
        await work()
        refreshWorkspaces()
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "That did not work. Try again.")
      }
    },
  ]
}

function Name({ workspace, editable }: { workspace: WorkspaceSummary; editable: boolean }) {
  const [name, setName] = useState<string>()
  const [error, change] = useChange()
  if (name === undefined) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <h1 className="truncate text-2xl font-semibold tracking-tight">{workspace.name}</h1>
        {editable ? (
          <Button variant="ghost" size="sm" onClick={() => setName(workspace.name)}>
            Rename
          </Button>
        ) : null}
      </div>
    )
  }
  const save = () =>
    change(async () => {
      await client.workspace(workspace.id).update({ name })
      setName(undefined)
    })
  return (
    <form
      className="flex min-w-0 flex-1 flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <div className="flex items-center gap-2">
        <Input
          aria-label="Team name"
          value={name}
          maxLength={60}
          autoFocus
          onChange={(event) => setName(event.target.value)}
        />
        <Button type="submit" size="sm" disabled={name.trim() === ""}>
          Save
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setName(undefined)}>
          Cancel
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  )
}

function MemberRow({
  workspace,
  member,
  meId,
  here,
  change,
}: {
  workspace: WorkspaceSummary
  member: WorkspaceMember
  meId: string
  here: boolean
  change: (work: () => Promise<unknown>) => Promise<void>
}) {
  const navigate = useNavigate()
  const api = client.workspace(workspace.id)
  const mine = member.id === meId
  // The owner decides who is what. An admin can remove members; anyone but the owner can leave.
  const canSetRole = workspace.role === "owner" && !mine
  const canRemove =
    !mine &&
    member.role !== "owner" &&
    (workspace.role === "owner" || (workspace.role === "admin" && member.role === "member"))
  const [confirm, confirming] = useConfirm()
  return (
    <li className="flex items-center gap-3 border-t px-3.5 py-2.5 first:border-t-0">
      <PersonFace person={member} here={here} className={here ? "size-8" : "size-8 opacity-70"} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {member.name}
          {mine ? <span className="font-normal text-muted-foreground"> (you)</span> : null}
        </p>
        <p className="truncate text-xs text-muted-foreground">{member.email}</p>
      </div>
      {canSetRole ? (
        <Select
          items={ROLES}
          value={member.role}
          onValueChange={async (role) => {
            if (role === null || role === member.role) return
            if (
              role === "owner" &&
              !(await confirm({
                title: `Hand ${workspace.name} to ${member.name}?`,
                description: "You will become an admin.",
                action: "Hand it over",
              }))
            ) {
              return
            }
            void change(() => api.setRole(member.id, role))
          }}
        >
          <SelectTrigger size="sm" aria-label={`Role of ${member.name}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {ROLES.map((role) => (
                <SelectItem key={role.value} value={role.value}>
                  {role.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      ) : (
        <Badge variant="secondary" className="bg-accent font-normal text-muted-foreground">
          {ROLE_WORDS[member.role]}
        </Badge>
      )}
      {canRemove ? (
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive"
          onClick={async () => {
            if (
              await confirm({
                title: `Remove ${member.name} from ${workspace.name}?`,
                action: "Remove",
                destructive: true,
              })
            ) {
              void change(() => api.removeMember(member.id))
            }
          }}
        >
          Remove
        </Button>
      ) : mine && member.role !== "owner" ? (
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive"
          onClick={async () => {
            if (
              !(await confirm({
                title: `Leave ${workspace.name}?`,
                description: "You will lose its Doods and their chats.",
                action: "Leave",
                destructive: true,
              }))
            ) {
              return
            }
            void change(async () => {
              await api.removeMember(member.id)
              // The index route goes to the agent that was last open, which is the team's
              // until the list says it is gone.
              await agentsCollection.utils.refetch()
              await navigate({ to: "/" })
            })
          }}
        >
          Leave
        </Button>
      ) : null}
      {confirming}
    </li>
  )
}

function InvitationRow({
  workspace,
  invitation,
  admin,
  change,
}: {
  workspace: WorkspaceSummary
  invitation: Invitation
  admin: boolean
  change: (work: () => Promise<unknown>) => Promise<void>
}) {
  const api = client.workspace(workspace.id)
  // A link is only known when it is made. Sending again makes a new one, shown here until copied.
  const [renewed, setRenewed] = useState<SentInvitation>()
  const [copied, setCopied] = useState(false)
  const refresh = () => queryClient.invalidateQueries({ queryKey: invitationsKey(workspace.id) })
  return (
    <li className="flex flex-wrap items-center gap-3 border-t px-3.5 py-2.5 first:border-t-0">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-muted-foreground">
        {invitation.email === null ? (
          <GithubLogoIcon className="size-4" />
        ) : (
          <EnvelopeSimpleIcon className="size-4" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {invitation.email ?? `@${invitation.githubLogin}`}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {renewed !== undefined
            ? renewed.emailed
              ? "Sent again, with a new link."
              : "A new link was made. The old one no longer works."
            : `Invited by ${invitation.invitedBy.name} as ${
                invitation.role === "admin" ? "an admin" : "a member"
              } · good until ${day.format(invitation.expiresAt)}`}
        </p>
      </div>
      {admin ? (
        <>
          {renewed !== undefined ? (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await navigator.clipboard.writeText(renewed.link).catch(() => {})
                setCopied(true)
              }}
            >
              {copied ? "Copied" : "Copy link"}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                void change(async () => {
                  setRenewed(await api.renewInvitation(invitation.id))
                  await refresh()
                })
              }
            >
              {invitation.email === null ? "New link" : "Send again"}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={() =>
              void change(async () => {
                await api.withdrawInvitation(invitation.id)
                await refresh()
              })
            }
          >
            Withdraw
          </Button>
        </>
      ) : null}
    </li>
  )
}

/** Who is in a team, who has been asked, and what each may do. */
/** A team's own settings: what it is called, who is in it, and who has been asked to be. */
export function TeamSettings({ workspace }: { workspace: WorkspaceSummary }) {
  const navigate = useNavigate()
  const { me } = useRouteContext({ from: "/_app" })
  const admin = workspace.role !== "member"
  const [inviting, setInviting] = useState(false)
  const [error, change] = useChange()
  const [confirm, confirming] = useConfirm()
  const hereIds = whoIs(useHere(workspace.id), () => true)
  const { data: invitations } = useQuery({
    queryKey: invitationsKey(workspace.id),
    queryFn: () => client.workspace(workspace.id).invitations(),
  })

  return (
    <div>
      <div>
        <header className="flex items-center gap-4">
          <WorkspaceTile workspace={workspace} className="size-12" />
          <Name workspace={workspace} editable={admin} />
          {admin ? (
            <Button onClick={() => setInviting(true)}>
              <PlusIcon /> Invite people
            </Button>
          ) : null}
        </header>
        <p className="mt-3 text-sm text-muted-foreground">
          Everyone here can use every Dood in this team, read its chats and make new Doods.
        </p>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <h2 className={heading}>Members · {workspace.members.length}</h2>
        <ul className="overflow-hidden rounded-2xl border">
          {workspace.members.map((member) => (
            <MemberRow
              key={member.id}
              workspace={workspace}
              member={member}
              meId={me.user.id}
              here={hereIds.includes(member.id) || member.id === me.user.id}
              change={change}
            />
          ))}
        </ul>

        {(invitations ?? []).length === 0 ? null : (
          <>
            <h2 className={heading}>Invited · {invitations!.length}</h2>
            <ul className="overflow-hidden rounded-2xl border">
              {invitations!.map((invitation) => (
                <InvitationRow
                  key={invitation.id}
                  workspace={workspace}
                  invitation={invitation}
                  admin={admin}
                  change={change}
                />
              ))}
            </ul>
          </>
        )}

        <h2 className={heading}>Roles</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          <b className="font-medium text-foreground">Members</b> use every Dood here, start chats,
          read each other's, and make new Doods.{" "}
          <b className="font-medium text-foreground">Admins</b> also invite and remove people,
          rename the team, and move or delete its Doods. The{" "}
          <b className="font-medium text-foreground">owner</b> also decides who is an admin, and can
          hand the team on or delete it.
        </p>

        {workspace.role === "owner" ? (
          <>
            <h2 className={heading}>Delete</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              A team can be deleted once it has no Doods: move or delete those first.
            </p>
            <Button
              variant="outline"
              className="text-destructive"
              onClick={async () => {
                if (
                  !(await confirm({
                    title: `Delete ${workspace.name} for everyone in it?`,
                    action: "Delete",
                    destructive: true,
                  }))
                ) {
                  return
                }
                void change(async () => {
                  await client.workspace(workspace.id).remove()
                  await agentsCollection.utils.refetch()
                  await navigate({ to: "/" })
                })
              }}
            >
              Delete {workspace.name}
            </Button>
          </>
        ) : null}
      </div>
      <InviteDialog workspace={workspace} open={inviting} onOpenChange={setInviting} />
      {confirming}
    </div>
  )
}
