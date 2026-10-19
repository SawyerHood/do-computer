import type { ChatMessage, ChatUsage } from "@do-computer/protocol"
import type { Context } from "@earendil-works/chord"
import type { AssistantMessage } from "@earendil-works/pi-ai"
import {
  CompactionTask,
  type ConversationId,
  defineDoc,
  defineExtension,
  type EntryId,
  type EntryRecord,
  type Extension,
  GenerationTask,
  type Harness,
  hook,
  section,
} from "@earendil-works/pi-durable"
import {
  type ChatRecord,
  ChatsDoc,
  type ChatsState,
  IdentityDoc,
  SchedulesDoc,
  type SchedulesState,
} from "./docs.ts"
import { own } from "./own.ts"
import { addNotes } from "./persona.ts"
import { onlySends, roundEnded, storedRound } from "./bus.ts"
import { projectPast } from "./project.ts"
import { isValidTimezone } from "./schedule.ts"

/** What is kept of one chat for the agent's other chats: what it is about and where it stands. */
export type ChatNote = {
  text: string
  at: number
  /** The last message the note takes in. What comes after it is read the next time. */
  through: number
}

/** A piece of work the agent finished, as it wrote it up with the log tool. */
export type DoneEntry = {
  at: number
  chatId: string
  title: string
  outcome: string
  /** For a scheduled run: the schedule's title, as it was when the run was written up. */
  run?: string
  /**
   * For a scheduled run: the schedule's id, so that each schedule has one entry, its latest, by
   * whatever title. Absent on entries from before it was kept, which are known by `run`.
   */
  schedule?: string
}

/**
 * What the agent's chats tell each other. A chat sees only its own messages; this is where what
 * went on in one is kept for the rest, and every chat is shown the latest of it.
 */
export type JournalState = {
  notes: Record<string, ChatNote>
  /** Oldest first. */
  done: DoneEntry[]
  /** What having a small model write the notes has cost. */
  spent?: ChatUsage
}

export const JournalDoc = defineDoc<JournalState>({
  kind: "dc.journal",
  version: 1,
  scope: "session",
  initial: () => ({ notes: {}, done: [] }),
})

/** How many chats' notes and finished pieces of work are kept. The oldest go first. */
const MAX_NOTES = 40
const MAX_DONE = 40
/** How many of each a chat is shown, and how much of one. */
const SHOWN_NOTES = 6
const SHOWN_DONE = 10
const MAX_NOTE_CHARS = 500
const MAX_DONE_CHARS = 200

const clip = (text: string, limit: number) => {
  const plain = text.replace(/\s+/g, " ").trim()
  return plain.length > limit ? `${plain.slice(0, limit - 1).trimEnd()}…` : plain
}

