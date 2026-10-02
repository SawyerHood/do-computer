import type { ScheduleSummary, UpdateScheduleRequest } from "@durable-computer/protocol"
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
import { formatTime, nextRunAt, parseSchedule } from "./schedule.ts"
import { own } from "./own.ts"

export const SILENT_MARKER = "[SILENT]"
export const MAX_ENABLED_SCHEDULES = 20
const MAX_TITLE_CHARS = 80
const MAX_PROMPT_CHARS = 8_000

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
  }
}

const titleOf = (prompt: string) => {
  const line = prompt.trim().split("\n")[0]!.trim()
  return line.length > MAX_TITLE_CHARS ? `${line.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…` : line
}

/** A problem the caller should be told about, as opposed to a bug. */
export class ScheduleError extends Error {}

export type SchedulerOptions = {
  readonly now: () => number
  /** Called when a scheduled task has something to tell the user. */
  readonly onReport?: (report: ScheduledReport) => void
  readonly onError?: (error: unknown) => void
}

/**
 * The agent's schedules: the tool it manages them with, and the firing of due ones.
 *
 * A fire is one commit that creates the run's chat, records the run as pending and moves the
 * schedule on, so a crash can lose a run's start but never run it twice. Submitting the prompt
 * and delivering the report are both keyed, so repeating them after a crash does nothing new.
 */
export class Scheduler {
  readonly extension: Extension
  readonly #options: SchedulerOptions
  #harness: Harness | undefined
  #ticking: Promise<void> = Promise.resolve()

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
    input: { schedule: string; prompt: string; title?: string; timezone?: string },
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

  async update(
    id: string,
    change: UpdateScheduleRequest,
    context: Context,
  ): Promise<ScheduleSummary> {
    const now = this.#options.now()
    return this.#require().commit(async (tx) => {
      const { schedules } = await tx.doc(SchedulesDoc)
      const record = own(schedules, id)
      if (record === undefined) throw new ScheduleError(`There is no schedule "${id}".`)
      if (typeof change.title === "string" && change.title.trim() !== "") {
        record.title = change.title.trim().slice(0, MAX_TITLE_CHARS)
      }
      if (typeof change.prompt === "string" && change.prompt.trim() !== "") {
        if (change.prompt.length > MAX_PROMPT_CHARS) {
          throw new ScheduleError(`A prompt can be at most ${MAX_PROMPT_CHARS} characters.`)
        }
        record.prompt = change.prompt.trim()
      }
      const rescheduled = typeof change.schedule === "string" && change.schedule.trim() !== ""
      if (rescheduled) record.schedule = change.schedule!.trim()
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
        next = nextRunAt(parseSchedule(record.schedule, now, record.timezone ?? undefined), now)
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
    await harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: { model: parseModel(identity.model) },
        init: async (tx, conversationId) => {
          const record = own((await tx.doc(SchedulesDoc)).schedules, id)
          // Removed or already fired since the snapshot: the chat stays unlisted and empty.
          if (record === undefined || record.pending !== null) return
          const chatId = String(conversationId)
          ;(await tx.doc(ChatsDoc)).chats[chatId] = {
            title: record.title,
            kind: "schedule",
            createdAt: now,
            updatedAt: now,
            archived: false,
          }
          record.pending = { chatId, firedAt: now }
          record.runCount += 1
          advance(record)
        },
      },
      context,
    )
  }

  /** Start pending runs that have not started, and report the ones that finished. */
  async #settle(context: Context): Promise<void> {
    const harness = this.#require()
    const schedules = (await harness.snapshot(SchedulesDoc, context))?.schedules ?? {}
    for (const [id, record] of Object.entries(schedules)) {
      const pending = record.pending
      if (pending === null) continue
      const conversation = await harness.conversation(
        Number(pending.chatId) as ConversationId,
        context,
      )
      if (conversation === undefined) continue
      const identity = await harness.snapshot(IdentityDoc, context)
      // The same request id every time: the first call starts the run, later ones find it.
      const submission = await conversation.submit(
        {
          type: "input",
          requestId: `schedule:${id}:${pending.firedAt}`,
          content: `${preamble(record.title, pending.firedAt, identity?.timezone ?? record.timezone)}\n\n${record.prompt}`,
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
            { scheduleId: id, title: record.title, runChatId: pending.chatId, chatId: null, text },
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
        stored.lastRun = { at: pending.firedAt, chatId: pending.chatId, outcome }
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
        'Manage tasks you run on your own later or repeatedly. action "create" needs `schedule` and `prompt`; "update", "pause", "resume" and "remove" need `id`; "list" shows them all. ' +
        '`schedule` is one of: "30m" (once, that long from now), "every 2h" (repeating), a 5-field cron expression such as "0 9 * * 1-5" (in the user\'s timezone), or an ISO 8601 timestamp. ' +
        "`prompt` is what you will be asked to do on each run, written so it makes sense with no other context. Each run starts fresh and its final reply is delivered to the user.",
      parameters: Type.Object({
        action: Type.Union([
          Type.Literal("create"),
          Type.Literal("list"),
          Type.Literal("update"),
          Type.Literal("pause"),
          Type.Literal("resume"),
          Type.Literal("remove"),
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
      }),
      execute: async (args, api, context) => {
        const reply = (text: string, isError = false) => ({
          isError,
          content: [{ type: "text" as const, text }],
        })
        const identity = await api.snapshot(IdentityDoc, context)
        const describe = (schedule: ScheduleSummary) =>
          `${schedule.id}: "${schedule.title}" — ${schedule.schedule}` +
          (schedule.enabled && schedule.nextRunAt !== null
            ? `, next run ${formatTime(schedule.nextRunAt, schedule.timezone ?? identity?.timezone)}`
            : ", paused") +
          (schedule.running ? " (running now)" : "")
        try {
          const chatId = String(api.conversationId)
          const chats = (await api.snapshot(ChatsDoc, context))?.chats ?? {}
          if (args.action !== "list" && own(chats, chatId)?.kind === "schedule") {
            return reply("A scheduled run cannot change schedules.", true)
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
                },
                own(chats, chatId) === undefined ? null : chatId,
                context,
              )
              return reply(`Scheduled. ${describe(created)}`)
            }
            case "remove":
              if (!args.id) return reply('"remove" needs id.', true)
              await this.remove(args.id, context)
              return reply(`Removed schedule ${args.id}.`)
            default: {
              if (!args.id) return reply(`"${args.action}" needs id.`, true)
              const change: UpdateScheduleRequest =
                args.action === "pause"
                  ? { enabled: false }
                  : args.action === "resume"
                    ? { enabled: true }
                    : { schedule: args.schedule, prompt: args.prompt, title: args.title }
              return reply(`Updated. ${describe(await this.update(args.id, change, context))}`)
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
