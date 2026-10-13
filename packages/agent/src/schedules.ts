import {
  DEFAULT_THINKING,
  type ScheduleCheck,
  type ScheduleSummary,
  type UpdateScheduleRequest,
} from "@do-computer/protocol"
import type { Context } from "@earendil-works/chord"
import { Type } from "@earendil-works/pi-ai"
import {
  AssistantEntry,
  type Conversation,
  type ConversationId,
  defineExtension,
  defineTool,
  type Extension,
  type Harness,
} from "@earendil-works/pi-durable"
import { ChatsDoc, IdentityDoc, type ScheduleRecord, SchedulesDoc } from "./docs.ts"
import { parseModel } from "./models.ts"
import { formatTime, isValidTimezone, nextRunAt, parseSchedule } from "./schedule.ts"
import { own } from "./own.ts"

export const SILENT_MARKER = "[SILENT]"
export const MAX_ENABLED_SCHEDULES = 20
const MAX_TITLE_CHARS = 80
const MAX_PROMPT_CHARS = 8_000
const MAX_CHECK_CHARS = 2_000
/** How much of what a check printed the agent is shown. */
const MAX_CHECK_OUTPUT_CHARS = 8_000
/** How much of it is kept to say, next time, what changed. */
const MAX_SEEN_CHARS = 4_000

/** Entry kind of a scheduled task's report in the chat it was created in. */
export const SCHEDULED_ENTRY = "dc.scheduled"

export type ScheduledReport = {
  scheduleId: string
  title: string
  /** The chat holding the run's full transcript. */
  runChatId: string
  /** The chat the report was delivered into, when it still exists. */
  chatId: string | null
  text: string
}

function preamble(title: string, now: number, timezone: string | null): string {
  return (
    `[You are running the scheduled task "${title}". It is ${formatTime(now, timezone)}. Nobody is present, so you cannot ask questions. ` +
    "Your final reply is delivered to the user automatically; do not try to send it yourself. " +
    `If there is genuinely nothing new to report, reply with exactly "${SILENT_MARKER}" and nothing else to skip the message.]`
  )
}

/** What running a check came to: what it printed, or why it could not be run. */
export type CheckResult = { ok: true; output: string } | { ok: false; error: string }

/** Where the checks of schedules run. */
export type ScheduleChecks = {
  /** The computer a check would run on: the one named, or the one meant by naming none. */
  where(computer: string | undefined, context: Context): Promise<{ name: string } | string>
  /** Run a check's command. A command that fails, or runs too long, could not be run. */
  run(check: ScheduleCheck, context: Context): Promise<CheckResult>
}

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}\n… (cut short)` : text

const fenced = (text: string) => `\`\`\`\n${text}\n\`\`\``

