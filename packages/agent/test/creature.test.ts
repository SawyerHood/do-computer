import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type AgentEvent,
  type AgentSummary,
  BOX_EVERY_MS,
  type CreatureState,
  readSse,
  TREATS_PER_BOX,
  WEAR_ITEMS,
  wearItem,
} from "@durable-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@durable-computer/runtime/node"
import { createModels } from "@earendil-works/pi-ai/models"
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux"
import { afterEach, describe, expect, it } from "vitest"
import { createAgentActor } from "../src/index.ts"

type World = {
  namespace: NodeActorNamespace
  faux: ReturnType<typeof fauxProvider>
  reports: unknown[]
  /** What chance says next. Each box asks twice: for a rarity, then for a thing of it. */
  chance: number[]
  /** How far ahead of the real time the agent takes it to be. */
  ahead: number
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
    now: () => Date.now() + world.ahead,
    onError: (error) => reports.push(error),
  })
  namespace.start()
  const world: World = { namespace, faux, reports, chance, ahead: 0 }
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

const creature = (world: World) => call<CreatureState>(world, "/creature")

describe("an agent's creature", () => {
  it("starts with nothing but a box waiting, and has nothing on", async () => {
    const world = open()
    await call(world, "/init", "POST", { ownerId: "user-1" })
    expect(await creature(world)).toEqual({
      fed: 0,
      joy: 0,
      boxes: 1,
      shared: 0,
      owned: [],
      outfit: {},
    })
    const { agent } = await call<{ agent: AgentSummary }>(world, "/")
    expect(agent.outfit).toEqual({})
  })

  it("has one box of its own waiting at most, and the next twelve hours after that is opened", async () => {
    const world = open()
    await call(world, "/init", "POST", { ownerId: "user-1" })
    const open1 = () => call<{ creature: CreatureState }>(world, "/creature/open", "POST")
    // Left alone for days with its first box, it still has the one, and no other on the way.
    world.ahead += 6 * BOX_EVERY_MS
    const left = await creature(world)
    expect(left).toMatchObject({ boxes: 1, shared: 0 })
    expect(left.nextBoxAt).toBeUndefined()

    // Opened, the next is twelve hours from then, however long the box had waited.
    const opened = (await open1()).creature
    const now = Date.now() + world.ahead
    expect(opened.boxes).toBe(0)
    expect(opened.nextBoxAt).toBeGreaterThan(now + BOX_EVERY_MS - 30_000)
    expect(opened.nextBoxAt).toBeLessThanOrEqual(now + BOX_EVERY_MS)
    world.ahead += BOX_EVERY_MS - 60_000
    expect(await creature(world)).toEqual(opened)
    world.ahead += 60_000
    const arrived = await creature(world)
    expect(arrived.boxes).toBe(1)
    expect(arrived.nextBoxAt).toBeUndefined()

    // No second one comes while that one waits. One that came due is there to be opened unseen.
    world.ahead += 6 * BOX_EVERY_MS
    expect((await creature(world)).boxes).toBe(1)
    await open1()
    world.ahead += BOX_EVERY_MS
    expect((await open1()).creature).toMatchObject({ boxes: 0, owned: { length: 3 } })
    expect(world.reports).toEqual([])
  })

  it("keeps the boxes other people's treats made besides its own", async () => {
    const world = open()
    await call(world, "/init", "POST", { ownerId: "user-1" })
    const open1 = () => call<{ creature: CreatureState }>(world, "/creature/open", "POST")
    // Three boxes from the treats it was given on its own page, with the one it started with.
    expect(
      await call<CreatureState>(world, "/gifts", "POST", { treats: 3 * TREATS_PER_BOX }),
    ).toMatchObject({ boxes: 4, shared: 3 })
    // Its own is opened first, and the next of its own comes in its time though those wait.
    const opened = (await open1()).creature
    expect(opened).toMatchObject({ boxes: 3, shared: 3, nextBoxAt: expect.any(Number) })
    world.ahead += BOX_EVERY_MS
    expect(await creature(world)).toMatchObject({ boxes: 4, shared: 3 })
    world.ahead += 3 * BOX_EVERY_MS
    expect(await creature(world)).toMatchObject({ boxes: 4, shared: 3 })
    // With its own opened again, the rest are the ones it was given, and no wait starts over them.
    const again = (await open1()).creature
    expect(again).toMatchObject({ boxes: 3, shared: 3 })
    const given = (await open1()).creature
    expect(given).toMatchObject({ boxes: 2, shared: 2, nextBoxAt: again.nextBoxAt })
  })

  it("has no more boxes turn up once it has everything", async () => {
    const world = open()
    await call(world, "/init", "POST", { ownerId: "user-1" })
    await call(world, "/creature/open", "POST")
    for (const item of WEAR_ITEMS) await call(world, "/gifts", "POST", { item: item.id })
    world.ahead += 3 * BOX_EVERY_MS
    expect((await creature(world)).boxes).toBe(0)
  })

  it("is given a treat as often as anyone likes, and none of them is a box", async () => {
    const world = open()
    await call(world, "/init", "POST", { ownerId: "user-1" })
    for (let given = 1; given <= TREATS_PER_BOX + 1; given++) {
      expect(await call<CreatureState>(world, "/creature/feed", "POST")).toMatchObject({
        fed: given,
        joy: 0,
        boxes: 1,
      })
    }
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
    // Treats from other people, on its own page, are a box for it every few.
    const fed = await call<CreatureState>(world, "/gifts", "POST", { treats: 5 })
    expect(fed).toMatchObject({ fed: 5, joy: 1, boxes: 2, shared: 1 })
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
