import type { ChatHistoryPage, HistoryHit } from "@durable-computer/protocol"
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
import { ChatsDoc } from "./docs.ts"
import { entryText, projectPast } from "./project.ts"

const PAGE_SIZE = 200
/** Entries one search will read. Past it, the search says it did not look at everything. */
const SCAN_BUDGET = 10_000
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
  /** False when the search stopped before reading every chat. */
  complete: boolean
  /** True when no message had every word, and these are the ones with the most of them. */
  partial: boolean
}

/**
 * Search everything said in the agent's chats, scheduled runs included, for messages containing
 * every term. When none has them all, the messages with the most of them are returned instead: a
 * question is seldom phrased in the words of the answer. Reads the transcripts as stored; there is
 * no index to fall out of date.
 */
export async function searchHistory(
  harness: Harness,
  query: string,
  options: { limit?: number; skipChatId?: string },
  context: Context,
): Promise<SearchResult> {
  const terms = searchTerms(query)
  if (terms.length === 0) throw new HistoryError("Give at least one word to search for.")
  const limit = Math.max(1, Math.min(options.limit ?? 20, 50))
  const chats = Object.entries((await harness.snapshot(ChatsDoc, context))?.chats ?? {})
    .filter(([id]) => id !== options.skipChatId)
    // Most recently active first, so the scan budget is spent where a match is likeliest to matter.
    .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)

  // Words worth matching on their own when no message has them all.
  const telling = terms.filter((term) => !FILLER.has(term) && term.length > 1)
  const hits: (HistoryHit & { matched: number })[] = []
  let scanned = 0
  let complete = true
  search: for (const [chatId, chat] of chats) {
    const conversation = await harness.conversation(Number(chatId) as ConversationId, context)
    if (conversation === undefined) continue
    let cursor: Parameters<typeof conversation.entries>[2]
    do {
      if (scanned >= SCAN_BUDGET) {
        complete = false
        break search
      }
      const page = await conversation.entries({}, PAGE_SIZE, cursor, context)
      scanned += page.items.length
      for (const entry of page.items) {
        const said = entryText(entry)
        if (said === undefined) continue
        const lower = said.text.toLowerCase()
        const all = terms.every((term) => lower.includes(term))
        const found = all ? terms : telling.filter((term) => lower.includes(term))
        if (found.length === 0) continue
        hits.push({
          // Every word beats any number of some of them.
          matched: all ? Number.MAX_SAFE_INTEGER : found.length,
          chatId,
          chatTitle: chat.title,
          chatKind: chat.kind,
          messageId: String(entry.id),
          role: said.role,
          at: said.at ?? null,
          snippet: snippet(said.text, found),
        })
      }
      cursor = page.next
    } while (cursor !== undefined)
  }
  const best = Math.max(0, ...hits.map((hit) => hit.matched))
  const partial = hits.length > 0 && best !== Number.MAX_SAFE_INTEGER
  // With every word found somewhere, only those messages count. Otherwise the closest ones do:
  // those with as many of the telling words as the best has, or one fewer.
  const kept = hits
    .filter((hit) => hit.matched >= (partial ? Math.max(1, best - 1) : best))
    .sort((a, b) => b.matched - a.matched || (b.at ?? 0) - (a.at ?? 0))
  return {
    hits: kept.slice(0, limit).map(({ matched: _matched, ...hit }) => hit),
    complete: complete && kept.length <= limit,
    partial,
  }
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
      maxEntryId === undefined ? {} : { maxEntryId },
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

/** The agent's own way into its past: a tool to search every chat and to read around a match. */
export function historyExtension(harness: () => Harness): Extension {
  const fail = (text: string) => ({ isError: true, content: [{ type: "text" as const, text }] })
  const tool = defineTool({
    name: "history",
    description:
      "Look through your earlier conversations with the user, in any chat, including scheduled runs. `search` finds messages containing all the given words. `read` shows the messages of one chat around a match. Use it when the user refers to something that is not in this chat or in your memory.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("search"), Type.Literal("read")]),
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
          const { hits, complete, partial } = await searchHistory(
            harness(),
            args.query ?? "",
            // What is said in this chat is already in front of the agent.
            { skipChatId: String(api.conversationId) },
            context,
          )
          if (hits.length === 0) {
            return {
              content: [{ type: "text", text: "Nothing in your other chats matches that." }],
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
          if (!complete) lines.push("(There may be more; narrow the search to see other matches.)")
          return { content: [{ type: "text", text: lines.join("\n") }], details: { hits } }
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
                      ? `[${part.text}]`
                      : "",
              )
              .filter(Boolean)
              .join("\n")
            const clipped = said.length > 1500 ? `${said.slice(0, 1500)}…` : said
            return `${message.role === "user" ? "user" : "you"} (message ${message.id}): ${clipped}`
          })
          .join("\n\n")
        return { content: [{ type: "text", text: text || "That chat has nothing there." }] }
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
          "Your chats with the user are separate, and what was said in another chat is not in front of you. When the user refers to something you do not see here or in your memory, search for it with the `history` tool before saying you do not know.",
      ),
    ],
  })
}
