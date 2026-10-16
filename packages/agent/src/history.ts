import type { ChatHistoryPage, HistoryHit } from "@do-computer/protocol"
import type { Context } from "@earendil-works/chord"
import { Type } from "@earendil-works/pi-ai"
import {
  type ConversationId,
  defineExtension,
  defineTool,
  type EntryId,
  type EntryRecord,
  type Extension,
  type Harness,
  section,
} from "@earendil-works/pi-durable"
import type { SqliteDatabase } from "@earendil-works/pi-durable/storage/sqlite"
import { type ChatRecord, ChatsDoc, IdentityDoc } from "./docs.ts"
import { chatLabel, JournalDoc } from "./journal.ts"
import { own } from "./own.ts"
import { entryText, projectPast } from "./project.ts"

const PAGE_SIZE = 200
/** Entries one search will take in. Past it, the search says it did not look at everything. */
const SCAN_BUDGET = 10_000
/** A chat untouched for this long before it was last read is not read again. */
const SETTLED_MS = 24 * 60 * 60 * 1000
/** How much of one message is kept for searching. */
const MAX_STORED_CHARS = 20_000
/** How many chats a search can name to the database as ones to leave out. */
const MAX_SKIPPED = 60
const MAX_TERMS = 24
const SNIPPET_BEFORE = 80
const SNIPPET_LENGTH = 280
export const DEFAULT_HISTORY_PAGE = 50
const MAX_HISTORY_PAGE = 200

export class HistoryError extends Error {}

/** The words of a query, lowercased. Quotes keep a phrase together. */
export function searchTerms(query: string): string[] {
  const terms: string[] = []
  for (const match of query.toLowerCase().matchAll(/"([^"]+)"|(\S+)/g)) {
    const term = (match[1] ?? match[2] ?? "").trim()
    if (term !== "" && !terms.includes(term)) terms.push(term)
  }
  return terms.slice(0, MAX_TERMS)
}

/** Common words that say nothing about which message is meant. */
const FILLER = new Set(
  "a about an and are as at be by can did do does for from had has have how i in is it me my of on or our that the this to was we were what when where which who why with you your".split(
    " ",
  ),
)

