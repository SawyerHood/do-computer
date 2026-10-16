import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers"
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import type { AgentSummary, Person, WorkspaceSummary } from "@do-computer/protocol"
import {
  ArrowsLeftRightIcon,
  CaretDownIcon,
  ClockIcon,
  DotsThreeIcon,
  FolderIcon,
  PhoneIcon,
  PlusIcon,
  SidebarSimpleIcon,
  SlidersHorizontalIcon,
} from "@phosphor-icons/react"
import { Link, useNavigate } from "@tanstack/react-router"
import { useLiveQuery } from "@tanstack/react-db"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { useEffect, useId, useRef, useState } from "react"
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
import { agentOrderAtom, foldedWorkspacesAtom } from "@/lib/atoms"
import { callAtom } from "@/lib/call"
import { agentsCollection } from "@/lib/collections"
import { inOrder, isUnread, latestWords, useSeenHere, useVisible, when } from "@/lib/latest"
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
 * own agents, and no headings. A row is dragged to another place among its workspace's.
 */
export function AgentList({
  workspace,
  pending = false,
  activeAgentId,
  me,
  narrow,
  onNavigate,
}: {
  /** The workspace of the page that is open. */
  workspace: WorkspaceSummary
  /** Which workspace that is has not settled yet, so neither has whose agents these are. */
  pending?: boolean
  activeAgentId: string | undefined
  me: { id: string; name: string; image?: string | null }
  /** On a narrow screen: a column of faces, or those faces with the rest of the list beside them. */
  narrow?: "rail" | "open" | undefined
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
  // What is said of a row as it is moved, for whoever does not see it move.
  const [told, tell] = useState("")
  const howToMove = useId()

  return (
    <nav
      aria-label="Doods"
      className={cn(
        "flex h-full min-h-0 flex-col gap-0.5 overflow-y-auto pb-3",
        // A face is as far from the edge of a narrow screen as it is from the page beside it.
        narrow === undefined ? "px-2" : "px-1 [scrollbar-width:none]",
      )}
    >
      {loading ? (
        <>
          <div className="flex h-9 shrink-0 items-center">
            {narrow === "rail" ? null : (
              <h2
                className={cn(
                  "text-[0.8125rem] font-medium text-muted-foreground",
                  narrow === "open" && "pl-1",
                )}
              >
                Doods
              </h2>
            )}
          </div>
          <AgentRowsPlaceholder narrow={narrow} />
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
              howToMove={howToMove}
              tell={tell}
              narrow={narrow}
              onNavigate={onNavigate}
            />
          ))}
          {narrow === "rail" ? null : <MoreWorkspaces me={me} onNavigate={onNavigate} />}
        </>
      )}
      <p id={howToMove} hidden>
        {HOW_TO_MOVE}
      </p>
      {/* Not a status: the page has those for what it has to say of itself, one at a time. */}
      <p aria-live="assertive" aria-atomic="true" className="sr-only">
        {told}
      </p>
    </nav>
  )
}

/** How to move a row without a pointer, said to someone who reaches one with a screen reader. */
const HOW_TO_MOVE =
  "To move this Dood in the list, press Space, then the arrow keys, and Space again to put it down. Escape leaves it where it was."

/**
 * Where dnd-kit's own words for a screen reader are put, which is nowhere. It says them in a
 * status of its own beside every list, there whether or not anything is being moved. The list
 * says them itself, once for all its workspaces (`tell`).
 */
const NOWHERE = typeof document === "undefined" ? undefined : document.createElement("div")

/**
 * Keep the click that ends a drag from everything that would take it. A row that is let go
 * under the pointer has been clicked, as far as the browser knows, and a row is a link: it
 * would be opened. Called when a drag begins, since the click comes however it ends.
 */
