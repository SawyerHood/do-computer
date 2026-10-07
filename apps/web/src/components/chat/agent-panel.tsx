import {
  type AgentSummary,
  type ChatRun,
  chatRuns,
  type ChatState,
  type ChatSummary,
  type LibraryFile,
  sentFiles,
  toolActivity,
  type ToolPart,
  toolSummary,
} from "@durable-computer/protocol"
import {
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  FileIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"
import { useAtomValue } from "jotai"
import { useMemo } from "react"
import { ResizeHandle } from "@/components/shell/resize-handle"
import { client } from "@/lib/client"
import { agentPanelColumn } from "@/lib/columns"
import { formatBytes, isViewable } from "@/lib/library"
import { type MascotMood, mascotMoodAtom } from "@/lib/mascot"
import { cn } from "@/lib/utils"

import { ThreadRows } from "./agent-threads.tsx"
import { SubagentBrood, SubagentRows, subagentSeed, subagentWords } from "./subagents.tsx"

/** How many of the latest pieces of work are listed. */
const SHOWN = 30

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
  return (
    <li>
      <details className="group/step">
        <summary className="flex cursor-default list-none items-start gap-2 rounded-lg px-2 py-1 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden">
          <span
            aria-hidden
            className={cn(
              "mt-1.5 size-1.5 shrink-0 rounded-full bg-current",
              part.status === "error" && "bg-destructive",
              going && "animate-pulse",
            )}
          />
          <span className="line-clamp-1 min-w-0 flex-1 break-all group-open/step:line-clamp-none">
            {going ? toolActivity(part) : toolSummary(part)}
          </span>
        </summary>
        <pre className="mt-1 mb-1.5 ml-5 max-h-56 overflow-auto rounded-lg bg-background p-2 text-xs whitespace-pre-wrap break-words text-muted-foreground">
          {output === "" ? (going ? "Still going." : "It returned nothing.") : output}
        </pre>
      </details>
    </li>
  )
}

