import { type JobStatus, type JobSummary, spanOf } from "@do-computer/protocol"
import {
  JOB_LOG_CAP_BYTES,
  type JobFollowed,
  type JobState,
  JobsUnsupported,
  type SandboxJobs,
  shellJobs,
} from "@do-computer/sandbox"
import type { Context } from "@earendil-works/chord"
import { Type } from "@earendil-works/pi-ai"
import {
  type Conversation,
  type ConversationId,
  defineDoc,
  defineExtension,
  defineTool,
  type Extension,
  type Harness,
  section,
  type ToolRegistration,
} from "@earendil-works/pi-durable"
import { createBashTool } from "@earendil-works/pi-durable/tools"
import { busOn, eventText } from "./bus.ts"
import { ComputerEnv, type ComputerTarget } from "./computers.ts"
import { own } from "./own.ts"

/** How long a command is waited for before it is left to run in the background. */
export const FOREGROUND_MS = 60_000
/** How long a command that was asked to run in the background is watched for failing at once. */
const STARTING_MS = 1_000
/** How long a background command may run when the agent does not say, and the most it may ask. */
export const DEFAULT_JOB_LIFE_MS = 60 * 60_000
export const MAX_JOB_LIFE_MS = 24 * 60 * 60_000
/** The longest a command is waited for when the agent says how long, as it was before jobs. */
const MAX_WAIT_MS = 600_000
/** How many background commands of one agent can be running at once. */
export const MAX_RUNNING_JOBS = 8
/** The most the agent may ask `output` to wait for a command to end. */
const MAX_OUTPUT_WAIT_SECONDS = 60
/** What pi-durable's `bash` keeps of a command's output, past which it points at a file. */
const KEEP_BYTES = 50 * 1024
const KEEP_LINES = 2000
/** How much of the end of its output the agent is sent when a command ends. */
const REPORT_BYTES = 16 * 1024
/** A command is looked at on every wake-up at first, and this often once it has run a while. */
const SETTLED_AFTER_MS = 10 * 60_000
const SETTLED_EVERY_MS = 60_000
/**
 * And this often once it has run an hour: a server left running, say. The agent is woken for
 * each look and may be put away between two, which on Cloudflare takes a while with nothing
 * asked of it; looked at every minute it never was.
 */
const LONG_AFTER_MS = 60 * 60_000
const LONG_EVERY_MS = 5 * 60_000
/** How often a command that has run this long is looked at, at the most. */
const everyMs = (age: number) =>
  age > LONG_AFTER_MS ? LONG_EVERY_MS : age > SETTLED_AFTER_MS ? SETTLED_EVERY_MS : 0
/**
 * How soon a running command is looked at again, by how long it has run: a short one should
 * not seem to take longer than it did. It is when the agent asks to be woken for it.
 */
export const lookAgainMs = (age: number) =>
  age < 2 * 60_000
    ? 5_000
    : age < SETTLED_AFTER_MS
      ? 15_000
      : age < LONG_AFTER_MS
        ? SETTLED_EVERY_MS
        : LONG_EVERY_MS
/** The least time between the start of one look and a wake-up for the next. */
const MIN_LOOK_GAP_MS = 1_000
/** A command that is over is forgotten after this long. Its folder goes at the same age. */
const FORGET_AFTER_MS = 7 * 24 * 60 * 60_000
/** One follow of a job may wait this long; a longer wait is made of several. */
const FOLLOW_STEP_MS = 570_000
/** Past its time limit by this much with no word of how it ended, a command is given up on. */
const OVERDUE_MS = 10 * 60_000

/** Entry kind of word that a background command ended, in the chat that started it. */
export const JOB_ENTRY = "dc.job"

/** What the agent is told to set it going when a command ends. Not shown in the chat. */
const NUDGE =
  '<meta kind="command">A command you left running in the background has ended, above. The user has not seen that: carry on with what it was for, or tell them what matters about it in your own words. You do not need to wait for commands that are still running.</meta>'

export type JobRecord = {
  /** The chat it was started in. */
  chatId: string
  computerId: string
  /** What the computer was called when it started. */
  computer: string
  command: string
  /** What its folder on the computer is named. */
  folder: string
  log: string
  status: JobStatus
  startedAt: number
  /** How long it may run. */
  lifeMs: number
  endedAt?: number
  exitCode?: number
  /** How many bytes of its log the agent has been shown. */
  seen: number
  /** Why it ended, where the status alone does not say. */
  reason?: "output" | "computer"
}

type JobsState = {
  jobs: Record<string, JobRecord>
  next: number
  intents?: Record<string, JobRecord>
}

/** The commands the agent left running in the background, by the id it calls each. */
export const JobsDoc = defineDoc<JobsState>({
  kind: "dc.jobs",
  version: 1,
  scope: "session",
  checkpointWhen: () => false,
  initial: () => ({ jobs: {}, next: 1, intents: {} }),
})

