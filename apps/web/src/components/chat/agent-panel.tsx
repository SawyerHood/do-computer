import {
  type AgentSummary,
  type ChatRun,
  chatRuns,
  type ChatState,
  type ChatSummary,
  type JobSummary,
  type LibraryFile,
  sentFiles,
  chatUses,
  toolActivity,
  useOf,
  type ToolPart,
  toolSummary,
} from "@do-computer/protocol"
import {
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  FileIcon,
  TShirtIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"
import { useAtomValue, useSetAtom } from "jotai"
import { type ReactNode, useMemo, useRef, useState } from "react"
import { AgentAvatar, AgentFace } from "@/components/agent-avatar"
import { CreatureCare } from "@/components/creature/care"
import { PinnedShelf } from "@/components/pins/shelf"
import { RowsPlaceholder } from "@/components/placeholders"
import { ResizeHandle } from "@/components/shell/resize-handle"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { client } from "@/lib/client"
import { agentPanelColumn } from "@/lib/columns"
import { creatureWardrobeAtom } from "@/lib/creature"
import { formatBytes, isViewable } from "@/lib/library"
import { type MascotMood, mascotMoodAtom } from "@/lib/mascot"
import { keptLine } from "@/lib/passwords"
import { cn } from "@/lib/utils"

import { ThreadRows } from "./agent-threads.tsx"
import { JobRows, waitingWords } from "./commands.tsx"
import { PanelSection } from "./panel-section.tsx"
import { SlackRows } from "./slack-threads.tsx"
import { AgentIdContext } from "./sent-file.tsx"
import { UseNow } from "./uses.tsx"
import { SubagentBrood, SubagentRows, subagentSeed, subagentWords } from "./subagents.tsx"

/** How many of the latest pieces of work are listed. */
const SHOWN = 30

/** How many of them are listed until the rest are asked for. */
const FIRST = 5

/** How tall the bar is that stands in for the face once it has been scrolled away, in pixels. */
const BAR = 52

/** What it is doing, in a few words. The transcript's own line has the particulars. */
function moodWords(mood: MascotMood, hatched: boolean): string {
  if (!hatched) return "About to hatch"
  switch (mood.state) {
    case "listening":
      return "Listening"
    case "thinking":
      return "Thinking"
    case "working":
      return mood.variant === "file"
        ? "Working with files"
        : mood.variant === "search"
          ? "Looking something up"
          : mood.variant === "memory"
            ? "Making a note"
            : "Running a command"
    case "speaking":
      return "Answering"
    case "waiting":
      return "Waiting for your OK"
    case "done":
      return "Done"
    case "error":
      return "Something went wrong"
    case "asleep":
      return "Resting"
    default:
      return "Ready"
  }
}

const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })

