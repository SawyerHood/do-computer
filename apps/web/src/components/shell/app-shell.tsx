import {
  type AgentSummary,
  isPersonalWorkspace,
  personalWorkspaceId,
  type WorkspaceSummary,
} from "@durable-computer/protocol"
import {
  ChatCircleIcon,
  ClockIcon,
  DesktopIcon,
  FolderIcon,
  GearIcon,
  LightningIcon,
  ListIcon,
  PlugsIcon,
  MoonIcon,
  ShieldCheckIcon,
  NotePencilIcon,
  SignOutIcon,
  SunIcon,
  UserCircleIcon,
  UsersIcon,
} from "@phosphor-icons/react"
import { Link, useLocation, useNavigate, useParams, useRouteContext } from "@tanstack/react-router"
import { eq, useLiveQuery } from "@tanstack/react-db"
import { useAtom } from "jotai"
import { type ReactNode, useEffect, useMemo, useState } from "react"
import { AgentFace } from "@/components/agent-avatar"
import { FaceStack } from "@/components/people"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { chatListOpenAtom } from "@/lib/atoms"
import { authClient } from "@/lib/auth-client"
import { agentsCollection } from "@/lib/collections"
import { currentTheme, setTheme } from "@/lib/theme"
import { cn } from "@/lib/utils"
import { useHere, usePeople, usePresence, useWorkspaces, whoIs } from "@/lib/workspaces"
import { AgentList, useNewChat } from "./agent-list.tsx"
import { WorkspaceMenu } from "./workspace-menu.tsx"

function RailButton({
  label,
  active,
  children,
  ...props
}: { label: string; active?: boolean; children: ReactNode } & React.ComponentProps<typeof Button>) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label={label}
            className={cn(
              "relative rounded-full text-muted-foreground",
              active && "bg-accent text-foreground",
            )}
            {...props}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

const CHAT_LIST_KEY = "dc-chat-list"

function ThemeToggle() {
  const [theme, setCurrent] = useState<"light" | "dark">("dark")
  useEffect(() => setCurrent(currentTheme()), [])
  const next = theme === "dark" ? "light" : "dark"
  return (
    <RailButton
      label={`Switch to ${next} theme`}
      onClick={() => {
        setTheme(next)
        setCurrent(next)
      }}
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </RailButton>
  )
}

/** The workspace a page is in: the one named, else the agent's, else the user's own. */
function useCurrentWorkspace(
  me: { id: string; name: string; email: string; image?: string | null },
  agentId: string | undefined,
  workspaceId: string | undefined,
): WorkspaceSummary {
  const state = useWorkspaces()
  const { data: found } = useLiveQuery(
    (q) => q.from({ agent: agentsCollection }).where(({ agent }) => eq(agent.id, agentId ?? "")),
    [agentId],
  )
  const id = workspaceId ?? found?.[0]?.workspaceId ?? personalWorkspaceId(me.id)
  return useMemo(
    () =>
      state?.workspaces.find((workspace) => workspace.id === id) ?? {
        // Until the list has arrived, and for a team it does not have: the user's own.
        id: personalWorkspaceId(me.id),
        name: "Personal",
        color: "teal",
        kind: "personal",
        role: "owner",
        members: [
          {
            id: me.id,
            name: me.name,
            email: me.email,
            image: me.image ?? null,
            role: "owner",
            joinedAt: 0,
          },
        ],
        createdAt: 0,
      },
    [state, id, me],
  )
}

/**
 * The frame around everything behind sign-in: a rail with the workspace and the open agent's
 * pages, the workspace's agents with their chats, and the current page. Without an agent, as on
 * a team's own pages, the rail has only what belongs to the workspace.
 */