/** A date and time as the agent reads them: fixed text, so the section changes only with its entries. */
function stamp(at: number, timezone: string | null | undefined): string {
  const zone = timezone && isValidTimezone(timezone) ? timezone : "UTC"
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(at))
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? ""
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`
}

/** What a chat is, for the agent reading about it from another one. */
export function chatLabel(id: string, chat: ChatRecord, main: string | undefined): string {
  const named = chat.title.replaceAll('"', "'")
  if (id === main) return `Your main chat (chat ${id})`
  switch (chat.kind) {
    case "slack":
      return `${
        chat.slack?.direct
          ? "A direct message in Slack"
          : `A Slack thread${chat.slack?.channelName ? ` in #${chat.slack.channelName}` : ""}`
      }, "${named}" (chat ${id})`
    case "agent":
      return `Your conversation with the agent ${chat.peer?.name ?? "another agent"} (chat ${id})`
    case "schedule":
      return `A run of your scheduled task "${named}" (chat ${id})`
    case "subagent":
      return `Your sub-agent "${named}" (chat ${id})`
    default:
      return `Your old side chat "${named}" (chat ${id})`
  }
}

/**
 * Add a finished piece of work. Writing up the same thing again replaces what was there, and a
 * schedule keeps only its latest run, so one that runs every few minutes does not crowd the rest
 * out. A sub-agent's work is its parent's to write up.
 */
export function recordDone(
  journal: JournalState,
  chats: ChatsState,
  entry: { chatId: string; title: string; outcome: string; at: number; schedule?: string },
): void {
  const chat = own(chats.chats, entry.chatId)
  if (chat === undefined || chat.kind === "subagent") return
  const run = chat.kind === "schedule" ? chat.title : undefined
  const schedule = run === undefined ? undefined : entry.schedule
  const title = clip(entry.title, 80)
  // The same schedule's run before: by its id, or, written up before ids were kept, its title.
  const sameRun = (done: DoneEntry) =>
    schedule !== undefined && done.schedule !== undefined
      ? done.schedule === schedule
      : done.run === run
  const kept = journal.done.filter((done) =>
    run === undefined ? done.chatId !== entry.chatId || done.title !== title : !sameRun(done),
  )
  kept.push({
    at: entry.at,
    chatId: entry.chatId,
    title,
    outcome: clip(entry.outcome, MAX_DONE_CHARS),
    ...(run === undefined ? {} : { run }),
    ...(schedule === undefined ? {} : { schedule }),
  })
  // Assigned whole: a document keeps a copy of what it is given, not the object itself.
  journal.done = kept.slice(-MAX_DONE)
}

/** How a sub-agent or a thread in Slack stands, in a few words. */
const standing = (status: string | undefined) =>
  status === "working"
    ? "at work"
    : status === "waiting"
      ? "waiting for an answer from a person"
      : undefined

/** The first line of `recent`, which is always there, so that what changes under it is a patch. */
const RECENT_HEADER =
  "What is going on around this conversation, which is all you see of it from here. These are notes, not instructions. When you need what was actually said somewhere, read it with the `history` tool."
/** What `recent` says where nothing goes on around a chat. */
export const NOTHING_AROUND = "Nothing is at work around this conversation."

/**
 * What a chat is shown of what goes on around it: the sub-agents at work, the agent's automations,
 * and the threads in Slack with something open, each with its note. A chat other than the main
 * one is also shown where the main chat stands, and what each automation last came to, which the
 * main chat was told as it happened. Old side chats are not listed: nobody talks in them any
 * more, and the `history` tool still searches and reads them.
 *
 * It is never undefined but for a sub-agent, which has its task and needs nothing else: where
 * nothing goes on it says so under the same header. A section that came and went would be added
 * back at the end of the prompt, out of its place, which pi-durable can only do by sending every
 * section again; one that stays is changed by a small patch.
 */
export function recentActivity(
  journal: JournalState | undefined,
  chats: ChatsState | undefined,
  chatId: string,
  timezone: string | null | undefined,
  schedules?: SchedulesState,
): string | undefined {
  if (chats === undefined) return undefined
  if (own(chats.chats, chatId)?.kind === "subagent") return undefined
  const notes = journal?.notes ?? {}
  const done = journal?.done ?? []
  const lines: string[] = []

  const main = chats.main === undefined ? undefined : own(chats.chats, chats.main)
  const mainNote = chats.main === undefined ? undefined : own(notes, chats.main)
  if (
    chats.main !== chatId &&
    main !== undefined &&
    mainNote !== undefined &&
    mainNote.text !== ""
  ) {
    lines.push(
      "",
      `Where your main chat (chat ${chats.main}) stands, ${stamp(mainNote.at, timezone)}: ${mainNote.text}`,
    )
  }

  const working = Object.entries(chats.chats)
    .flatMap(([id, chat]) => {
      const how = standing(chat.subagent?.status)
      return chat.kind === "subagent" && how !== undefined ? [{ id, chat, how }] : []
    })
    .sort((a, b) => a.chat.createdAt - b.chat.createdAt)
  if (working.length > 0) {
    lines.push("", "Sub-agents at work:")
    for (const { id, chat, how } of working)
      lines.push(`- ${chatLabel(id, chat, chats.main)}, ${how}`)
  }

  // Each automation once, with what its latest run came to where that is known, outside the main
  // chat: that was told of each run as it happened, and the line would change with every run.
  const outcomes = chats.main !== chatId
  const bySchedule = new Map(
    done.flatMap((entry) => (entry.schedule === undefined ? [] : [[entry.schedule, entry]])),
  )
  const byTitle = new Map(
    done.flatMap((entry) =>
      entry.run === undefined || entry.schedule !== undefined ? [] : [[entry.run, entry]],
    ),
  )
  const automations = Object.entries(schedules?.schedules ?? {})
    .filter(([, schedule]) => schedule.enabled)
    .sort(([, a], [, b]) => a.createdAt - b.createdAt)
  if (automations.length > 0) {
    lines.push("", "Your automations, which report to your main chat:")
    for (const [id, schedule] of automations) {
      const last = outcomes ? (bySchedule.get(id) ?? byTitle.get(schedule.title)) : undefined
      lines.push(
        `- "${schedule.title.replaceAll('"', "'")}" (schedule ${id}), ${schedule.schedule}${
          last === undefined
            ? ""
            : `; last run ${stamp(last.at, timezone)}: ${clip(last.outcome, MAX_DONE_CHARS)}`
        }`,
      )
    }
  }

  // Threads in Slack that are at work, or waiting, or have a note of where they stand.
  const threads = Object.entries(chats.chats)
    .flatMap(([id, chat]) => {
      if (chat.kind !== "slack" || id === chatId || chat.archived) return []
      const how = standing(chat.slack?.status)
      const note = own(notes, id)
      const text = note?.text ?? ""
      if (how === undefined && text === "") return []
      return [{ id, chat, how, text, at: note?.at ?? chat.updatedAt }]
    })
    .sort((a, b) => b.at - a.at)
    .slice(0, SHOWN_NOTES)
  if (threads.length > 0) {
    lines.push("", "Threads in Slack with something open, most recent first:")
    for (const { id, chat, how, text, at } of threads) {
      const said = [how, text === "" ? undefined : `${stamp(at, timezone)}: ${text}`]
        .filter(Boolean)
        .join("; ")
      lines.push(`- ${chatLabel(id, chat, chats.main)}, ${said}`)
    }
  }

  // Work written up in the threads and in conversations with other agents. An automation's is
  // with it above, and the main chat's own is in front of it already.
  const finished = done
    .flatMap((entry) => {
      const chat = entry.chatId === chatId ? undefined : own(chats.chats, entry.chatId)
      return chat === undefined ||
        entry.run !== undefined ||
        (chat.kind !== "slack" && chat.kind !== "agent")
        ? []
        : [{ entry, chat }]
    })
    .slice(-SHOWN_DONE)
    .reverse()
  if (finished.length > 0) {
    lines.push("", "Work finished in them, most recent first:")
    for (const { entry, chat } of finished) {
      lines.push(
        `- ${stamp(entry.at, timezone)}, ${chatLabel(entry.chatId, chat, chats.main)}: ${entry.title}. ${entry.outcome}`,
      )
    }
  }

  return [RECENT_HEADER, ...(lines.length === 0 ? ["", NOTHING_AROUND] : lines)].join("\n")
}

export type ReviewOptions = {
  /** The deployment's OpenRouter key. Notes are billed to it like everything else. */
  readonly apiKey: string
  /** OpenRouter model id that writes the notes. A small one that summarizes well is right. */
  readonly model: string
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>
}

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"
/** How long the small model is given. Past that, the note is written the next time. */
const REVIEW_TIMEOUT_MS = 20_000
/** How much of what was said since the last note is read: the newest of it. */
const MAX_REVIEW_ENTRIES = 400
const MAX_SAID_CHARS = 9_000
const MAX_MESSAGE_CHARS = 1_200
/**
 * The same for a stretch with a voice call in it. A chat is read after each answer, so what is
 * new is short; a call is read once it is over, and is all new at once.
 */
const MAX_CALL_SAID_CHARS = 30_000
/** How many lasting things one reading can add of each kind, and after a call. */
const MAX_ADDED = 1
const MAX_CALL_ADDED = 3

const INSTRUCTIONS = (
  team: boolean,
  most = MAX_ADDED,
) => `You keep the notes of an AI agent that works for ${
  team ? "a team" : "one person"
} across several separate chats. Each chat sees only its own messages, so these notes are how the agent knows, from its other chats, what went on in this one. You are given the note as it stands, what the agent already remembers, and what was said in the chat since the note was written. Answer with one JSON object and nothing else:

{"note": "...", "memory": [], "user": []}

"note": the chat's note, rewritten to take in what is new. At most 60 words, in plain sentences. Say what the chat is about, what was decided or done, and what is still open or waiting on someone. Keep names, numbers, dates, links and file names exactly as written. Keep what is still true in the note as it stands, and drop what is settled or was replaced. Write for a reader who has seen none of the chat. If nothing was said that another chat could need, such as greetings or small talk, give the note as it stands, or "" where there is none.

"memory" and "user": nearly always empty. Add an entry only for something the ${
  team ? "people" : "person"
} said that will still matter in every chat months from now and is not already remembered. "user" is for a lasting fact about ${
  team ? "one of the people, saying who" : "the person"
}: who they are, what they prefer, how they want things done. "memory" is for a lasting fact about their setup, such as machines, accounts and tools, or a convention for how work is to be done; what someone likes or wants for themselves goes in "user". Each entry is one sentence that states a fact and gives no order. At most ${
  most === 1 ? "one entry" : `${most} entries`
} in each. Never the task at hand, how far it has got, or anything that belongs in the note.${
  most === 1
    ? ""
    : " Some of what was said was said out loud, on a voice call the agent's voice answered: it counts as said in the chat."
}`

/**
 * What was said, as lines the small model reads. Steps are named, not shown. A voice call that
 * was held in the chat is read as what was said on it: `called` is whether there was one.
 */
function transcript(messages: readonly ChatMessage[]): {
  text: string
  asked: number
  called: boolean
} {
  let asked = 0
  let called = false
  const lines: string[] = []
  for (const message of messages) {
    if (message.role === "notice") {
      for (const part of message.parts) {
        if (part.type !== "notice" || part.call === undefined) continue
        called = true
        const who = part.call.by ?? "the person"
        for (const line of part.call.lines) {
          if (line.who === "you") asked++
          lines.push(
            `${line.who === "you" ? `${who} (out loud, on a call)` : "the agent's voice"}: ${clip(line.text, MAX_MESSAGE_CHARS)}`,
          )
        }
      }
      continue
    }
    const said = message.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n")
      .trim()
    const steps = message.parts.flatMap((part) => (part.type === "tool" ? [part.name] : []))
    if (message.role === "user") {
      if (said === "") continue
      asked++
      const who = message.author?.name ?? message.slack?.name ?? message.agent?.name ?? "the person"
      lines.push(`${who}: ${clip(said, MAX_MESSAGE_CHARS)}`)
      continue
    }
    const used = steps.length === 0 ? "" : ` [used ${[...new Set(steps)].join(", ")}]`
    if (said === "" && used === "") continue
    lines.push(`the agent:${used} ${clip(said, MAX_MESSAGE_CHARS)}`.trimEnd())
  }
  let text = lines.join("\n")
  // The newest is what the note must take in; the oldest of a long stretch is let go.
  const limit = called ? MAX_CALL_SAID_CHARS : MAX_SAID_CHARS
  if (text.length > limit) text = `…\n${text.slice(-limit)}`
  return { text, asked, called }
}

type Reviewed = { note?: string; memory: string[]; user: string[] }

/**
 * What the small model answered, read leniently: a model may wrap its JSON in words or a fence.
 * `most` is how many lasting things of each kind are taken from it.
 */
export function parseReview(answer: string, most = MAX_ADDED): Reviewed | undefined {
  const start = answer.indexOf("{")
  const end = answer.lastIndexOf("}")
  if (start === -1 || end <= start) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(answer.slice(start, end + 1))
  } catch {
    return undefined
  }
  if (typeof parsed !== "object" || parsed === null) return undefined
  const { note, memory, user } = parsed as Record<string, unknown>
  const list = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string").slice(0, most)
      : []
  return {
    ...(typeof note === "string" ? { note } : {}),
    memory: list(memory),
    user: list(user),
  }
}

export type JournalOptions = {
  /** The small model that writes each chat's note. Absent: only what the agent logs is kept. */
  readonly review?: ReviewOptions
  readonly now: () => number
  /** What writing a note runs under: it outlives the run that set it off. */
  readonly context: Context
  readonly onError: (error: unknown) => void
}

/**
 * Keeps the agent's chats from losing each other's context. Every chat is shown where the others
 * stand and what was finished in them. The finished work is what the agent writes up itself
 * with the log tool. Where a chat stands is written by a small model each time the agent comes to
 * rest there, and before a chat's context is summarized or started over, so nothing depends on
 * the agent thinking to save it. The same reading adds a lasting fact to the agent's memory where
 * one was said and not saved; it never removes or rewrites what the agent keeps.
 */
export class Journal {
  readonly extension: Extension
  readonly #options: JournalOptions
  /** The chats a note is being written for, and those where more was said meanwhile. */
  readonly #writing = new Map<string, Promise<void>>()
  readonly #again = new Set<string>()
  #harness: Harness | undefined

  constructor(options: JournalOptions) {
    this.#options = options
    this.extension = defineExtension({
      name: "dc.journal",
      sections: [
        section("recent", async (input, context) => {
          const [journal, chats, identity, schedules] = await Promise.all([
            input.read.snapshot(JournalDoc, context),
            input.read.snapshot(ChatsDoc, context),
            input.read.snapshot(IdentityDoc, context),
            input.read.snapshot(SchedulesDoc, context),
          ])
          return recentActivity(
            journal,
            chats,
            String(input.conversationId),
            identity?.timezone,
            schedules,
          )
        }),
      ],
      hooks: [
        hook(GenerationTask, {
          // The agent came to rest. Never waited for: an answer is not held up for its note.
          onYield: (answer, api) => {
            void this.review(String(api.conversationId), answer)
            return undefined
          },
          // A run that a send marked done ended never yields: it comes to rest with that round.
          // Read from the stored results, as the run's end was decided. This runs before the
          // commit that ends the run, so a round looked at again after a crash reviews again:
          // one more small-model call, which writes the same note.
          afterTools: async (assistant, results, api, context) => {
            const harness = this.#harness
            if (harness === undefined || this.#options.review === undefined) return
            try {
              if (!(await onlySends(api, context))) return
              const round = await storedRound(harness, assistant, results, context)
              if (round !== undefined && roundEnded(round.answer, round.results)) {
                void this.review(String(api.conversationId))
              }
            } catch (error) {
              this.#options.onError(error)
            }
          },
        }),
        hook(CompactionTask, {
          // What is about to be summarized away is noted first, where it has not been.
          beforeCompact: (_compaction, api) => {
            void this.review(String(api.conversationId))
            return undefined
          },
        }),
      ],
    })
  }

  attach(harness: Harness): void {
    this.#harness = harness
  }

  /** What writing the notes has cost, and the model that wrote them. */
  async spent(context: Context): Promise<{ model: string; spent: ChatUsage } | undefined> {
    const review = this.#options.review
    const spent = (await this.#harness?.snapshot(JournalDoc, context))?.spent
    return review === undefined || spent === undefined ? undefined : { model: review.model, spent }
  }

  /** Write up a piece of finished work from outside a tool call, such as a scheduled run's report. */
  async record(entry: {
    chatId: string
    title: string
    outcome: string
    schedule?: string
  }): Promise<void> {
    await this.#harness?.commit(async (tx) => {
      recordDone(await tx.doc(JournalDoc), await tx.doc(ChatsDoc), {
        ...entry,
        at: this.#options.now(),
      })
    }, this.#options.context)
  }

  /**
   * Bring a chat's note up to date with what was said since it was written. `answer` is the
   * reply the agent is coming to rest on, which may not be stored yet. One at a time for a chat:
   * asked again meanwhile, it is done once more afterwards. Never throws.
   */
  review(chatId: string, answer?: AssistantMessage): Promise<void> {
    if (this.#options.review === undefined || this.#harness === undefined) return Promise.resolve()
    const writing = this.#writing.get(chatId)
    if (writing !== undefined) {
      this.#again.add(chatId)
      return writing
    }
    const run = this.#review(chatId, answer)
      .catch((error) => {
        this.#options.onError(
          new Error(
            `Could not write the note of chat ${chatId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
            { cause: error },
          ),
        )
      })
      .finally(() => {
        this.#writing.delete(chatId)
        if (this.#again.delete(chatId)) void this.review(chatId)
      })
    this.#writing.set(chatId, run)
    return run
  }

  async #review(chatId: string, answer: AssistantMessage | undefined): Promise<void> {
    const review = this.#options.review!
    const harness = this.#harness!
    const context = this.#options.context
    const chats = await harness.snapshot(ChatsDoc, context)
    const chat = own(chats?.chats, chatId)
    // A sub-agent reports to the chat that started it, and a scheduled run to the chat its
    // schedule was made in: what they did is told there.
    if (chat === undefined || chat.kind === "subagent" || chat.kind === "schedule") return
    const conversation = await harness.conversation(Number(chatId) as ConversationId, context)
    if (conversation === undefined) return
    const before = (await harness.snapshot(JournalDoc, context))?.notes[chatId]
    // A side chat's own messages begin after the ones it carries from the chat it branched off.
    const through = Math.max(before?.through ?? 0, chat.fork?.at ?? 0)

    // Newest first from storage, so a long stretch is read from its end.
    const entries: EntryRecord[] = []
    let cursor: Parameters<typeof conversation.entries>[2]
    do {
      const page = await conversation.entries(
        { minEntryId: (through + 1) as EntryId },
        200,
        cursor,
        context,
      )
      entries.push(...page.items)
      cursor = page.next
    } while (cursor !== undefined && entries.length < MAX_REVIEW_ENTRIES)
    if (entries.length === 0) return
    entries.reverse()
    const last = Number(entries.at(-1)!.id)
    const messages = projectPast(entries)
    const reply = answer?.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("\n")
      .trim()
    if (reply) {
      const stored = messages.findLast((message) => message.role === "assistant")
      const same = stored?.parts.some((part) => part.type === "text" && part.text.trim() === reply)
      if (same !== true) {
        messages.push({
          id: "reply",
          role: "assistant",
          parts: [{ type: "text", text: reply }],
          status: "done",
        })
      }
    }
    const said = transcript(messages)
    // Nothing a person said since the note: there is nothing new to take in.
    if (said.asked === 0) return
    // A call is all new at once, and may hold more than one thing worth keeping.
    const most = said.called ? MAX_CALL_ADDED : MAX_ADDED

    const identity = await harness.snapshot(IdentityDoc, context)
    const team = Boolean(identity?.team)
    const send = review.fetch ?? ((url, init) => fetch(url, init))
    const response = await send(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${review.apiKey}`,
        "content-type": "application/json",
        "x-title": "Do Computer",
      },
      body: JSON.stringify({
        model: review.model,
        max_tokens: said.called ? 700 : 400,
        temperature: 0,
        response_format: { type: "json_object" },
        usage: { include: true },
        messages: [
          { role: "system", content: INSTRUCTIONS(team, most) },
          {
            role: "user",
            content: [
              `The chat: ${chatLabel(chatId, chat, chats?.main)}`,
              `The note as it stands: ${before?.text || "(none)"}`,
              "",
              `Already remembered about ${team ? "the people" : "the person"}:`,
              identity?.user || "(nothing)",
              "",
              "Already remembered, the agent's own notes:",
              identity?.memory || "(nothing)",
              "",
              "Said since the note was written:",
              said.text,
            ].join("\n"),
          },
        ],
      }),
      signal: AbortSignal.timeout(REVIEW_TIMEOUT_MS),
    })
    const body = (await response.json().catch(() => ({}))) as {
      choices?: { message?: { content?: string | null } }[]
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }
      error?: { message?: string }
    }
    if (!response.ok || body.error !== undefined) {
      throw new Error(body.error?.message ?? `HTTP ${response.status}`)
    }
    const reviewed = parseReview(body.choices?.[0]?.message?.content ?? "", most)
    await harness.commit(async (tx) => {
      const journal = await tx.doc(JournalDoc)
      const spent = journal.spent ?? { inputTokens: 0, outputTokens: 0, cost: 0 }
      journal.spent = {
        inputTokens: spent.inputTokens + (body.usage?.prompt_tokens ?? 0),
        outputTokens: spent.outputTokens + (body.usage?.completion_tokens ?? 0),
        cost: spent.cost + (body.usage?.cost ?? 0),
      }
      // An answer that could not be read leaves the note as it was, to be tried again from
      // the same place.
      if (reviewed === undefined) return
      const notes = { ...journal.notes }
      notes[chatId] = {
        text: clip(reviewed.note ?? before?.text ?? "", MAX_NOTE_CHARS),
        at: this.#options.now(),
        through: last,
      }
      const kept = Object.entries(notes)
        .sort(([, a], [, b]) => b.at - a.at)
        .slice(0, MAX_NOTES)
      journal.notes = Object.fromEntries(kept)
      // What a person said is taken as something to remember, in the app or in Slack: whoever
      // is in the Slack workspace is someone the agent works for, by its owner's choice. What
      // another agent wrote is not.
      if (chat.kind !== "chat" && chat.kind !== "slack") return
      if (reviewed.user.length + reviewed.memory.length === 0) return
      const doc = await tx.doc(IdentityDoc)
      addNotes(doc, "user", reviewed.user)
      addNotes(doc, "memory", reviewed.memory)
    }, context)
  }
}
