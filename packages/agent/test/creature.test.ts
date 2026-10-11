import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type AgentEvent,
  type AgentSummary,
  type CreatureState,
  readSse,
  TREATS_PER_BOX,
  WEAR_ITEMS,
  wearItem,
} from "@durable-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@durable-computer/runtime/node"
import { createModels } from "@earendil-works/pi-ai/models"
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux"
import { afterEach, describe, expect, it } from "vitest"
import { createAgentActor } from "../src/index.ts"

type World = {
  namespace: NodeActorNamespace
  faux: ReturnType<typeof fauxProvider>
  reports: unknown[]
  /** What chance says next. Each box asks twice: for a rarity, then for a thing of it. */
  chance: number[]
}

const worlds: World[] = []

function open(): World {
  const directory = mkdtempSync(join(tmpdir(), "dc-creature-"))
  const faux = fauxProvider({ provider: "test", models: [{ id: "model" }], tokensPerSecond: 2_000 })
  const models = createModels()
  models.setProvider(faux.provider)
  const reports: unknown[] = []
  const chance: number[] = []
  const namespace = new NodeActorNamespace({
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
        random: () => chance.shift() ?? 0,
        onReport: (error) => reports.push(error),
      }),
    onError: (error) => reports.push(error),
  })
  namespace.start()
  const world = { namespace, faux, reports, chance }
  worlds.push(world)
  return world
}

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.namespace.close().catch(() => {})
})

async function send(world: World, path: string, method = "GET", payload?: unknown) {
  return world.namespace.get("agent-1").fetch(
    new Request(`http://actor${path}`, {
      method,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      headers: payload === undefined ? undefined : { "content-type": "application/json" },
    }),
  )
}

async function call<T>(world: World, path: string, method = "GET", payload?: unknown): Promise<T> {
  const response = await send(world, path, method, payload)
  const result = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(`${response.status}: ${result.error}`)
  return result
}

