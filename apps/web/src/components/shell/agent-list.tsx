import type { AgentSummary, Person, WorkspaceSummary } from "@do-computer/protocol"
import {
  ArrowsLeftRightIcon,
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
import { useEffect, useState } from "react"
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
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { foldedWorkspacesAtom } from "@/lib/atoms"
import { agentsCollection } from "@/lib/collections"
import { isUnread, latestFirst, latestWords, useSeenHere, useVisible, when } from "@/lib/latest"
import { useNewAgent } from "@/lib/new-agent"
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

/** The time, for words that say how long ago something was. Looked at again twice a minute. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

/**
 * Words that are level with the mark or the buttons beside them. A line of text is as tall as
 * its font says, and a font says so differently from one system to the next, so words centred
 * as a line sit a pixel high on one and not on another. Trimmed to the height of a capital,
 * what is centred is the letters themselves. The room above and below is so that what reaches
 * past a capital, such as the tail of a "g", is not cut off where the words are cut short.
 */
export const LEVEL = "py-1 [text-box:trim-both_cap_alphabetic]"

/**
 * The list in the sidebar: agents, and nothing under them. Choosing one is talking to it: it
 * opens the agent's main chat. Its side chats are reached from its strip. Each row says what
 * its agent last said or was told, and when. Someone who is in a team has every workspace of
 * theirs here at once, each under a heading that folds; someone who is not has only their
 * own agents, and no headings.
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
  me: { id: string; name: string; image?: string | null }
  onNavigate?: () => void
}) {
  const { data: listed, isLoading } = useLiveQuery((q) => q.from({ agent: agentsCollection }))
  const loading = pending || isLoading
  const agents = loading ? [] : (listed ?? [])
  const now = useNow()
  // What the agent on screen left running, wherever in its chats it did.
  const waiting = waitingWords(useRunningJobs(activeAgentId), true)
  const [folded, fold] = useAtom(foldedWorkspacesAtom)
  // Until the workspaces are here, only the one on screen is known of.
  const workspaces = useWorkspaces()?.workspaces ?? [workspace]
  const sectioned = workspaces.some((entry) => entry.kind === "team")

  return (
    <nav
      aria-label="Doods"
      className="flex h-full min-h-0 flex-col gap-0.5 overflow-y-auto px-2 pb-3"
    >
      {loading ? (
        <>
          <div className="flex h-9 shrink-0 items-center">
            <h2 className="text-[0.8125rem] font-medium text-muted-foreground">Doods</h2>
          </div>
          <AgentRowsPlaceholder />
        </>
      ) : (
        <>
          {(sectioned ? workspaces : [workspace]).map((entry) => (
            <Section
              key={entry.id}
              workspace={entry}
              agents={agents.filter((agent) => agent.workspaceId === entry.id)}
              named={sectioned}
              current={entry.id === workspace.id}
              folded={sectioned && folded.includes(entry.id)}
              onFold={() => fold(entry.id)}
              activeAgentId={activeAgentId}
              waiting={waiting}
              me={me}
              now={now}
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
 * One workspace's agents, the one last heard from first. Under its name where there is more
 * than one workspace to tell apart, which also folds them away; under "Agents" where there is not.
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
  now,
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
  me: { id: string; name: string; image?: string | null }
  now: number
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
  // Folded away, there is nowhere to show one that is on its way.
  const making = newAgent.making && !folded
  const seenHere = useSeenHere()
  const visible = useVisible()
  const list = latestFirst(agents)
  // The agent on screen is being looked at, so nothing of its is new.
  const unread = (agent: AgentSummary) =>
    !(agent.id === activeAgentId && visible) && isUnread(agent, me.id, seenHere[agent.id])
  const wanted = list.some((agent) => unread(agent) || agent.asking === true)

  return (
    <section
      aria-label={named ? workspace.name : "Doods"}
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
            <span className={cn("truncate", LEVEL)}>{workspace.name}</span>
            <CaretDownIcon
              aria-hidden
              className={cn("size-3 shrink-0 transition-transform", folded && "-rotate-90")}
            />
          </button>
        ) : (
          <h2 className={cn("truncate text-[0.8125rem] font-medium text-muted-foreground", LEVEL)}>
            Doods
          </h2>
        )}
        <span className="min-w-1 flex-1" />
        {folded ? (
          // Folded, it still says who is in there, and whether one of them wants looking at.
          <span className="flex shrink-0 items-center gap-2 pr-0.5">
            <span className="flex items-center -space-x-1.5">
              {list.slice(0, 3).map((agent) => (
                <AgentFace key={agent.id} agent={agent} className="size-5" still />
              ))}
            </span>
            {wanted ? (
              <span
                role="img"
                aria-label="Something new"
                className="size-2 rounded-full bg-primary"
              />
            ) : null}
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
              disabled={newAgent.making}
              aria-busy={newAgent.making}
              onClick={() => void newAgent.create()}
              aria-label={named ? `New Dood in ${workspace.name}` : "New Dood"}
              title={named ? `New Dood in ${workspace.name}` : "New Dood"}
              className="-mr-1 text-muted-foreground [&_svg]:size-4"
            >
              {newAgent.making ? <Spinner /> : <PlusIcon />}
            </Button>
          </>
        )}
      </div>
      {newAgent.error === undefined || folded ? null : (
        <p role="alert" className="px-2.5 py-1 text-xs text-destructive">
          {newAgent.error}
        </p>
      )}
      {/* First, which is where it will be: the one last heard from, and it was only just made. */}
      {making ? <MakingAgentRow /> : null}
      {folded
        ? null
        : list.map((agent) => (
            <AgentRow
              key={agent.id}
              agent={agent}
              active={agent.id === activeAgentId}
              unread={unread(agent)}
              waiting={agent.id === activeAgentId ? waiting : undefined}
              with_={whoIs(
                here,
                (place) => place.agentId === agent.id && place.userId !== me.id,
              ).flatMap((id) => people.get(id) ?? [])}
              meId={me.id}
              people={people}
              now={now}
              onNavigate={onNavigate}
            />
          ))}
      {!folded && !making && list.length === 0 ? (
        <p className="px-2.5 py-1.5 text-sm text-muted-foreground">
          {team ? "This team has no Doods yet." : "You have no Doods yet."}
        </p>
      ) : null}
    </section>
  )
}

