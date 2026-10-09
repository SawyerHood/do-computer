import {
  jobOutcome,
  type JobSummary,
  type NoticePart,
  spanOf,
  type ToolPart,
} from "@durable-computer/protocol"
import {
  CaretDownIcon,
  CaretRightIcon,
  CheckCircleIcon,
  StopCircleIcon,
  TerminalWindowIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { atom, useAtom, useSetAtom } from "jotai"
import { useContext, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Spinner } from "@/components/ui/spinner"
import { client } from "@/lib/client"
import { jobsKey, jobsQuery } from "@/lib/collections"
import { queryClient } from "@/lib/query"
import { cn } from "@/lib/utils"
import { AgentIdContext } from "./sent-file.tsx"

/** How often a running command is asked what it has printed since. */
const READ_EVERY_MS = 4_000
/** How much of what a command printed is kept on the page: the end of it. */
const KEPT_CHARS = 32 * 1024
/** How many lines of it are shown. */
const SHOWN_LINES = 40

/** How a command ended, as the middle of a sentence: "finished in 4m 12s". */
const ended = (job: {
  status: JobSummary["status"]
  exitCode?: number | undefined
  ms: number
}) => {
  const words = jobOutcome(job)
  return words.charAt(0).toLowerCase() + words.slice(1)
}

const firstLine = (command: string) => command.split("\n")[0] ?? command

/** A command is one of an agent's, and ids start over if its record of them is ever lost. */
const keyOf = (job: Pick<JobSummary, "id" | "startedAt">) => `${job.id}-${job.startedAt}`
const domId = (job: Pick<JobSummary, "id" | "startedAt">) => `command-${keyOf(job)}`

/** Which commands are unfolded where they were started, to show what they are printing. */
const openCommandsAtom = atom<Record<string, boolean>>({})

/** An agent's background commands, oldest first, from the query the whole page shares. */
export function useJobs(agentId: string | undefined): JobSummary[] {
  const { data } = useQuery({ ...jobsQuery(agentId ?? ""), enabled: agentId !== undefined })
  return data ?? EMPTY
}
const EMPTY: JobSummary[] = []

/** The commands that are running, of one chat or of the whole agent. */
export function useRunningJobs(agentId: string | undefined, chatId?: string): JobSummary[] {
  const jobs = useJobs(agentId)
  return useMemo(
    () =>
      jobs.filter(
        (job) => job.status === "running" && (chatId === undefined || job.chatId === chatId),
      ),
    [jobs, chatId],
  )
}

/** What the agent is waiting on, in a few words, or undefined when it is waiting on nothing. */
export function waitingWords(running: JobSummary[], name: boolean): string | undefined {
  if (running.length === 0) return undefined
  if (running.length > 1) return `Waiting on ${running.length} commands`
  return name ? `Waiting on ${firstLine(running[0]!.command)}` : "Waiting on a command"
}

/** Stop a background command. Its agent is told that someone stopped it. */
export async function stopJob(agentId: string, jobId: string): Promise<void> {
  try {
    await client.agent(agentId).stopJob(jobId)
  } finally {
    await queryClient.invalidateQueries({ queryKey: jobsKey(agentId), exact: true })
  }
}

type Printed = { text: string; next: number | undefined }

/**
 * The end of what a running command has printed, added to while it is shown. Whatever shows
 * the same command shares it, so the command is asked once however many places it is in.
 */
function usePrinted(agentId: string, job: JobSummary, on: boolean): string {
  const queryKey = [...jobsKey(agentId), keyOf(job), "output"]
  const { data } = useQuery<Printed>({
    queryKey,
    queryFn: async () => {
      const before = queryClient.getQueryData<Printed>(queryKey)
      const more = await client.agent(agentId).jobOutput(job.id, before?.next)
      return {
        text: `${before?.text ?? ""}${more.output}`.slice(-KEPT_CHARS),
        next: more.next,
      }
    },
    enabled: on && job.status === "running",
    refetchInterval: READ_EVERY_MS,
    // What it printed after it ended is with the word that it ended.
    retry: false,
  })
  return data?.text ?? ""
}

const lastLine = (text: string) => text.trimEnd().split("\n").at(-1)?.trim() ?? ""

/** How long ago `since` was, kept up to the second while it is on screen. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])
  return <span className="whitespace-nowrap tabular-nums">{spanOf(Math.max(0, now - since))}</span>
}

/** The mark of a command, where a sub-agent has its face. */
function CommandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-[0.6rem] bg-secondary text-muted-foreground",
        className,
      )}
    >
      <TerminalWindowIcon className="size-[56%]" />
    </span>
  )
}

