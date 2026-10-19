import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import type { ActorDatabase } from "@do-computer/runtime"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { fileBlobs, NodeActorNamespace } from "@do-computer/runtime/node"
import type { Message } from "@earendil-works/pi-ai"
import { createModels } from "@earendil-works/pi-ai/models"
import {
  type ConversationId,
  createRegistry,
  type EntryRecord,
  Harness,
  type JsonObject,
} from "@earendil-works/pi-durable"
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite"
import { type ChatRecord, ChatsDoc } from "../src/docs.ts"

/**
 * Open an agent's own store, as the agent keeps it in `directory`, and work on it directly: to
 * set it up as an agent from before a change left it, or to read what is in it afterwards. The
 * agent itself must not be open meanwhile. Nothing of the agent's runs here: no extension, no
 * model, no hook, only the documents and conversations as they are stored.
 */
export async function inStore<T>(
  directory: string,
  agentId: string,
  work: (harness: Harness) => Promise<T>,
): Promise<T> {
  let result: { value: T } | { error: unknown } | undefined
  const namespace = new NodeActorNamespace({
    directory: join(directory, "actors"),
    blobs: (name) => fileBlobs(join(directory, "blobs", encodeURIComponent(name))),
    factory: (host) => ({
      alarm: async () => {},
      fetch: async () => {
        const sql = host.sql
        const kept: ActorDatabase = {
          exec: (text) => sql.exec(text),
          run: (text, ...params) => sql.run(text, ...params),
          get: (text, ...params) => sql.get(text, ...params),
          all: (text, ...params) => sql.all(text, ...params),
          transaction: (callback) => sql.transaction(callback),
          close: async () => {},
        }
        const harness = await Harness.open(
          await SqliteStorage.open(kept),
          { models: createModels(), registry: createRegistry(), now: () => Date.now() },
          BACKGROUND_CONTEXT,
        )
        try {
          result = { value: await work(harness) }
        } catch (error) {
          result = { error }
        } finally {
          await harness.close(BACKGROUND_CONTEXT)
        }
        return new Response("ok")
      },
    }),
  })
  namespace.start()
  try {
    await namespace.get(agentId).fetch(new Request("http://store/"))
  } finally {
    await namespace.close()
  }
  if (result === undefined) throw new Error("The store was not opened")
  if ("error" in result) throw result.error
  return result.value
}

/** Every entry of a conversation, oldest first. */
export async function entriesOf(harness: Harness, chatId: string): Promise<EntryRecord[]> {
  const conversation = await harness.conversation(
    Number(chatId) as ConversationId,
    BACKGROUND_CONTEXT,
  )
  if (conversation === undefined) throw new Error(`There is no chat ${chatId}`)
  const entries: EntryRecord[] = []
  let cursor: Parameters<typeof conversation.entries>[2]
  do {
    const page = await conversation.entries({}, 200, cursor, BACKGROUND_CONTEXT)
    entries.push(...page.items)
    cursor = page.next
  } while (cursor !== undefined)
  // Newest first from storage.
  return entries.reverse()
}

/** A chat's record as it was kept, with what is not given left as a new chat has it. */
export const chatRecord = (
  kind: ChatRecord["kind"],
  title: string,
  more: Partial<ChatRecord> = {},
): ChatRecord => ({
  title,
  kind,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  archived: false,
  ...more,
})

/** A seeded entry: its kind, with data, or with something said, or with messages of its own. */
export type SeedEntry = { kind: string; data?: JsonObject; said?: string; model?: Message[] }

/**
 * Make a chat as it was kept, with entries written into it in that order, and nothing run. Made
 * the agent's main chat where `main` is set. Resolves with its id.
 */
export async function seedChat(
  harness: Harness,
  record: ChatRecord,
  entries: readonly SeedEntry[] = [],
  main = false,
): Promise<string> {
  const conversation = await harness.createConversation(
    {
      ownership: { kind: "ownerless" },
      agent: { model: { provider: "test", modelId: "model" }, thinkingLevel: "medium" },
      init: async (tx, id) => {
        const doc = await tx.doc(ChatsDoc)
        doc.chats[String(id)] = record
        if (main) doc.main = String(id)
      },
    },
    BACKGROUND_CONTEXT,
  )
  for (const [index, entry] of entries.entries()) {
    const model =
      entry.model ??
      (entry.said === undefined
        ? undefined
        : [{ role: "user" as const, content: entry.said, timestamp: Date.now() }])
    const written = await conversation.submit(
      {
        type: "write",
        requestId: `seed:${index}`,
        entry: {
          kind: entry.kind,
          ...(entry.data === undefined ? {} : { data: entry.data }),
          ...(model === undefined ? {} : { model }),
        },
      },
      BACKGROUND_CONTEXT,
    )
    await written.wait(BACKGROUND_CONTEXT)
  }
  return String(conversation.id)
}

/** Have an agent woken as soon as it is next started, as an alarm it had set would. */
export function wakeSoon(directory: string, agentId: string): void {
  const index = new DatabaseSync(join(directory, "actors", "_alarms.sqlite"))
  index.prepare("INSERT OR REPLACE INTO alarms (name, at) VALUES (?, ?)").run(agentId, Date.now())
  index.close()
}
