import type { AgentState } from "@durable-computer/client"
import {
  type AgentSummary,
  type ChatSummary,
  isPersonalWorkspace,
  type Person,
  type Presence,
  type WorkspaceSummary,
} from "@durable-computer/protocol"
import {
  ArchiveIcon,
  CaretRightIcon,
  CircleNotchIcon,
  ClockIcon,
  DotsThreeIcon,
  FolderIcon,
  NotePencilIcon,
  PlusIcon,
  SlidersHorizontalIcon,
} from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate, useParams } from "@tanstack/react-router"
import { and, eq, useLiveQuery } from "@tanstack/react-db"
import { useAtomValue } from "jotai"
import { useCallback, useEffect, useMemo, useState } from "react"
import { AgentFace } from "@/components/agent-avatar"
import { isAtWork } from "@/components/chat/subagents"
import { FaceStack, PersonFace } from "@/components/people"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { chatKey, liveChatAtom } from "@/lib/atoms"
import { client } from "@/lib/client"
import { agentKey, agentsCollection, chatsCollection } from "@/lib/collections"
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

/** Starts a chat with the agent and opens it. */
export function useNewChat(agentId: string | undefined, onNavigate?: () => void) {
  const navigate = useNavigate()
  return async () => {
    if (agentId === undefined) return
    const chat = await client.agent(agentId).createChat()
    await chatsCollection(agentId).utils.refetch()
    onNavigate?.()
    await navigate({ to: "/a/$agentId/c/$chatId", params: { agentId, chatId: chat.id } })
  }
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

const FOLDS_KEY = "dc-agents-open"
/** How many of an agent's chats are listed before the rest are asked for. */
const SHOWN = 8

/** Which agents have their chats unfolded. Remembered; the agent on screen starts unfolded. */
function useFolds(activeAgentId: string | undefined) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  useEffect(() => {
    try {
      setOpen(JSON.parse(localStorage.getItem(FOLDS_KEY) ?? "{}") as Record<string, boolean>)
    } catch {
      // Storage can be unavailable; then only the agent on screen is unfolded.
    }
  }, [])
  const toggle = useCallback(
    (agentId: string) =>
      setOpen((previous) => {
        const next = { ...previous, [agentId]: !(previous[agentId] ?? agentId === activeAgentId) }
        try {
          localStorage.setItem(FOLDS_KEY, JSON.stringify(next))
        } catch {
          // The choice then lasts for this page only.
        }
        return next
      }),
    [activeAgentId],
  )
  return { isOpen: (agentId: string) => open[agentId] ?? agentId === activeAgentId, toggle }
}

/**
 * One chat, on one line: its title, who else is in it, and at the end either a spinner while
 * there is work going on in it or when it was last used. Never both.
 */
