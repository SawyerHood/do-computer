import type { AgentSummary, WorkspaceSummary } from "@do-computer/protocol"
import {
  CaretLeftIcon,
  CaretUpDownIcon,
  DesktopIcon,
  GearIcon,
  SidebarSimpleIcon,
  SignOutIcon,
  UserPlusIcon,
} from "@phosphor-icons/react"
import { Link } from "@tanstack/react-router"
import { useSetAtom } from "jotai"
import { useState } from "react"
import { AgentFace } from "@/components/agent-avatar"
import { useComputerRequests } from "@/components/computer-requests"
import { PersonFace } from "@/components/people"
import { InviteDialog } from "@/components/team/invite"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { sidebarSlotAtom } from "@/lib/atoms"
import { authClient } from "@/lib/auth-client"
import { forgetNotifications } from "@/lib/notifications"
import { useSettings } from "@/lib/settings"
import { cn } from "@/lib/utils"
import { AgentList, LEVEL } from "./agent-list.tsx"

type Me = { id: string; name: string; email: string; image?: string | null }

/**
 * How the sidebar of a narrow screen is drawn: as a column of faces, or opened out into the
 * whole list. Either way the faces are in the one place, so that opening it moves none of them.
 */
export type Narrow = "rail" | "open"

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
  narrow: Narrow | undefined
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
    // On a narrow screen the face is under the Doods' own, whether or not its name is beside it.
    <div className={narrow === undefined ? "p-2" : "p-1.5"}>
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
                className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-primary ring-2 ring-frame"
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
                  className="size-2 shrink-0 rounded-full bg-primary"
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
              <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary" />
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
 * than their own, and the user's own menu at its foot. While the Library tab is showing, the
 * list in the middle is that agent's files, which the library page puts there; everything
 * around it stays.
 */
export function Sidebar({
  workspace,
  settled = true,
  me,
  agentId,
  agent,
  library = false,
  narrow,
  onPull,
  onNavigate,
  onCollapse,
  className,
}: {
  workspace: WorkspaceSummary
  /** Whether that is known to be the workspace. Until it is, its place is held and not named. */
  settled?: boolean
  me: Me
  /** The agent whose page is open, which the address says before the agent itself is here. */
  agentId: string | undefined
  agent: AgentSummary | undefined
  /** The Library tab is showing, and this is the sidebar its list of files goes in. */
  library?: boolean
  /** This is the sidebar of a narrow screen, drawn this way. */
  narrow?: Narrow
  /** Opens the faces out into the list, or shuts the list to faces, without a finger's pull. */
  onPull?: () => void
  onNavigate?: () => void
  /** Hides the sidebar, where it can be hidden. */
  onCollapse?: () => void
  className?: string
}) {
  const setSlot = useSetAtom(sidebarSlotAtom)
  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      {/* Flush with the list under it: its ends are where the chosen agent's row has its own. */}
      <div
        className={cn(
          "flex items-center gap-2 pt-2.5 pb-0.5",
          // Over the faces, on a narrow screen.
          narrow === undefined ? "px-2" : "px-3",
        )}
      >
        {onPull === undefined ? (
          <img src="/icon-192.png" alt="" className="size-6 shrink-0 rounded-md" />
        ) : (
          // Where there is no finger to pull with, the mark at the top does it.
          <button
            type="button"
            aria-label={narrow === "rail" ? "Show Doods by name" : "Show Doods as faces"}
            aria-expanded={narrow !== "rail"}
            onClick={onPull}
            className="shrink-0 rounded-lg p-1 outline-none hover:bg-foreground/6 focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            <img src="/icon-192.png" alt="" className="size-6 rounded-md" />
          </button>
        )}
        {narrow === "rail" ? null : (
          <span className={cn("min-w-0 flex-1 truncate text-sm font-semibold", LEVEL)}>
            Do Computer
          </span>
        )}
        {onCollapse === undefined ? null : (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Hide the sidebar"
            title="Hide the sidebar"
            className="-mr-1.5 shrink-0 text-muted-foreground"
            onClick={onCollapse}
          >
            <SidebarSimpleIcon />
          </Button>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {library && agentId !== undefined ? (
          <>
            <Link
              to="/a/$agentId"
              params={{ agentId }}
              className="mx-2 mt-1 flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-sm text-muted-foreground outline-none hover:bg-foreground/6 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
            >
              <CaretLeftIcon className="size-3.5 shrink-0" />
              {agent === undefined ? null : <AgentFace agent={agent} className="size-5" quiet />}
              <span className="min-w-0 truncate">Doods</span>
            </Link>
            <div ref={setSlot} className="min-h-0 flex-1" />
          </>
        ) : (
          <AgentList
            workspace={workspace}
            pending={!settled}
            activeAgentId={agentId}
            me={me}
            narrow={narrow}
            onNavigate={onNavigate}
          />
        )}
      </div>
      <AccountMenu workspace={workspace} me={me} narrow={narrow} />
    </div>
  )
}
