import {
  type AgentSummary,
  avatarLook,
  personalWorkspaceId,
  type WorkspaceSummary,
} from "@do-computer/protocol"
import { ListIcon, SidebarSimpleIcon } from "@phosphor-icons/react"
import { useLocation, useParams, useRouteContext } from "@tanstack/react-router"
import { eq, useLiveQuery } from "@tanstack/react-db"
import { type PrimitiveAtom, useAtom, useAtomValue } from "jotai"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { Settings } from "@/components/settings/settings"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import {
  AGENT_PANEL_OPEN_KEY,
  agentPanelOpenAtom,
  SIDEBAR_OPEN_KEY,
  sidebarOpenAtom,
} from "@/lib/atoms"
import { agentsCollection } from "@/lib/collections"
import { sidebarColumn } from "@/lib/columns"
import { cn } from "@/lib/utils"
import { useSwipe } from "@/lib/use-swipe"
import { useFeed, useMarkSeen } from "@/lib/latest"
import { useListedAgent, usePresence, useWorkspaces } from "@/lib/workspaces"
import { AgentStrip, type AgentTab } from "./agent-strip.tsx"
import { ResizeHandle } from "./resize-handle.tsx"
import { Sidebar } from "./sidebar.tsx"

/** The width from which the sidebar is beside the page. Narrower, it is a sheet over it. */
const SIDEBAR_BESIDE = "(min-width: 48rem)"

/**
 * Something that is open or shut and stays the way it was left. Its atom starts as it was kept,
 * and it is written back when it changes.
 */
function useRemembered(atom: PrimitiveAtom<boolean>, key: string): [boolean, () => void] {
  const [open, setOpen] = useAtom(atom)
  const first = useRef(true)
  useEffect(() => {
    // Not on the first pass, when nothing has changed.
    if (first.current) {
      first.current = false
      return
    }
    try {
      localStorage.setItem(key, open ? "open" : "closed")
    } catch {
      // The choice then lasts for this page only.
    }
  }, [key, open])
  return [open, () => setOpen(!open)]
}

