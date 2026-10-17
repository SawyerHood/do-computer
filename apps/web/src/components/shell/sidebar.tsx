import type { WorkspaceSummary } from "@do-computer/protocol"
import {
  CaretUpDownIcon,
  DesktopIcon,
  GearIcon,
  SignOutIcon,
  UserPlusIcon,
} from "@phosphor-icons/react"
import { useState } from "react"
import { useComputerRequests } from "@/components/computer-requests"
import { PersonFace } from "@/components/people"
import { InviteDialog } from "@/components/team/invite"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { authClient } from "@/lib/auth-client"
import { forgetNotifications } from "@/lib/notifications"
import { useSettings } from "@/lib/settings"
import { cn } from "@/lib/utils"
import { AgentList } from "./agent-list.tsx"

type Me = { id: string; name: string; email: string; image?: string | null }

/**
 * How the sidebar is drawn: as a column of faces, or opened out into the whole list. Either way
 * the faces are in the one place, so that opening it moves none of them.
 */
export type Drawn = "rail" | "open"

/**
 * The user's own menu, at the foot of the sidebar: the way into the settings, asking people in
 * to a team, and signing out.
 */
function AccountMenu({
  workspace,
  me,
  narrow,
}: {
  workspace: WorkspaceSummary
  me: Me
  narrow: Drawn
}) {
  const rail = narrow === "rail"
  const { open: openSettings } = useSettings()
  const [inviting, setInviting] = useState(false)
  const team = workspace.kind === "team"
  const person = { id: me.id, name: me.name, image: me.image ?? null }
  // Agents asking for a computer of theirs, in whichever workspace: answered under Computers.
  const asking = useComputerRequests().filter((request) => request.canAnswer).length

  // From the press until the sign-in page takes this one's place.
  const [leaving, setLeaving] = useState(false)
  const signOut = async () => {
    setLeaving(true)
    try {
      await forgetNotifications()
      await authClient.signOut()
    } catch {
      // It did not go through. They are still signed in, and can ask again.
      return setLeaving(false)
    }
    // The page is loaded again, so that nothing of the session is left in it.
    window.location.assign("/login")
  }

  return (
    // The face is under the Doods' own, whether or not its name is beside it.
    <div className="px-2 py-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`${me.name}: settings and signing out`}
          disabled={leaving}
          aria-busy={leaving}
          className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left outline-none hover:bg-foreground/6 focus-visible:ring-3 focus-visible:ring-ring/40 aria-expanded:bg-foreground/6"
        >
          <span className="relative shrink-0">
            <PersonFace person={person} title="" className="size-7" />
            {rail && asking > 0 ? (
              <span
                title="A Dood is asking to use a computer"
                className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-notice ring-2 ring-frame"
              />
            ) : null}
          </span>
          {rail ? null : (
            <>
              <span className="min-w-0 flex-1 truncate text-sm">
                {leaving ? "Signing out…" : me.name}
              </span>
              {leaving ? (
                <Spinner className="size-3.5 shrink-0 text-muted-foreground" />
              ) : asking > 0 ? (
                <span
                  title="A Dood is asking to use a computer"
                  className="size-2 shrink-0 rounded-full bg-notice"
                />
              ) : null}
              {leaving ? null : (
                <CaretUpDownIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              )}
            </>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-68">
          <div className="flex items-center gap-2.5 px-2 py-1.5">
            <PersonFace person={person} title="" className="size-8" />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-medium">{me.name}</p>
              <p className="truncate text-xs text-muted-foreground">{me.email}</p>
            </div>
          </div>
          <DropdownMenuSeparator />
          {asking > 0 ? (
            <DropdownMenuItem
              onClick={() =>
                openSettings({ at: "workspace", workspaceId: workspace.id, section: "computers" })
              }
            >
              <DesktopIcon />
              <span className="flex-1">
                {asking === 1 ? "A Dood asks for a computer" : `${asking} Doods ask for computers`}
              </span>
              <span aria-hidden className="size-2 shrink-0 rounded-full bg-notice" />
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => openSettings({ at: "top" })}>
            <GearIcon /> Settings
          </DropdownMenuItem>
          {team && workspace.role !== "member" ? (
            <DropdownMenuItem onClick={() => setInviting(true)}>
              <UserPlusIcon /> Invite people
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void signOut()}>
            <SignOutIcon /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {team ? (
        <InviteDialog workspace={workspace} open={inviting} onOpenChange={setInviting} />
      ) : null}
    </div>
  )
}

/**
 * The one column of navigation: the user's agents, under their workspaces where they have more
 * than their own, and the user's own menu at its foot. Its edge opens it out from faces into
 * the whole list and shuts it again.
 */
export function Sidebar({
  workspace,
  settled = true,
  me,
  agentId,
  drawn,
  onNavigate,
  className,
}: {
  workspace: WorkspaceSummary
  /** Whether that is known to be the workspace. Until it is, its place is held and not named. */
  settled?: boolean
  me: Me
  /** The agent whose page is open, which the address says before the agent itself is here. */
  agentId: string | undefined
  drawn: Drawn
  onNavigate?: () => void
  className?: string
}) {
  return (
    // With no title bar the column is wider, for the window's buttons, and everything in it
    // is as far in from the left whether or not it is opened out.
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden inset:pl-2.5",
        drawn === "rail" && "inset:pr-2.5",
        className,
      )}
    >
      {/* Under the window's buttons, which are all there is at the top of it there. */}
      <div aria-hidden className="hidden h-10 shrink-0 inset:block" />
      {/* Elsewhere, a little room over the list. */}
      <div aria-hidden className="h-2 shrink-0 inset:hidden" />
      <div className="flex min-h-0 flex-1 flex-col">
        <AgentList
          workspace={workspace}
          pending={!settled}
          activeAgentId={agentId}
          me={me}
          narrow={drawn}
          onNavigate={onNavigate}
        />
      </div>
      <AccountMenu workspace={workspace} me={me} narrow={drawn} />
    </div>
  )
}
