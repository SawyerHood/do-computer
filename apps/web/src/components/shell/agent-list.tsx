import type { AgentSummary, Person, WorkspaceSummary } from "@durable-computer/protocol"
import {
  CaretDownIcon,
  ClockIcon,
  DotsThreeIcon,
  FolderIcon,
  PlusIcon,
  SlidersHorizontalIcon,
} from "@phosphor-icons/react"
import { Link, useNavigate } from "@tanstack/react-router"
import { useLiveQuery } from "@tanstack/react-db"
import { useAtom } from "jotai"
import { AgentFace } from "@/components/agent-avatar"
import { useRunningJobs, waitingWords } from "@/components/chat/commands"
import { FaceStack, names } from "@/components/people"
import { AgentRowsPlaceholder } from "@/components/placeholders"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { foldedWorkspacesAtom } from "@/lib/atoms"
import { client } from "@/lib/client"
import { agentsCollection } from "@/lib/collections"
import { settingsAddress, useSettings } from "@/lib/settings"
import { cn } from "@/lib/utils"
import { useHere, usePeople, useWorkspaces, whoIs } from "@/lib/workspaces"
import { MoreWorkspaces, WorkspaceMark, WorkspaceMenu } from "./workspace-menu.tsx"

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

type Me = { id: string; name: string; image?: string | null }

/**
 * The list in the sidebar: agents, and nothing under them. Choosing one is talking to it: it
 * opens the agent's main chat. Its side chats are reached from its strip. Someone who is in a
 * team has every workspace of theirs here at once, each under a heading that folds; someone who
 * is not has only their own agents, and no headings.
 */
export function AgentList({
  workspace,
  pending = false,
  activeAgentId,
  me,
  onNavigate,
}: {
  /** The workspace of the page that is open. */
  workspace: WorkspaceSummary
  /** Which workspace that is has not settled yet, so neither has whose agents these are. */
  pending?: boolean
  activeAgentId: string | undefined
  me: Me
  onNavigate?: () => void
}) {
  const { data: agents, isLoading } = useLiveQuery((q) =>
    q.from({ agent: agentsCollection }).orderBy(({ agent }) => agent.createdAt, "asc"),
  )
  const loading = pending || isLoading
  // What the agent on screen left running, wherever in its chats it did.
  const waiting = waitingWords(useRunningJobs(activeAgentId), true)
  const [folded, fold] = useAtom(foldedWorkspacesAtom)
  // Until the workspaces are here, only the one on screen is known of.
  const workspaces = useWorkspaces()?.workspaces ?? [workspace]
  const sectioned = workspaces.some((entry) => entry.kind === "team")

  return (
    <nav
      aria-label="Agents"
      className="flex h-full min-h-0 flex-col gap-0.5 overflow-y-auto px-2 pb-3"
    >
      {loading ? (
        <>
          <div className="flex h-9 shrink-0 items-center">
            <h2 className="text-[0.8125rem] font-medium text-muted-foreground">Agents</h2>
          </div>
          <AgentRowsPlaceholder />
        </>
      ) : (
        <>
          {(sectioned ? workspaces : [workspace]).map((entry) => (
            <Section
              key={entry.id}
              workspace={entry}
              agents={(agents ?? []).filter((agent) => agent.workspaceId === entry.id)}
              named={sectioned}
              current={entry.id === workspace.id}
              folded={sectioned && folded.includes(entry.id)}
              onFold={() => fold(entry.id)}
              activeAgentId={activeAgentId}
              waiting={waiting}
              me={me}
              onNavigate={onNavigate}
            />
          ))}
          <MoreWorkspaces me={me} onNavigate={onNavigate} />
        </>
      )}
    </nav>
  )
}

/**
 * One workspace's agents. Under its name where there is more than one workspace to tell apart,
 * which also folds them away; under "Agents" where there is not.
 */