/** The workspace a page is in: the one named, else the agent's, else the user's own. */
function useCurrentWorkspace(
  me: { id: string; name: string; email: string; image?: string | null },
  agentId: string | undefined,
  workspaceId: string | undefined,
): { workspace: WorkspaceSummary; settled: boolean } {
  const state = useWorkspaces()
  const { data: found, isLoading } = useLiveQuery(
    (q) => q.from({ agent: agentsCollection }).where(({ agent }) => eq(agent.id, agentId ?? "")),
    [agentId],
  )
  const id = workspaceId ?? found?.[0]?.workspaceId ?? personalWorkspaceId(me.id)
  const workspace = useMemo(
    (): WorkspaceSummary =>
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
  // Which workspace an agent is in is only known once both lists are here. Until then the
  // sidebar holds its place, and does not name one workspace and then another.
  const settled =
    state !== undefined && (workspaceId !== undefined || agentId === undefined || !isLoading)
  return { workspace, settled }
}

/**
 * The frame around everything behind sign-in. One sidebar holds the user's agents; choosing
 * one opens its main chat. An agent's own pages are tabs in a strip above them, and
 * the settings are a window over whichever page is showing. Changing tab changes what is under
 * the strip and nothing else.
 */
export function AppShell({
  agentId,
  agent,
  workspaceId,
  children,
}: {
  /** The agent whose page this is. It is known from the address, before the agent itself is. */
  agentId?: string
  /** That agent, once the list of agents or its own state has it. */
  agent?: AgentSummary | undefined
  /** The team whose page this is, where the page is not an agent's. */
  workspaceId?: string
  children: ReactNode
}) {
  const { me } = useRouteContext({ from: "/_app" })
  const { chatId } = useParams({ strict: false })
  const { workspace, settled } = useCurrentWorkspace(me.user, agentId, workspaceId)
  usePresence(settled ? workspace.id : undefined, {
    agentId: agentId ?? null,
    chatId: chatId ?? null,
  })
  // What every agent is up to arrives as it happens, for the sidebar's rows.
  useFeed(me.user.id)
  // The agent on screen is being looked at. When that was last said is in the list of agents.
  const listed = useListedAgent(agentId)
  useMarkSeen(
    agentId,
    Math.max(agent?.latest?.at ?? 0, listed?.latest?.at ?? 0) || undefined,
    listed?.seenAt,
  )

  const [sidebarOpen, toggleSidebar] = useRemembered(sidebarOpenAtom, SIDEBAR_OPEN_KEY)
  const sidebarWidth = useAtomValue(sidebarColumn.width)
  // The panel's switch is in the strip, so what it was left as is kept from here.
  useRemembered(agentPanelOpenAtom, AGENT_PANEL_OPEN_KEY)
  const [sheetOpen, setSheetOpen] = useState(false)
  // On a narrow screen a finger also draws the sidebar out from the left, and pushes it back.
  const [shell, setShell] = useState<HTMLElement | null>(null)
  const [sheet, setSheet] = useState<HTMLElement | null>(null)
  useSwipe(shell, "right", () => {
    if (!matchMedia(SIDEBAR_BESIDE).matches) setSheetOpen(true)
  })
  useSwipe(sheet, "left", () => setSheetOpen(false))
  const page = useLocation({
    select: (location): AgentTab => {
      const last = location.pathname.split("/").at(-1)
      return last === "library" || last === "automations" ? last : "chat"
    },
  })

  return (
    <div ref={setShell} className="flex h-full min-h-0 bg-frame">
      {/* The accent follows the open agent. Set on the root, so windows and menus have it too. */}
      {agent === undefined ? null : (
        <style>{`:root{--agent-color:${avatarLook(agent.avatar, agent.id).color}}`}</style>
      )}
      {sidebarOpen ? (
        <aside className="relative hidden shrink-0 md:block" style={{ width: sidebarWidth }}>
          <Sidebar
            workspace={workspace}
            settled={settled}
            me={me.user}
            agentId={agentId}
            agent={agent}
            library={agentId !== undefined && page === "library"}
            onCollapse={toggleSidebar}
          />
          <ResizeHandle column={sidebarColumn} edge="right" label="Resize the sidebar" />
        </aside>
      ) : null}

      {/* The page is a sheet on the frame, where there is room for a frame around it. */}
      <main
        className={cn(
          "flex min-w-0 flex-1 flex-col bg-background md:my-2 md:mr-2 md:overflow-hidden md:rounded-2xl md:shadow-card",
          !sidebarOpen && "md:ml-2",
        )}
      >
        {agentId === undefined ? (
          // A workspace with no agent open has nothing for a strip to say but its name.
          <header className="flex h-13 shrink-0 items-center gap-1.5 px-2.5 md:px-3">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Agents"
              className="text-muted-foreground md:hidden"
              onClick={() => setSheetOpen(true)}
            >
              <ListIcon />
            </Button>
            {sidebarOpen ? null : (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Show the sidebar"
                title="Show the sidebar"
                className="hidden text-muted-foreground md:inline-flex"
                onClick={toggleSidebar}
              >
                <SidebarSimpleIcon />
              </Button>
            )}
            <span className="truncate px-1 text-[0.9375rem] font-semibold">
              {settled ? workspace.name : null}
            </span>
          </header>
        ) : (
          <AgentStrip
            agentId={agentId}
            agent={agent}
            workspace={workspace}
            page={page}
            sidebarOpen={sidebarOpen}
            onShowSidebar={toggleSidebar}
            onOpenSheet={() => setSheetOpen(true)}
          />
        )}
        <div className="relative min-h-0 flex-1">{children}</div>
      </main>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent ref={setSheet} side="left" className="w-80 p-0" showCloseButton={false}>
          <SheetTitle className="sr-only">Agents</SheetTitle>
          <Sidebar
            workspace={workspace}
            settled={settled}
            me={me.user}
            agentId={agentId}
            agent={agent}
            onNavigate={() => setSheetOpen(false)}
          />
        </SheetContent>
      </Sheet>

      <Settings
        workspace={workspace}
        me={me.user}
        admin={me.admin === true}
        waitlist={me.signup === "waitlist"}
        agentId={agentId}
      />
    </div>
  )
}