/** Word of a command's end, as it was sent to the chat that started it. */
export type JobReport = {
  id: string
  chatId: string
  /** The turn the word gives the agent, when it gives one. */
  turn: Awaited<ReturnType<Conversation["submit"]>> | undefined
}

/** A problem the caller should be told about, as opposed to a bug. */
export class JobError extends Error {}

export type JobsOptions = {
  /** Whose jobs these are. Names their folder on a machine that agents share. */
  readonly agentId: string
  readonly now: () => number
  /** What looking in on jobs runs under. It outlasts the tool call that started one. */
  readonly context: Context
  /** A computer by id, checked and ready to work on, or why it cannot be worked on. */
  readonly computer: (id: string, context: Context) => Promise<ComputerTarget | string>
  /** How long a command is waited for before it is left to run in the background. */
  readonly foregroundMs?: number
  /**
   * Look at running commands this often, whatever their age, with a timer of its own as well as
   * the wake-ups. Only a test sets it: in use the wake-ups alone look (`nextWake`).
   */
  readonly lookMs?: number
  /** Called when a command started running in the background, which wants looking in on. */
  readonly onStarted?: () => void
  /** Called when word of a command's end has been sent to its chat. */
  readonly onReport?: (report: JobReport) => void
  readonly onError?: (error: unknown) => void
}

const fail = (text: string) => ({ isError: true, output: [{ type: "text" as const, text }] })

const statusOf = (state: JobState): JobStatus =>
  state.state === "running"
    ? "running"
    : state.state === "lost"
      ? "lost"
      : state.timedOut
        ? "timed_out"
        : state.exitCode === 0
          ? "done"
          : "failed"

/**
 * When a command ended. It is looked at now and then, so the time it was found over is later
 * than the time it was: where its computer says how long it ran, that is what counts.
 */
const endOf = (job: JobRecord, state: JobState, now: number): number =>
  state.state === "exited" && state.ranMs !== undefined
    ? Math.min(now, job.startedAt + state.ranMs)
    : now

/** How a command ended, as the agent is told it. */
function ending(job: JobRecord, now: number): string {
  const span = spanOf((job.endedAt ?? now) - job.startedAt)
  switch (job.status) {
    case "running":
      return `is still running, ${span} so far`
    case "done":
      return `finished with exit code 0 after ${span}`
    case "failed":
      return job.reason === "output"
        ? `was stopped after ${span} because it had printed more than ${JOB_LOG_CAP_BYTES / (1024 * 1024)} MB`
        : `ended with exit code ${job.exitCode ?? "unknown"} after ${span}`
    case "timed_out":
      return `was stopped after ${span}, at its time limit of ${spanOf(job.lifeMs)}`
    case "stopped":
      return `was stopped after ${span}`
    case "lost":
      return job.reason === "computer"
        ? `was lost after ${span}: the computer is no longer one you can use`
        : `was lost after ${span}: the machine stopped or restarted before it ended`
  }
}

/**
 * Commands that run in the background: the `bash` tool that starts them, the tool the agent
 * looks in on them with, and telling the agent when one ends.
 *
 * On a machine that can keep a command going by itself, every command is a job (see
 * `SandboxJobs`), and a call to `bash` is a wait for one. A command still running when the wait
 * ends is not stopped: it is written down here and the call returns. From then on the agent's
 * wake-ups look at it, which also keeps its machine from being stopped for idleness, and when
 * it ends the chat that started it is sent word and the agent is given a turn there. Each step
 * is keyed or repeatable, so a crash can delay that word but not lose it or send it twice.
 */
export class Jobs {
  readonly extension: Extension
  /** `bash`, to be installed in place of pi-durable's own. */
  readonly bashTool: ToolRegistration
  readonly #options: JobsOptions
  readonly #plain = createBashTool()
  #harness: Harness | undefined
  /** Foreground ownership is temporary; durable intents survive a crash before handoff. */
  readonly #foreground = new Set<string>()
  #ticking: Promise<void> = Promise.resolve()
  /** When each running job was last looked at. */
  readonly #looked = new Map<string, number>()
  /** When the last look began. */
  #tickedAt = 0
  /** The next look that is not a wake-up's, while there is one to come. */
  #again: ReturnType<typeof setTimeout> | undefined