function Section({
  workspace,
  agents,
  named,
  current,
  folded,
  onFold,
  activeAgentId,
  waiting,
  me,
  onNavigate,
}: {
  workspace: WorkspaceSummary
  agents: readonly AgentSummary[]
  /** There are several workspaces, so this one is under its name. */
  named: boolean
  /** The page that is open is in this workspace. */
  current: boolean
  folded: boolean
  onFold: () => void
  activeAgentId: string | undefined
  /** What the agent on screen is waiting on that it left running, in words. */
  waiting: string | undefined
  me: Me
  onNavigate?: (() => void) | undefined
}) {
  const { open: openSettings } = useSettings()
  const team = workspace.kind === "team"
  // Who is where is only known for the team that is on screen.
  const here = useHere(workspace.id)
  const people = usePeople(workspace)
  const others = whoIs(here, (place) => place.userId !== me.id).flatMap(
    (id) => people.get(id) ?? [],
  )
  const newAgent = useNewAgent(workspace.id, onNavigate)

  return (
    <section
      aria-label={named ? workspace.name : "Agents"}
      data-current={current ? "" : undefined}
      className="flex shrink-0 flex-col gap-0.5 not-first:mt-2"
    >
      {/* Flush with the rows under it: its ends are where the chosen row's are. */}
      <div className="flex h-9 items-center gap-0.5 [--face-ring:var(--frame)]">
        {named ? (
          <button
            type="button"
            aria-expanded={!folded}
            onClick={onFold}
            className="flex min-w-0 items-center gap-1.5 rounded-md py-1 pr-1 text-[0.8125rem] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            <WorkspaceMark workspace={workspace} me={me} className="size-4" />
            <span className="truncate">{workspace.name}</span>
            <CaretDownIcon
              aria-hidden
              className={cn("size-3 shrink-0 transition-transform", folded && "-rotate-90")}
            />
          </button>
        ) : (
          <h2 className="truncate text-[0.8125rem] font-medium text-muted-foreground">Agents</h2>
        )}
        <span className="min-w-1 flex-1" />
        {folded ? (
          // Folded, it still says who is in there.
          <span className="flex shrink-0 items-center -space-x-1 pr-0.5">
            {agents.slice(0, 3).map((agent) => (
              <AgentFace key={agent.id} agent={agent} className="size-5" still />
            ))}
          </span>
        ) : (
          <>
            {others.length > 0 ? (
              <button
                type="button"
                aria-label={`${others.length} here now: ${names(others)}`}
                title={`Here now: ${names(others)}`}
                onClick={() => {
                  onNavigate?.()
                  openSettings({ at: "workspace", workspaceId: workspace.id, section: "people" })
                }}
                className="mr-0.5 flex shrink-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
              >
                <FaceStack people={others} className="size-4" />
                {others.length} here
              </button>
            ) : null}
            <WorkspaceMenu workspace={workspace} onNavigate={onNavigate} />
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={newAgent}
              aria-label={named ? `New agent in ${workspace.name}` : "New agent"}
              title={named ? `New agent in ${workspace.name}` : "New agent"}
              className="-mr-1 text-muted-foreground [&_svg]:size-4"
            >
              <PlusIcon />
            </Button>
          </>
        )}
      </div>
      {folded
        ? null
        : agents.map((agent) => (
            <AgentRow
              key={agent.id}
              agent={agent}
              active={agent.id === activeAgentId}
              waiting={agent.id === activeAgentId ? waiting : undefined}
              // Known only for the team on screen. Of another's agent nothing is said, which
              // is why a row with nobody at it says what the agent is, and not that it is quiet.
              with_={whoIs(
                here,
                (place) => place.agentId === agent.id && place.userId !== me.id,
              ).flatMap((id) => people.get(id) ?? [])}
              onNavigate={onNavigate}
            />
          ))}
      {!folded && agents.length === 0 ? (
        <p className="px-2.5 py-1.5 text-sm text-muted-foreground">
          {team ? "This team has no agents yet." : "You have no agents yet."}
        </p>
      ) : null}
    </section>
  )
}

/** An agent in the list: its creature, its name, and a line about it. */
function AgentRow({
  agent,
  active,
  waiting,
  with_,
  onNavigate,
}: {
  agent: AgentSummary
  active: boolean
  /** What it is waiting on that it left running, in words. */
  waiting: string | undefined
  /** Who else is with it right now, as far as is known. */
  with_: readonly Person[]
  onNavigate?: (() => void) | undefined
}) {
  const name = agent.name ?? "New agent"
  return (
    <div
      className={cn(
        "group/agent flex shrink-0 items-center rounded-xl",
        // The one that is open is raised off the frame. The others darken under the pointer.
        active
          ? "bg-card shadow-raised [--face-ring:var(--card)]"
          : "[--face-ring:var(--frame)] hover:bg-foreground/6",
      )}
    >
      <Link
        to="/a/$agentId"
        params={{ agentId: agent.id }}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl py-2 pr-1 pl-2.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
      >
        <AgentFace agent={agent} className="size-10" quiet />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.90625rem] font-medium">{name}</span>
          {with_.length > 0 ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <FaceStack people={with_} className="size-4" />
              {with_.length} here
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
            <span className="block truncate text-xs text-muted-foreground">{agent.tagline}</span>
          ) : null}
        </span>
      </Link>
      <AgentMenu agent={agent} onNavigate={onNavigate} />
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
              search: { settings: settingsAddress({ at: "agent", agentId: agent.id }) },
            })
          }}
        >
          <SlidersHorizontalIcon /> Settings
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
