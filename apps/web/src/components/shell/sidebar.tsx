import type { AgentSummary, WorkspaceSummary } from "@durable-computer/protocol"
import {
  CaretLeftIcon,
  CaretUpDownIcon,
  GearIcon,
  MoonIcon,
  SidebarSimpleIcon,
  SignOutIcon,
  SunIcon,
  UserPlusIcon,
} from "@phosphor-icons/react"
import { Link, useNavigate } from "@tanstack/react-router"
import { useSetAtom } from "jotai"
import { useEffect, useState } from "react"
import { AgentFace } from "@/components/agent-avatar"
import { FaceStack, names, PersonFace } from "@/components/people"
import { InviteDialog } from "@/components/team/invite"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { sidebarSlotAtom } from "@/lib/atoms"
import { authClient } from "@/lib/auth-client"
import { useSettings } from "@/lib/settings"
import { currentTheme, setTheme } from "@/lib/theme"
import { cn } from "@/lib/utils"
import { useHere, usePeople, whoIs } from "@/lib/workspaces"
import { AgentList } from "./agent-list.tsx"
import { WorkspaceMenu } from "./workspace-menu.tsx"

type Me = { id: string; name: string; email: string; image?: string | null }

/**
 * The user's own menu, at the foot of the sidebar: the way into the workspace's settings, the
 * theme, and signing out.
 */
function AccountMenu({ workspace, me }: { workspace: WorkspaceSummary; me: Me }) {
  const navigate = useNavigate()
  const { openWorkspace } = useSettings()
  const [inviting, setInviting] = useState(false)
  const [theme, setCurrent] = useState<"light" | "dark">("dark")
  useEffect(() => setCurrent(currentTheme()), [])
  const next = theme === "dark" ? "light" : "dark"
  const team = workspace.kind === "team"
  const person = { id: me.id, name: me.name, image: me.image ?? null }

  const signOut = async () => {
    await authClient.signOut()
    await navigate({ to: "/login" })
  }

  return (
    <div className="border-t p-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`${me.name}: settings and signing out`}
          className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/40 aria-expanded:bg-accent"
        >
          <PersonFace person={person} title="" className="size-7" />
          <span className="min-w-0 flex-1 truncate text-sm">{me.name}</span>
          <CaretUpDownIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
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
          <DropdownMenuItem onClick={() => openWorkspace(team ? "team" : "computers")}>
            <GearIcon />
            <span className="flex-1">Workspace settings</span>
            <span className="max-w-24 truncate text-xs text-muted-foreground">
              {workspace.name}
            </span>
          </DropdownMenuItem>
          {team && workspace.role !== "member" ? (
            <DropdownMenuItem onClick={() => setInviting(true)}>
              <UserPlusIcon /> Invite people
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            // The menu stays open, so the change is seen from where it was asked for.
            closeOnClick={false}
            onClick={() => {
              setTheme(next)
              setCurrent(next)
            }}
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            {theme === "dark" ? "Light theme" : "Dark theme"}
          </DropdownMenuItem>
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
 * The one column of navigation: the workspace at its top, then its agents with their chats, and
 * the user's own menu at its foot. While the Library tab is showing, the list in the middle is
 * that agent's files, which the library page puts there; everything around it stays.
 */
export function Sidebar({
  workspace,
  me,
  agent,
  library = false,
  onNavigate,
  onCollapse,
  className,
}: {
  workspace: WorkspaceSummary
  me: Me
  agent: AgentSummary | undefined
  /** The Library tab is showing, and this is the sidebar its list of files goes in. */
  library?: boolean
  onNavigate?: () => void
  /** Hides the sidebar, where it can be hidden. */
  onCollapse?: () => void
  className?: string
}) {
  const { openWorkspace } = useSettings()
  const setSlot = useSetAtom(sidebarSlotAtom)
  const here = useHere(workspace.id)
  const people = usePeople(workspace)
  const others = whoIs(here, (place) => place.userId !== me.id).flatMap(
    (id) => people.get(id) ?? [],
  )
  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="flex items-center gap-0.5 px-2 pt-2.5 pb-1 [--face-ring:var(--rail)]">
        <WorkspaceMenu workspace={workspace} me={me} />
        {others.length > 0 ? (
          <button
            type="button"
            aria-label={`${others.length} here now: ${names(others)}`}
            title={`Here now: ${names(others)}`}
            onClick={() => openWorkspace("team")}
            className="flex h-8 shrink-0 items-center rounded-lg px-1.5 outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            <FaceStack people={others} className="size-[1.125rem]" />
          </button>
        ) : null}
        {onCollapse === undefined ? null : (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Hide the sidebar"
            title="Hide the sidebar"
            className="shrink-0 text-muted-foreground"
            onClick={onCollapse}
          >
            <SidebarSimpleIcon />
          </Button>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {library && agent !== undefined ? (
          <>
            <Link
              to="/a/$agentId"
              params={{ agentId: agent.id }}
              className="mx-2 mt-1 flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
            >
              <CaretLeftIcon className="size-3.5 shrink-0" />
              <AgentFace agent={agent} className="size-5" still />
              <span className="min-w-0 truncate">Agents and chats</span>
            </Link>
            <div ref={setSlot} className="min-h-0 flex-1" />
          </>
        ) : (
          <AgentList
            workspace={workspace}
            activeAgentId={agent?.id}
            meId={me.id}
            onNavigate={onNavigate}
          />
        )}
      </div>
      <AccountMenu workspace={workspace} me={me} />
    </div>
  )
}
