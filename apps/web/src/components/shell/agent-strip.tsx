import type { AgentSummary, WorkspaceSummary } from "@durable-computer/protocol"
import {
  CaretDownIcon,
  CheckIcon,
  ListIcon,
  SidebarSimpleIcon,
  SlidersHorizontalIcon,
} from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { eq, useLiveQuery } from "@tanstack/react-db"
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router"
import { useAtom } from "jotai"
import { useEffect } from "react"
import { AgentFace } from "@/components/agent-avatar"
import { FaceStack } from "@/components/people"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { agentPanelOpenAtom } from "@/lib/atoms"
import { Skeleton } from "@/components/ui/skeleton"
import { agentQuery, agentsCollection } from "@/lib/collections"
import { useSettings } from "@/lib/settings"
import { cn } from "@/lib/utils"
import { useHere, usePeople, whoIs } from "@/lib/workspaces"
import { SideChats } from "./side-chats.tsx"

/** The pages of an agent that are tabs: the things it is used for, as against how it is set up. */
export type AgentTab = "chat" | "library" | "automations"

/**
 * The chat each agent was last on, so that its Chat tab goes back to it from another tab. With
 * none to go back to, the tab opens the main chat.
 */
const lastChat = new Map<string, string>()

const tab =
  "relative flex h-full shrink-0 items-center px-2.5 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 aria-[current=page]:text-foreground aria-[current=page]:after:absolute aria-[current=page]:after:inset-x-2 aria-[current=page]:after:bottom-0 aria-[current=page]:after:h-0.5 aria-[current=page]:after:rounded-full aria-[current=page]:after:bg-primary"