  constructor(options: JobsOptions) {
    this.#options = options
    this.bashTool = this.#bash() as unknown as ToolRegistration
    this.extension = defineExtension({
      name: "dc.jobs",
      tools: [this.#tool()],
      sections: [
        section(
          "background",
          () =>
            `A command that takes long does not have to hold you up. Pass \`run_in_background\` to \`bash\` for a server, a watcher, or a build, install or test run likely to take more than a minute: the call returns at once, and when the command ends you get a message and a turn. A command you did not start that way and that is still running after ${Math.round((options.foregroundMs ?? FOREGROUND_MS) / 1000)} seconds is moved to the background by itself. Either way, do not sleep, poll or run it again while you wait: carry on with other work, or say what you started and end your turn. The \`background\` tool lists these commands, shows what one has printed and stops one; stop what is no longer needed. A lightweight shell has no background to run things in, and \`bash\` says so there.`,
        ),
      ],
    })
  }

  attach(harness: Harness): void {
    this.#harness = harness
  }

  /** Stop looking. What is running runs on, and is found again by whoever opens the agent. */
  close(): void {
    clearTimeout(this.#again)
    this.#again = undefined
    this.#harness = undefined
  }

  /**
   * When the agent should next be woken to look at its running commands, or null where none is
   * running. The agent may be put away until then: the commands run on their computers whether
   * it is loaded or not.
   */
  async nextWake(context: Context): Promise<number | null> {
    const running = Object.entries(await this.#jobs(context)).filter(
      ([, job]) => job.status === "running",
    )
    if (running.length === 0) return null
    const now = this.#options.now()
    const lookMs = this.#options.lookMs
    // From the last look, not from now: every request asks, and a time that moved on with each
    // one would never come while requests kept coming. One gone by is looked at on the next
    // wake-up, which is then at once.
    const due = Math.min(
      ...running.map(
        ([id, job]) =>
          (this.#looked.get(id) ?? job.startedAt) + (lookMs ?? lookAgainMs(now - job.startedAt)),
      ),
    )
    // Not again at once after a look that failed before it got to a command.
    return Math.max(due, this.#tickedAt + MIN_LOOK_GAP_MS)
  }

  /** Whether a command is being started, which keeps the agent awake until it is running. */
  async starting(context: Context): Promise<boolean> {
    const state = await this.#require().snapshot(JobsDoc, context)
    return Object.keys(state?.intents ?? {}).length > 0
  }

  /**
   * Look again soon, without waiting for a wake-up, where a test asks to look more often than
   * the wake-ups do. Otherwise the wake-up (`nextWake`) looks at the same pace, and a timer
   * would only cost: a Durable Object with a timer pending can neither hibernate nor be put
   * away, even one that is unreferenced, so an agent with a server left running in the
   * background was billed for every second of it, doing nothing.
   */
  #soon(_age: number): void {
    const lookMs = this.#options.lookMs
    if (lookMs === undefined || this.#again !== undefined || this.#harness === undefined) return
    const timer = setTimeout(() => {
      this.#again = undefined
      if (this.#harness !== undefined) void this.tick()
    }, lookMs)
    // Nothing should be kept alive only to look at a command.
    ;(timer as { unref?: () => void }).unref?.()
    this.#again = timer
  }

  #require(): Harness {
    if (this.#harness === undefined) throw new Error("Jobs are not attached to a harness")
    return this.#harness
  }

  /**
   * What keeps commands going on a computer, or undefined where nothing can. A computer
   * somebody connected keeps them itself; a Linux machine of the workspace is given the means.
   */
  #runner(target: ComputerTarget): SandboxJobs | undefined {
    const own = target.sandbox.jobs?.(this.#options.agentId)
    if (own !== undefined) return own
    return target.machine && target.sandbox.capabilities.realBinaries
      ? shellJobs(target.sandbox, this.#options.agentId)
      : undefined
  }

  async #jobs(context: Context): Promise<Record<string, JobRecord>> {
    return (await this.#require().snapshot(JobsDoc, context))?.jobs ?? {}
  }

  async #forgetIntent(folder: string): Promise<void> {
    await this.#require().commit(async (tx) => {
      const state = await tx.doc(JobsDoc)
      if (state.intents) delete state.intents[folder]
    }, this.#options.context)
  }

  /** The agent's background commands, oldest first: the running ones and those lately over. */
  async list(context: Context): Promise<JobSummary[]> {
    return Object.entries(await this.#jobs(context))
      .sort(([, a], [, b]) => a.startedAt - b.startedAt)
      .map(([id, job]) => ({
        id,
        chatId: job.chatId,
        computer: job.computer,
        command: job.command,
        status: job.status,
        startedAt: job.startedAt,
        ...(job.endedAt === undefined ? {} : { endedAt: job.endedAt }),
        ...(job.exitCode === undefined ? {} : { exitCode: job.exitCode }),
        log: job.log,
      }))
  }

  /** Whether any command is running, and so wants looking in on. */
  async working(context: Context): Promise<boolean> {
    const state = await this.#require().snapshot(JobsDoc, context)
    return (
      Object.values(state?.jobs ?? {}).some((job) => job.status === "running") ||
      Object.keys(state?.intents ?? {}).length > 0
    )
  }

  /** Whether a chat has a command running, whose end will give the agent a turn there. */
  async waiting(chatId: string, context: Context): Promise<boolean> {
    return Object.values(await this.#jobs(context)).some(
      (job) => job.status === "running" && job.chatId === chatId,
    )
  }

  async #find(id: string, context: Context): Promise<JobRecord> {
    const job = own(await this.#jobs(context), id.trim())
    if (job === undefined) {
      throw new JobError(`There is no background command "${id}". "list" shows the ones there are.`)
    }
    return job
  }

  /** Where a job runs, or a job error saying why it cannot be reached. */
  async #reach(job: JobRecord, context: Context): Promise<SandboxJobs> {
    const target = await this.#options.computer(job.computerId, context)
    if (typeof target === "string") throw new JobError(target)
    const runner = this.#runner(target)
    if (runner === undefined) {
      throw new JobError(`"${job.computer}" cannot run commands in the background.`)
    }
    return runner
  }

  /**
   * What a command has printed since the agent last looked, waiting up to `waitMs` for it to
   * end. Looking at one that has ended is how the agent learns of it, so no word is sent after.
   */
  async output(
    id: string,
    waitMs: number,
    context: Context,
    onOutput?: (text: string) => void,
  ): Promise<{ job: JobRecord; output: string }> {
    const job = await this.#find(id, context)
    const runner = await this.#reach(job, context)
    const followed = await runner.follow(job.folder, {
      from: job.seen,
      waitMs: job.status === "running" ? waitMs : 0,
      signal: context.abortSignal,
      onOutput,
    })
    const after = await this.#settle(id, followed, followed.next, context)
    return { job: after ?? job, output: followed.output }
  }

  /**
   * What a command has printed from `from` bytes on, for a person reading along. Without
   * `from`, the end of it. What the agent has seen of it is left as it was.
   */
  async read(
    id: string,
    from: number | undefined,
    context: Context,
  ): Promise<{ output: string; next: number; status: JobStatus }> {
    const job = await this.#find(id, context)
    const runner = await this.#reach(job, context)
    let start = from
    if (start === undefined) {
      const size = (await runner.check([job.folder]))[job.folder]?.size ?? 0
      start = Math.max(0, size - REPORT_BYTES)
    }
    const followed = await runner.follow(job.folder, { from: start, waitMs: 0 })
    return { output: followed.output, next: followed.next, status: job.status }
  }

  /**
   * Stop a running command. Stopped by the agent, which then knows, nothing more is said;
   * stopped by a person, its chat is sent word of it and the agent is not given a turn.
   */
  async stop(id: string, by: "user" | "agent", context: Context): Promise<JobRecord> {
    const job = await this.#find(id, context)
    if (job.status !== "running") throw new JobError(`${id.trim()} is not running.`)
    await (await this.#reach(job, context)).stop(job.folder)
    const now = this.#options.now()
    const stopped: JobRecord = { ...job, status: "stopped", endedAt: now }
    if (by === "user") await this.#deliver(id.trim(), stopped, "", false, context)
    await this.#require().commit(async (tx) => {
      const stored = own((await tx.doc(JobsDoc)).jobs, id.trim())
      if (stored === undefined || stored.status !== "running") return
      stored.status = "stopped"
      stored.endedAt = now
    }, context)
    this.#looked.delete(id.trim())
    return stopped
  }

  /** Stop the commands a chat left running, when the chat itself was stopped. Nothing is said. */
  async stopFor(chatId: string, context: Context): Promise<void> {
    for (const [id, job] of Object.entries(await this.#jobs(context))) {
      if (job.status !== "running" || job.chatId !== chatId) continue
      await this.stop(id, "agent", context).catch((error) => this.#options.onError?.(error))
    }
  }

  /** Stop every running command, as well as can be done, for an agent that is being deleted. */
  async stopAll(context: Context): Promise<void> {
    for (const [id, job] of Object.entries(await this.#jobs(context))) {
      if (job.status !== "running") continue
      await this.stop(id, "agent", context).catch((error) => this.#options.onError?.(error))
    }
  }

  /** Write down how a job stands and how much of it the agent has seen. No word is sent. */
  async #settle(
    id: string,
    state: JobState,
    seen: number | undefined,
    context: Context,
    reason?: JobRecord["reason"],
  ): Promise<JobRecord | undefined> {
    const now = this.#options.now()
    return this.#require().commit(async (tx) => {
      const stored = own((await tx.doc(JobsDoc)).jobs, id)
      if (stored === undefined) return undefined
      if (seen !== undefined) stored.seen = Math.max(stored.seen, seen)
      if (stored.status === "running" && state.state !== "running") {
        stored.status = statusOf(state)
        stored.endedAt = endOf(stored, state, now)
        if (state.state === "exited") stored.exitCode = state.exitCode
        if (reason !== undefined) stored.reason = reason
      }
      return { ...stored }
    }, context)
  }

  /** Look at each running command, and send word of those that have ended. */
  tick(): Promise<void> {
    const context = this.#options.context
    const run = async () => {
      if (this.#harness === undefined) return
      this.#tickedAt = this.#options.now()
      try {
        // Intents after the running commands, so a computer that is slow to answer about one it
        // was starting does not hold up word of the others.
        await this.#look(context).finally(() => this.#reconcile(context))
        const now = this.#options.now()
        const running = Object.values(await this.#jobs(context)).filter(
          (job) => job.status === "running",
        )
        if (running.length > 0) this.#soon(Math.min(...running.map((job) => now - job.startedAt)))
        else if (await this.working(context)) this.#soon(0)
      } catch (error) {
        this.#options.onError?.(error)
      }
    }
    this.#ticking = this.#ticking.then(run, run)
    return this.#ticking
  }

  async #look(context: Context): Promise<void> {
    const now = this.#options.now()
    const jobs = await this.#jobs(context)
    const stale = Object.entries(jobs).filter(
      ([, job]) => job.status !== "running" && now - (job.endedAt ?? now) > FORGET_AFTER_MS,
    )
    if (stale.length > 0) {
      await this.#require().commit(async (tx) => {
        const stored = (await tx.doc(JobsDoc)).jobs
        for (const [id] of stale) delete stored[id]
      }, context)
    }
    const due = new Map<string, [string, JobRecord][]>()
    for (const [id, job] of Object.entries(jobs)) {
      if (job.status !== "running") continue
      const every = this.#options.lookMs === undefined ? everyMs(now - job.startedAt) : 0
      if (now - (this.#looked.get(id) ?? 0) < every) continue
      due.set(job.computerId, [...(due.get(job.computerId) ?? []), [id, job]])
    }
    for (const [computerId, mine] of due) {
      let runner: SandboxJobs | undefined
      let stands: Awaited<ReturnType<SandboxJobs["check"]>> = {}
      let gone = false
      try {
        const target = await this.#options.computer(computerId, context)
        // It was taken away, or removed: there is nobody to ask how its commands ended.
        if (typeof target === "string") gone = true
        else {
          runner = this.#runner(target)
          stands = (await runner?.check(mine.map(([, job]) => job.folder))) ?? {}
        }
      } catch {
        // A machine that cannot be reached right now is asked again at the next look. A laptop
        // that is asleep is not worth a report each time.
      }
      for (const [id, job] of mine) {
        this.#looked.set(id, now)
        const found = own(stands, job.folder)
        const overdue = now - job.startedAt > job.lifeMs + OVERDUE_MS
        const state: (JobState & { size?: number }) | undefined = gone
          ? { state: "lost" }
          : (found ?? (overdue ? { state: "lost" } : undefined))
        if (state === undefined || state.state === "running") continue
        await this.#ended(id, job, state, runner, gone ? "computer" : undefined, context)
      }
    }
  }

  /**
   * Anything no longer owned by a live foreground call is stopped and forgotten, even if the
   * tool never reached its background handoff. Each is reconciled at once, and each on its own
   * deadline, so that one computer that does not answer holds up none of the others.
   */
  async #reconcile(context: Context): Promise<void> {
    const intents = (await this.#require().snapshot(JobsDoc, context))?.intents ?? {}
    const now = this.#options.now()
    await Promise.allSettled(
      Object.entries(intents).map(async ([folder, intent]) => {
        if (this.#foreground.has(folder)) return
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([
            (async () => {
              const runner = await this.#reach(intent, context)
              // The snapshot above may predate a completed background handoff.
              const current = (await this.#require().snapshot(JobsDoc, context))?.intents?.[folder]
              if (current === undefined || this.#foreground.has(folder)) return
              await runner.stop(folder)
              const state = (await runner.check([folder]))[folder]
              if (state !== undefined && state.state !== "running") {
                await this.#forgetIntent(folder)
              }
            })(),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error("Job cleanup timed out")), 30_000)
            }),
          ])
        } catch (error) {
          // Its computer was taken away or removed: nothing is left there to stop, and nobody to
          // ask. One that is past its time limit by far has been stopped by its computer anyway,
          // if the computer is ever there to; it is not kept looking in on forever.
          if (error instanceof JobError || now - intent.startedAt > intent.lifeMs + OVERDUE_MS) {
            await this.#forgetIntent(folder).catch((error) => this.#options.onError?.(error))
          }
          // A computer that cannot be reached right now is asked again at the next look. A
          // laptop that is asleep is not worth a report each time.
        } finally {
          clearTimeout(timer)
        }
      }),
    )
  }

  /** A command has ended: read the last of what it printed, send word, and write it down. */
  async #ended(
    id: string,
    job: JobRecord,
    state: JobState & { size?: number },
    runner: SandboxJobs | undefined,
    reason: JobRecord["reason"],
    context: Context,
  ): Promise<void> {
    const now = this.#options.now()
    const size = state.size ?? job.seen
    let output = ""
    let earlier = false
    if (runner !== undefined && size > 0) {
      const from = Math.max(0, size - REPORT_BYTES)
      earlier = from > 0
      output = await runner
        .follow(job.folder, { from, waitMs: 0 })
        .then((followed) => followed.output)
        .catch(() => "")
    }
    const why = reason ?? (size >= JOB_LOG_CAP_BYTES ? "output" : undefined)
    const ended: JobRecord = {
      ...job,
      status: statusOf(state),
      endedAt: endOf(job, state, now),
      ...(state.state === "exited" ? { exitCode: state.exitCode } : {}),
      ...(why === undefined ? {} : { reason: why }),
    }
    await this.#deliver(
      id,
      ended,
      earlier ? output.replace(/^[^\n]*\n/, "") : output,
      true,
      context,
    )
    await this.#settle(id, state, size, context, why)
    this.#looked.delete(id)
  }