function swallowClick() {
  const swallow = (event: MouseEvent) => {
    // One made with a key is not the drag's: a pointer's says how many times it was pressed.
    if (event.detail === 0) return
    event.preventDefault()
    event.stopPropagation()
  }
  window.addEventListener("click", swallow, { capture: true, once: true })
  // Let go anywhere else there is no click. The next press is then a new one, with its own.
  window.addEventListener(
    "pointerdown",
    () => window.removeEventListener("click", swallow, { capture: true }),
    { capture: true, once: true },
  )
}

/**
 * One workspace's agents: the one last heard from first, until they are put in an order by
 * hand, which they then keep. Under its name where there is more than one workspace to tell
 * apart, which also folds them away; under "Doods" where there is not.
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
  howToMove,
  tell,
  narrow,
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
  /** The id of what says how a row is moved without a pointer. */
  howToMove: string
  /** Say what has become of a row that is being moved. */
  tell: (words: string) => void
  narrow: "rail" | "open" | undefined
  onNavigate?: (() => void) | undefined
}) {
  const rail = narrow === "rail"
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
  const order = useAtomValue(agentOrderAtom)[workspace.id]
  const putInOrder = useSetAtom(agentOrderAtom)
  const list = inOrder(agents, order)
  const sensors = useSensors(
    // A press that does not move is a click, and opens the agent.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // A finger that moves at once is scrolling the list. One held still takes the row up.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    // Enter is left to the link, which it opens.
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] },
    }),
  )
  const said = (id: UniqueIdentifier) => list.find((agent) => agent.id === id)?.name ?? "New Dood"
  const placeOf = (id: UniqueIdentifier) =>
    `${list.findIndex((agent) => agent.id === id) + 1} of ${list.length}`
  // As it is taken up it is over its own place, which is not somewhere it was moved to, and
  // saying so would be said over its having been taken up.
  const moved = useRef(false)
  const dropped = ({ active, over }: DragEndEvent) => {
    tell(`${said(active.id)} was put down at ${placeOf((over ?? active).id)}.`)
    if (over === null || over.id === active.id) return
    const from = list.findIndex((agent) => agent.id === active.id)
    const to = list.findIndex((agent) => agent.id === over.id)
    // The whole list as it now stands, so that one made since the last time has a place too.
    putInOrder(
      workspace.id,
      arrayMove(list, from, to).map((agent) => agent.id),
    )
  }
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
      {rail ? (
        // Only what fits over a face: the workspace's mark, which folds it, where there are
        // several to tell apart, and otherwise the way to a new Dood. The mark is in the middle
        // of a line across the column, which is all that parts one workspace's faces from the
        // next's.
        <div
          className={cn(
            "flex h-9 items-center justify-center [--face-ring:var(--frame)]",
            named &&
              "-mx-1 gap-0.5 before:h-px before:flex-1 before:bg-hairline after:h-px after:flex-1 after:bg-hairline",
          )}
        >
          {named ? (
            <button
              type="button"
              aria-expanded={!folded}
              aria-label={workspace.name}
              title={workspace.name}
              onClick={onFold}
              className="relative rounded-md p-0.5 outline-none hover:brightness-95 focus-visible:ring-3 focus-visible:ring-ring/40"
            >
              <WorkspaceMark workspace={workspace} me={me} className="size-5" />
              {folded && wanted ? (
                <span
                  role="img"
                  aria-label="Something new"
                  className="absolute top-0.5 right-0.5 size-2 rounded-full bg-primary ring-2 ring-(--face-ring)"
                />
              ) : null}
            </button>
          ) : (
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={newAgent.making}
              aria-busy={newAgent.making}
              onClick={() => void newAgent.create()}
              aria-label={named ? `New Dood in ${workspace.name}` : "New Dood"}
              title={named ? `New Dood in ${workspace.name}` : "New Dood"}
              className="text-muted-foreground [&_svg]:size-4"
            >
              {newAgent.making ? <Spinner /> : <PlusIcon />}
            </Button>
          )}
        </div>
      ) : (
        // Flush with the rows under it: its ends are where the chosen row's are.
        <div
          className={cn(
            "flex h-9 items-center gap-0.5 [--face-ring:var(--frame)]",
            // The row under it starts nearer the edge on a narrow screen, and the heading with it.
            narrow === "open" && "px-1.5",
          )}
        >
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
            <h2
              className={cn("truncate text-[0.8125rem] font-medium text-muted-foreground", LEVEL)}
            >
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
      )}
      {newAgent.error === undefined || folded || rail ? null : (
        <p role="alert" className="px-2.5 py-1 text-xs text-destructive">
          {newAgent.error}
        </p>
      )}
      {/* First, which is where it will be: the one last heard from, and it was only just made. */}
      {making ? <MakingAgentRow narrow={narrow} /> : null}
      {folded || list.length === 0 ? null : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          // Up and down, and no further than its own workspace's rows.
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          {...(NOWHERE === undefined ? {} : { accessibility: { container: NOWHERE } })}
          onDragStart={({ active, activatorEvent }) => {
            if (!(activatorEvent instanceof KeyboardEvent)) swallowClick()
            moved.current = false
            tell(`Picked up ${said(active.id)}, ${placeOf(active.id)}.`)
          }}
          onDragOver={({ active, over }) => {
            if (over === null || (over.id === active.id && !moved.current)) return
            moved.current = true
            tell(`${said(active.id)} is at ${placeOf(over.id)}.`)
          }}
          onDragEnd={dropped}
          onDragCancel={({ active }) => tell(`${said(active.id)} was left where it was.`)}
        >
          <SortableContext
            items={list.map((agent) => agent.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="flex flex-col gap-0.5">
              {list.map((agent) => (
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
                  // One on its own has nowhere to go.
                  howToMove={list.length > 1 ? howToMove : undefined}
                  narrow={narrow}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      {!folded && !making && !rail && list.length === 0 ? (
        <p className="px-2.5 py-1.5 text-sm text-muted-foreground">
          {team ? "This team has no Doods yet." : "You have no Doods yet."}
        </p>
      ) : null}
    </section>
  )
}

/**
 * The room around what is in a row. On a narrow screen a face is four pixels in from the row's
 * edge whether its words are beside it or not, so the row of a face alone is a square around it.
 */
const ROW = { wide: "px-2.5 py-2", open: "py-1.5 pr-2.5 pl-1", rail: "px-1 py-1.5" }

/**
 * An agent that is being made, in the list from the moment it is asked for: the row it will have,
 * with its creature and what it says still to come.
 */
function MakingAgentRow({ narrow }: { narrow: "rail" | "open" | undefined }) {
  return (
    <div
      data-loading
      aria-busy="true"
      aria-label="Making a new Dood"
      className={cn("flex shrink-0 items-center gap-3 rounded-xl", ROW[narrow ?? "wide"])}
    >
      <Skeleton className="size-10 shrink-0 rounded-full" />
      {narrow === "rail" ? null : (
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.90625rem] font-medium">New Dood</span>
          <span className="mt-px block truncate text-xs text-muted-foreground">On its way…</span>
        </span>
      )}
    </div>
  )
}

/**
 * An agent in the list: its creature, its name, and under that the latest thing it said or was
 * told, with when. The creature carries a mark while it is at work, and another while it has
 * stopped to wait for someone. It is taken up by its link, and the whole row goes with it.
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
  howToMove,
  narrow,
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
  /** The id of what says how it is moved. None where there are no others to move it among. */
  howToMove: string | undefined
  narrow: "rail" | "open" | undefined
  onNavigate?: (() => void) | undefined
}) {
  const rail = narrow === "rail"
  const name = agent.name ?? "New Dood"
  const { latest } = agent
  const sortable = useSortable({ id: agent.id, disabled: howToMove === undefined })
  const working = agent.working === true
  const asking = agent.asking === true
  // Whoever is signed in is on a call with it, in this tab.
  const calling = useAtomValue(callAtom)?.agentId === agent.id
  const line = calling
    ? "On a call"
    : waiting !== undefined && !working
      ? waiting
      : latest !== undefined
        ? latestWords(latest, meId, people)
        : agent.tagline || undefined
  return (
    <div
      ref={sortable.setNodeRef}
      data-dragging={sortable.isDragging ? "" : undefined}
      // The others make room as it passes them. It is only ever moved, never squeezed.
      style={{
        transform: CSS.Translate.toString(sortable.transform),
        transition: sortable.transition,
      }}
      // A link and a picture are things a browser drags off the page by itself.
      onDragStart={(event) => event.preventDefault()}
      className={cn(
        "group/agent relative flex shrink-0 items-center rounded-xl select-none [-webkit-touch-callout:none]",
        // The one that is open is a shade off the frame, and so is one that is being moved,
        // over the rest. The others darken under the pointer.
        active || sortable.isDragging
          ? "bg-[color-mix(in_oklab,var(--foreground)_9%,var(--frame))] [--face-ring:color-mix(in_oklab,var(--foreground)_9%,var(--frame))]"
          : "[--face-ring:var(--frame)] hover:bg-foreground/6",
        sortable.isDragging && "z-10",
      )}
    >
      <Link
        ref={sortable.setActivatorNodeRef}
        {...sortable.listeners}
        // It stays a link to whoever is told what it is, and is told as well how it is moved.
        aria-describedby={howToMove}
        draggable={false}
        to="/a/$agentId"
        params={{ agentId: agent.id }}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        // A face on its own still says whose it is.
        aria-label={rail ? (unread ? `${name}: something new` : name) : undefined}
        title={rail ? name : undefined}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-3 rounded-xl outline-none group-data-dragging/agent:cursor-grabbing focus-visible:ring-3 focus-visible:ring-ring/40",
          ROW[narrow ?? "wide"],
        )}
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
          {/* With no words beside it to carry the mark, the face does. */}
          {rail && unread ? (
            <span
              aria-hidden
              className="absolute -top-0.5 -right-0.5 z-10 size-3 rounded-full bg-primary ring-2 ring-(--face-ring)"
            />
          ) : null}
        </span>
        {rail ? null : (
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
                {calling ? (
                  <PhoneIcon
                    aria-hidden
                    weight="fill"
                    className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400"
                  />
                ) : waiting !== undefined && !working ? (
                  <ClockIcon aria-hidden className="size-3 shrink-0" />
                ) : latest?.kind === "scheduled" ? (
                  <ClockIcon aria-hidden className="size-3 shrink-0" />
                ) : latest?.kind === "agent" ? (
                  <ArrowsLeftRightIcon aria-hidden className="size-3 shrink-0" />
                ) : null}
                <span
                  data-latest=""
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    unread && "text-foreground",
                    calling && "font-medium text-emerald-700 dark:text-emerald-400",
                  )}
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
        )}
      </Link>
      {rail ? null : <AgentMenu agent={agent} onNavigate={onNavigate} />}
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

/**
 * The way to the sidebar where it is out of sight, on a narrow screen, for whoever does not
 * pull it across with a finger. It says when a Dood that is not on screen has something new.
 */
export function DoodsButton({
  meId,
  activeAgentId,
  onClick,
}: {
  meId: string
  /** The agent on screen, whose news is being read as it comes. */
  activeAgentId?: string | undefined
  onClick: () => void
}) {
  const { data: agents } = useLiveQuery((q) => q.from({ agent: agentsCollection }))
  const seenHere = useSeenHere()
  const wanted = (agents ?? []).some(
    (agent) =>
      agent.id !== activeAgentId &&
      (agent.asking === true || isUnread(agent, meId, seenHere[agent.id])),
  )
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={wanted ? "Show your Doods: something new" : "Show your Doods"}
      title="Your Doods"
      className="relative shrink-0 text-muted-foreground"
      onClick={onClick}
    >
      <SidebarSimpleIcon />
      {wanted ? (
        <span
          aria-hidden
          className="absolute top-0.5 right-0.5 size-2 rounded-full bg-primary ring-2 ring-background"
        />
      ) : null}
    </Button>
  )
}
