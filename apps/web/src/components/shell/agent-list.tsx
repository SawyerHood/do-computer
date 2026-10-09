import type { AgentState } from "@durable-computer/client"
import {
  type AgentSummary,
  isPersonalWorkspace,
  type Person,
  type Presence,
  type WorkspaceSummary,
} from "@durable-computer/protocol"
import {
  ClockIcon,
  DotsThreeIcon,
  FolderIcon,
  PlusIcon,
  SlidersHorizontalIcon,
} from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { eq, useLiveQuery } from "@tanstack/react-db"
import { AgentFace } from "@/components/agent-avatar"
import { useRunningJobs, waitingWords } from "@/components/chat/commands"
import { FaceStack, PersonFace } from "@/components/people"
import { AgentRowsPlaceholder } from "@/components/placeholders"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { client } from "@/lib/client"
import { agentKey, agentsCollection } from "@/lib/collections"
import { useSettings } from "@/lib/settings"
import { cn } from "@/lib/utils"
import { useHere, usePeople, whoIs } from "@/lib/workspaces"

const day = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" })
const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" })

/** When something last happened, in as few characters as say it: now, 4m, 1h, Tue, Sep 28. */
export function ago(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000)
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h`
  if (minutes < 7 * 24 * 60) return weekday.format(at)
  return day.format(at)
}

/** Makes an agent in a workspace and opens it. */
export function useNewAgent(workspaceId: string, onNavigate?: () => void) {
  const navigate = useNavigate()
  return async () => {
    const created = await client.createAgent(workspaceId)
    await agentsCollection.utils.refetch()
    onNavigate?.()
    await navigate({ to: "/a/$agentId", params: { agentId: created.id } })
  }
}

/** Where someone is, in words: the agent they are with, and the side chat if they are in one. */
function WhereWords({ place, agents }: { place: Presence; agents: readonly AgentSummary[] }) {
  // Read from what is already loaded. A chat list nobody has opened is not fetched for this.
  const { data: state } = useQuery<AgentState>({
    queryKey: agentKey(place.agentId ?? ""),
    queryFn: () => client.agent(place.agentId!).state(),
    enabled: false,
  })
  const agent = agents.find((entry) => entry.id === place.agentId)
  if (agent === undefined) return <>Looking around</>
  const chat = state?.chats.find((entry) => entry.id === place.chatId)
  const parent =
    chat?.parentId === undefined
      ? undefined
      : state?.chats.find((entry) => entry.id === chat.parentId)
  const name = agent.name ?? "New agent"
  // In the main chat they are simply with the agent.
  if (chat === undefined || chat.main === true) return <>{name}</>
  return (
    <>
      {name} ·{" "}
      {parent === undefined || parent.main === true
        ? chat.title
        : `${parent.title} › ${chat.title}`}
    </>
  )
}

/** Who else in the team is here right now, and where. */
function WhoIsWhere({
  workspace,
  here,
  people,
  agents,
  meId,
  onNavigate,
}: {
  workspace: WorkspaceSummary
  here: readonly Presence[]
  people: Map<string, Person>
  agents: readonly AgentSummary[]
  meId: string
  onNavigate?: (() => void) | undefined
}) {
  const { openWorkspace } = useSettings()
  // One line a person: the place they are writing in, else the first that names a chat.
  const others = whoIs(here, (place) => place.userId !== meId).map((userId) => {
    const places = here.filter((place) => place.userId === userId)
    return (
      places.find((place) => place.typing) ??
      places.find((place) => place.chatId !== null) ??
      places[0]!
    )
  })
  return (
    <section aria-label={`Who is in ${workspace.name}`} className="border-t px-3 pt-3 pb-3.5">
      <button
        type="button"
        onClick={() => {
          onNavigate?.()
          openWorkspace("team")
        }}
        className="flex w-full items-baseline justify-between rounded-md px-1 pb-1.5 text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
      >
        <span className="truncate">{workspace.name}</span>
        <span className="shrink-0">{others.length} here</span>
      </button>
      {others.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground">Nobody else is here right now.</p>
      ) : (
        <ul className="flex max-h-44 flex-col overflow-y-auto">
          {others.map((place) => {
            const person = people.get(place.userId)
            if (person === undefined) return null
            const row = (
              <>
                <PersonFace person={person} here className="size-6" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{person.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    <WhereWords place={place} agents={agents} />
                  </span>
                </span>
              </>
            )
            const className =
              "flex items-center gap-2.5 rounded-lg px-1 py-1 outline-none [--face-ring:var(--rail)] hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/40"
            return (
              <li key={place.userId}>
                {place.agentId !== null && place.chatId !== null ? (
                  // Go to where they are.
                  <Link
                    to="/a/$agentId/c/$chatId"
                    params={{ agentId: place.agentId, chatId: place.chatId }}
                    onClick={onNavigate}
                    className={className}
                  >
                    {row}
                  </Link>
                ) : (
                  <div className={className}>{row}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/**
 * The list in the sidebar: the workspace's agents, and nothing under them. Choosing one is
 * talking to it: it opens the agent's main chat. Its side chats are reached from its strip. In
 * a team the list also says who is where.
 */
export function AgentList({
  workspace,
  pending = false,
  activeAgentId,
  meId,
  onNavigate,
}: {
  workspace: WorkspaceSummary
  /** Which workspace this is has not settled yet, so neither has whose agents these are. */
  pending?: boolean
  activeAgentId: string | undefined
  meId: string
  onNavigate?: () => void
}) {
  const { data: agents, isLoading } = useLiveQuery(
    (q) =>
      q
        .from({ agent: agentsCollection })
        .where(({ agent }) => eq(agent.workspaceId, workspace.id))
        .orderBy(({ agent }) => agent.createdAt, "asc"),
    [workspace.id],
  )
  const team = !isPersonalWorkspace(workspace.id)
  const here = useHere(workspace.id)
  const people = usePeople(workspace)
  const newAgent = useNewAgent(workspace.id, onNavigate)
  const loading = pending || isLoading
  const list = loading ? [] : (agents ?? [])
  // What the agent on screen left running, wherever in its chats it did.
  const waiting = waitingWords(useRunningJobs(activeAgentId), true)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-0.5 pt-2 pr-2.5 pb-1.5 pl-4">
        <h2 className="min-w-0 flex-1 truncate text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
          Agents
        </h2>
        <Button variant="ghost" size="icon-sm" onClick={newAgent} aria-label="New agent">
          <PlusIcon />
        </Button>
      </div>
      <nav
        aria-label="Agents"
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3"
      >
        {loading ? <AgentRowsPlaceholder /> : null}
        {list.map((agent) => {
          const with_ = whoIs(
            here,
            (place) => place.agentId === agent.id && place.userId !== meId,
          ).flatMap((id) => people.get(id) ?? [])
          const name = agent.name ?? "New agent"
          const active = agent.id === activeAgentId
          return (
            <div
              key={agent.id}
              className={cn(
                "group/agent flex shrink-0 items-center rounded-2xl [--face-ring:var(--rail)] hover:bg-accent",
                active && "bg-accent",
              )}
            >
              <Link
                to="/a/$agentId"
                params={{ agentId: agent.id }}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl py-2 pr-1 pl-2.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
              >
                <AgentFace agent={agent} className="size-10" quiet />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.90625rem] font-medium">{name}</span>
                  {team ? (
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <FaceStack people={with_} className="size-4" />
                      {with_.length === 0 ? "Quiet" : `${with_.length} here`}
                    </span>
                  ) : active && waiting !== undefined ? (
                    <span
                      title="Waiting on something it left running"
                      className="flex items-center gap-1 text-xs text-muted-foreground"
                    >
                      <span className="min-w-0 truncate">{waiting}</span>
                      <ClockIcon className="size-3 shrink-0" />
                    </span>
                  ) : agent.tagline ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {agent.tagline}
                    </span>
                  ) : null}
                </span>
              </Link>
              <AgentMenu agent={agent} onNavigate={onNavigate} />
            </div>
          )
        })}
        {!loading && agents !== undefined && list.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">
            {team ? "This team has no agents yet." : "You have no agents yet."}
          </p>
        ) : null}
      </nav>
      {/* Only while someone else is about. The faces at the top of the sidebar say so too. */}
      {team && whoIs(here, (place) => place.userId !== meId).length > 0 ? (
        <WhoIsWhere
          workspace={workspace}
          here={here}
          people={people}
          agents={list}
          meId={meId}
          onNavigate={onNavigate}
        />
      ) : null}
    </div>
  )
}

/** An agent's own pages, from its row: the same ones its strip has once it is open. */
function AgentMenu({
  agent,
  onNavigate,
}: {
  agent: AgentSummary
  onNavigate?: (() => void) | undefined
}) {
  const navigate = useNavigate()
  const name = agent.name ?? "New agent"
  const go = (to: "/a/$agentId/library" | "/a/$agentId/automations") => () => {
    onNavigate?.()
    void navigate({ to, params: { agentId: agent.id } })
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${name}'s pages`}
        title={`${name}'s pages`}
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            className="mr-1.5 size-7 text-muted-foreground opacity-0 group-hover/agent:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 [@media(hover:none)]:opacity-100"
          />
        }
      >
        <DotsThreeIcon weight="bold" className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" className="w-48">
        <DropdownMenuItem onClick={go("/a/$agentId/library")}>
          <FolderIcon /> Library
        </DropdownMenuItem>
        <DropdownMenuItem onClick={go("/a/$agentId/automations")}>
          <ClockIcon /> Automations
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            onNavigate?.()
            void navigate({
              to: "/a/$agentId",
              params: { agentId: agent.id },
              search: { settings: "identity" },
            })
          }}
        >
          <SlidersHorizontalIcon /> Settings
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