function ChatRow({
  agentId,
  chat,
  active,
  subagentsAtWork,
  people,
  now,
  onNavigate,
  onArchive,
}: {
  agentId: string
  chat: ChatSummary
  active: boolean
  /** How many sub-agents started in this chat are at work. */
  subagentsAtWork: number
  /** Teammates who have it open. */
  people: Person[]
  now: number
  onNavigate?: (() => void) | undefined
  onArchive: () => void
}) {
  // Whether the agent is at work in it is only known for the chat on screen, which is followed.
  const live = useAtomValue(liveChatAtom(chatKey(agentId, chat.id)))
  const working = subagentsAtWork > 0 || (active && live.loaded && live.state.busy)
  return (
    <div className="group/chat relative">
      <Link
        to="/a/$agentId/c/$chatId"
        params={{ agentId, chatId: chat.id }}
        onClick={onNavigate}
        className={cn(
          "flex h-8 items-center gap-1.5 rounded-lg pr-2 pl-2.5 text-[0.84375rem] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40",
          active && "bg-accent text-foreground",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{chat.title}</span>
        <FaceStack people={people} className="size-[1.125rem]" />
        <span
          className="flex min-w-6 shrink-0 items-center justify-end gap-1 text-[0.6875rem] group-focus-within/chat:invisible group-hover/chat:invisible"
          title={
            subagentsAtWork > 0
              ? `${subagentsAtWork} ${subagentsAtWork === 1 ? "sub-agent" : "sub-agents"} at work`
              : undefined
          }
        >
          {working ? (
            <>
              <CircleNotchIcon aria-label="Working" className="size-3 animate-spin" />
              {subagentsAtWork > 0 ? subagentsAtWork : null}
            </>
          ) : (
            ago(chat.updatedAt, now)
          )}
        </span>
      </Link>
      <button
        type="button"
        aria-label={`Archive ${chat.title}`}
        onClick={onArchive}
        className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md p-1 text-muted-foreground opacity-0 outline-none hover:text-foreground focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/40 group-hover/chat:opacity-100"
      >
        <ArchiveIcon className="size-3.5" />
      </button>
    </div>
  )
}

/** An agent's chats, under it. Sub-agents are not listed: a chat only says how many are at work. */
function AgentChats({
  agentId,
  here,
  people,
  meId,
  onNavigate,
}: {
  agentId: string
  here: readonly Presence[]
  people: Map<string, Person>
  meId: string
  onNavigate?: (() => void) | undefined
}) {
  const navigate = useNavigate()
  const { agentId: activeAgentId, chatId: activeChatId } = useParams({ strict: false })
  const collection = chatsCollection(agentId)
  const { data: chats } = useLiveQuery(
    (q) =>
      q
        .from({ chat: collection })
        // Scheduled runs have their own chats; those are reached from the automations page.
        .where(({ chat }) => and(eq(chat.archived, false), eq(chat.kind, "chat")))
        .orderBy(({ chat }) => chat.updatedAt, "desc"),
    [collection],
  )
  const { data: subagents } = useLiveQuery(
    (q) => q.from({ chat: collection }).where(({ chat }) => eq(chat.kind, "subagent")),
    [collection],
  )
  const [all, setAll] = useState(false)
  const now = useNow()

  // Someone reading a sub-agent's chat counts as being in the chat it was started in.
  const parentOf = useMemo(
    () => new Map((subagents ?? []).map((subagent) => [subagent.id, subagent.parentId])),
    [subagents],
  )
  const openChatId =
    activeAgentId === agentId && activeChatId !== undefined
      ? (parentOf.get(activeChatId) ?? activeChatId)
      : undefined
  const list = chats ?? []
  const openAt = list.findIndex((chat) => chat.id === openChatId)
  // The chat on screen is always listed, however far down it is.
  const shown = all ? list : list.slice(0, Math.max(SHOWN, openAt + 1))

  const archive = async (chat: ChatSummary) => {
    collection.update(chat.id, (draft) => {
      draft.archived = true
    })
    if (chat.id === openChatId) await navigate({ to: "/a/$agentId", params: { agentId } })
  }

  return (
    <nav aria-label="Chats" className="mt-1 mb-2 ml-[1.6rem] flex flex-col gap-px border-l pl-1.5">
      {shown.map((chat) => (
        <ChatRow
          key={chat.id}
          agentId={agentId}
          chat={chat}
          active={chat.id === openChatId}
          subagentsAtWork={
            (subagents ?? []).filter(
              (subagent) => subagent.parentId === chat.id && isAtWork(subagent.status),
            ).length
          }
          people={whoIs(
            here,
            (place) =>
              place.userId !== meId &&
              place.agentId === agentId &&
              place.chatId !== null &&
              (parentOf.get(place.chatId) ?? place.chatId) === chat.id,
          ).flatMap((id) => people.get(id) ?? [])}
          now={now}
          onNavigate={onNavigate}
          onArchive={() => void archive(chat)}
        />
      ))}
      {chats !== undefined && list.length === 0 ? (
        <p className="px-2.5 py-1.5 text-[0.8125rem] text-muted-foreground">No chats yet.</p>
      ) : null}
      {list.length > shown.length ? (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="rounded-lg px-2.5 py-1.5 text-left text-xs text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
        >
          {list.length - shown.length} older {list.length - shown.length === 1 ? "chat" : "chats"}
        </button>
      ) : null}
    </nav>
  )
}

/** The time, kept current to the minute, for saying how long ago something was. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

/** Where someone is, in words: the agent they have open, and the chat. */
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
  if (chat === undefined) return <>{name}</>
  return (
    <>
      {name} · {parent === undefined ? chat.title : `${parent.title} › ${chat.title}`}
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
 * The list in the sidebar: the workspace's agents, each with its chats folded under it. This is
 * how an agent is picked, and how a chat is. In a team it also says who is where.
 */
export function AgentList({
  workspace,
  activeAgentId,
  meId,
  onNavigate,
}: {
  workspace: WorkspaceSummary
  activeAgentId: string | undefined
  meId: string
  onNavigate?: () => void
}) {
  const { data: agents } = useLiveQuery(
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
  const folds = useFolds(activeAgentId)
  const newChat = useNewChat(activeAgentId, onNavigate)
  const newAgent = useNewAgent(workspace.id, onNavigate)
  const list = agents ?? []

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-0.5 pt-2 pr-2.5 pb-1.5 pl-4">
        <h2 className="min-w-0 flex-1 truncate text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
          Agents
        </h2>
        {activeAgentId === undefined ? null : (
          <Button variant="ghost" size="icon-sm" onClick={newChat} aria-label="New chat">
            <NotePencilIcon />
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" onClick={newAgent} aria-label="New agent">
          <PlusIcon />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-3">
        {list.map((agent) => {
          const open = folds.isOpen(agent.id)
          const with_ = whoIs(
            here,
            (place) => place.agentId === agent.id && place.userId !== meId,
          ).flatMap((id) => people.get(id) ?? [])
          const name = agent.name ?? "New agent"
          return (
            <div key={agent.id}>
              <div
                className={cn(
                  "group/agent flex items-center rounded-xl [--face-ring:var(--rail)] hover:bg-accent",
                  agent.id === activeAgentId && !open && "bg-accent",
                )}
              >
                <button
                  type="button"
                  aria-expanded={open}
                  aria-label={`${name}: ${open ? "hide" : "show"} its chats`}
                  onClick={() => folds.toggle(agent.id)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl py-1.5 pr-1 pl-1 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                >
                  <CaretRightIcon
                    className={cn(
                      "size-3 shrink-0 text-muted-foreground transition-transform",
                      open && "rotate-90",
                    )}
                  />
                  <AgentFace agent={agent} className="size-8" quiet />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{name}</span>
                    {team ? (
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <FaceStack people={with_} className="size-4" />
                        {with_.length === 0 ? "Quiet" : `${with_.length} here`}
                      </span>
                    ) : agent.tagline ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {agent.tagline}
                      </span>
                    ) : null}
                  </span>
                </button>
                <AgentMenu agent={agent} onNavigate={onNavigate} />
                <NewChatWith agent={agent} onNavigate={onNavigate} />
              </div>
              {open ? (
                <AgentChats
                  agentId={agent.id}
                  here={here}
                  people={people}
                  meId={meId}
                  onNavigate={onNavigate}
                />
              ) : null}
            </div>
          )
        })}
        {agents !== undefined && list.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">
            {team ? "This team has no agents yet." : "You have no agents yet."}
          </p>
        ) : null}
      </div>
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
        className="rounded-md p-1.5 text-muted-foreground opacity-0 outline-none hover:text-foreground focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/40 group-hover/agent:opacity-100 aria-expanded:opacity-100 [@media(hover:none)]:opacity-100"
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

/** The way to a new chat with an agent that is not the one on screen. */
function NewChatWith({
  agent,
  onNavigate,
}: {
  agent: AgentSummary
  onNavigate?: (() => void) | undefined
}) {
  const create = useNewChat(agent.id, onNavigate)
  const name = agent.name ?? "New agent"
  return (
    <button
      type="button"
      aria-label={`New chat with ${name}`}
      title={`New chat with ${name}`}
      onClick={create}
      className="mr-1.5 rounded-md p-1.5 text-muted-foreground opacity-0 outline-none hover:text-foreground focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/40 group-hover/agent:opacity-100 [@media(hover:none)]:opacity-100"
    >
      <NotePencilIcon className="size-4" />
    </button>
  )
}