/** The agent's name, which is also the way to another agent without opening the sidebar. */
function AgentSwitcher({ agent, workspace }: { agent: AgentSummary; workspace: WorkspaceSummary }) {
  const navigate = useNavigate()
  const { data: agents } = useLiveQuery(
    (q) =>
      q
        .from({ agent: agentsCollection })
        .where(({ agent }) => eq(agent.workspaceId, workspace.id))
        .orderBy(({ agent }) => agent.createdAt, "asc"),
    [workspace.id],
  )
  const name = agent.name ?? "New agent"
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${name}: another agent`}
        title="Another agent"
        className="flex min-w-0 items-center gap-2 rounded-xl py-1 pr-2 pl-1 outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/40 aria-expanded:bg-accent"
      >
        <AgentFace agent={agent} className="size-7" still />
        <span className="min-w-0 truncate text-[0.9375rem] font-semibold">{name}</span>
        <CaretDownIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" className="w-76">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Agents in {workspace.name}</DropdownMenuLabel>
          {(agents ?? [agent]).map((entry) => (
            <DropdownMenuItem
              key={entry.id}
              onClick={() => navigate({ to: "/a/$agentId", params: { agentId: entry.id } })}
            >
              <AgentFace agent={entry} className="size-7" still />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{entry.name ?? "New agent"}</span>
                {entry.tagline ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    {entry.tagline}
                  </span>
                ) : null}
              </span>
              {entry.id === agent.id ? <CheckIcon className="size-4" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The strip across the top of an agent's pages: which agent this is, its tabs, and at its end
 * who is here, its side chats, the way into its settings, and the switch for its panel. It is the same on every
 * tab, so that changing tab changes only what is under it.
 */
export function AgentStrip({
  agentId,
  agent,
  workspace,
  page,
  sidebarOpen,
  onShowSidebar,
  onOpenSheet,
}: {
  /** The agent whose pages these are. The address says so before the agent itself is here. */
  agentId: string
  /** That agent. Until it is here its name holds its place, and the tabs already work. */
  agent: AgentSummary | undefined
  workspace: WorkspaceSummary
  page: AgentTab
  /** Whether the sidebar is beside this on a wide screen. */
  sidebarOpen: boolean
  onShowSidebar: () => void
  /** Opens the sidebar as a sheet, on a narrow screen. */
  onOpenSheet: () => void
}) {
  const { chatId } = useParams({ strict: false })
  const { side } = useSearch({ strict: false })
  const navigate = useNavigate()
  const { openAgent } = useSettings()
  const [wanted, setPanel] = useAtom(agentPanelOpenAtom)
  // A side chat beside the main chat is where the panel would be.
  const panel = wanted && side === undefined
  // Shares the layout's query, so this never fetches on its own.
  const { data: state } = useQuery(agentQuery(agentId))
  useEffect(() => {
    if (chatId !== undefined) lastChat.set(agentId, chatId)
  }, [agentId, chatId])
  const back = lastChat.get(agentId)

  const team = workspace.kind === "team"
  const here = useHere(team ? workspace.id : undefined)
  const people = usePeople(team ? workspace : undefined)
  const present =
    chatId === undefined
      ? []
      : whoIs(here, (place) => place.agentId === agentId && place.chatId === chatId).flatMap(
          (id) => people.get(id) ?? [],
        )
  const name = agent?.name ?? "New agent"

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-1.5 border-b px-2.5 md:h-13 md:flex-nowrap md:px-3">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Agents"
        title="Agents"
        className="text-muted-foreground md:hidden"
        onClick={onOpenSheet}
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
          onClick={onShowSidebar}
        >
          <SidebarSimpleIcon />
        </Button>
      )}
      <div className="flex h-12 min-w-0 items-center gap-1.5 md:h-full">
        {agent === undefined ? (
          <div data-loading aria-busy="true" className="flex items-center gap-2 py-1 pr-2 pl-1">
            <Skeleton className="size-7 rounded-full" />
            <Skeleton className="h-3 w-20 rounded-full" />
          </div>
        ) : (
          <AgentSwitcher agent={agent} workspace={workspace} />
        )}
      </div>
      <nav
        aria-label={agent === undefined ? "Pages" : `${name}'s pages`}
        className="order-last -mx-1 flex h-10 w-full items-stretch border-t md:order-none md:mx-0 md:ml-1.5 md:h-full md:w-auto md:border-t-0"
      >
        {back === undefined ? (
          <Link
            to="/a/$agentId"
            params={{ agentId }}
            aria-current={page === "chat" ? "page" : undefined}
            className={tab}
          >
            Chat
          </Link>
        ) : (
          <Link
            to="/a/$agentId/c/$chatId"
            params={{ agentId, chatId: back }}
            aria-current={page === "chat" ? "page" : undefined}
            className={tab}
          >
            Chat
          </Link>
        )}
        <Link
          to="/a/$agentId/library"
          params={{ agentId }}
          search={{}}
          aria-current={page === "library" ? "page" : undefined}
          className={tab}
        >
          Library
        </Link>
        <Link
          to="/a/$agentId/automations"
          params={{ agentId }}
          aria-current={page === "automations" ? "page" : undefined}
          className={tab}
        >
          Automations
        </Link>
      </nav>
      <div className="ml-auto flex items-center gap-0.5">
        {page === "chat" && present.length > 0 ? (
          <span className="pr-1.5">
            <FaceStack people={present} className="size-6.5" max={4} />
          </span>
        ) : null}
        {agent === undefined ? null : (
          <>
            <SideChats agent={agent} workspace={workspace} state={state} />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`${name}'s settings`}
              title={`${name}'s settings`}
              className="text-muted-foreground"
              onClick={() => openAgent("identity")}
            >
              <SlidersHorizontalIcon />
            </Button>
          </>
        )}
        {/* The panel is only ever beside a page where there is room for both. */}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={panel ? `Hide ${name}'s panel` : `Show ${name}'s panel`}
          aria-pressed={panel}
          title={panel ? `Hide ${name}` : `Show ${name}`}
          className={cn(
            "hidden xl:inline-flex",
            panel ? "text-foreground" : "text-muted-foreground",
          )}
          onClick={() => {
            setPanel(!panel)
            // The side chat makes way for the panel.
            if (side !== undefined && chatId !== undefined) {
              void navigate({
                to: "/a/$agentId/c/$chatId",
                params: { agentId, chatId },
              })
            }
          }}
        >
          <SidebarSimpleIcon className="-scale-x-100" />
        </Button>
      </div>
    </header>
  )
}