/**
 * An agent that is being made, in the list from the moment it is asked for: the row it will have,
 * with its creature and what it says still to come.
 */
function MakingAgentRow() {
  return (
    <div
      data-loading
      aria-busy="true"
      aria-label="Making a new Dood"
      className="flex shrink-0 items-center gap-3 rounded-xl px-2.5 py-2"
    >
      <Skeleton className="size-10 shrink-0 rounded-full" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.90625rem] font-medium">New Dood</span>
        <span className="mt-px block truncate text-xs text-muted-foreground">On its way…</span>
      </span>
    </div>
  )
}

/**
 * An agent in the list: its creature, its name, and under that the latest thing it said or was
 * told, with when. The creature carries a mark while it is at work, and another while it has
 * stopped to wait for someone.
 */
function AgentRow({
  agent,
  active,
  unread,
  waiting,
  with_,
  meId,
  people,
  now,
  onNavigate,
}: {
  agent: AgentSummary
  active: boolean
  unread: boolean
  /** What it is waiting on that it left running, in words. */
  waiting: string | undefined
  /** Who else is with it right now. */
  with_: readonly Person[]
  meId: string
  people: ReadonlyMap<string, Person>
  now: number
  onNavigate?: (() => void) | undefined
}) {
  const name = agent.name ?? "New Dood"
  const { latest } = agent
  const working = agent.working === true
  const asking = agent.asking === true
  const line =
    waiting !== undefined && !working
      ? waiting
      : latest !== undefined
        ? latestWords(latest, meId, people)
        : agent.tagline || undefined
  return (
    <div
      className={cn(
        "group/agent relative flex shrink-0 items-center rounded-xl",
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
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2.5 py-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
      >
        <span className="relative shrink-0">
          <AgentFace agent={agent} className="size-10" quiet />
          {asking ? (
            <span
              role="img"
              aria-label="Waiting on someone"
              title="Waiting on someone"
              className="absolute -right-0.5 -bottom-0.5 z-10 grid size-3.5 place-items-center rounded-full bg-amber-500 text-[0.625rem] leading-none font-bold text-white ring-2 ring-(--face-ring)"
            >
              ?
            </span>
          ) : working ? (
            <span
              role="img"
              aria-label="Working"
              title="Working"
              className="absolute -right-0.5 -bottom-0.5 z-10 grid size-3.5 place-items-center rounded-full bg-card text-primary ring-2 ring-(--face-ring)"
            >
              <Spinner className="size-2.5" />
            </span>
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[0.90625rem]",
                unread ? "font-semibold" : "font-medium",
              )}
            >
              {name}
            </span>
            {working || latest !== undefined ? (
              <time
                dateTime={latest === undefined ? undefined : new Date(latest.at).toISOString()}
                className={cn(
                  // It gives way to the row's menu, where there is a pointer to bring that out.
                  "shrink-0 text-[0.71875rem] text-muted-foreground group-has-[[data-agent-menu]:focus-visible]/agent:invisible group-has-[[data-agent-menu][aria-expanded=true]]/agent:invisible [@media(hover:hover)]:group-hover/agent:invisible",
                  unread && "font-medium text-primary",
                )}
              >
                {working ? "now" : when(latest!.at, now)}
              </time>
            ) : null}
          </span>
          {line !== undefined || with_.length > 0 || unread ? (
            <span className="mt-px flex items-center gap-1.5 text-xs text-muted-foreground">
              {waiting !== undefined && !working ? (
                <ClockIcon aria-hidden className="size-3 shrink-0" />
              ) : latest?.kind === "scheduled" ? (
                <ClockIcon aria-hidden className="size-3 shrink-0" />
              ) : latest?.kind === "agent" ? (
                <ArrowsLeftRightIcon aria-hidden className="size-3 shrink-0" />
              ) : null}
              <span
                data-latest=""
                className={cn("min-w-0 flex-1 truncate", unread && "text-foreground")}
              >
                {line}
              </span>
              <FaceStack people={with_} className="size-4" />
              {unread ? (
                <span
                  role="img"
                  aria-label="Something new"
                  className="size-2 shrink-0 rounded-full bg-primary"
                />
              ) : null}
            </span>
          ) : null}
        </span>
      </Link>
      <AgentMenu agent={agent} onNavigate={onNavigate} />
    </div>
  )
}

/**
 * An agent's own pages, from its row: the same ones its strip has once it is open. It comes out
 * over the row's time under a pointer. Where there is none to bring it out, the strip has them.
 */
function AgentMenu({
  agent,
  onNavigate,
}: {
  agent: AgentSummary
  onNavigate?: (() => void) | undefined
}) {
  const navigate = useNavigate()
  const name = agent.name ?? "New Dood"
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
            data-agent-menu=""
            variant="ghost"
            size="icon-xs"
            className="absolute top-1.5 right-1.5 text-muted-foreground opacity-0 group-hover/agent:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 [@media(hover:none)]:hidden"
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