function StopButton({ agentId, job }: { agentId: string; job: JobSummary }) {
  const [stopping, setStopping] = useState(false)
  return (
    <Button
      variant="outline"
      size="xs"
      disabled={stopping}
      aria-label={`Stop ${firstLine(job.command)}`}
      onClick={(event) => {
        event.stopPropagation()
        setStopping(true)
        void stopJob(agentId, job.id).finally(() => setStopping(false))
      }}
      className="shrink-0"
    >
      Stop
    </Button>
  )
}

/** The end of what a running command has printed, with the way to stop it. */
function Printing({ agentId, job }: { agentId: string; job: JobSummary }) {
  const text = usePrinted(agentId, job, true)
  const shown = useMemo(() => text.trimEnd().split("\n").slice(-SHOWN_LINES).join("\n"), [text])
  const pre = useRef<HTMLPreElement>(null)
  // It rests at the newest line, as a terminal does.
  useEffect(() => {
    if (pre.current !== null) pre.current.scrollTop = pre.current.scrollHeight
  }, [shown])
  return (
    <div className="mt-2 overflow-hidden rounded-xl bg-surface">
      <div className="flex min-h-10 items-center gap-2 border-b py-1.5 pr-2 pl-3 text-xs text-muted-foreground">
        <Spinner className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1">
          Running on {job.computer} for <Elapsed since={job.startedAt} /> · the last lines it
          printed
        </span>
        <StopButton agentId={agentId} job={job} />
      </div>
      <pre
        ref={pre}
        aria-label={`What ${firstLine(job.command)} is printing`}
        className="max-h-80 overflow-auto px-3 py-2.5 font-mono text-xs leading-relaxed wrap-anywhere whitespace-pre-wrap text-foreground"
      >
        {shown === "" ? (
          <span className="text-muted-foreground">It has printed nothing yet.</span>
        ) : (
          shown
        )}
      </pre>
    </div>
  )
}

/**
 * A command where the agent left it running, in its message: how it is getting on, and, opened,
 * what it is printing. Once it has ended it says how; what it printed is with the word of that.
 */
export function CommandChip({ part }: { part: ToolPart }) {
  const agentId = useContext(AgentIdContext)
  const jobs = useJobs(agentId)
  const [open, setOpen] = useAtom(openCommandsAtom)
  const { job: id } = part.details as { job: string }
  const args = part.args as { command?: string; run_in_background?: boolean } | null
  const command = args?.command ?? ""
  const job = jobs.find((one) => one.id === id && one.command === command)
  const running = job?.status === "running"
  const key = job === undefined ? undefined : keyOf(job)
  const unfolded = running && key !== undefined && open[key] === true
  // One the agent did not start this way was moved here when the wait for it ended.
  const moved = args?.run_in_background !== true
  const how =
    job === undefined ? (
      "ran in the background"
    ) : running ? (
      <>
        {moved ? "still going after a minute, now in the background" : "in the background"} ·{" "}
        <Elapsed since={job.startedAt} />
      </>
    ) : (
      ended({ ...job, ms: (job.endedAt ?? job.startedAt) - job.startedAt })
    )
  const body = (
    <>
      <CommandMark className="size-6" />
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span className="max-w-full truncate font-mono text-[0.8125rem] font-medium">
          {firstLine(command)}
        </span>
        <span className="text-xs text-muted-foreground">
          {job === undefined ? null : <>{job.computer} · </>}
          {how}
        </span>
      </span>
      {running ? (
        <Spinner className="size-3.5 shrink-0 text-muted-foreground" />
      ) : job?.status === "done" || job === undefined ? (
        <CheckCircleIcon className="size-4 shrink-0 text-muted-foreground" />
      ) : job.status === "stopped" ? (
        <StopCircleIcon className="size-4 shrink-0 text-muted-foreground" />
      ) : (
        <WarningCircleIcon className="size-4 shrink-0 text-destructive" />
      )}
    </>
  )
  const shape =
    "flex w-fit max-w-full items-center gap-2 rounded-2xl border bg-surface py-1.5 pr-2.5 pl-2 text-left text-sm"
  if (agentId === undefined || job === undefined || !running || key === undefined) {
    return (
      <div data-testid="command-chip" className={shape}>
        {body}
      </div>
    )
  }
  return (
    <div id={domId(job)} className="scroll-my-4">
      <button
        type="button"
        data-testid="command-chip"
        aria-expanded={unfolded}
        title={`Running in the background on ${job.computer}: ${firstLine(command)}`}
        onClick={() => setOpen((before) => ({ ...before, [key]: !before[key] }))}
        className={cn(
          shape,
          "outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/40",
        )}
      >
        {body}
        <CaretRightIcon
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            unfolded && "rotate-90",
          )}
        />
      </button>
      {unfolded ? <Printing agentId={agentId} job={job} /> : null}
    </div>
  )
}