async function digest(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

/** The lines that went and the lines that came. */
function changes(before: string, after: string): string {
  const was = new Set(before.split("\n"))
  const is = new Set(after.split("\n"))
  return [
    ...before.split("\n").flatMap((line) => (is.has(line) ? [] : [`- ${line}`])),
    ...after.split("\n").flatMap((line) => (was.has(line) ? [] : [`+ ${line}`])),
  ].join("\n")
}

/**
 * What a check's result means for the run that is waiting on it. `context` is what the agent is
 * started with, and null where it is not started.
 */
type Verdict = {
  context: string | null
  failed: boolean
  seen?: NonNullable<ScheduleRecord["seen"]>
}

async function weigh(
  check: ScheduleCheck,
  result: CheckResult,
  record: Pick<ScheduleRecord, "seen" | "checkFailures">,
): Promise<Verdict> {
  if (!result.ok) {
    // It is told once, the first time. A check that stays broken does not start it every time.
    const first = (record.checkFailures ?? 0) === 0
    return {
      failed: true,
      context: first
        ? `[This task has a check, a command that is run first to see whether there is anything for you to do: \`${check.command}\`, on ${check.computer}. This time it could not be run, so nothing was checked:\n\n${fenced(clip(result.error, MAX_CHECK_OUTPUT_CHARS))}\n\nDo the task as well as you can without it. Then tell the user that the check is failing and how you would fix it: a scheduled run cannot change it, and until it works again the task is skipped without a word.]`
        : null,
    }
  }
  const output = result.output.trim()
  if (check.wake === "output") {
    return {
      failed: false,
      context:
        output === ""
          ? null
          : `[This task's check, \`${check.command}\` on ${check.computer}, was run first and printed what follows. It is why you were started.]\n\n${fenced(clip(output, MAX_CHECK_OUTPUT_CHARS))}`,
    }
  }
  const seen = { hash: await digest(output), output: clip(output, MAX_SEEN_CHARS) }
  // The first look is what later ones are held against, and is not a change itself.
  if (record.seen === undefined || record.seen.hash === seen.hash) {
    return { failed: false, context: null, seen }
  }
  return {
    failed: false,
    seen,
    context: `[This task's check, \`${check.command}\` on ${check.computer}, was run first, and what it printed is not what it printed last time. That is why you were started. What changed:]\n\n${fenced(clip(changes(record.seen.output, seen.output), MAX_CHECK_OUTPUT_CHARS))}\n\n[What it printed this time:]\n\n${fenced(clip(output, MAX_CHECK_OUTPUT_CHARS))}`,
  }
}

function summarize(id: string, record: ScheduleRecord): ScheduleSummary {
  return {
    id,
    title: record.title,
    prompt: record.prompt,
    schedule: record.schedule,
    timezone: record.timezone,
    enabled: record.enabled,
    nextRunAt: record.nextRunAt,
    createdAt: record.createdAt,
    running: record.pending !== null,
    lastRun: record.lastRun && { ...record.lastRun },
    runCount: record.runCount,
    check: record.check === undefined ? null : { ...record.check },
    skipCount: record.skipCount ?? 0,
  }
}

const titleOf = (prompt: string) => {
  const line = prompt.trim().split("\n")[0]!.trim()
  return line.length > MAX_TITLE_CHARS ? `${line.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…` : line
}

/** A problem the caller should be told about, as opposed to a bug. */
export class ScheduleError extends Error {}

/** What the agent says about a schedule's check when it makes or changes one. */
export type CheckInput = {
  /** The command. Empty takes the check away. */
  check?: string
  computer?: string
  wakeOn?: string
}

export type SchedulerOptions = {
  readonly now: () => number
  /** Called when a scheduled task has something to tell the user. */
  readonly onReport?: (report: ScheduledReport) => void
  readonly onError?: (error: unknown) => void
  /** Where checks run. Without it, a schedule cannot have one. */
  readonly checks?: ScheduleChecks
  /**
   * What a run the agent starts itself runs under. It outlasts the tool call that set it off,
   * whose own context ends with it. Absent: the tool call's.
   */
  readonly context?: Context
}

/**
 * The agent's schedules: the tool it manages them with, and the firing of due ones.
 *
 * A fire is one commit that creates the run's chat, records the run as pending and moves the
 * schedule on, so a crash can lose a run's start but never run it twice. Submitting the prompt
 * and delivering the report are both keyed, so repeating them after a crash does nothing new.
 *
 * A schedule with a check fires without a chat. Its command is run first, with no model in it,
 * and the chat is made only if what it printed says there is something to do. A crash can run
 * the command twice, which is why a check only looks.
 */
export class Scheduler {
  readonly extension: Extension
  readonly #options: SchedulerOptions
  #harness: Harness | undefined
  #ticking: Promise<void> = Promise.resolve()
  /** The checks under way, by schedule and firing: a tick that finds one running leaves it be. */
  readonly #checking = new Set<string>()

  constructor(options: SchedulerOptions) {
    this.#options = options
    this.extension = defineExtension({ name: "dc.schedules", tools: [this.#tool()] })
  }

  attach(harness: Harness): void {
    this.#harness = harness
  }

  #require(): Harness {
    if (this.#harness === undefined) throw new Error("Scheduler is not attached to a harness")
    return this.#harness
  }

  async list(context: Context): Promise<ScheduleSummary[]> {
    const schedules = (await this.#require().snapshot(SchedulesDoc, context))?.schedules ?? {}
    return Object.entries(schedules)
      .map(([id, record]) => summarize(id, record))
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  /** Whether a run is waiting on its check, which nothing else keeps the agent awake for. */
  async working(context: Context): Promise<boolean> {
    const schedules = (await this.#require().snapshot(SchedulesDoc, context))?.schedules ?? {}
    return Object.values(schedules).some((record) => record.pending?.chatId === null)
  }

  /**
   * The check a schedule is to have, from what was asked for and what it has: undefined where
   * nothing about it was said, null where it was taken away.
   */
  async #checkOf(
    input: CheckInput | undefined,
    existing: ScheduleCheck | undefined,
    context: Context,
  ): Promise<ScheduleCheck | null | undefined> {
    if (
      input === undefined ||
      (input.check === undefined && input.computer === undefined && input.wakeOn === undefined)
    ) {
      return undefined
    }
    const command = input.check === undefined ? existing?.command : input.check.trim()
    if (input.check !== undefined && command === "") return null
    if (command === undefined) {
      throw new ScheduleError(
        "`computer` and `wake_on` are about a check, and this task has none. Give its command in `check`.",
      )
    }
    if (command.length > MAX_CHECK_CHARS) {
      throw new ScheduleError(
        `A check can be at most ${MAX_CHECK_CHARS} characters. Put a longer one in a script file and run that.`,
      )
    }
    const wake = input.wakeOn ?? existing?.wake ?? "output"
    if (wake !== "output" && wake !== "change") {
      throw new ScheduleError('`wake_on` is "output" or "change".')
    }
    const checks = this.#options.checks
    if (checks === undefined) throw new ScheduleError("Checks cannot be run here.")
    let computer = existing?.computer
    if (computer === undefined || input.computer !== undefined) {
      const where = await checks.where(input.computer?.trim() || undefined, context)
      if (typeof where === "string") throw new ScheduleError(where)
      computer = where.name
    }
    return { command, computer, wake }
  }

  /** When the actor must next wake for a schedule, or null. */
  async nextWake(context: Context): Promise<number | null> {
    const schedules = (await this.#require().snapshot(SchedulesDoc, context))?.schedules ?? {}
    let next: number | null = null
    for (const record of Object.values(schedules)) {
      if (!record.enabled || record.nextRunAt === null) continue
      if (next === null || record.nextRunAt < next) next = record.nextRunAt
    }
    return next
  }

  async create(
    input: { schedule: string; prompt: string; title?: string; timezone?: string } & CheckInput,
    originChatId: string | null,
    context: Context,
  ): Promise<ScheduleSummary> {
    const harness = this.#require()
    const now = this.#options.now()
    const prompt = input.prompt.trim()
    if (prompt === "")
      throw new ScheduleError("A prompt is required: what should happen on each run?")
    if (prompt.length > MAX_PROMPT_CHARS) {
      throw new ScheduleError(`A prompt can be at most ${MAX_PROMPT_CHARS} characters.`)
    }
    const identity = await harness.snapshot(IdentityDoc, context)
    const timezone = input.timezone ?? identity?.timezone ?? undefined
    let next: number | null
    try {
      next = nextRunAt(parseSchedule(input.schedule, now, timezone), now)
    } catch (error) {
      throw new ScheduleError((error as Error).message)
    }
    const check = await this.#checkOf(input, undefined, context)
    const id = crypto.randomUUID().slice(0, 8)
    const record: ScheduleRecord = {
      title: (input.title?.trim() || titleOf(prompt)).slice(0, MAX_TITLE_CHARS),
      prompt,
      schedule: input.schedule.trim(),
      timezone: timezone ?? null,
      enabled: true,
      nextRunAt: next,
      createdAt: now,
      originChatId,
      pending: null,
      lastRun: null,
      runCount: 0,
      ...(check == null ? {} : { check }),
    }
    await harness.commit(async (tx) => {
      const { schedules } = await tx.doc(SchedulesDoc)
      const enabled = Object.values(schedules).filter((schedule) => schedule.enabled).length
      if (enabled >= MAX_ENABLED_SCHEDULES) {
        throw new ScheduleError(
          `There are already ${MAX_ENABLED_SCHEDULES} active schedules. Pause or remove one first.`,
        )
      }
      schedules[id] = record
    }, context)
    return summarize(id, record)
  }

  /** Change a schedule. Its check is the agent's to change, and is not a part of `change`. */
  async update(
    id: string,
    change: UpdateScheduleRequest,
    context: Context,
    checkInput?: CheckInput,
  ): Promise<ScheduleSummary> {
    const now = this.#options.now()
    const harness = this.#require()
    const before = own((await harness.snapshot(SchedulesDoc, context))?.schedules, id)
    if (before === undefined) throw new ScheduleError(`There is no schedule "${id}".`)
    const check = await this.#checkOf(checkInput, before.check, context)
    return harness.commit(async (tx) => {
      const { schedules } = await tx.doc(SchedulesDoc)
      const record = own(schedules, id)
      if (record === undefined) throw new ScheduleError(`There is no schedule "${id}".`)
      if (check !== undefined) {
        if (check === null) delete record.check
        else record.check = check
        // Another check has nothing to be held against, and has not failed yet.
        delete record.seen
        delete record.checkFailures
      }
      if (typeof change.title === "string" && change.title.trim() !== "") {
        record.title = change.title.trim().slice(0, MAX_TITLE_CHARS)
      }
      if (typeof change.prompt === "string" && change.prompt.trim() !== "") {
        if (change.prompt.length > MAX_PROMPT_CHARS) {
          throw new ScheduleError(`A prompt can be at most ${MAX_PROMPT_CHARS} characters.`)
        }
        record.prompt = change.prompt.trim()
      }
      const moved = typeof change.timezone === "string" && change.timezone.trim() !== ""
      if (moved) {
        if (!isValidTimezone(change.timezone!.trim())) {
          throw new ScheduleError(`"${change.timezone}" is not an IANA timezone.`)
        }
        record.timezone = change.timezone!.trim()
      }
      const retimed = typeof change.schedule === "string" && change.schedule.trim() !== ""
      if (retimed) record.schedule = change.schedule!.trim()
      // Read in another timezone, the same words mean another time.
      const rescheduled = retimed || (moved && record.enabled)
      if (typeof change.enabled === "boolean") {
        if (change.enabled && !record.enabled) {
          const enabled = Object.values(schedules).filter((schedule) => schedule.enabled).length
          if (enabled >= MAX_ENABLED_SCHEDULES) {
            throw new ScheduleError(`There are already ${MAX_ENABLED_SCHEDULES} active schedules.`)
          }
        }
        record.enabled = change.enabled
      }
      // Resuming or rescheduling starts the clock again from now.
      if (rescheduled || change.enabled === true) {
        try {
          const spec = parseSchedule(record.schedule, now, record.timezone ?? undefined)
          record.nextRunAt = nextRunAt(spec, now)
        } catch (error) {
          throw new ScheduleError((error as Error).message)
        }
        if (record.nextRunAt === null) record.enabled = false
      }
      return summarize(id, {
        ...record,
        pending: record.pending && { ...record.pending },
        lastRun: record.lastRun && { ...record.lastRun },
      })
    }, context)
  }

  async remove(id: string, context: Context): Promise<void> {
    await this.#require().commit(async (tx) => {
      const { schedules } = await tx.doc(SchedulesDoc)
      if (own(schedules, id) === undefined) {
        throw new ScheduleError(`There is no schedule "${id}".`)
      }
      delete schedules[id]
    }, context)
  }

  /** Run a schedule now, without changing when it next runs on its own. */
  async runNow(id: string, context: Context): Promise<void> {
    const schedules = (await this.#require().snapshot(SchedulesDoc, context))?.schedules ?? {}
    const record = own(schedules, id)
    if (record === undefined) throw new ScheduleError(`There is no schedule "${id}".`)
    if (record.pending !== null) throw new ScheduleError("That schedule is already running.")
    await this.#fire(id, { advance: false }, context)
    await this.tick(context)
  }

  /** Report finished runs and start due ones. Calls run one after another. */
  tick(context: Context): Promise<void> {
    const run = async () => {
      try {
        await this.#settle(context)
        await this.#fireDue(context)
        await this.#settle(context)
      } catch (error) {
        this.#options.onError?.(error)
      }
    }
    this.#ticking = this.#ticking.then(run, run)
    return this.#ticking
  }

  async #fireDue(context: Context): Promise<void> {
    const now = this.#options.now()
    const schedules = (await this.#require().snapshot(SchedulesDoc, context))?.schedules ?? {}
    for (const [id, record] of Object.entries(schedules)) {
      if (record.enabled && record.nextRunAt !== null && record.nextRunAt <= now) {
        await this.#fire(id, { advance: true }, context)
      }
    }
  }

  /**
   * One commit: create the run's chat, mark the run pending and move the schedule to its next
   * time. A schedule whose previous run is still going skips this occurrence.
   */
  async #fire(id: string, options: { advance: boolean }, context: Context): Promise<void> {
    const harness = this.#require()
    const now = this.#options.now()
    const identity = await harness.snapshot(IdentityDoc, context)
    if (identity === undefined) return
    const advance = (record: ScheduleRecord) => {
      if (!options.advance) return
      let next: number | null = null
      try {
        const spec = parseSchedule(record.schedule, now, record.timezone ?? undefined)
        // A one-off is spent by running. Asking when it runs next would read "1m" as a minute
        // from now, and a reminder would come back every minute for ever.
        next = spec.kind === "once" ? null : nextRunAt(spec, now)
      } catch {
        // A one-shot whose time has passed no longer parses; it is spent.
      }
      record.nextRunAt = next
      if (next === null) record.enabled = false
    }

    const current = own((await harness.snapshot(SchedulesDoc, context))?.schedules, id)
    if (current === undefined) return
    if (current.pending !== null) {
      await harness.commit(async (tx) => {
        const record = own((await tx.doc(SchedulesDoc)).schedules, id)
        if (record !== undefined) advance(record)
      }, context)
      return
    }
    if (current.check !== undefined) {
      // No chat yet: its check says whether there is to be one.
      await harness.commit(async (tx) => {
        const record = own((await tx.doc(SchedulesDoc)).schedules, id)
        if (record === undefined || record.pending !== null) return
        record.pending = { chatId: null, firedAt: now }
        record.runCount += 1
        advance(record)
      }, context)
      return
    }
    await this.#begin(
      id,
      (record) => {
        if (record.pending !== null) return undefined
        record.runCount += 1
        advance(record)
        return { firedAt: now }
      },
      context,
    )
  }

  /**
   * Make the chat a run happens in and hand the run to it, in one commit. `claim` says, of the
   * schedule as it then is, whether the run is still to be started, and what it starts with.
   */
  async #begin(
    id: string,
    claim: (record: ScheduleRecord) => { firedAt: number; context?: string } | undefined,
    context: Context,
  ): Promise<void> {
    const harness = this.#require()
    const now = this.#options.now()
    const identity = await harness.snapshot(IdentityDoc, context)
    if (identity === undefined) return
    await harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: {
          model: parseModel(identity.model),
          thinkingLevel: identity.thinking ?? DEFAULT_THINKING,
        },
        init: async (tx, conversationId) => {
          const record = own((await tx.doc(SchedulesDoc)).schedules, id)
          // Removed or already started since the snapshot: the chat stays unlisted and empty.
          const run = record === undefined ? undefined : claim(record)
          if (record === undefined || run === undefined) return
          const chatId = String(conversationId)
          ;(await tx.doc(ChatsDoc)).chats[chatId] = {
            title: record.title,
            kind: "schedule",
            createdAt: now,
            updatedAt: now,
            archived: false,
          }
          record.pending = { chatId, ...run }
        },
      },
      context,
    )
  }

  /** Run a check now and say what it came to, for one that fails to say so instead of throwing. */
  async #run(check: ScheduleCheck, context: Context): Promise<CheckResult> {
    const checks = this.#options.checks
    if (checks === undefined) return { ok: false, error: "Checks cannot be run here." }
    try {
      return await checks.run(check, context)
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * Run the check a fired run is waiting on, and then either start the run with what the check
   * found or let this time go by. Nothing waits for it: it comes back with a tick of its own.
   */
  #look(id: string, firedAt: number, context: Context): void {
    const key = `${id}:${firedAt}`
    if (this.#checking.has(key)) return
    this.#checking.add(key)
    void this.#decide(id, firedAt, context).then(
      () => {
        this.#checking.delete(key)
        return this.tick(context)
      },
      // Left as it is, to be tried again at the next wake-up rather than at once and for ever.
      (error) => {
        this.#checking.delete(key)
        this.#options.onError?.(error)
      },
    )
  }

  async #decide(id: string, firedAt: number, context: Context): Promise<void> {
    const harness = this.#require()
    const record = own((await harness.snapshot(SchedulesDoc, context))?.schedules, id)
    if (record?.pending?.firedAt !== firedAt || record.pending.chatId !== null) return
    const waiting = (stored: ScheduleRecord | undefined): stored is ScheduleRecord =>
      stored?.pending?.firedAt === firedAt && stored.pending.chatId === null
    const check = record.check
    // Its check was taken away while it waited: it runs as a schedule without one does.
    const verdict: Verdict =
      check === undefined
        ? { failed: false, context: "" }
        : await weigh(check, await this.#run(check, context), record)
    const note = (stored: ScheduleRecord) => {
      // What an old check found says nothing about the one that has taken its place.
      if (check === undefined || stored.check?.command !== check.command) return
      if (verdict.failed) stored.checkFailures = (stored.checkFailures ?? 0) + 1
      else delete stored.checkFailures
      if (verdict.seen !== undefined) stored.seen = verdict.seen
    }
    if (verdict.context === null) {
      await harness.commit(async (tx) => {
        const stored = own((await tx.doc(SchedulesDoc)).schedules, id)
        if (!waiting(stored)) return
        note(stored)
        stored.pending = null
        stored.lastRun = {
          at: firedAt,
          chatId: null,
          outcome: verdict.failed ? "check-failed" : "skipped",
        }
        stored.skipCount = (stored.skipCount ?? 0) + 1
      }, context)
      return
    }
    const found = verdict.context
    await this.#begin(
      id,
      (stored) => {
        if (!waiting(stored)) return undefined
        note(stored)
        return { firedAt, ...(found === "" ? {} : { context: found }) }
      },
      context,
    )
  }

  /** Run a schedule's check now and say what a run would have done with it. Changes nothing. */
  async tryCheck(id: string, context: Context): Promise<string> {
    const record = own((await this.#require().snapshot(SchedulesDoc, context))?.schedules, id)
    if (record === undefined) throw new ScheduleError(`There is no schedule "${id}".`)
    const check = record.check
    if (check === undefined) {
      throw new ScheduleError("That task has no check: you are started every time it runs.")
    }
    const result = await this.#run(check, context)
    if (!result.ok) {
      return `The check could not be run, which a scheduled run counts as a failure:\n\n${fenced(clip(result.error, MAX_CHECK_OUTPUT_CHARS))}\n\nA check has to end with exit code 0 whether or not it found anything. Fix it with action "update".`
    }
    const output = result.output.trim()
    const printed =
      output === ""
        ? "The check ran and printed nothing."
        : `The check ran and printed:\n\n${fenced(clip(output, MAX_CHECK_OUTPUT_CHARS))}`
    if (check.wake === "output") {
      return `${printed}\n\n${
        output === ""
          ? "A run now would be skipped, and you would not be started."
          : "A run now would start you, with this in front of the prompt."
      }`
    }
    const same = record.seen !== undefined && record.seen.hash === (await digest(output))
    return `${printed}\n\n${
      record.seen === undefined
        ? "No scheduled run has looked yet. The first one only takes note of what it prints; you are started when a later one prints something else."
        : same
          ? "That is what it printed at the last scheduled run, so a run now would be skipped."
          : "That is not what it printed at the last scheduled run, so a run now would start you, with what changed in front of the prompt."
    }`
  }

  /** Start pending runs that have not started, and report the ones that finished. */
  async #settle(context: Context): Promise<void> {
    const harness = this.#require()
    const schedules = (await harness.snapshot(SchedulesDoc, context))?.schedules ?? {}
    for (const [id, record] of Object.entries(schedules)) {
      const pending = record.pending
      if (pending === null) continue
      const runChatId = pending.chatId
      if (runChatId === null) {
        this.#look(id, pending.firedAt, this.#options.context ?? context)
        continue
      }
      const conversation = await harness.conversation(Number(runChatId) as ConversationId, context)
      if (conversation === undefined) continue
      const identity = await harness.snapshot(IdentityDoc, context)
      // The same request id every time: the first call starts the run, later ones find it.
      const submission = await conversation.submit(
        {
          type: "input",
          requestId: `schedule:${id}:${pending.firedAt}`,
          content: [
            preamble(record.title, pending.firedAt, identity?.timezone ?? record.timezone),
            ...(pending.context === undefined ? [] : [pending.context]),
            record.prompt,
          ].join("\n\n"),
        },
        context,
      )
      const status = await submission.status(context)
      if (status.status === "queued" || status.status === "placed") {
        // Come back as soon as it settles rather than at the next wake-up.
        void submission.wait(context).then(
          () => this.tick(context),
          () => {},
        )
        continue
      }
      let outcome: NonNullable<ScheduleRecord["lastRun"]>["outcome"] = "failed"
      if (status.status === "done" && status.type === "input") {
        const answer = await harness.commit(
          (tx) => tx.entry(AssistantEntry, status.answer),
          context,
        )
        const message = answer?.model?.[0]
        const text =
          message?.role === "assistant"
            ? message.content
                .flatMap((block) => (block.type === "text" ? [block.text] : []))
                .join("")
                .trim()
            : ""
        if (text === SILENT_MARKER || text === "") outcome = "silent"
        else {
          outcome = "delivered"
          await this.#deliver(
            { scheduleId: id, title: record.title, runChatId, chatId: null, text },
            record.originChatId,
            pending.firedAt,
            context,
          )
        }
      }
      await harness.commit(async (tx) => {
        const stored = own((await tx.doc(SchedulesDoc)).schedules, id)
        if (stored === undefined || stored.pending?.firedAt !== pending.firedAt) return
        stored.pending = null
        stored.lastRun = { at: pending.firedAt, chatId: runChatId, outcome }
      }, context)
    }
  }

  async #deliver(
    report: ScheduledReport,
    originChatId: string | null,
    firedAt: number,
    context: Context,
  ): Promise<void> {
    const harness = this.#require()
    const now = this.#options.now()
    let origin: Conversation | undefined
    const chats = (await harness.snapshot(ChatsDoc, context))?.chats ?? {}
    if (originChatId !== null && chats[originChatId] !== undefined) {
      origin = await harness.conversation(Number(originChatId) as ConversationId, context)
    }
    if (origin !== undefined) {
      // A write, not an input: it lands in the chat without asking the model anything, and is in
      // the model's context the next time the user replies there.
      await origin.submit(
        {
          type: "write",
          requestId: `delivery:${report.scheduleId}:${firedAt}`,
          entry: {
            kind: SCHEDULED_ENTRY,
            model: [
              {
                role: "user",
                content: `[Your scheduled task "${report.title}" ran and reported the following to the user.]\n\n${report.text}`,
                timestamp: now,
              },
            ],
            data: {
              scheduleId: report.scheduleId,
              title: report.title,
              runChatId: report.runChatId,
              text: report.text,
            },
          },
        },
        context,
      )
      await harness.commit(async (tx) => {
        const chat = (await tx.doc(ChatsDoc)).chats[originChatId!]
        if (chat !== undefined) chat.updatedAt = now
      }, context)
    }
    this.#options.onReport?.({ ...report, chatId: origin === undefined ? null : originChatId })
  }

  #tool() {
    return defineTool({
      name: "schedule",
      description:
        'Manage tasks you run on your own later or repeatedly. action "create" needs `schedule` and `prompt`; "update", "pause", "resume", "remove", "run" and "check" need `id`; "list" shows them all. "run" runs one now, without changing when it next runs on its own: use it to try out a task you have just made. ' +
        '`schedule` is one of: "30m" (once, that long from now), "every 2h" (repeating), a 5-field cron expression such as "0 9 * * 1-5" (in the user\'s timezone), or an ISO 8601 timestamp. ' +
        "`prompt` is what you will be asked to do on each run, written so it makes sense with no other context. Each run starts fresh and its final reply is delivered to the user. " +
        'Give a task a `check` when most of its runs would find nothing to do ("tell me when…", "only if…"): a shell command that is run first each time, with no model and at no cost in tokens. If it prints nothing, that time is skipped and you are not started; if it prints something, you are started with what it printed in front of the prompt. With `wake_on` "change" you are started instead when what it prints differs from the time before. A check only looks and never changes anything, since it can be run more than once; it must end with exit code 0 whether or not it found something, because failing counts as broken; and it should print nothing but what matters. After making or changing one, try it with action "check", which runs only the command and says what a run would have done.',
      parameters: Type.Object({
        action: Type.Union([
          Type.Literal("create"),
          Type.Literal("list"),
          Type.Literal("update"),
          Type.Literal("pause"),
          Type.Literal("resume"),
          Type.Literal("remove"),
          Type.Literal("run"),
          Type.Literal("check"),
        ]),
        id: Type.Optional(Type.String()),
        schedule: Type.Optional(Type.String()),
        prompt: Type.Optional(Type.String()),
        title: Type.Optional(Type.String({ description: "A short name for the task" })),
        timezone: Type.Optional(
          Type.String({
            description: "IANA timezone for a cron expression, if not the user's own",
          }),
        ),
        check: Type.Optional(
          Type.String({
            description:
              'A shell command that decides whether you are started. On "update", "" takes it away',
          }),
        ),
        wake_on: Type.Optional(
          Type.Union([Type.Literal("output"), Type.Literal("change")], {
            description:
              'What starts you: "output", the check printing anything (the default), or "change", it printing something other than last time',
          }),
        ),
        computer: Type.Optional(
          Type.String({
            description:
              "The computer the check runs on, if there is more than one machine. It starts in your folder there",
          }),
        ),
      }),
      execute: async (args, api, context) => {
        const reply = (text: string, isError = false) => ({
          isError,
          output: [{ type: "text" as const, text }],
        })
        const identity = await api.snapshot(IdentityDoc, context)
        const describe = (schedule: ScheduleSummary) =>
          `${schedule.id}: "${schedule.title}" — ${schedule.schedule}` +
          (schedule.enabled && schedule.nextRunAt !== null
            ? `, next run ${formatTime(schedule.nextRunAt, schedule.timezone ?? identity?.timezone)}`
            : ", paused") +
          (schedule.running ? " (running now)" : "") +
          (schedule.check === null
            ? ""
            : `. Checked first on ${schedule.check.computer}, and you are started ${
                schedule.check.wake === "change"
                  ? "when what it prints changes"
                  : "if it prints anything"
              }: \`${schedule.check.command}\``)
        try {
          const chatId = String(api.conversationId)
          const chats = (await api.snapshot(ChatsDoc, context))?.chats ?? {}
          const kind = own(chats, chatId)?.kind
          if (args.action !== "list" && (kind === "schedule" || kind === "subagent")) {
            return reply(
              `A ${kind === "schedule" ? "scheduled run" : "sub-agent"} cannot change schedules.`,
              true,
            )
          }
          switch (args.action) {
            case "list": {
              const schedules = await this.list(context)
              return reply(
                schedules.length === 0 ? "No schedules." : schedules.map(describe).join("\n"),
              )
            }
            case "create": {
              if (!args.schedule || !args.prompt) {
                return reply('"create" needs both schedule and prompt.', true)
              }
              const created = await this.create(
                {
                  schedule: args.schedule,
                  prompt: args.prompt,
                  title: args.title,
                  timezone: args.timezone,
                  check: args.check,
                  wakeOn: args.wake_on,
                  computer: args.computer,
                },
                own(chats, chatId) === undefined ? null : chatId,
                context,
              )
              return reply(`Scheduled. ${describe(created)}`)
            }
            case "check":
              if (!args.id) return reply('"check" needs id.', true)
              return reply(await this.tryCheck(args.id, context))
            case "remove":
              if (!args.id) return reply('"remove" needs id.', true)
              await this.remove(args.id, context)
              return reply(`Removed schedule ${args.id}.`)
            case "run":
              if (!args.id) return reply('"run" needs id.', true)
              await this.runNow(args.id, this.#options.context ?? context)
              return reply(
                `Started a run of schedule ${args.id}. It runs on its own, and what it reports is delivered where the schedule's reports go: do not wait for it.`,
              )
            default: {
              if (!args.id) return reply(`"${args.action}" needs id.`, true)
              const change: UpdateScheduleRequest =
                args.action === "pause"
                  ? { enabled: false }
                  : args.action === "resume"
                    ? { enabled: true }
                    : {
                        schedule: args.schedule,
                        prompt: args.prompt,
                        title: args.title,
                        timezone: args.timezone,
                      }
              const check =
                args.action === "update"
                  ? { check: args.check, wakeOn: args.wake_on, computer: args.computer }
                  : undefined
              return reply(
                `Updated. ${describe(await this.update(args.id, change, context, check))}`,
              )
            }
          }
        } catch (error) {
          if (error instanceof ScheduleError) return reply(error.message, true)
          throw error
        }
      },
    })
  }
}