export function AppShell({
  agent,
  workspaceId,
  children,
}: {
  agent?: AgentSummary
  /** The team whose page this is, where the page is not an agent's. */
  workspaceId?: string
  children: ReactNode
}) {
  const navigate = useNavigate()
  const { me } = useRouteContext({ from: "/_app" })
  const { chatId } = useParams({ strict: false })
  const workspace = useCurrentWorkspace(me.user, agent?.id, workspaceId)
  const team = !isPersonalWorkspace(workspace.id)
  usePresence(workspace.id, { agentId: agent?.id ?? null, chatId: chatId ?? null })
  const here = useHere(workspace.id)
  const people = usePeople(workspace)
  const others = whoIs(here, (place) => place.userId !== me.user.id).flatMap(
    (id) => people.get(id) ?? [],
  )

  const [listOpen, setListOpen] = useAtom(chatListOpenAtom)
  // The list stays the way it was left.
  useEffect(() => {
    try {
      if (localStorage.getItem(CHAT_LIST_KEY) === "open") setListOpen(true)
    } catch {
      // Storage can be unavailable; the list then starts closed.
    }
  }, [setListOpen])
  const toggleList = () =>
    setListOpen((open) => {
      try {
        localStorage.setItem(CHAT_LIST_KEY, open ? "closed" : "open")
      } catch {
        // The choice then lasts for this page only.
      }
      return !open
    })
  const newChat = useNewChat(agent?.id)
  const [sheetOpen, setSheetOpen] = useState(false)
  const page = useLocation({
    select: (location) => {
      const last = location.pathname.split("/").at(-1) ?? ""
      if (location.pathname.startsWith("/w/")) return last === "people" ? "people" : "team"
      return [
        "profile",
        "automations",
        "skills",
        "computers",
        "library",
        "connectors",
        "permissions",
        "settings",
      ].includes(last)
        ? last
        : "chat"
    },
  })
  // Where the list of agents and chats is the thing to see: a chat, or a team's own pages.
  const listed = page === "chat" || page === "team" || page === "people"

  const signOut = async () => {
    await authClient.signOut()
    await navigate({ to: "/login" })
  }
  const to = (path: string) => () =>
    navigate({ to: `/a/$agentId/${path}`, params: { agentId: agent!.id } })

  return (
    <div className="flex h-dvh min-h-0">
      <aside className="hidden w-16 shrink-0 flex-col items-center gap-2 border-r bg-rail py-3 md:flex">
        <WorkspaceMenu workspace={workspace} me={me.user} />
        <div className="mt-3 flex flex-col items-center gap-1 border-t pt-3">
          {/* The library has a list of its own in that place, so from there this leads back. */}
          <RailButton
            label={page === "library" ? "Back to chat" : listOpen ? "Hide chats" : "Show chats"}
            active={listOpen && listed}
            onClick={
              page === "library"
                ? () => navigate({ to: "/a/$agentId", params: { agentId: agent!.id } })
                : toggleList
            }
          >
            <ChatCircleIcon />
          </RailButton>
          {agent === undefined ? null : (
            <>
              <RailButton label="Library" active={page === "library"} onClick={to("library")}>
                <FolderIcon />
              </RailButton>
              <RailButton
                label="Automations"
                active={page === "automations"}
                onClick={to("automations")}
              >
                <ClockIcon />
              </RailButton>
              <RailButton label="Skills" active={page === "skills"} onClick={to("skills")}>
                <LightningIcon />
              </RailButton>
              <RailButton
                label="Connectors"
                active={page === "connectors"}
                onClick={to("connectors")}
              >
                <PlugsIcon />
              </RailButton>
              <RailButton label="Computers" active={page === "computers"} onClick={to("computers")}>
                <DesktopIcon />
              </RailButton>
              <RailButton
                label="Permissions"
                active={page === "permissions"}
                onClick={to("permissions")}
              >
                <ShieldCheckIcon />
              </RailButton>
              <RailButton
                label="Identity and memory"
                active={page === "profile"}
                onClick={to("profile")}
              >
                <UserCircleIcon />
              </RailButton>
            </>
          )}
        </div>
        <div className="mt-auto flex flex-col items-center gap-1">
          {team ? (
            <RailButton
              label={
                others.length === 0
                  ? workspace.name
                  : `${workspace.name}: ${others.length} here now`
              }
              active={page === "team" || page === "people"}
              onClick={() =>
                navigate({ to: "/w/$workspaceId", params: { workspaceId: workspace.id } })
              }
            >
              <UsersIcon />
              {others.length > 0 ? (
                <span
                  aria-hidden
                  className="absolute top-0.5 right-0 grid h-4 min-w-4 place-items-center rounded-full bg-[oklch(0.7_0.16_150)] px-1 text-[0.625rem] font-bold text-[oklch(0.2_0.05_150)] ring-2 ring-rail"
                >
                  {others.length}
                </span>
              ) : null}
            </RailButton>
          ) : null}
          {/* For the account, so it sits with signing out, apart from the agent's own pages. */}
          {agent === undefined ? null : (
            <RailButton label="Settings" active={page === "settings"} onClick={to("settings")}>
              <GearIcon />
            </RailButton>
          )}
          <ThemeToggle />
          <RailButton label="Sign out" onClick={signOut}>
            <SignOutIcon />
          </RailButton>
        </div>
      </aside>

      {listOpen && page !== "library" ? (
        <aside className="hidden w-72 shrink-0 border-r bg-rail/60 md:block">
          <AgentList workspace={workspace} activeAgentId={agent?.id} meId={me.user.id} />
        </aside>
      ) : null}

      <main className="relative flex min-w-0 flex-1 flex-col">
        <div className="absolute top-3 left-3 z-20 md:hidden">
          <Button
            variant="secondary"
            size="sm"
            className="rounded-full"
            onClick={() => setSheetOpen(true)}
          >
            <ListIcon /> Agents
          </Button>
        </div>
        {/* On a wide screen the list is beside the page when it is open, and behind this when not. */}
        {listOpen || !listed ? null : (
          <div className="absolute top-3 left-3 z-20 hidden items-center gap-1.5 md:flex">
            <Button
              variant="secondary"
              size="sm"
              className="rounded-full [--face-ring:var(--secondary)]"
              aria-label="Agents"
              onClick={toggleList}
            >
              <ListIcon /> Agents
              {/* Who else is about, so that it shows with the list put away. */}
              <FaceStack people={others} className="size-[1.125rem]" />
            </Button>
            {agent === undefined ? null : (
              <Button
                variant="secondary"
                size="icon-sm"
                className="rounded-full"
                aria-label="New chat"
                title="New chat"
                onClick={() => void newChat()}
              >
                <NotePencilIcon />
              </Button>
            )}
          </div>
        )}
        {children}
      </main>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="left" className="flex w-80 flex-col p-0">
          <SheetTitle className="sr-only">Agents and chats</SheetTitle>
          <div className="flex items-center gap-3 border-b p-4 pr-12">
            <WorkspaceMenu workspace={workspace} me={me.user} side="bottom" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{workspace.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {agent === undefined ? "Pick an agent" : (agent.name ?? "New agent")}
              </p>
            </div>
            {agent === undefined ? null : <AgentFace agent={agent} className="size-9" still />}
          </div>
          {/* The agent's pages, two to a row so the list below keeps most of the sheet. */}
          {agent === undefined ? null : (
            <nav aria-label="Pages" className="grid grid-cols-2 gap-1 border-b p-2">
              {(
                [
                  // Short enough for half a sheet. Its page is still titled in full.
                  ["profile", "Identity", <UserCircleIcon key="i" />],
                  ["library", "Library", <FolderIcon key="i" />],
                  ["automations", "Automations", <ClockIcon key="i" />],
                  ["skills", "Skills", <LightningIcon key="i" />],
                  ["connectors", "Connectors", <PlugsIcon key="i" />],
                  ["computers", "Computers", <DesktopIcon key="i" />],
                  ["permissions", "Permissions", <ShieldCheckIcon key="i" />],
                  ["settings", "Settings", <GearIcon key="i" />],
                ] as const
              ).map(([path, label, icon]) => (
                <Link
                  key={path}
                  to={`/a/$agentId/${path}`}
                  params={{ agentId: agent.id }}
                  onClick={() => setSheetOpen(false)}
                  className={cn(
                    "flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 [&_svg]:size-4 [&_svg]:shrink-0",
                    page === path && "bg-accent text-foreground",
                  )}
                >
                  {icon}
                  <span className="truncate">{label}</span>
                </Link>
              ))}
            </nav>
          )}
          <div className="min-h-0 flex-1">
            <AgentList
              workspace={workspace}
              activeAgentId={agent?.id}
              meId={me.user.id}
              onNavigate={() => setSheetOpen(false)}
            />
          </div>
          <div className="border-t p-3">
            <Button variant="ghost" size="sm" onClick={signOut}>
              <SignOutIcon /> Sign out
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