  /**
   * Write word of a command's end into the chat that started it, and give the agent a turn
   * there if `turn` says so. Both are keyed by the job, so repeating them does nothing new.
   */
  async #deliver(
    id: string,
    job: JobRecord,
    output: string,
    turn: boolean,
    context: Context,
  ): Promise<void> {
    const harness = this.#require()
    const now = this.#options.now()
    if (!/^\d+$/.test(job.chatId)) return
    const chat = await harness.conversation(Number(job.chatId) as ConversationId, context)
    if (chat === undefined) return
    const said = output.trim()
    // What it came to, then the last of what it printed, where it printed anything.
    const head =
      job.status === "stopped"
        ? `The user stopped your background command ${id} on "${job.computer}" after ${spanOf((job.endedAt ?? now) - job.startedAt)}.\nCommand: ${job.command}`
        : `Your background command ${id} on "${job.computer}" ${ending(job, now)}.\nCommand: ${job.command}\n${
            job.status === "lost"
              ? `Whatever it printed before that is in ${job.log}, if the computer still has it.`
              : said === ""
                ? "It printed nothing."
                : `The last of what it printed is below. All of it: ${job.log}`
          }`
    const tail = job.status !== "stopped" && job.status !== "lost" && said !== "" ? said : ""
    const told = `[${head}]${tail === "" ? "" : `\n\n${tail}`}`
    // Keyed by when it started as well: ids start over if the agent's record of jobs is lost.
    const key = `${id}:${job.startedAt}`
    const data = {
      id,
      computer: job.computer,
      command: job.command,
      status: job.status,
      ...(job.exitCode === undefined ? {} : { exitCode: job.exitCode }),
      ms: (job.endedAt ?? now) - job.startedAt,
      output: said,
    }
    let given: JobReport["turn"]
    if (await busOn(harness, job.chatId, context)) {
      // On the bus it is an event, which waits for the agent to finish what it is doing and is
      // taken up with whatever else came meanwhile.
      const event = eventText(
        "command-ended",
        { job: id, computer: job.computer, status: job.status, exit: job.exitCode },
        tail === "" ? head : `${head}\n\n${tail}`,
      )
      if (turn) {
        given = await chat.submit(
          {
            type: "input",
            requestId: `job-report:${key}`,
            content: [{ type: "text", text: event }],
            entry: { kind: JOB_ENTRY, data },
            whenBusy: "followUp",
          },
          context,
        )
      } else {
        await chat.submit(
          {
            type: "write",
            requestId: `job-report:${key}`,
            entry: {
              kind: JOB_ENTRY,
              model: [{ role: "user", content: event, timestamp: now }],
              data,
            },
          },
          context,
        )
      }
    } else {
      await chat.submit(
        {
          type: "write",
          requestId: `job-report:${key}`,
          entry: {
            kind: JOB_ENTRY,
            model: [{ role: "user", content: told, timestamp: now }],
            data,
          },
        },
        context,
      )
      given = turn
        ? await chat.submit(
            {
              type: "input",
              requestId: `job-turn:${key}`,
              content: [{ type: "text", text: NUDGE }],
              whenBusy: "followUp",
            },
            context,
          )
        : undefined
    }
    this.#options.onReport?.({ id, chatId: job.chatId, turn: given })
  }

  /** Write a command down as running in the background, and say what it is called. */
  async #keep(
    input: Omit<JobRecord, "status" | "startedAt"> & { startedAt: number },
    context: Context,
  ): Promise<string> {
    const id = await this.#require().commit(async (tx) => {
      const state = await tx.doc(JobsDoc)
      let id = `b${state.next}`
      while (Object.hasOwn(state.jobs, id)) id = `b${++state.next}`
      state.next += 1
      state.jobs[id] = { ...input, status: "running" }
      if (state.intents) delete state.intents[input.folder]
      return id
    }, context)
    // `onStarted` was called when its intent was written down, which this only takes over.
    this.#soon(0)
    return id
  }

  #bash() {
    const foregroundMs = this.#options.foregroundMs ?? FOREGROUND_MS
    return defineTool({
      name: "bash",
      description:
        `Execute a bash command in the current working directory. Returns combined stdout and stderr. Output is truncated to last ${KEEP_LINES} lines or ${KEEP_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a file. ` +
        `A command still running after ${Math.round(foregroundMs / 1000)} seconds is moved to the background, where it carries on: the call returns what it has printed so far, and you get a message when it ends. ` +
        "Pass `run_in_background` to start it there straight away, for a server or anything likely to take more than a minute. " +
        `Pass \`timeout\` in seconds to wait for it instead, ${MAX_WAIT_MS / 1000} at most, and have it stopped at the end of that; with \`run_in_background\`, \`timeout\` is how long it may run, ${spanOf(DEFAULT_JOB_LIFE_MS)} unless you say and ${spanOf(MAX_JOB_LIFE_MS)} at most.`,
      parameters: Type.Object({
        command: Type.String({ description: "Bash command to execute" }),
        timeout: Type.Optional(
          Type.Number({
            description:
              "Seconds to wait for the command before it is stopped; with run_in_background, seconds it may run",
          }),
        ),
        run_in_background: Type.Optional(
          Type.Boolean({
            description:
              "Start the command and return at once. A message reaches you when it ends.",
          }),
        ),
      }),
      outputLimits: { retain: "tail" },
      execute: async (args, api, context) => {
        const { command, timeout, run_in_background: background } = args
        if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0)) {
          throw new Error("Invalid timeout: must be a finite number of seconds")
        }
        const target = api.env instanceof ComputerEnv ? api.env.target : undefined
        const runner = target === undefined ? undefined : this.#runner(target)
        // As it was before there were jobs: the call is the command. What pi-durable's own
        // gives to programs is left out, as this `bash` declares nothing for them.
        const plainly = async () => {
          const { structuredOutput: _programs, ...result } = await this.#plain.execute(
            { command, ...(timeout === undefined ? {} : { timeout }) },
            api as never,
            context,
          )
          return result
        }
        if (target === undefined || runner === undefined) {
          if (background === true) {
            return fail(
              "This computer cannot run commands in the background: it is a lightweight shell that runs one command at a time. Run it without run_in_background.",
            )
          }
          return plainly()
        }
        if (background === true) {
          const running = Object.values(await this.#jobs(context)).filter(
            (job) => job.status === "running",
          ).length
          if (running >= MAX_RUNNING_JOBS) {
            return fail(
              `There are already ${MAX_RUNNING_JOBS} commands running in the background. Stop one with the background tool, or wait for one to end.`,
            )
          }
        }
        // A command the agent waits for with a timeout is stopped at the end of it, as before.
        const waited = background !== true && timeout !== undefined
        const lifeMs =
          background === true
            ? Math.min((timeout ?? DEFAULT_JOB_LIFE_MS / 1000) * 1000, MAX_JOB_LIFE_MS)
            : waited
              ? Math.min(timeout * 1000, MAX_WAIT_MS)
              : DEFAULT_JOB_LIFE_MS
        // Long enough past its time limit for the command to be stopped and say so.
        const waitMs = background === true ? STARTING_MS : waited ? lifeMs + 8_000 : foregroundMs
        const folder = crypto.randomUUID().replaceAll("-", "").slice(0, 12)
        const startedAt = this.#options.now()
        context.abortSignal?.throwIfAborted()
        this.#foreground.add(folder)
        try {
          // Commit before the remote side effect, under a context that outlives the tool.
          await this.#require().commit(async (tx) => {
            const state = await tx.doc(JobsDoc)
            state.intents ??= {}
            state.intents[folder] = {
              chatId: String(api.conversationId),
              computerId: target.id,
              computer: target.computer.name,
              command,
              folder,
              log: runner.log(folder),
              status: "running",
              startedAt,
              lifeMs,
              seen: 0,
            }
          }, this.#options.context)
          this.#options.onStarted?.()
          context.abortSignal?.throwIfAborted()
          // Stopping the call stops the command while the call is what waits for it.
          const signal = context.abortSignal
          const abort = () => void runner.stop(folder).catch(() => {})
          signal?.addEventListener("abort", abort, { once: true })
          let followed: JobFollowed
          try {
            const options = {
              signal,
              onOutput: (text: string) => api.output(text),
              removeUnder: { bytes: KEEP_BYTES, lines: KEEP_LINES },
            }
            followed = await runner.start(
              { id: folder, command, cwd: target.cwd, lifeMs },
              { ...options, waitMs: Math.min(waitMs, FOLLOW_STEP_MS) },
            )
            // A wait longer than one call to the machine may last is made of several.
            for (
              let left = waitMs - FOLLOW_STEP_MS;
              followed.state === "running" && left > 0;
              left -= FOLLOW_STEP_MS
            ) {
              followed = await runner.follow(folder, {
                ...options,
                from: followed.next,
                waitMs: Math.min(left, FOLLOW_STEP_MS),
              })
            }
          } catch (error) {
            if (error instanceof JobsUnsupported) {
              await this.#forgetIntent(folder)
              if (background !== true) return plainly()
              return fail(
                `"${target.computer.name}" cannot run commands in the background yet. ${error.message} Until then, run it without run_in_background, with a timeout long enough for it.`,
              )
            }
            // Whoever made the call is told it failed, so the command is not left running unseen.
            void runner.stop(folder).catch(() => {})
            throw error
          } finally {
            signal?.removeEventListener("abort", abort)
          }
          if (signal?.aborted) {
            void runner.stop(folder).catch(() => {})
            throw new Error("Command aborted")
          }
          if (followed.state === "running") {
            if (waited) {
              // Its time limit should have stopped it by now. It is not left to run unseen.
              void runner.stop(folder).catch(() => {})
              throw new Error(`Command timed out after ${timeout} seconds`)
            }
            const log = runner.log(folder)
            const id = await this.#keep(
              {
                chatId: String(api.conversationId),
                computerId: target.id,
                computer: target.computer.name,
                command,
                folder,
                log,
                startedAt,
                lifeMs,
                seen: followed.next,
              },
              context,
            )
            const where = `on "${target.computer.name}"`
            const rest = `You will get a message when it ends, so do not wait for it or run it again. Everything it prints is written to ${log}.`
            if (background === true) {
              return {
                output: [
                  {
                    type: "text" as const,
                    text: [
                      `Started in the background as ${id} ${where}. ${rest}`,
                      followed.output.trim() === ""
                        ? ""
                        : `So far it has printed:\n${followed.output}`,
                    ]
                      .filter(Boolean)
                      .join("\n\n"),
                  },
                ],
                details: { job: id },
              }
            }
            api.output(
              `\n[Still running after ${spanOf(waitMs)}, so it was moved to the background as ${id} ${where}. What it has printed so far is above. ${rest}]\n`,
            )
            return { details: { job: id } }
          }
          if (followed.state === "exited") await this.#forgetIntent(folder)
          if (followed.kept && followed.state === "exited") {
            api.diagnostic({
              severity: "info",
              code: "full_output",
              message: `Full output: ${runner.log(folder)}`,
            })
          }
          if (followed.state === "lost") {
            throw new Error(
              "The command could not be followed to its end: it did not start, or the machine stopped while it ran",
            )
          }
          if (followed.timedOut) {
            throw new Error(
              waited
                ? `Command timed out after ${timeout} seconds`
                : `Command was stopped at its time limit of ${spanOf(lifeMs)}`,
            )
          }
          if (followed.exitCode !== 0) {
            // As pi-durable's own `bash` answers it: an error result, and nothing thrown.
            return {
              isError: true,
              diagnostics: [
                {
                  severity: "error" as const,
                  code: "exit_code",
                  message: `Command exited with code ${followed.exitCode}`,
                },
              ],
            }
          }
          return {}
        } finally {
          this.#foreground.delete(folder)
          this.#soon(0)
        }
      },
    })
  }

  #tool() {
    return defineTool({
      name: "background",
      description:
        "Look in on the commands you left running in the background with bash. " +
        'action "list" shows them: the ones running, and the ones that ended lately. ' +
        `"output" needs \`id\` and shows what that command has printed since you last looked; with \`wait_seconds\` (${MAX_OUTPUT_WAIT_SECONDS} at most) it first waits that long for the command to end. ` +
        '"stop" needs `id` and stops that command and everything it started. ' +
        "You are sent a message when a command ends, so there is no need to check on one in order to wait for it.",
      parameters: Type.Object({
        action: Type.Union([Type.Literal("list"), Type.Literal("output"), Type.Literal("stop")]),
        id: Type.Optional(Type.String({ description: "A background command's id, such as b3" })),
        wait_seconds: Type.Optional(
          Type.Number({ description: "For output: how long to wait for the command to end" }),
        ),
      }),
      outputLimits: { retain: "tail" },
      execute: async (args, api, context) => {
        const reply = (text: string) => ({ output: [{ type: "text" as const, text }] })
        const now = this.#options.now()
        try {
          switch (args.action) {
            case "list": {
              const jobs = Object.entries(await this.#jobs(context)).sort(
                ([, a], [, b]) => a.startedAt - b.startedAt,
              )
              return reply(
                jobs.length === 0
                  ? "No commands are running in the background, and none ended lately."
                  : jobs
                      .map(
                        ([id, job]) =>
                          `${id} on "${job.computer}": ${ending(job, now)}\n  ${job.command.split("\n")[0]}\n  output: ${job.log}`,
                      )
                      .join("\n"),
              )
            }
            case "output": {
              if (!args.id) return fail('"output" needs id.')
              const wait = Math.max(0, Math.min(args.wait_seconds ?? 0, MAX_OUTPUT_WAIT_SECONDS))
              const { job, output } = await this.output(
                args.id,
                Number.isFinite(wait) ? wait * 1000 : 0,
                context,
                (text) => api.output(text),
              )
              api.output(
                `${output === "" ? "[Nothing new was printed.]" : ""}\n[${args.id.trim()} ${ending(job, this.#options.now())}.]\n`,
              )
              return {}
            }
            case "stop": {
              if (!args.id) return fail('"stop" needs id.')
              const stopped = await this.stop(args.id, "agent", context)
              return reply(`Stopped ${args.id.trim()}. What it printed is in ${stopped.log}.`)
            }
          }
        } catch (error) {
          if (error instanceof JobError) return fail(error.message)
          throw error
        }
      },
    })
  }
}