/** One step of a piece of work, which opens to show what came back. */
function Step({ part }: { part: ToolPart }) {
  const going = part.status === "pending" || part.status === "running"
  const output = part.output?.trim() ?? ""
  const kept = keptLine(part)
  return (
    <li>
      <Collapsible className="group/step">
        <CollapsibleTrigger className="flex w-full cursor-default items-start gap-2 rounded-lg px-2 py-1 text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40">
          <span
            aria-hidden
            className={cn(
              "mt-1.5 size-1.5 shrink-0 rounded-full bg-current",
              part.status === "error" && "bg-destructive",
              going && "animate-pulse",
            )}
          />
          <span className="line-clamp-1 min-w-0 flex-1 break-all group-data-open/step:line-clamp-none">
            {/* A step on a screen says what it did there, not only that it used it. */}
            {useOf(part)?.say ??
              // A sign-in or a payment says how it went, which what it was called with does not.
              (kept === undefined ? (going ? toolActivity(part) : toolSummary(part)) : kept.words)}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="mt-1 mb-1.5 ml-5 max-h-56 overflow-auto rounded-lg bg-background p-2 text-xs whitespace-pre-wrap break-words text-muted-foreground">
            {output === "" ? (going ? "Still going." : "It returned nothing.") : output}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}

/** One piece of work: what it was, what came of it, and its steps for whoever wants them. */
function Work({ run }: { run: ChatRun }) {
  const summary = run.entry
  return (
    <li>
      <Collapsible className="group rounded-xl data-open:bg-surface">
        {/* Only the title, so the list can be taken in at a glance. The rest is inside. */}
        <CollapsibleTrigger className="flex w-full cursor-default items-center gap-2.5 rounded-xl px-2.5 py-2 text-left outline-none hover:bg-surface focus-visible:ring-3 focus-visible:ring-ring/40">
          {run.status === "working" ? (
            <Spinner className="shrink-0 text-muted-foreground" />
          ) : run.status === "failed" ? (
            <WarningCircleIcon className="size-4 shrink-0 text-destructive" />
          ) : (
            <CheckCircleIcon className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1 truncate text-sm group-data-open:font-medium group-data-open:whitespace-normal">
            {summary.title}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-1.5 px-2.5 pb-2.5 pl-9">
          <p className="text-sm break-words text-muted-foreground">{summary.outcome}</p>
          <p className="text-xs text-muted-foreground">
            {run.at === undefined ? "" : `${clock.format(run.at)} · `}
            {run.steps.length} {run.steps.length === 1 ? "step" : "steps"}
          </p>
          <ol aria-label="Steps" className="-ml-2 flex flex-col">
            {run.steps.map((part) => (
              <Step key={part.toolCallId} part={part} />
            ))}
          </ol>
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}

/** A file the agent sent in this chat: opened beside it where it can be shown, and otherwise downloaded. */
function Shared({
  agentId,
  file,
  onOpen,
}: {
  agentId: string
  file: LibraryFile
  onOpen: (fileId: string) => void
}) {
  const row =
    "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm outline-none hover:bg-surface focus-visible:ring-3 focus-visible:ring-ring/40"
  const label = (
    <>
      <FileIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{file.name}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(file.size)}</span>
    </>
  )
  return (
    <li>
      {isViewable(file) ? (
        <button
          type="button"
          title="Open beside the chat"
          onClick={() => onOpen(file.id)}
          className={row}
        >
          {label}
        </button>
      ) : (
        <a
          href={client.agent(agentId).libraryFileUrl(file.id)}
          download={file.name}
          title="Download"
          className={row}
        >
          {label}
        </a>
      )}
    </li>
  )
}

/**
 * What a folded list of conversations says of them: that some want an OK, that one is being
 * answered, or that every one has had its answer.
 */
function threadsSaid(threads: ChatSummary[]): ReactNode {
  const waiting = threads.filter((thread) => thread.status === "waiting").length
  if (waiting > 0) {
    return (
      <>
        <span className="text-foreground">{waiting} waiting</span>
        <span aria-hidden className="size-2 shrink-0 animate-pulse rounded-full bg-amber-500" />
      </>
    )
  }
  if (threads.some((thread) => thread.status === "working")) {
    return (
      <>
        Answering
        <Spinner className="size-3.5" />
      </>
    )
  }
  const answered = threads.every((thread) => (thread.status ?? "done") === "done")
  return answered ? (threads.length === 1 ? "Answered" : "All answered") : undefined
}

/**
 * The agent, beside its chat: its creature at a size where it can be watched, what it is doing,
 * what it has shared here and what it has done here. The transcript keeps only what was said; this
 * is where the work behind an answer can be opened and read, and a file found without scrolling
 * back to where it was sent.
 *
 * All of it scrolls as one, the face with it; a bar with the agent's name takes the face's place
 * at the top once it has gone. Each section folds under its heading, so that a panel with a lot
 * in it can be cut down to what is wanted.
 */
export function AgentPanel({
  agent,
  state,
  face,
  reconnecting,
  startFresh,
  subagent,
  subagents,
  running = [],
  threads = [],
  slack = [],
  chatId,
  presence,
  onOpenFile,
  chatless = false,
  loading = false,
}: {
  agent: AgentSummary
  state: ChatState
  /** Its creature, large. Given from outside because a new agent hatches in it. */
  face: React.ReactNode
  /** The chat's stream dropped and is being picked up again. */
  reconnecting: boolean
  /** Starts the chat's context over, where there is something to start over from. */
  startFresh: { title: string; disabled: boolean; run: () => void } | undefined
  /** Set in a sub-agent's chat: the panel is then about it, not about its agent. */
  subagent?: {
    chatId: string
    title: string
    status: ChatSummary["status"]
    parentTitle: string | undefined
  }
  /** The sub-agents of this chat that are at work. */
  subagents: ChatSummary[]
  /** The commands this chat left running in the background. */
  running?: JobSummary[]
  /** The conversations other agents have had with it, newest first. */
  threads?: ChatSummary[]
  /** The threads in Slack it has been spoken to in, newest first. */
  slack?: ChatSummary[]
  /** The chat the panel is beside, so that a thread which is open is marked in its list. */
  chatId?: string
  /** In a team: who is in this chat right now. Shown above what the agent did. */
  presence?: React.ReactNode
  /** Opens a file the agent sent beside the chat, by its id. Without it the files are not listed. */
  onOpenFile?: (fileId: string) => void
  /** Beside a page that is not a chat: there is then no work here to list. */
  chatless?: boolean
  /** The chat has not been heard from yet, so what the agent is doing and has done is not known. */
  loading?: boolean
}) {
  const mood = useAtomValue(
    mascotMoodAtom(subagent === undefined ? agent.id : subagentSeed(agent.id, subagent.chatId)),
  )
  const width = useAtomValue(agentPanelColumn.width)
  const openWardrobe = useSetAtom(creatureWardrobeAtom)
  // Newest first. Each is a piece of work the agent wrote an entry for, which it does only for
  // the substantial ones, however many steps it took.
  const runs = useMemo(() => chatRuns(state).slice(-SHOWN).reverse(), [state])
  const files = useMemo(() => sentFiles(state), [state])
  const using = useMemo(() => chatUses(state).at(-1), [state])
  // Whether every piece of work is listed, or only the latest few.
  const [allRuns, setAllRuns] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const nameplate = useRef<HTMLDivElement>(null)
  // Whether the agent's name has gone up under where the bar is.
  const [tucked, setTucked] = useState(false)
  const follow = () => {
    const [box, plate] = [scroller.current, nameplate.current]
    if (box === null || plate === null) return
    setTucked(plate.getBoundingClientRect().bottom <= box.getBoundingClientRect().top + BAR)
  }
  const agentName = agent.name ?? "New Dood"
  const name = subagent?.title ?? agentName
  // A sub-agent at rest says how it ended; one at work says what it is doing.
  // An agent at rest with a command still running is waiting on it, not ready.
  const doing =
    mood.state === "idle" && running.length > 0
      ? waitingWords(running, false)
      : subagent !== undefined && mood.state === "idle"
        ? subagentWords(subagent.status)
        : moodWords(mood, agent.hatched)
  const seed = subagent === undefined ? undefined : subagentSeed(agent.id, subagent.chatId)
  return (
    <aside
      aria-label={`About ${name}`}
      className="relative mr-2.5 mb-2.5 overflow-hidden rounded-2xl border flex shrink-0 flex-col bg-rail/50"
      style={{ width }}
    >
      <ResizeHandle column={agentPanelColumn} edge="left" label={`Resize ${name}'s panel`} />
      {/* Rarely wanted, so it is out of the way in the corner. It stays there over the bar. */}
      {startFresh === undefined ? null : (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Start fresh"
          title={startFresh.title}
          disabled={startFresh.disabled}
          onClick={startFresh.run}
          className="absolute top-2.5 right-2.5 z-20 size-7 text-muted-foreground/60"
        >
          <ArrowsClockwiseIcon />
        </Button>
      )}
      {tucked ? (
        // The face has been scrolled away: who this is and what it is doing stay in sight, and
        // a press brings the face back.
        <button
          type="button"
          aria-label={`Back to ${name}`}
          title="Back to the top"
          onClick={() => scroller.current?.scrollTo({ top: 0, behavior: "smooth" })}
          style={{ height: BAR }}
          className="absolute inset-x-0 top-0 z-10 flex animate-in cursor-default items-center gap-2.5 border-b bg-background pr-11 pl-3 text-left duration-150 outline-none slide-in-from-top-2 fade-in focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:ring-inset"
        >
          {/* Over the page's color, the panel's own tint, as the rest of the panel has. */}
          <span aria-hidden className="absolute inset-0 bg-rail/50" />
          {seed === undefined ? (
            <AgentFace agent={agent} className="relative size-9 shrink-0" quiet />
          ) : (
            <AgentAvatar
              avatar={null}
              seed={seed}
              mood={mood}
              className="relative size-9 shrink-0"
              quiet
            />
          )}
          <span className="relative truncate text-sm font-medium">{name}</span>
          {loading ? null : (
            <span className="relative min-w-0 flex-1 truncate text-sm text-muted-foreground">
              {doing}
            </span>
          )}
        </button>
      ) : null}
      <div ref={scroller} onScroll={follow} className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col items-center gap-1 px-6 pt-10 pb-5 text-center">
          {/* Its treats and its box are beside the agent's own creature, not a sub-agent's. */}
          {subagent === undefined ? <CreatureCare agent={agent}>{face}</CreatureCare> : face}
          {subagent === undefined ? (
            <SubagentBrood agentId={agent.id} subagents={subagents} />
          ) : null}
          <div ref={nameplate} className="flex flex-col items-center gap-1">
            <div className="mt-3 flex items-center gap-0.5">
              <h2 className="text-lg font-medium">{name}</h2>
              {subagent !== undefined || !agent.hatched ? null : (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`${name}'s wardrobe`}
                  title="Wardrobe"
                  onClick={() => openWardrobe(true)}
                  className="-mr-8 size-7 text-muted-foreground/70"
                >
                  <TShirtIcon />
                </Button>
              )}
            </div>
            {/* The line in the transcript is the one announced; this repeats it beside the creature. */}
            {loading ? (
              // Not "Ready": nothing has been heard from it yet.
              <div data-loading aria-busy="true" className="placeholder-late flex h-5 items-center">
                <Skeleton className="h-2.5 w-16 rounded-full" />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{doing}</p>
            )}
          </div>
          {subagent === undefined ? null : (
            <p className="mt-1 text-xs text-muted-foreground">
              A sub-agent of {agentName}
              {subagent.parentTitle === undefined ? "" : `, for “${subagent.parentTitle}”`}
            </p>
          )}
          {reconnecting ? (
            <p className="mt-1 text-xs text-muted-foreground">reconnecting…</p>
          ) : null}
        </div>
        {/* What is pinned to the agent is the agent's, not a sub-agent's. */}
        {subagent === undefined ? <PinnedShelf agentId={agent.id} onOpen={onOpenFile} /> : null}
        {using === undefined ? null : (
          // The last screen the agent used here may still be its own; the section says when it is.
          <AgentIdContext value={agent.id}>
            <UseNow key={using.id} use={using} chatId={chatId} />
          </AgentIdContext>
        )}
        {running.length === 0 ? null : (
          <PanelSection
            id="running"
            title="Running in the background"
            count={running.length}
            said={<Spinner className="size-3.5" />}
          >
            <div className="px-2.5 pb-3">
              <JobRows agentId={agent.id} jobs={running} />
            </div>
          </PanelSection>
        )}
        {subagent !== undefined || subagents.length === 0 ? null : (
          <PanelSection
            id="subagents"
            title="Sub-agents at work"
            count={subagents.length}
            said={<Spinner className="size-3.5" />}
          >
            <div className="px-2.5 pb-3">
              <SubagentRows agentId={agent.id} subagents={subagents} />
            </div>
          </PanelSection>
        )}
        {subagent !== undefined || threads.length === 0 ? null : (
          // Mostly read and done with, so they are folded until they are wanted.
          <PanelSection
            id="doods"
            title="From other Doods"
            count={threads.length}
            said={threadsSaid(threads)}
            startsFolded
          >
            <div className="px-2.5 pb-3">
              <ThreadRows agentId={agent.id} threads={threads} />
            </div>
          </PanelSection>
        )}
        {subagent !== undefined || slack.length === 0 ? null : (
          <PanelSection
            id="slack"
            title="From Slack"
            count={slack.length}
            said={threadsSaid(slack)}
            startsFolded
          >
            <div className="px-2.5 pb-3">
              <SlackRows agentId={agent.id} threads={slack} current={chatId} />
            </div>
          </PanelSection>
        )}
        {presence}
        {onOpenFile === undefined || files.length === 0 ? null : (
          <PanelSection id="shared" title="Shared here" count={files.length} startsFolded>
            <ul className="flex flex-col gap-0.5 px-2.5 pb-3">
              {files.map((file) => (
                <Shared key={file.id} agentId={agent.id} file={file} onOpen={onOpenFile} />
              ))}
            </ul>
          </PanelSection>
        )}
        {chatless ? null : (
          <PanelSection
            id="did"
            title="What it did here"
            count={runs.length === 0 ? undefined : runs.length}
            said={
              runs.some((run) => run.status === "working") ? (
                <Spinner className="size-3.5" />
              ) : undefined
            }
          >
            {loading ? (
              <RowsPlaceholder className="px-2.5 pb-4" />
            ) : runs.length === 0 ? (
              <p className="px-5 pb-4 text-sm text-muted-foreground">
                Nothing yet. When {name} gets something substantial done in this chat, it notes it
                here, with its steps inside.
              </p>
            ) : (
              <div className="flex flex-col gap-0.5 px-2.5 pb-4">
                <ul className="flex flex-col gap-0.5">
                  {(allRuns ? runs : runs.slice(0, FIRST)).map((run) => (
                    <Work key={run.id} run={run} />
                  ))}
                </ul>
                {runs.length <= FIRST ? null : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setAllRuns(!allRuns)}
                    className="ml-0.5 self-start font-normal text-muted-foreground"
                  >
                    {allRuns ? "Show fewer" : `Show ${runs.length - FIRST} more`}
                  </Button>
                )}
              </div>
            )}
          </PanelSection>
        )}
      </div>
    </aside>
  )
}
