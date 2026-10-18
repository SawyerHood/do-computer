import { CUT_OFF_TEXT } from "@do-computer/protocol"
import type { ActorDatabase } from "@do-computer/runtime"
import type { Context } from "@earendil-works/chord"
import {
  type ConversationId,
  defineExtension,
  type Extension,
  GenerationTask,
  type GenerationHooks,
  type Harness,
  hook,
} from "@earendil-works/pi-durable"
import { dropOldPictures } from "./uses.ts"

/** One message of a request to the model, as a `beforeRequest` hook is given it. */
export type SentMessage = Parameters<GenerationHooks["beforeRequest"]>[0]["messages"][number]

/**
 * How much of what a chat has seen as pictures one request to the model carries.
 *
 * A request is built in the agent's actor, which on Cloudflare is one Durable Object for every
 * chat and sub-agent of the agent, in an isolate of 128 MB. Building a request copies every
 * picture in it a few times over (its stored entry, the request's messages, the body as text and
 * as bytes). A conversation on this harness that had read 42 screenshots, some 31 MB as base64,
 * was seen to be unable to make a request at all: its isolate was reset each time, the run was
 * taken up again from its checkpoint, and reset again, for hours. Here that would take every
 * chat of the agent down with it. Providers refuse a request past a size and a number
 * of pictures of their own as well (Anthropic: 32 MB, 100 pictures).
 *
 * So past `highBytes` (or `highCount` pictures), the oldest pictures are left out until what is
 * left is under `lowBytes` (and `lowCount`). What is left out depends only on the order the
 * pictures came in, and grows only: a request starts the same as the one before it until the next
 * time a picture pushes it over, so a provider's prompt cache is only spent then, and not on every
 * request. The words around a picture, and what the model said of it, all stay.
 */
export type ImageLimits = {
  readonly highBytes: number
  readonly lowBytes: number
  readonly highCount: number
  readonly lowCount: number
}

/**
 * Lower than the 12 MB that does where an actor holds one conversation: here one holds every chat
 * of an agent, its main chat, side chats, up to six sub-agents and conversations with other
 * agents, and several of them can be building a request at once. At about four copies a
 * request, 8 MB of base64 is some 32 MB at its peak, so two requests at the mark together stay
 * well inside 128 MB with room for everything else the actor holds. 8 MB is still a dozen or
 * more full screenshots, or one picture of the largest size `read` gives (4.5 MB, 6 MB as
 * base64) with room beside it. Coming down to 3 MB, and not just under the mark, is what makes
 * it a step: what is left out then stays the same for as many requests as it takes to gain
 * 5 MB again. The counts keep under a provider's limit of 100 pictures, in steps of 40.
 */
export const IMAGE_LIMITS: ImageLimits = {
  highBytes: 8_000_000,
  lowBytes: 3_000_000,
  highCount: 80,
  lowCount: 40,
}

type Content = { type: string; data?: unknown; mimeType?: unknown }

/** Where a picture is: which message, which block of it, and how much of the request it is. */
type Picture = { message: number; block: number; size: number }

function pictures(messages: readonly SentMessage[]): Picture[] {
  const found: Picture[] = []
  messages.forEach((message, index) => {
    if (message.role !== "user" && message.role !== "toolResult") return
    const content: unknown = message.content
    if (!Array.isArray(content)) return
    content.forEach((block: Content, at) => {
      if (block.type === "image" && typeof block.data === "string") {
        found.push({ message: index, block: at, size: block.data.length })
      }
    })
  })
  return found
}

/**
 * How many of the oldest pictures are left out. Walked in order, as if each request had been
 * decided when its newest picture came in: the answer for a conversation is the answer for every
 * earlier part of it, or more. The newest picture is never left out.
 */
export function picturesLeftOut(
  sizes: readonly number[],
  limits: ImageLimits = IMAGE_LIMITS,
): number {
  let from = 0
  let bytes = 0
  for (let index = 0; index < sizes.length; index++) {
    bytes += sizes[index]!
    if (bytes <= limits.highBytes && index - from + 1 <= limits.highCount) continue
    while (from < index && (bytes > limits.lowBytes || index - from + 1 > limits.lowCount)) {
      bytes -= sizes[from]!
      from++
    }
  }
  return from
}

