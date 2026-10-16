import {
  type AgentSummary,
  avatarLook,
  personalWorkspaceId,
  type WorkspaceSummary,
} from "@do-computer/protocol"
import { useLocation, useParams, useRouteContext } from "@tanstack/react-router"
import { eq, useLiveQuery } from "@tanstack/react-db"
import { type PrimitiveAtom, useAtom, useAtomValue } from "jotai"
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CallCard } from "@/components/call/call"
import { Settings } from "@/components/settings/settings"
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
import { DoodsButton } from "./agent-list.tsx"
import { AgentStrip, type AgentTab } from "./agent-strip.tsx"
import { ResizeHandle } from "./resize-handle.tsx"
import { Sidebar } from "./sidebar.tsx"

/**
 * The width from which the sidebar is beside the page: a column of faces, which its edge is
 * dragged out from into the whole list, and back. Narrower, there is no room to give it, and it
 * is out of sight until a finger pulls it across the page.
 */
const SIDEBAR_BESIDE = "(min-width: 48rem)"

/** How wide the column of faces is, in pixels. */
const FACES = 56
/** How wide the sidebar of a narrow screen is while it is shut: it is not there. */
const RAIL = 0
/** How long the sidebar takes to open or shut on a narrow screen, in milliseconds. */
const PULL_MS = 200
/** How far a finger has to pull the sidebar for it to go the rest of the way, in pixels. */
const PULL_FAR = 40

/**
 * The sidebar of a narrow screen, which a finger pulls open and pushes shut. Shut, it is out of
 * sight; open, it is the whole list, and the page has slid aside to make room. While
 * it is being pulled it follows the finger: its width is said on the shell itself, as `--pull`,
 * and not through React, which would draw the whole app again for every pixel.
 */
function usePulledSidebar(shell: HTMLElement | null) {
  const [open, setOpen] = useState(false)
  // Whether it is drawn at all. It is while it is open, and while it is on its way.
  const [whole, setWhole] = useState(false)
  const shutting = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const settle = useCallback((next: boolean) => {
    clearTimeout(shutting.current)
    setOpen(next)
    if (next) setWhole(true)
    // It is gone only once it has shut.
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
function useRemembered(
  atom: PrimitiveAtom<boolean>,
  key: string,
): [boolean, (open: boolean) => void] {
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
  return [open, setOpen]
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
 * The frame around everything behind sign-in. One sidebar holds the user's agents, as a column
 * of faces until it is opened out; choosing one opens its main chat. An agent's own pages are
 * reached from its name above them, and the settings are a window over whichever page is
 * showing. Changing page changes what is under the name and nothing else.
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

  const [sidebarOpen, setSidebarOpen] = useRemembered(sidebarOpenAtom, SIDEBAR_OPEN_KEY)
  const sidebarWidth = useAtomValue(sidebarColumn.width)
  // The panel's switch is in the menu on the agent's name, so what it was left as is kept from here.
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
          className="w-[var(--pull,0px)] shrink-0 overflow-hidden transition-[width] duration-200 ease-out group-data-pulling/shell:transition-none data-open:w-[var(--pull,min(20rem,100%-3rem))] motion-reduce:transition-none"
        >
          {pulled.whole ? (
            <Sidebar
              workspace={workspace}
              settled={settled}
              me={me.user}
              agentId={agentId}
              drawn="open"
              onPull={() => pulled.settle(false)}
              onNavigate={() => pulled.settle(false)}
              className="w-[min(20rem,100vw-3rem)]"
            />
          ) : null}
        </aside>
      ) : (
        <aside
          // As faces it is wider under a window with no title bar, whose buttons lie over it.
          className={cn("relative shrink-0", !sidebarOpen && "w-14 inset:w-19")}
          style={sidebarOpen ? { width: sidebarWidth } : undefined}
        >
          <Sidebar
            workspace={workspace}
            settled={settled}
            me={me.user}
            agentId={agentId}
            drawn={sidebarOpen ? "open" : "rail"}
            onPull={() => setSidebarOpen(!sidebarOpen)}
          />
          {/* Its edge is the way to open it and to shut it, and says so only by the pointer. */}
          <ResizeHandle
            column={sidebarColumn}
            edge="right"
            label="Resize the sidebar"
            shut={{ is: !sidebarOpen, width: FACES, set: (shut) => setSidebarOpen(!shut) }}
            quiet
          />
        </aside>
      )}

      {/* The page is flat against the sidebar, with a hairline between the two. */}
      <main className="relative flex w-full shrink-0 flex-col overflow-hidden bg-background md:w-auto md:min-w-0 md:flex-1 md:shrink md:border-l md:border-hairline">
        {agentId === undefined ? (
          // A workspace with no agent open has nothing to say above its page but its name.
          <header
            data-title-drag=""
            className="flex h-13 shrink-0 items-center gap-1.5 px-2.5 inset:max-md:pl-20 md:px-3"
          >
            {beside ? null : <DoodsButton meId={me.user.id} onClick={() => pulled.settle(true)} />}
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
            meId={me.user.id}
            onShowSidebar={beside ? undefined : () => pulled.settle(true)}
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
