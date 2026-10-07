import type { AgentState } from "@durable-computer/client"
import type { AgentSummary, WorkspaceSummary } from "@durable-computer/protocol"
import {
  CaretDownIcon,
  CheckIcon,
  ListIcon,
  NotePencilIcon,
  SidebarSimpleIcon,
  SlidersHorizontalIcon,
} from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { eq, useLiveQuery } from "@tanstack/react-db"
import { Link, useNavigate, useParams } from "@tanstack/react-router"
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { agentPanelOpenAtom } from "@/lib/atoms"
import { client } from "@/lib/client"
import { agentKey, agentsCollection } from "@/lib/collections"
import { useSettings } from "@/lib/settings"
import { cn } from "@/lib/utils"
import { useHere, usePeople, whoIs } from "@/lib/workspaces"
import { ago, useNewChat } from "./agent-list.tsx"

/** The pages of an agent that are tabs: the things it is used for, as against how it is set up. */
export type AgentTab = "chat" | "library" | "automations"

/** The chat each agent was last on, so that its Chat tab goes back to it from another tab. */
const lastChat = new Map<string, string>()

const tab =
  "relative flex h-full shrink-0 items-center px-2.5 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 aria-[current=page]:text-foreground aria-[current=page]:after:absolute aria-[current=page]:after:inset-x-2 aria-[current=page]:after:bottom-0 aria-[current=page]:after:h-0.5 aria-[current=page]:after:rounded-full aria-[current=page]:after:bg-primary"

/**
 * The agent's name, which is also the way to another agent or another of its chats without
 * opening the sidebar.
 */
function AgentSwitcher({
  agent,
  workspace,
  state,
  chatId,
}: {
  agent: AgentSummary
  workspace: WorkspaceSummary
  state: AgentState | undefined
  chatId: string | undefined
}) {
  const navigate = useNavigate()
  const newChat = useNewChat(agent.id)
  const { data: agents } = useLiveQuery(
    (q) =>
      q
        .from({ agent: agentsCollection })
        .where(({ agent }) => eq(agent.workspaceId, workspace.id))
        .orderBy(({ agent }) => agent.createdAt, "asc"),
    [workspace.id],
  )
  const name = agent.name ?? "New agent"
  const recent = (state?.chats ?? [])
    .filter((chat) => chat.kind === "chat" && !chat.archived)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5)
  const now = Date.now()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${name}: another agent or chat`}
        title="Another agent or chat"
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
        {recent.length === 0 ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Recent chats with {name}</DropdownMenuLabel>
              {recent.map((chat) => (
                <DropdownMenuItem
                  key={chat.id}
                  onClick={() =>
                    navigate({
                      to: "/a/$agentId/c/$chatId",
                      params: { agentId: agent.id, chatId: chat.id },
                    })
                  }
                >
                  <span
                    className={cn("min-w-0 flex-1 truncate", chat.id === chatId && "font-medium")}
                  >
                    {chat.title}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {ago(chat.updatedAt, now)}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void newChat()}>
          <NotePencilIcon /> New chat
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The strip across the top of an agent's pages: which agent this is, its tabs, and at its end
 * who is here, the way into its settings, and the switch for its panel. It is the same on every
 * tab, so that changing tab changes only what is under it.
 */
export function AgentStrip({
  agent,
  workspace,
  page,
  sidebarOpen,
  onShowSidebar,
  onOpenSheet,
}: {
  agent: AgentSummary
  workspace: WorkspaceSummary
  page: AgentTab
  /** Whether the sidebar is beside this on a wide screen. */
  sidebarOpen: boolean
  onShowSidebar: () => void
  /** Opens the sidebar as a sheet, on a narrow screen. */
  onOpenSheet: () => void
}) {
  const { chatId } = useParams({ strict: false })
  const { openAgent } = useSettings()
  const newChat = useNewChat(agent.id)
  const [panel, setPanel] = useAtom(agentPanelOpenAtom)
  // Shares the layout's query, so this never fetches on its own.
  const { data: state } = useQuery<AgentState>({
    queryKey: agentKey(agent.id),
    queryFn: () => client.agent(agent.id).state(),
  })
  useEffect(() => {
    if (chatId !== undefined) lastChat.set(agent.id, chatId)
  }, [agent.id, chatId])
  const chat = state?.chats.find((entry) => entry.id === chatId)
  const back = lastChat.get(agent.id)

  const team = workspace.kind === "team"
  const here = useHere(team ? workspace.id : undefined)
  const people = usePeople(team ? workspace : undefined)
  const present =
    chatId === undefined
      ? []
      : whoIs(here, (place) => place.agentId === agent.id && place.chatId === chatId).flatMap(
          (id) => people.get(id) ?? [],
        )
  const name = agent.name ?? "New agent"

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-1.5 border-b px-2.5 md:h-13 md:flex-nowrap md:px-3">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Agents and chats"
        title="Agents and chats"
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
        <AgentSwitcher agent={agent} workspace={workspace} state={state} chatId={chatId} />
        {/* With the sidebar away, nothing else says which chat this is. */}
        {!sidebarOpen && page === "chat" && chat !== undefined ? (
          <>
            <span aria-hidden className="hidden text-muted-foreground md:inline">
              /
            </span>
            <span className="hidden max-w-60 min-w-0 truncate pr-1.5 text-sm md:inline">
              {chat.title}
            </span>
          </>
        ) : null}
        {/* The sidebar has this button too, so it is here only while the sidebar is away. */}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="New chat"
          title="New chat"
          className={cn("shrink-0 text-muted-foreground", sidebarOpen && "md:hidden")}
          onClick={() => void newChat()}
        >
          <NotePencilIcon />
        </Button>
      </div>
      <nav
        aria-label={`${name}'s pages`}
        className="order-last -mx-1 flex h-10 w-full items-stretch border-t md:order-none md:mx-0 md:ml-1.5 md:h-full md:w-auto md:border-t-0"
      >
        {back === undefined ? (
          <Link
            to="/a/$agentId"
            params={{ agentId: agent.id }}
            aria-current={page === "chat" ? "page" : undefined}
            className={tab}
          >
            Chat
          </Link>
        ) : (
          <Link
            to="/a/$agentId/c/$chatId"
            params={{ agentId: agent.id, chatId: back }}
            aria-current={page === "chat" ? "page" : undefined}
            className={tab}
          >
            Chat
          </Link>
        )}
        <Link
          to="/a/$agentId/library"
          params={{ agentId: agent.id }}
          search={{}}
          aria-current={page === "library" ? "page" : undefined}
          className={tab}
        >
          Library
        </Link>
        <Link
          to="/a/$agentId/automations"
          params={{ agentId: agent.id }}
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
          onClick={() => setPanel(!panel)}
        >
          <SidebarSimpleIcon className="-scale-x-100" />
        </Button>
      </div>
    </header>
  )
}