/** One piece of work: what it was, what came of it, and its steps for whoever wants them. */
function Work({ run }: { run: ChatRun }) {
  const summary = run.entry
  return (
    <li>
      <details className="group rounded-xl open:bg-surface">
        {/* Only the title, so the list can be taken in at a glance. The rest is inside. */}
        <summary className="flex cursor-default list-none items-center gap-2.5 rounded-xl px-2.5 py-2 outline-none hover:bg-surface focus-visible:ring-3 focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden">
          {run.status === "working" ? (
            <CircleNotchIcon className="size-4 shrink-0 animate-spin text-muted-foreground" />
          ) : run.status === "failed" ? (
            <WarningCircleIcon className="size-4 shrink-0 text-destructive" />
          ) : (
            <CheckCircleIcon className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1 truncate text-sm group-open:font-medium group-open:whitespace-normal">
            {summary.title}
          </span>
        </summary>
        <div className="flex flex-col gap-1.5 px-2.5 pb-2.5 pl-9">
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
        </div>
      </details>
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
 * The agent, beside its chat: its creature at a size where it can be watched, what it is doing,
 * what it has shared here and what it has done here. The transcript keeps only what was said; this
 * is where the work behind an answer can be opened and read, and a file found without scrolling
 * back to where it was sent.
 */
export function AgentPanel({
  agent,
  state,
  face,
  reconnecting,
  startFresh,
  subagent,
  subagents,
  threads = [],
  presence,
  onOpenFile,
  chatless = false,
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
  /** The sub-agents started in this chat. */
  subagents: ChatSummary[]
  /** The conversations other agents have had with it, newest first. */
  threads?: ChatSummary[]
  /** In a team: who is in this chat right now. Shown above what the agent did. */
  presence?: React.ReactNode
  /** Opens a file the agent sent beside the chat, by its id. Without it the files are not listed. */
  onOpenFile?: (fileId: string) => void
  /** Beside a page that is not a chat: there is then no work here to list. */
  chatless?: boolean
}) {
  const mood = useAtomValue(
    mascotMoodAtom(subagent === undefined ? agent.id : subagentSeed(agent.id, subagent.chatId)),
  )
  const width = useAtomValue(agentPanelColumn.width)
  // Newest first. Each is a piece of work the agent wrote an entry for, which it does only for
  // the substantial ones, however many steps it took.
  const runs = useMemo(() => chatRuns(state).slice(-SHOWN).reverse(), [state])
  const files = useMemo(() => sentFiles(state), [state])
  const agentName = agent.name ?? "New agent"
  const name = subagent?.title ?? agentName
  // A sub-agent at rest says how it ended; one at work says what it is doing.
  const doing =
    subagent !== undefined && mood.state === "idle"
      ? subagentWords(subagent.status)
      : moodWords(mood, agent.hatched)
  return (
    <aside
      aria-label={`About ${name}`}
      className="relative flex shrink-0 flex-col border-l bg-rail/40"
      style={{ width }}
    >
      <ResizeHandle column={agentPanelColumn} edge="left" label={`Resize ${name}'s panel`} />
      {/* Rarely wanted, so it is out of the way in the corner. */}
      {startFresh === undefined ? null : (
        <button
          type="button"
          aria-label="Start fresh"
          title={startFresh.title}
          disabled={startFresh.disabled}
          onClick={startFresh.run}
          className="absolute top-2.5 right-2.5 rounded-md p-1.5 text-muted-foreground/60 outline-none hover:bg-surface hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-40"
        >
          <ArrowsClockwiseIcon className="size-4" />
        </button>
      )}
      <div className="flex flex-col items-center gap-1 px-6 pt-10 pb-5 text-center">
        {face}
        {subagent === undefined ? <SubagentBrood agentId={agent.id} subagents={subagents} /> : null}
        <h2 className="mt-3 text-lg font-medium">{name}</h2>
        {/* The line in the transcript is the one announced; this repeats it beside the creature. */}
        <p className="text-sm text-muted-foreground">{doing}</p>
        {subagent === undefined ? null : (
          <p className="mt-1 text-xs text-muted-foreground">
            A sub-agent of {agentName}
            {subagent.parentTitle === undefined ? "" : `, for “${subagent.parentTitle}”`}
          </p>
        )}
        {reconnecting ? <p className="mt-1 text-xs text-muted-foreground">reconnecting…</p> : null}
      </div>
      {subagent !== undefined || subagents.length === 0 ? null : (
        <div className="flex max-h-[40%] shrink-0 flex-col border-t">
          <h3 className="px-5 pt-4 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Sub-agents in this chat
          </h3>
          <div className="min-h-0 overflow-y-auto px-2.5 pb-3">
            <SubagentRows agentId={agent.id} subagents={subagents} />
          </div>
        </div>
      )}
      {subagent !== undefined || threads.length === 0 ? null : (
        <div className="flex max-h-[30%] shrink-0 flex-col border-t">
          <h3 className="px-5 pt-4 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            From other agents
          </h3>
          <div className="min-h-0 overflow-y-auto px-2.5 pb-3">
            <ThreadRows agentId={agent.id} threads={threads} />
          </div>
        </div>
      )}
      {presence}
      {onOpenFile === undefined || files.length === 0 ? null : (
        <section aria-label="Shared here" className="flex max-h-[30%] shrink-0 flex-col border-t">
          <h3 className="px-5 pt-4 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Shared here
          </h3>
          <ul className="flex min-h-0 flex-col gap-0.5 overflow-y-auto px-2.5 pb-3">
            {files.map((file) => (
              <Shared key={file.id} agentId={agent.id} file={file} onOpen={onOpenFile} />
            ))}
          </ul>
        </section>
      )}
      <div hidden={chatless} className="flex min-h-0 flex-1 flex-col border-t">
        <h3 className="px-5 pt-4 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          What it did here
        </h3>
        {runs.length === 0 ? (
          <p className="px-5 text-sm text-muted-foreground">
            Nothing yet. When {name} gets something substantial done in this chat, it notes it here,
            with its steps inside.
          </p>
        ) : (
          <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pb-4">
            {runs.map((run) => (
              <Work key={run.id} run={run} />
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}