/** What the model reads where a picture was left out. */
export function leftOutText(mimeType: unknown, size: number): string {
  const kind = typeof mimeType === "string" && mimeType.length > 0 ? `${mimeType}, ` : ""
  const megabytes = ((size * 3) / 4 / 1_000_000).toFixed(1)
  return (
    `[A picture (${kind}${megabytes} MB) was here. It is left out of this request to keep the ` +
    "request small; what was said about it still stands. Read the file again to see it.]"
  )
}

/** The messages with their oldest pictures left out, or the same array when none need be. */
export function keepPicturesSmall(
  messages: readonly SentMessage[],
  limits: ImageLimits = IMAGE_LIMITS,
): readonly SentMessage[] {
  const found = pictures(messages)
  const leftOut = picturesLeftOut(
    found.map((picture) => picture.size),
    limits,
  )
  if (leftOut === 0) return messages
  const dropped = new Map<number, Set<number>>()
  for (const picture of found.slice(0, leftOut)) {
    const blocks = dropped.get(picture.message) ?? new Set<number>()
    blocks.add(picture.block)
    dropped.set(picture.message, blocks)
  }
  return messages.map((message, index) => {
    const blocks = dropped.get(index)
    if (blocks === undefined) return message
    const content = (message.content as Content[]).map((block, at) =>
      blocks.has(at)
        ? { type: "text" as const, text: leftOutText(block.mimeType, String(block.data).length) }
        : block,
    )
    return { ...message, content } as SentMessage
  })
}

/**
 * What a chat's request to the model carries, from the chat's context: the older pictures of the
 * screen and the browser left out (`uses.ts`), then the oldest pictures past the limits. Every
 * change the agent makes to a request belongs here, and nowhere else. The summary the idle
 * compaction asks for (`idle-compaction.ts`) is shaped by the same function, so that it starts as
 * the chat's last request did and is read from the provider's cache; a change made anywhere else
 * would make the two differ, and that cache would not be read.
 */
export function shapeRequest(
  messages: readonly SentMessage[],
  limits: ImageLimits = IMAGE_LIMITS,
): readonly SentMessage[] {
  return keepPicturesSmall(dropOldPictures(messages), limits)
}

/**
 * How many times one request to the model may be started without coming to an answer of any kind
 * (a reply, or a provider's error) before the chat's run is ended instead. A request that is cut
 * off with its actor, by a deploy or an eviction, is started again when the run is taken up, and
 * that is right once or twice. A request that takes its actor down each time, as one too large
 * for its isolate's memory does, would be started again forever: the keep-alive wake-up takes
 * the run up every 20 seconds, the chat says it is working for as long as anybody lets it, and
 * every other chat of the agent goes down with it each time.
 */
export const REQUEST_TRIES = 3

/** How long a request that is not to be started waits for its run to be stopped. */
const STOP_WAIT_MS = 10_000

/** The entry a chat is told in that its run was ended for that. */
export const CUT_OFF_ENTRY = "dc.cut-off"

export type CutOffEntry = {
  /** When the run was ended. */
  at: number
  /** How many times its request had been started. */
  starts: number
}

/** Whether a request that is starting should be started, from how many times it has been. */
export function shouldStart(starts: number, tries: number = REQUEST_TRIES): boolean {
  return starts <= tries
}

/**
 * How many times the request each generation task is making has been started, kept in the
 * agent's own store so that a new actor has it. A row a task: several chats of an agent can
 * have a request under way at once.
 */
export class RequestStarts {
  readonly #sql: ActorDatabase
  readonly #now: () => number
  #ready: Promise<void> | undefined

  constructor(sql: ActorDatabase, now: () => number) {
    this.#sql = sql
    this.#now = now
  }