/** The part of `text` around its first match, on one line. */
function snippet(text: string, terms: readonly string[]): string {
  const lower = text.toLowerCase()
  const first = Math.min(...terms.map((term) => lower.indexOf(term)).filter((at) => at !== -1))
  const start = Math.max(0, first - SNIPPET_BEFORE)
  const end = Math.min(text.length, start + SNIPPET_LENGTH)
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`
}

export type SearchResult = {
  hits: HistoryHit[]
  /** False when not every chat has been read yet, or there were more matches than were asked for. */
  complete: boolean
  /** True when no message had every word, and these are the ones with the most of them. */
  partial: boolean
  /** False while the agent's older chats are still being read in: a later search looks further back. */
  caughtUp: boolean
}

/** The agent's own SQLite database, which its transcripts are in too. */
type Sql = Pick<SqliteDatabase, "exec" | "run" | "all" | "transaction">

type Row = { chat_id: string; entry_id: number; role: string; at: number | null; text: string }

/**
 * The words of every chat, kept in a table of their own so that a search reads what was said and
 * nothing else. A transcript is mostly steps and their output; walking it to find a sentence
 * meant that an agent with a long past could not reach the far end of it.
 *
 * The table is filled in when a search is made, from where it left off in each chat. Messages
 * never change once written, so what is in it stays right.
 */
export class HistoryIndex {
  readonly #sql: Sql
  readonly #now: () => number
  #ready: Promise<void> | undefined

  constructor(sql: Sql, now: () => number) {
    this.#sql = sql
    this.#now = now
  }

  #prepare(): Promise<void> {
    this.#ready ??= (async () => {
      await this.#sql.exec(
        "CREATE TABLE IF NOT EXISTS dc_history (chat_id TEXT NOT NULL, entry_id INTEGER NOT NULL, role TEXT NOT NULL, at INTEGER, text TEXT NOT NULL, folded TEXT NOT NULL, PRIMARY KEY (chat_id, entry_id)) STRICT",
      )
      await this.#sql.exec(
        "CREATE TABLE IF NOT EXISTS dc_history_read (chat_id TEXT PRIMARY KEY, through INTEGER NOT NULL, at INTEGER NOT NULL) STRICT",
      )
    })()
    return this.#ready
  }

  /**
   * Take in what was said since the table was last filled, most recently active chats first.
   * False when it stopped before reading everything: an agent's whole past is read over a few
   * searches, not in one.
   */
  async #fill(
    harness: Harness,
    chats: readonly (readonly [string, ChatRecord])[],
    context: Context,
  ): Promise<boolean> {
    const read = new Map(
      (
        await this.#sql.all<{ chat_id: string; through: number; at: number }>(
          "SELECT chat_id, through, at FROM dc_history_read",
        )
      ).map((row) => [row.chat_id, row]),
    )
    let scanned = 0
    for (const [chatId, chat] of chats) {
      const mark = read.get(chatId)
      // Nothing has been said in it since well before it was last read.
      if (mark !== undefined && chat.updatedAt < mark.at - SETTLED_MS) continue
      if (scanned >= SCAN_BUDGET) return false
      const conversation = await harness.conversation(Number(chatId) as ConversationId, context)
      if (conversation === undefined) continue
      // A side chat carries the messages of the chat it branched off, which are that chat's.
      let through = Math.max(mark?.through ?? 0, chat.fork?.at ?? 0)
      let cursor: Parameters<typeof conversation.entries>[2]
      let more = true
      while (more) {
        const page = await conversation.entries(
          { minEntryId: (through + 1) as EntryId, order: "ascending" },
          PAGE_SIZE,
          cursor,
          context,
        )
        scanned += page.items.length
        cursor = page.next
        more = cursor !== undefined && scanned < SCAN_BUDGET
        const rows = page.items.flatMap((entry) => {
          const said = entryText(entry)
          if (said === undefined || said.text.trim() === "") return []
          const text = said.text.slice(0, MAX_STORED_CHARS)
          return [[chatId, Number(entry.id), said.role, said.at ?? null, text, text.toLowerCase()]]
        })
        const last = page.items.at(-1)
        if (last !== undefined) through = Number(last.id)
        // Nothing of the transcript is read inside the transaction: it is the same database.
        await this.#sql.transaction(async (tx) => {
          for (const row of rows) {
            await tx.run(
              "INSERT OR IGNORE INTO dc_history (chat_id, entry_id, role, at, text, folded) VALUES (?, ?, ?, ?, ?, ?)",
              ...(row as (string | number | null)[]),
            )
          }
          await tx.run(
            "INSERT INTO dc_history_read (chat_id, through, at) VALUES (?, ?, ?) ON CONFLICT (chat_id) DO UPDATE SET through = excluded.through, at = excluded.at",
            chatId,
            through,
            // Stopped short, it is read again from here whatever its age.
            cursor === undefined ? this.#now() : 0,
          )
        })
      }
      if (cursor !== undefined) return false
    }
    return true
  }

  /**
   * Messages containing every term, or failing that the ones with the most of the telling
   * terms. `among` is the chats that may be searched; `last` are the ones whose matches come
   * after everyone else's.
   */
  async search(
    harness: Harness,
    chats: readonly (readonly [string, ChatRecord])[],
    terms: readonly string[],
    limit: number,
    last: (chat: ChatRecord) => boolean,
    skip: readonly string[],
    context: Context,
  ): Promise<SearchResult> {
    await this.#prepare()
    const filled = await this.#fill(harness, chats, context)
    const known = new Map(chats)
    const has = "instr(folded, ?) > 0"
    const columns = "chat_id, entry_id, role, at, text"
    // Chats that are not to be searched are left out by the database where they are few, so
    // that they do not use up what is fetched, and afterwards in any case.
    const left = skip.length <= MAX_SKIPPED ? skip : []
    const others =
      left.length === 0 ? "" : ` AND chat_id NOT IN (${left.map(() => "?").join(", ")})`
    const mine = <R extends Row>(rows: readonly R[]) => rows.filter((row) => known.has(row.chat_id))

    const fetch = Math.max(limit * 4, 200)
    let rows = mine(
      await this.#sql.all<Row>(
        `SELECT ${columns} FROM dc_history WHERE ${terms.map(() => has).join(" AND ")}${others} ORDER BY at DESC, entry_id DESC LIMIT ${fetch}`,
        ...terms,
        ...left,
      ),
    )
    let found = (_row: Row): readonly string[] => terms
    let partial = false
    if (rows.length === 0) {
      // Words worth matching on their own when no message has them all.
      const telling = terms.filter((term) => !FILLER.has(term) && term.length > 1)
      if (telling.length > 0) {
        const count = telling.map(() => `(${has})`).join(" + ")
        const counted = mine(
          await this.#sql.all<Row & { matched: number }>(
            `SELECT ${columns}, ${count} AS matched FROM dc_history WHERE (${telling.map(() => has).join(" OR ")})${others} ORDER BY matched DESC, at DESC, entry_id DESC LIMIT ${fetch}`,
            ...telling,
            ...telling,
            ...left,
          ),
        )
        // The closest ones: those with as many of the telling words as the best has, or one fewer.
        const best = Math.max(0, ...counted.map((row) => row.matched))
        rows = counted.filter((row) => row.matched >= Math.max(1, best - 1))
        found = (row) => telling.filter((term) => row.text.toLowerCase().includes(term))
        partial = rows.length > 0
      }
    }
    // Stable, so each group keeps the order it was fetched in.
    const ordered = [...rows].sort(
      (a, b) => Number(last(known.get(a.chat_id)!)) - Number(last(known.get(b.chat_id)!)),
    )
    return {
      hits: ordered.slice(0, limit).map((row) => {
        const chat = known.get(row.chat_id)!
        return {
          chatId: row.chat_id,
          chatTitle: chat.title,
          chatKind: chat.kind,
          messageId: String(row.entry_id),
          role: row.role === "user" ? "user" : "assistant",
          at: row.at,
          snippet: snippet(row.text, found(row)),
        }
      }),
      complete: filled && ordered.length <= limit,
      partial,
      caughtUp: filled,
    }
  }
}

/**
 * Search everything said in the agent's chats, scheduled runs included, for messages containing
 * every term. When none has them all, the messages with the most of them are returned instead: a
 * question is seldom phrased in the words of the answer.
 *
 * `forAgent` is how the agent itself searches: its sub-agents' chats are left out, since what
 * they found was reported to the chat that started them, and what scheduled runs said comes
 * after everything else, since a task that runs every day would otherwise fill the results with
 * its own repeated words.
 */
export async function searchHistory(
  harness: Harness,
  index: HistoryIndex,
  query: string,
  options: { limit?: number; skipChatId?: string; forAgent?: boolean },
  context: Context,
): Promise<SearchResult> {
  const terms = searchTerms(query)
  if (terms.length === 0) throw new HistoryError("Give at least one word to search for.")
  const limit = Math.max(1, Math.min(options.limit ?? 20, 50))
  const all = Object.entries((await harness.snapshot(ChatsDoc, context))?.chats ?? {})
  const searched = ([id, chat]: readonly [string, ChatRecord]) =>
    id !== options.skipChatId && !(options.forAgent === true && chat.kind === "subagent")
  const chats = all
    .filter(searched)
    // Most recently active first, so the reading budget is spent where a match is likeliest to matter.
    .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
  return index.search(
    harness,
    chats,
    terms,
    limit,
    (chat) => options.forAgent === true && chat.kind === "schedule",
    all.filter((entry) => !searched(entry)).map(([id]) => id),
    context,
  )
}

/**
 * Messages of a chat from before `before` (a message id), oldest first. This is how a client
 * reaches what a compaction or a reset moved out of the active transcript.
 */
export async function readHistory(
  harness: Harness,
  chatId: string,
  options: { before?: string; limit?: number },
  context: Context,
): Promise<ChatHistoryPage> {
  const conversation = await harness.conversation(Number(chatId) as ConversationId, context)
  if (conversation === undefined) throw new HistoryError("There is no such chat.")
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_HISTORY_PAGE, MAX_HISTORY_PAGE))
  // A side chat's own messages begin after the ones it carries from the chat it branched off.
  const fork = own((await harness.snapshot(ChatsDoc, context))?.chats, chatId)?.fork
  const bounds = fork === undefined ? {} : { minEntryId: (fork.at + 1) as EntryId }
  let maxEntryId: EntryId | undefined
  if (options.before !== undefined) {
    const before = Number(options.before)
    if (!Number.isInteger(before) || before < 1)
      throw new HistoryError("`before` is not a message.")
    if (before === 1) return { messages: [], before: null }
    maxEntryId = (before - 1) as EntryId
  }

  // Newest first from storage.
  const entries: EntryRecord[] = []
  let cursor: Parameters<typeof conversation.entries>[2]
  let more = true
  while (more) {
    const page = await conversation.entries(
      maxEntryId === undefined ? bounds : { ...bounds, maxEntryId },
      limit,
      cursor,
      context,
    )
    entries.push(...page.items)
    cursor = page.next
    more = cursor !== undefined
    // A page must not start with tool results whose call is on the page before: the call would
    // then look interrupted, and the results would be lost. Keep reading until it starts clean.
    if (entries.at(-1)?.kind !== "pi.tool-result") break
  }
  entries.reverse()
  return {
    messages: projectPast(entries),
    before: more && entries.length > 0 ? String(entries[0]!.id) : null,
  }
}

const when = (at: number | null) => (at === null ? "" : new Date(at).toISOString().slice(0, 10))

/** How many chats `list` shows. */
const MAX_LISTED = 20

/** The date of a moment where the agent's person is. */
function day(at: number, timezone: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone ?? "UTC" }).format(new Date(at))
  } catch {
    return when(at)
  }
}

/** The agent's own way into its past: a tool to search every chat and to read around a match. */
export function historyExtension(harness: () => Harness, index: HistoryIndex): Extension {
  const fail = (text: string) => ({ isError: true, output: [{ type: "text" as const, text }] })
  const tool = defineTool({
    name: "history",
    // It only reads, and what it keeps for searching is the same however often it is kept: a
    // call that a restart cut off is made again.
    replay: "safe",
    description:
      "Look through what was said in your other chats, including Slack threads and scheduled runs. `search` finds messages containing all the given words, in any chat however old. `list` shows your most recent chats and where each stands. `read` shows the messages of one chat: around a match, or its latest when no message is given. Use it for anything about earlier work, decisions, dates, people or things still to do that is not in this chat or in your memory.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("search"), Type.Literal("list"), Type.Literal("read")]),
      query: Type.Optional(
        Type.String({ description: 'For search: words to find. Quote a "whole phrase".' }),
      ),
      chat: Type.Optional(
        Type.String({ description: "For read: the chat id from a search result" }),
      ),
      message: Type.Optional(
        Type.String({ description: "For read: the message id to read around; omit for the end" }),
      ),
    }),
    execute: async (args, api, context) => {
      try {
        if (args.action === "search") {
          const { hits, complete, partial, caughtUp } = await searchHistory(
            harness(),
            index,
            args.query ?? "",
            // What is said in this chat is already in front of the agent.
            { skipChatId: String(api.conversationId), forAgent: true },
            context,
          )
          // Its older chats are read in over a few searches, most recent first.
          const reading =
            "(Not all of your older chats have been read in yet. Search again to look further back.)"
          if (hits.length === 0) {
            const none = "Nothing in your other chats matches that."
            return {
              output: [{ type: "text", text: caughtUp ? none : `${none} ${reading}` }],
            }
          }
          const lines = hits.map(
            (hit) =>
              `chat ${hit.chatId} "${hit.chatTitle}", message ${hit.messageId}, ${when(hit.at)} ${
                hit.role === "user" ? "user" : "you"
              }: ${hit.snippet}`,
          )
          if (partial) {
            lines.unshift("No message has all of those words. These have the most of them:")
          }
          if (!caughtUp) lines.push(reading)
          else if (!complete) {
            lines.push("(There may be more; narrow the search to see other matches.)")
          }
          return { output: [{ type: "text", text: lines.join("\n") }], details: { hits } }
        }
        if (args.action === "list") {
          const here = String(api.conversationId)
          const [state, journal, identity] = await Promise.all([
            harness().snapshot(ChatsDoc, context),
            harness().snapshot(JournalDoc, context),
            harness().snapshot(IdentityDoc, context),
          ])
          const recent = Object.entries(state?.chats ?? {})
            .filter(([id, chat]) => id !== here && chat.kind !== "subagent" && !chat.archived)
            .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
            .slice(0, MAX_LISTED)
          if (recent.length === 0) {
            return { output: [{ type: "text", text: "You have no other chats." }] }
          }
          const lines = recent.map(([id, chat]) => {
            const note = own(journal?.notes, id)?.text
            return `${chatLabel(id, chat, state?.main)}, last active ${day(chat.updatedAt, identity?.timezone)}${note ? `: ${note}` : ""}`
          })
          return { output: [{ type: "text", text: lines.join("\n") }] }
        }
        if (args.chat === undefined) return fail("`read` needs the chat id.")
        // A few messages after the match too, so its answer is in view.
        const around = args.message === undefined ? undefined : Number(args.message)
        const page = await readHistory(
          harness(),
          args.chat,
          { before: around === undefined ? undefined : String(around + 8), limit: 24 },
          context,
        )
        const text = page.messages
          .map((message) => {
            const said = message.parts
              .map((part) =>
                part.type === "text"
                  ? part.text
                  : part.type === "tool"
                    ? `[used ${part.name}]`
                    : part.type === "notice"
                      ? part.call === undefined
                        ? `[${part.text}]`
                        : // A voice call that was held in the chat: what came of it, and what was said.
                          [
                            `[A voice call, ${part.text}${part.call.chatId === undefined ? "" : `, whose work was done in chat ${part.call.chatId}`}]`,
                            ...part.call.summary,
                            ...part.call.lines.map(
                              (line) =>
                                `${line.who === "you" ? "they" : "your voice"}: ${line.text}`,
                            ),
                          ].join("\n")
                      : "",
              )
              .filter(Boolean)
              .join("\n")
            const clipped = said.length > 1500 ? `${said.slice(0, 1500)}…` : said
            return `${message.role === "user" ? "user" : "you"} (message ${message.id}): ${clipped}`
          })
          .join("\n\n")
        return { output: [{ type: "text", text: text || "That chat has nothing there." }] }
      } catch (error) {
        if (error instanceof HistoryError) return fail(error.message)
        throw error
      }
    },
  })
  return defineExtension({
    name: "dc.history",
    tools: [tool],
    sections: [
      section(
        "history",
        () =>
          "Your chats are separate, and what was said in another one is not in front of you: you see only the short account of them above, where there is one. Before you answer anything about earlier work, decisions, dates, people or things still to do that you do not see here or in your memory, look for it with the `history` tool: `search` for its words, `list` your recent chats, `read` what was said in one. If you looked and did not find it, say that you looked.",
      ),
    ],
  })
}
