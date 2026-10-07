import {
  type AgentSummary,
  avatarLook,
  personalWorkspaceId,
  type WorkspaceSummary,
} from "@durable-computer/protocol"
import { ListIcon, SidebarSimpleIcon } from "@phosphor-icons/react"
import { useLocation, useParams, useRouteContext } from "@tanstack/react-router"
import { eq, useLiveQuery } from "@tanstack/react-db"
import { type PrimitiveAtom, useAtom, useAtomValue } from "jotai"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { AgentSettings } from "@/components/settings/agent-settings"
import { WorkspaceSettings } from "@/components/settings/workspace-settings"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { agentPanelOpenAtom, sidebarOpenAtom } from "@/lib/atoms"
import { agentsCollection } from "@/lib/collections"
import { sidebarColumn } from "@/lib/columns"
import { usePresence, useWorkspaces } from "@/lib/workspaces"
import { AgentStrip, type AgentTab } from "./agent-strip.tsx"
import { ResizeHandle } from "./resize-handle.tsx"
import { Sidebar } from "./sidebar.tsx"

/**
 * Something that is open or shut and stays the way it was left: read from storage once, and
 * written back when it changes. Until it has been set either way it is as its atom starts.
 */
function useRemembered(atom: PrimitiveAtom<boolean>, key: string): [boolean, () => void] {
  const [open, setOpen] = useAtom(atom)
  const read = useRef(false)
  useEffect(() => {
    try {
      const kept = localStorage.getItem(key)
      if (kept === "open") setOpen(true)
      if (kept === "closed") setOpen(false)
    } catch {
      // Storage can be unavailable; it is then as it starts.
    }
  }, [key, setOpen])
  useEffect(() => {
    // Not on the first pass, which would write the starting value over what was kept.
    if (!read.current) {
      read.current = true
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
 * The frame around everything behind sign-in. One sidebar holds the workspace and its agents;
 * choosing one opens its main chat. An agent's own pages are tabs in a strip above them, and its settings and the
 * workspace's are windows over whichever page is showing. Changing tab changes what is under
 * the strip and nothing else.
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
  const { me } = useRouteContext({ from: "/_app" })
  const { chatId } = useParams({ strict: false })
  const workspace = useCurrentWorkspace(me.user, agent?.id, workspaceId)
  usePresence(workspace.id, { agentId: agent?.id ?? null, chatId: chatId ?? null })

  const [sidebarOpen, toggleSidebar] = useRemembered(sidebarOpenAtom, "dc-chat-list")
  const sidebarWidth = useAtomValue(sidebarColumn.width)
  // The panel's switch is in the strip, so what it was left as is kept from here.
  useRemembered(agentPanelOpenAtom, "dc-agent-panel")
  const [sheetOpen, setSheetOpen] = useState(false)
  const page = useLocation({
    select: (location): AgentTab => {
      const last = location.pathname.split("/").at(-1)
      return last === "library" || last === "automations" ? last : "chat"
    },
  })

  return (
    <div className="flex h-dvh min-h-0">
      {/* The accent follows the open agent. Set on the root, so windows and menus have it too. */}
      {agent === undefined ? null : (
        <style>{`:root{--agent-color:${avatarLook(agent.avatar, agent.id).color}}`}</style>
      )}
      {sidebarOpen ? (
        <aside
          className="relative hidden shrink-0 border-r bg-rail/60 md:block"
          style={{ width: sidebarWidth }}
        >
          <Sidebar
            workspace={workspace}
            me={me.user}
            agent={agent}
            library={agent !== undefined && page === "library"}
            onCollapse={toggleSidebar}
          />
          <ResizeHandle column={sidebarColumn} edge="right" label="Resize the sidebar" />
        </aside>
      ) : null}

      <main className="flex min-w-0 flex-1 flex-col">
        {agent === undefined ? (
          // A workspace with no agent open has nothing for a strip to say but its name.
          <header className="flex h-13 shrink-0 items-center gap-1.5 border-b px-2.5 md:px-3">
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
            <span className="truncate px-1 text-[0.9375rem] font-semibold">{workspace.name}</span>
          </header>
        ) : (
          <AgentStrip
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
        <SheetContent side="left" className="w-80 p-0" showCloseButton={false}>
          <SheetTitle className="sr-only">Agents</SheetTitle>
          <Sidebar
            workspace={workspace}
            me={me.user}
            agent={agent}
            onNavigate={() => setSheetOpen(false)}
          />
        </SheetContent>
      </Sheet>

      {agent === undefined ? null : <AgentSettings agent={agent} />}
      <WorkspaceSettings workspace={workspace} me={me.user} agentId={agent?.id} />
    </div>
  )
}
