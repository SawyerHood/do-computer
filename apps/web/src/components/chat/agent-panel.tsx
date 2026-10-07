import {
  type AgentSummary,
  type ChatActivity,
  type ChatRun,
  chatRuns,
  type ChatState,
  type RunSummary,
  runSummary,
  toolActivity,
  type ToolPart,
  toolSummary,
} from "@durable-computer/protocol"
import { useQuery } from "@tanstack/react-query"
import {
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react"
import { useAtomValue } from "jotai"
import { useMemo } from "react"
import { client } from "@/lib/client"
import { activityKey } from "@/lib/collections"
import { type MascotMood, mascotMoodAtom } from "@/lib/mascot"
import { cn } from "@/lib/utils"

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
function Work({ run, summary }: { run: ChatRun; summary: RunSummary }) {
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

/**
 * The agent, beside its chat: its creature at a size where it can be watched, what it is doing,
 * and what it has done here. The transcript keeps only what was said; this is where the work
 * behind an answer can be opened and read.
 */
export function AgentPanel({
  agent,
  chatId,
  state,
  face,
  reconnecting,
  startFresh,
  onClose,
}: {
  agent: AgentSummary
  chatId: string
  state: ChatState
  /** Its creature, large. Given from outside because a new agent hatches in it. */
  face: React.ReactNode
  /** The chat's stream dropped and is being picked up again. */
  reconnecting: boolean
  /** Starts the chat's context over, where there is something to start over from. */
  startFresh: { title: string; disabled: boolean; run: () => void } | undefined
  onClose: () => void
}) {
  const mood = useAtomValue(mascotMoodAtom(agent.id))
  // What a small model wrote about the chat's work, where the deployment has one. It writes up
  // only the substantial pieces, and those are the ones listed. Where there is no such model,
  // every piece is listed, described from the run itself.
  const { data: written } = useQuery<ChatActivity>({
    queryKey: activityKey(agent.id, chatId),
    queryFn: () => client.agent(agent.id).activity(chatId),
  })
  // Newest first. Each is one thing that was asked for, however many steps it took.
  const runs = useMemo(() => {
    if (written === undefined) return []
    const all = chatRuns(state)
    const kept = written.judged ? all.filter((run) => Object.hasOwn(written.runs, run.id)) : all
    return kept.slice(-SHOWN).reverse()
  }, [state, written])
  const name = agent.name ?? "New agent"
  return (
    <aside
      aria-label={`About ${name}`}
      className="relative flex w-80 shrink-0 flex-col border-l bg-rail/40"
    >
      <button
        type="button"
        aria-label="Hide this panel"
        title="Hide"
        onClick={onClose}
        className="absolute top-3 right-3 z-10 rounded-full p-1.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
      >
        <XIcon className="size-4" />
      </button>
      <div className="flex flex-col items-center gap-1 px-6 pt-10 pb-5 text-center">
        {face}
        <h2 className="mt-3 text-lg font-medium">{name}</h2>
        {/* The line in the transcript is the one announced; this repeats it beside the creature. */}
        <p className="text-sm text-muted-foreground">{moodWords(mood, agent.hatched)}</p>
        {agent.tagline ? (
          <p className="mt-1 text-xs text-muted-foreground">{agent.tagline}</p>
        ) : null}
        {reconnecting ? <p className="mt-1 text-xs text-muted-foreground">reconnecting…</p> : null}
        {startFresh === undefined ? null : (
          <button
            type="button"
            aria-label="Start fresh"
            title={startFresh.title}
            disabled={startFresh.disabled}
            onClick={startFresh.run}
            className="mt-2 flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-40"
          >
            <ArrowsClockwiseIcon className="size-3.5" /> Start fresh
          </button>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col border-t">
        <h3 className="px-5 pt-4 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          What it did here
        </h3>
        {runs.length === 0 ? (
          <p className="px-5 text-sm text-muted-foreground">
            Nothing yet. When {name} gets something substantial done in this chat, it is summed up
            here, with its steps inside.
          </p>
        ) : (
          <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pb-4">
            {runs.map((run) => (
              <Work key={run.id} run={run} summary={written?.runs[run.id] ?? runSummary(run)} />
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}