  #open(): Promise<void> {
    this.#ready ??= this.#sql.exec(
      `CREATE TABLE IF NOT EXISTS dc_request_starts (
        task_id TEXT PRIMARY KEY,
        starts INTEGER NOT NULL,
        at INTEGER NOT NULL
      ) STRICT`,
    )
    this.#ready.catch(() => {
      this.#ready = undefined
    })
    return this.#ready
  }

  /** Count a start of the request `taskId` is making, and say how many there have been. */
  async start(taskId: string): Promise<number> {
    await this.#open()
    const row = await this.#sql.get<{ starts: number }>(
      "SELECT starts FROM dc_request_starts WHERE task_id = ?",
      taskId,
    )
    const starts = (row?.starts ?? 0) + 1
    await this.#sql.run(
      `INSERT INTO dc_request_starts (task_id, starts, at) VALUES (?, ?, ?)
       ON CONFLICT (task_id) DO UPDATE SET starts = excluded.starts, at = excluded.at`,
      taskId,
      starts,
      this.#now(),
    )
    return starts
  }

  /** The request came to an answer, or will not be made again: the next one starts from none. */
  async clear(taskId: string): Promise<void> {
    await this.#open()
    await this.#sql.run("DELETE FROM dc_request_starts WHERE task_id = ?", taskId)
  }

  /**
   * Forget the tasks that are no longer live, from a look at what is that was taken at `seen`. A
   * row written since then is kept: its task may have begun after the look.
   */
  async prune(live: ReadonlySet<string>, seen: number): Promise<void> {
    await this.#open()
    const rows = await this.#sql.all<{ task_id: string }>(
      "SELECT task_id FROM dc_request_starts WHERE at < ?",
      seen,
    )
    for (const row of rows) {
      if (!live.has(row.task_id)) await this.clear(row.task_id)
    }
  }

  /** How many tasks are counted, for tests. */
  async size(): Promise<number> {
    await this.#open()
    const row = await this.#sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM dc_request_starts")
    return row?.n ?? 0
  }
}

export type RequestLimitsOptions = {
  readonly sql: ActorDatabase
  readonly now: () => number
  /** The actor's own context, which outlives the request being stopped. */
  readonly context: Context
  /** How many times a request is started without an answer before its run is ended. */
  readonly tries?: number
  readonly images?: ImageLimits
  readonly onReport: (error: unknown) => void
}

/**
 * What one request to the model may carry, and how often it may be started: a request too large
 * for the actor's memory takes the actor down with it, and the run, taken up again by the next
 * one, would make it again. Pictures past a size are left out of it, and a request started over
 * and over without an answer is not started again: that chat's run ends, and the chat says why.
 * Installed after every other extension, so that what they add to a request is counted.
 */
export class RequestLimits {
  readonly extension: Extension
  readonly starts: RequestStarts
  readonly #options: RequestLimitsOptions
  #harness: Harness | undefined

  constructor(options: RequestLimitsOptions) {
    this.#options = options
    this.starts = new RequestStarts(options.sql, options.now)
    this.extension = defineExtension({
      name: "dc.limits",
      hooks: [
        hook(GenerationTask, {
          beforeRequest: async ({ messages }, api, context) => {
            const taskId = String(api.taskId)
            const starts = await this.starts.start(taskId)
            if (!shouldStart(starts, this.#options.tries ?? REQUEST_TRIES)) {
              await this.#cutOff(String(api.conversationId), taskId, starts, context.abortSignal)
              await this.starts.clear(taskId)
              // A hook's failure is only reported, and the request made all the same, unless the
              // run was stopped by then: it has been, so this ends the request and the run.
              throw new Error(CUT_OFF_TEXT)
            }
            const kept = shapeRequest(messages, this.#options.images)
            return kept === messages ? undefined : { messages: kept }
          },
          afterResponse: async (_message, api) => {
            await this.starts.clear(String(api.taskId))
          },
        }),
      ],
    })
  }

  attach(harness: Harness): void {
    this.#harness = harness
  }

  /**
   * End the run of a chat whose request kept being cut off, and say why in the chat. The stop is
   * not waited for, since it waits for the request, which is waiting here: only for the request's
   * own signal, which the stop sets as soon as it is marked. Other chats of the agent go on.
   */
  async #cutOff(
    chatId: string,
    taskId: string,
    starts: number,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const { context, onReport } = this.#options
    onReport(
      new Error(
        `Chat ${chatId}: its request to the model (task ${taskId}) was started ${starts} time${starts === 1 ? "" : "s"} without an answer, so its run was ended`,
      ),
    )
    const conversation = await this.#harness?.conversation(
      Number(chatId) as ConversationId,
      context,
    )
    if (conversation === undefined) return
    const data: CutOffEntry = { at: this.#options.now(), starts }
    // Keyed by the task: a crash before the stop writes it once, and the next start stops it.
    await conversation.submit(
      { type: "write", requestId: `cut-off:${taskId}`, entry: { kind: CUT_OFF_ENTRY, data } },
      context,
    )
    if (signal === undefined || signal.aborted) return
    const stopped = new Promise<void>((done) => {
      signal.addEventListener("abort", () => done(), { once: true })
    })
    conversation.abort(context).catch(onReport)
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      stopped,
      new Promise<void>((done) => {
        timer = setTimeout(done, STOP_WAIT_MS)
      }),
    ]).finally(() => clearTimeout(timer))
  }
}
