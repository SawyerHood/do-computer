import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type ChatEvent,
  type ChatState,
  type ChatSummary,
  EMPTY_CHAT,
  readSse,
  reduceChat,
} from "@do-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@do-computer/runtime/node"
import { createModels } from "@earendil-works/pi-ai/models"
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux"
import { afterEach, describe, expect, it } from "vitest"
import { createAgentActor } from "../src/index.ts"
import { quietOnReminder } from "./quiet.ts"

type World = { namespace: NodeActorNamespace; faux: ReturnType<typeof fauxProvider> }
const worlds: World[] = []

function open(directory: string): World {
  const faux = quietOnReminder(
    fauxProvider({
      provider: "test",
      models: [{ id: "seeing" }, { id: "blind" }],
      tokensPerSecond: 5_000,
    }),
  )
  const models = createModels()
  models.setProvider(faux.provider)
  const option = (id: string, images: boolean) => ({
    id: `test/${id}`,
    name: id,
    reasoning: false,
    inputCost: 0,
    outputCost: 0,
    images,
  })
  const namespace = new NodeActorNamespace({
    directory: join(directory, "actors"),
    blobs: (name) => fileBlobs(join(directory, "blobs", encodeURIComponent(name))),
    factory: (host) =>
      createAgentActor(host, {
        models,
        defaultModel: "test/seeing",
        modelOptions: [option("seeing", true), option("blind", false)],
        keepAliveMs: 100,
      }),
  })
  namespace.start()
  const world = { namespace, faux }
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

/** Send a message with pictures and return the chat once the run has finished. */
async function converse(
  world: World,
  chatId: string,
  text: string,
  images: unknown,
): Promise<ChatState> {
  const response = await world.namespace
    .get("agent-1")
    .fetch(new Request(`http://actor/chats/${chatId}/events`))
  await call(world, `/chats/${chatId}/messages`, "POST", {
    text,
    images,
    requestId: crypto.randomUUID(),
  })
  let state = EMPTY_CHAT
  let started = false
  for await (const event of readSse<ChatEvent>(response.body!)) {
    state = reduceChat(state, event)
    started ||= state.busy
    if (started && !state.busy) break
  }
  return state
}

/** What the model is sent next: the content blocks of the last user message. */
function listen(world: World): { blocks: () => { type: string }[] } {
  let blocks: { type: string }[] = []
  world.faux.setResponses([
    (context) => {
      const last = context.messages.findLast((message) => message.role === "user")!
      blocks = last.content as { type: string }[]
      return fauxAssistantMessage("I see.")
    },
  ])
  return { blocks: () => blocks }
}

const PIXEL = {
  mimeType: "image/png",
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
}
const temporary = () => mkdtempSync(join(tmpdir(), "dc-pictures-"))

describe("pictures sent with a message", () => {
  it("reach a model that can look at them, and are kept with the message", async () => {
    const world = open(temporary())
    await call(world, "/init", "POST", { ownerId: "user-1" })
    const chat = await call<ChatSummary>(world, "/chats/main", "POST", {})
    const heard = listen(world)
    const state = await converse(world, chat.id, "What is this?", [PIXEL])
    expect(heard.blocks().map((block) => block.type)).toEqual(["text", "image", "text"])
    expect(heard.blocks()[1]).toMatchObject({ type: "image", ...PIXEL })
    // The transcript shows it with what was said.
    const sent = state.messages.find((message) => message.role === "user")!
    expect(sent.parts.filter((part) => part.type === "image")).toEqual([
      { type: "image", ...PIXEL },
    ])
  })

  it("are left out for a model that cannot take them, and the words still go", async () => {
    const world = open(temporary())
    await call(world, "/init", "POST", { ownerId: "user-1", model: "test/blind" })
    const chat = await call<ChatSummary>(world, "/chats/main", "POST", {})
    const heard = listen(world)
    const state = await converse(world, chat.id, "What is this?", [PIXEL])
    expect(heard.blocks().map((block) => block.type)).toEqual(["text", "text"])
    expect(state.messages.at(-1)!.parts).toEqual([{ type: "text", text: "I see." }])
  })

  it("have to be a few small pictures of a kind a model reads", async () => {
    const world = open(temporary())
    await call(world, "/init", "POST", { ownerId: "user-1" })
    const chat = await call<ChatSummary>(world, "/chats/main", "POST", {})
    const send = (images: unknown) =>
      call(world, `/chats/${chat.id}/messages`, "POST", {
        text: "look",
        images,
        requestId: crypto.randomUUID(),
      })
    await expect(send(Array(5).fill(PIXEL))).rejects.toThrow("up to 4 pictures")
    await expect(send([{ mimeType: "image/svg+xml", data: "PHN2Zz4=" }])).rejects.toThrow(
      "must be a PNG, JPEG, WebP or GIF",
    )
    await expect(send([{ mimeType: "image/png", data: "not base64!" }])).rejects.toThrow(
      "must be a PNG, JPEG, WebP or GIF",
    )
    await expect(send("image")).rejects.toThrow("up to 4 pictures")
    await expect(send([{ mimeType: "image/png", data: "A".repeat(1_400_004) }])).rejects.toThrow(
      "413",
    )
  })
})