function JobRow({
  agentId,
  job,
  onOpen,
}: {
  agentId: string
  job: JobSummary
  onOpen?: (() => void) | undefined
}) {
  const setOpen = useSetAtom(openCommandsAtom)
  const last = lastLine(usePrinted(agentId, job, true))
  // Opens it where it was started, which is where what it prints is read.
  const show = () => {
    setOpen((before) => ({ ...before, [keyOf(job)]: true }))
    onOpen?.()
    requestAnimationFrame(() =>
      document.getElementById(domId(job))?.scrollIntoView({ block: "center" }),
    )
  }
  return (
    <li className="flex items-center gap-2.5 rounded-xl py-1.5 pr-2 pl-2.5 hover:bg-surface">
      <button
        type="button"
        title="Show what it is printing"
        onClick={show}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
      >
        <CommandMark />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate font-mono text-[0.8125rem]">{firstLine(job.command)}</span>
            <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
              {job.computer} · <Elapsed since={job.startedAt} />
            </span>
          </span>
          <span className="mt-0.5 block truncate font-mono text-[0.71875rem] text-muted-foreground">
            {last === "" ? " " : last}
          </span>
        </span>
      </button>
      <StopButton agentId={agentId} job={job} />
    </li>
  )
}

/** The commands running in the background, as a list: each opens in the chat and can be stopped. */
export function JobRows({
  agentId,
  jobs,
  onOpen,
}: {
  agentId: string
  jobs: JobSummary[]
  /** Called when one was opened, by whatever holds the list and should get out of the way. */
  onOpen?: () => void
}) {
  return (
    <ul aria-label="Running in the background" className="flex flex-col gap-0.5">
      {jobs.map((job) => (
        <JobRow key={keyOf(job)} agentId={agentId} job={job} onOpen={onOpen} />
      ))}
    </ul>
  )
}

/**
 * How many commands are running in the background, above the message box, where it is whether
 * or not the agent's panel is. It opens the list of them.
 */
export function RunningCount({ agentId, jobs }: { agentId: string; jobs: JobSummary[] }) {
  const [open, setOpen] = useState(false)
  if (jobs.length === 0) return null
  return (
    // On a phone there is no room for a list: a command is opened, and stopped, in the chat.
    <div className="mx-auto flex w-full max-w-3xl px-6 pb-2 max-md:hidden">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              size="xs"
              className="rounded-full font-normal text-muted-foreground aria-expanded:bg-accent aria-expanded:text-foreground"
            />
          }
        >
          <Spinner className="size-3.5" />
          {jobs.length} running
          <CaretDownIcon className="size-3" />
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          sideOffset={8}
          className="max-h-80 w-[28.75rem] max-w-[90vw] gap-0 overflow-y-auto p-1.5"
        >
          <h3 className="px-2.5 py-1.5 text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
            Running in the background
          </h3>
          <JobRows agentId={agentId} jobs={jobs} onOpen={() => setOpen(false)} />
        </PopoverContent>
      </Popover>
    </div>
  )
}

/**
 * Word that a command the agent left running in the background has ended, in the chat that
 * started it: how it ended, and the last of what it printed for whoever wants to look.
 */
export function CommandWord({ part }: { part: NoticePart }) {
  const job = part.job
  const command = (
    <span className="font-mono font-medium text-foreground">{firstLine(part.text)}</span>
  )
  const stopped = job?.status === "stopped"
  const well = job === undefined || job.status === "done"
  const Icon = stopped ? StopCircleIcon : well ? CheckCircleIcon : WarningCircleIcon
  return (
    <div
      className="border-l-2 py-0.5 pl-3 text-sm text-muted-foreground"
      data-testid="command-word"
    >
      <div className="flex items-start gap-2">
        <Icon className={cn("mt-0.5 size-4 shrink-0", !well && !stopped && "text-destructive")} />
        <span className="min-w-0 wrap-anywhere">
          {stopped ? (
            <>You stopped {command}</>
          ) : (
            <>
              {command} {job === undefined ? "ended" : ended(job)}
            </>
          )}
          {job?.computer ? ` on ${job.computer}` : null}
        </span>
      </div>
      {part.detail === undefined ? null : (
        <Collapsible className="mt-1">
          <CollapsibleTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="group/more -ml-2 h-7 px-2 font-normal text-muted-foreground"
              />
            }
          >
            <CaretRightIcon
              data-icon="inline-start"
              className="transition-transform group-data-panel-open/more:rotate-90"
            />
            {well || stopped ? "What it printed" : "What went wrong"}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-1.5 max-h-96 overflow-auto rounded-xl bg-surface px-3 py-2 font-mono text-xs leading-relaxed wrap-anywhere whitespace-pre-wrap text-foreground">
              {part.detail}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}