async function until<T>(read: () => Promise<T>, good: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 10_000
  for (;;) {
    const value = await read()
    if (good(value)) return value
    if (Date.now() > deadline) throw new Error(`Still ${JSON.stringify(value)} after 10 s`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

const creature = (world: World) => call<CreatureState>(world, "/creature")

/** An agent with one chat, and its creature once it has been answered in it `answers` times. */
async function answered(world: World, answers: number): Promise<CreatureState> {
  await call(world, "/init", "POST", { ownerId: "user-1" })
  const { id } = await call<{ id: string }>(world, "/chats", "POST", {})
  for (let turn = 1; turn <= answers; turn++) {
    world.faux.setResponses([fauxAssistantMessage([fauxText(`Answer ${turn}.`)])])
    await call(world, `/chats/${id}/messages`, "POST", {
      requestId: `question-${turn}`,
      text: `Question ${turn}`,
    })
    await until(
      () => creature(world),
      (state) => state.treats === turn,
    )
  }
  return creature(world)
}

describe("an agent's creature", () => {
  it("starts with nothing but a box waiting, and has nothing on", async () => {
    const world = open()
    await call(world, "/init", "POST", { ownerId: "user-1" })
    expect(await creature(world)).toEqual({
      treats: 0,
      fed: 0,
      joy: 0,
      boxes: 1,
      owned: [],
      outfit: {},
    })
    const { agent } = await call<{ agent: AgentSummary }>(world, "/")
    expect(agent.outfit).toEqual({})
  })

  it("earns a treat each time the agent answers someone", async () => {
    const world = open()
    expect((await answered(world, 2)).treats).toBe(2)
    expect(world.reports).toEqual([])
  })

  it("is given its treats one at a time, and finds a box when it has had enough", async () => {
    const world = open()
    await answered(world, TREATS_PER_BOX)
    for (let given = 1; given < TREATS_PER_BOX; given++) {
      const state = await call<CreatureState>(world, "/creature/feed", "POST")
      expect(state).toMatchObject({ treats: TREATS_PER_BOX - given, fed: given, joy: given })
      expect(state.boxes).toBe(1)
    }
    expect(await call<CreatureState>(world, "/creature/feed", "POST")).toMatchObject({
      treats: 0,
      fed: TREATS_PER_BOX,
      joy: 0,
      boxes: 2,
    })
    // There is nothing left to give it.
    const refused = await send(world, "/creature/feed", "POST")
    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({ code: "no_treats" })
  })

  it("finds in a box something it does not have, of the rarity chance decided", async () => {
    const world = open()
    await call(world, "/init", "POST", { ownerId: "user-1" })
    // The top of chance is the rarest there is.
    world.chance.push(0.999, 0)
    const opened = await call<{ item: string; creature: CreatureState }>(
      world,
      "/creature/open",
      "POST",
    )
    expect(wearItem(opened.item)?.rarity).toBe("legendary")
    expect(opened.creature).toMatchObject({ boxes: 0, owned: [opened.item] })
    const refused = await send(world, "/creature/open", "POST")
    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({ code: "no_box" })
  })

  it("eats what it is given on its own page, and wears what it came with", async () => {
    const world = open()
    await call(world, "/init", "POST", { ownerId: "user-1" })
    // Treats from outside the app are eaten there and then: none is left on its pile.
    const fed = await call<CreatureState>(world, "/gifts", "POST", { treats: 5 })
    expect(fed).toMatchObject({ treats: 0, fed: 5, joy: 1, boxes: 2 })
    // What it kept out of its first present is its own, and on.
    const dressed = await call<CreatureState>(world, "/gifts", "POST", { item: "tophat" })
    expect(dressed).toMatchObject({ owned: ["tophat"], outfit: { hat: "tophat" }, fed: 5 })
    // Given again, it has it once. What is not a thing, and what is not a number, is nothing.
    const again = await call<CreatureState>(world, "/gifts", "POST", {
      item: "tophat",
      treats: "many",
    })
    expect(again).toEqual(dressed)
    expect(await call<CreatureState>(world, "/gifts", "POST", { item: "no-such" })).toEqual(dressed)
    expect(await call<CreatureState>(world, "/gifts", "POST", { treats: -3 })).toEqual(dressed)
  })

  it("wears what it has, where it is worn, and nothing else", async () => {
    const world = open()
    await call(world, "/init", "POST", { ownerId: "user-1" })
    const { item } = await call<{ item: string }>(world, "/creature/open", "POST")
    const found = wearItem(item)!
    const worn = await call<CreatureState>(world, "/creature/outfit", "PUT", {
      outfit: { [found.slot]: item },
    })
    expect(worn.outfit).toEqual({ [found.slot]: item })
    // The agent's own summary says what it has on, for wherever its creature is drawn.
    const { agent } = await call<{ agent: AgentSummary }>(world, "/")
    expect(agent.outfit).toEqual({ [found.slot]: item })

    const other = WEAR_ITEMS.find((entry) => entry.id !== item)!
    const refused = await send(world, "/creature/outfit", "PUT", {
      outfit: { [other.slot]: other.id },
    })
    expect(refused.status).toBe(400)
    expect(await refused.json()).toMatchObject({ error: `${other.name} has not been found yet` })
    expect((await creature(world)).outfit).toEqual({ [found.slot]: item })

    expect(
      (await call<CreatureState>(world, "/creature/outfit", "PUT", { outfit: {} })).outfit,
    ).toEqual({})
  })

  it("tells whoever is watching the agent when anything about its creature changes", async () => {
    const world = open()
    await call(world, "/init", "POST", { ownerId: "user-1" })
    const stream = await send(world, "/events")
    const events = readSse<AgentEvent>(stream.body!)[Symbol.asyncIterator]()
    const next = async () => (await events.next()).value as AgentEvent
    expect(await next()).toEqual({ type: "ready" })
    await call(world, "/creature/open", "POST")
    expect(await next()).toEqual({ type: "changed", what: "creature" })
    await events.return?.(undefined)
  })
})
