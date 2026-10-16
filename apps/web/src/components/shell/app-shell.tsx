import {
  type AgentSummary,
  avatarLook,
  personalWorkspaceId,
  type WorkspaceSummary,
} from "@do-computer/protocol"
import { SidebarSimpleIcon } from "@phosphor-icons/react"
import { useLocation, useParams, useRouteContext } from "@tanstack/react-router"
import { eq, useLiveQuery } from "@tanstack/react-db"
import { type PrimitiveAtom, useAtom, useAtomValue } from "jotai"
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CallCard } from "@/components/call/call"
import { Settings } from "@/components/settings/settings"
import { Button } from "@/components/ui/button"
import {
  AGENT_PANEL_OPEN_KEY,
  agentPanelOpenAtom,
  SIDEBAR_OPEN_KEY,
  sidebarOpenAtom,
} from "@/lib/atoms"
import { agentsCollection } from "@/lib/collections"
import { sidebarColumn } from "@/lib/columns"
import { cn } from "@/lib/utils"
import { usePull } from "@/lib/use-swipe"
import { useMedia } from "@/lib/use-wide"
import { accentChanged } from "@/lib/visual-theme"
import { useFeed, useMarkSeen } from "@/lib/latest"
import { useListedAgent, usePresence, useWorkspaces } from "@/lib/workspaces"
import { AgentStrip, type AgentTab } from "./agent-strip.tsx"
import { ResizeHandle } from "./resize-handle.tsx"
import { Sidebar } from "./sidebar.tsx"

/**
 * The width from which the sidebar is beside the page at its own width, and can be hidden.
 * Narrower, it is always there: a column of faces beside the page, which is pulled open over it.
 */
const SIDEBAR_BESIDE = "(min-width: 48rem)"

/** How wide the column of faces is, in pixels. `w-14` and the `3.5rem` below are this. */
const RAIL = 56
/** How long the sidebar takes to open or shut on a narrow screen, in milliseconds. */
const PULL_MS = 200
/** How far a finger has to pull the sidebar for it to go the rest of the way, in pixels. */
const PULL_FAR = 40

/**
 * The sidebar of a narrow screen, which a finger pulls open and pushes shut. Shut, it is a
 * column of faces; open, it is the whole list, and the page has slid aside to make room. While
 * it is being pulled it follows the finger: its width is said on the shell itself, as `--pull`,
 * and not through React, which would draw the whole app again for every pixel.
 */
function usePulledSidebar(shell: HTMLElement | null) {
  const [open, setOpen] = useState(false)
  // Whether it is drawn as the whole list. It is while it is open, and while it is on its way.
  const [whole, setWhole] = useState(false)
  const shutting = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const settle = useCallback((next: boolean) => {
    clearTimeout(shutting.current)
    setOpen(next)
    if (next) setWhole(true)
    // It is faces only once it is as narrow as they are.
    else shutting.current = setTimeout(() => setWhole(false), PULL_MS)
  }, [])
  useEffect(() => () => clearTimeout(shutting.current), [])

  const from = useRef(RAIL)
  usePull(shell, {
    start: () => {
      if (shell === null || matchMedia(SIDEBAR_BESIDE).matches) return
      const aside = shell.querySelector<HTMLElement>("[data-pulled-sidebar]")
      from.current = aside?.getBoundingClientRect().width ?? RAIL
      clearTimeout(shutting.current)
      setWhole(true)
      shell.dataset.pulling = ""
    },
    move: (across) => {
      if (shell === null || shell.dataset.pulling === undefined) return
      const most = Math.min(320, shell.clientWidth - 48)
      const width = Math.min(most, Math.max(RAIL, from.current + across))
      shell.style.setProperty("--pull", `${width}px`)
      shell.style.setProperty("--pull-dim", String((width - RAIL) / (most - RAIL)))
    },
    end: (across) => {
      if (shell === null || shell.dataset.pulling === undefined) return
      delete shell.dataset.pulling
      shell.style.removeProperty("--pull")
      shell.style.removeProperty("--pull-dim")
      const was = from.current > RAIL + 1
      settle(Math.abs(across) < PULL_FAR ? was : across > 0)
    },
  })
  return { open, whole, settle }
}

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
  const beside = useMedia(SIDEBAR_BESIDE)
  const [shell, setShell] = useState<HTMLElement | null>(null)
  const pulled = usePulledSidebar(shell)
  const page = useLocation({
    select: (location): AgentTab => {
      const last = location.pathname.split("/").at(-1)
      return last === "library" || last === "automations" ? last : "chat"
    },
  })

  const accent = agent === undefined ? undefined : avatarLook(agent.avatar, agent.id).color
  // A page of the library that is on screen is in the app's colors, and is told this one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: said again whenever the color is another
  useEffect(accentChanged, [accent])

  return (
    <div ref={setShell} className="group/shell flex h-full min-h-0 overflow-x-clip bg-frame">
      {/* The accent follows the open agent. Set on the root, so windows and menus have it too. */}
      {accent === undefined ? null : <style>{`:root{--agent-color:${accent}}`}</style>}
      {!beside ? (
        // The whole list is laid out at its full width from the first of a pull, and what
        // is past the edge is cut off, so that nothing in it moves as the edge does.
        <aside
          data-pulled-sidebar=""
          data-open={pulled.open ? "" : undefined}
          className="w-[var(--pull,3.5rem)] shrink-0 overflow-hidden transition-[width] duration-200 ease-out group-data-pulling/shell:transition-none data-open:w-[var(--pull,min(20rem,100%-3rem))] motion-reduce:transition-none"
        >
          <Sidebar
            workspace={workspace}
            settled={settled}
            me={me.user}
            agentId={agentId}
            agent={agent}
            narrow={pulled.whole ? "open" : "rail"}
            onPull={() => pulled.settle(!pulled.open)}
            onNavigate={() => pulled.settle(false)}
            className={pulled.whole ? "w-[min(20rem,100vw-3rem)]" : "w-14"}
          />
        </aside>
      ) : sidebarOpen ? (
        <aside className="relative shrink-0" style={{ width: sidebarWidth }}>
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
          // Beside the faces it keeps its width whatever theirs, and slides out of the way.
          "relative flex w-[calc(100%-3.5rem)] shrink-0 flex-col overflow-hidden rounded-l-2xl bg-background shadow-card md:my-2 md:mr-2 md:w-auto md:min-w-0 md:flex-1 md:shrink md:rounded-2xl",
          !sidebarOpen && "md:ml-2",
        )}
      >
        {agentId === undefined ? (
          // A workspace with no agent open has nothing for a strip to say but its name.
          <header className="flex h-13 shrink-0 items-center gap-1.5 px-2.5 md:px-3">
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
          />
        )}
        <div className="relative min-h-0 flex-1">{children}</div>
        {/*
          Under the open sidebar the page is set back, and a touch on it shuts the sidebar. The
          mark at the top of the sidebar does the same, for whoever is not touching.
        */}
        {beside || !pulled.whole ? null : (
          <div
            aria-hidden
            data-open={pulled.open ? "" : undefined}
            onClick={() => pulled.settle(false)}
            className="pointer-events-none absolute inset-0 z-40 bg-frame opacity-[var(--pull-dim,0)] transition-opacity duration-200 group-data-pulling/shell:transition-none data-open:pointer-events-auto data-open:opacity-[var(--pull-dim,0.6)] motion-reduce:transition-none"
          />
        )}
      </main>

      {/* A call goes on whichever page is open, and is here when its Dood is not on screen. */}
      <CallCard />

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
