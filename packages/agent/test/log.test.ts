import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type ChatEvent,
  chatRuns,
  type ChatState,
  type ChatSummary,
  EMPTY_CHAT,
  readSse,
  reduceChat,
} from "@do-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@do-computer/runtime/node"
import { justBashSandbox } from "@do-computer/sandbox"
import { createModels } from "@earendil-works/pi-ai/models"
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"
import { afterEach, describe, expect, it } from "vitest"
import { createAgentActor } from "../src/index.ts"
import { quietOnReminder } from "./quiet.ts"

type World = {
  namespace: NodeActorNamespace
  faux: ReturnType<typeof fauxProvider>
  reports: unknown[]
}
const worlds: World[] = []

function open(): World {
  const directory = mkdtempSync(join(tmpdir(), "dc-log-"))
  const faux = quietOnReminder(
    fauxProvider({ provider: "test", models: [{ id: "model" }], tokensPerSecond: 5_000 }),
  )
  const models = createModels()
  models.setProvider(faux.provider)
  const world: World = { namespace: undefined as never, faux, reports: [] }
  world.namespace = new NodeActorNamespace({
    directory: join(directory, "actors"),
    blobs: (name) => fileBlobs(join(directory, "blobs", encodeURIComponent(name))),
    factory: (host) =>
      createAgentActor(host, {
        models,
        defaultModel: "test/model",
        modelOptions: [
          { id: "test/model", name: "Test", reasoning: false, inputCost: 0, outputCost: 0 },
        ],
        keepAliveMs: 100,
        sandbox: (host) => justBashSandbox({ id: host.name, database: host.sql }),
        onReport: (error) => world.reports.push(error),
      }),
    onError: (error) => world.reports.push(error),
  })
  world.namespace.start()
  worlds.push(world)
  return world
}

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.namespace.close().catch(() => {})
})

async function call<T>(world: World, path: string, method = "GET", payload?: unknown): Promise<T> {
  const response = await world.namespace.get("agent-1").fetch(
    new Request(`http://actor${path}`, {
      method,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      headers: payload === undefined ? undefined : { "content-type": "application/json" },
    }),
  )
  const result = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(`${response.status}: ${result.error}`)
  return result
}

/** Send a message and return the chat once the run has finished. */
async function converse(world: World, chatId: string, text: string): Promise<ChatState> {
  const response = await world.namespace
    .get("agent-1")
    .fetch(new Request(`http://actor/chats/${chatId}/events`))
  await call(world, `/chats/${chatId}/messages`, "POST", { text, requestId: crypto.randomUUID() })
  let state = EMPTY_CHAT
  let started = false
  for await (const event of readSse<ChatEvent>(response.body!)) {
    state = reduceChat(state, event)
    started ||= state.busy
    if (started && !state.busy) break
  }
  return state
}

const step = (name: string, args: Record<string, string>) =>
  fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" })

describe("the list of what the agent did", () => {
  it("has an entry where the agent wrote one, and none for work it did not write up", async () => {
    const world = open()
    await call(world, "/init", "POST", { ownerId: "user-1" })
    const chat = await call<ChatSummary>(world, "/chats/main", "POST", {})

    world.faux.setResponses([step("bash", { command: "date" }), fauxAssistantMessage("Noon.")])
    expect(chatRuns(await converse(world, chat.id, "what time is it?"))).toEqual([])

    world.faux.setResponses([
      step("bash", { command: "echo nightly > backup.cron" }),
      step("log", { title: "Set up the backup", outcome: "Backups now run nightly." }),
      fauxAssistantMessage("Backups are set up."),
    ])
    const state = await converse(world, chat.id, "set up a nightly backup")
    const asked = state.messages.findLast((message) => message.role === "user")!
    expect(chatRuns(state)).toMatchObject([
      {
        id: asked.id,
        entry: { title: "Set up the backup", outcome: "Backups now run nightly." },
        steps: [{ name: "bash", status: "done" }],
        status: "done",
      },
    ])

    // It is in the transcript, so it is there for whoever opens the chat later.
    const later = await call<ChatState>(world, `/chats/${chat.id}`)
    expect(chatRuns({ ...EMPTY_CHAT, ...later }).map((run) => run.entry.title)).toEqual([
      "Set up the backup",
    ])
    expect(world.reports).toEqual([])
  })

  it("turns away an entry with nothing in it", async () => {
    const world = open()
    await call(world, "/init", "POST", { ownerId: "user-1" })
    const chat = await call<ChatSummary>(world, "/chats/main", "POST", {})
    world.faux.setResponses([
      step("log", { title: " ", outcome: "Done." }),
      fauxAssistantMessage("Done."),
    ])
    const state = await converse(world, chat.id, "do the thing")
    expect(chatRuns(state)).toEqual([])
    const part = state.messages.flatMap((message) => message.parts).find((p) => p.type === "tool")
    expect(part).toMatchObject({ name: "log", status: "error" })
  })
})
