import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type AgentEvent,
  type AgentSummary,
  type CreatureOwn,
  readSse,
  TREATS_PER_BOX,
  WEAR_ITEMS,
} from "@do-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@do-computer/runtime/node"
import { createModels } from "@earendil-works/pi-ai/models"
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux"
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
  const directory = mkdtempSync(join(tmpdir(), "dc-creature-"))
  const faux = quietOnReminder(
    fauxProvider({ provider: "test", models: [{ id: "model" }], tokensPerSecond: 2_000 }),
  )
  const models = createModels()
  models.setProvider(faux.provider)
  const reports: unknown[] = []
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
        onReport: (error) => reports.push(error),
      }),
    onError: (error) => reports.push(error),
  })
  namespace.start()
  const world: World = { namespace, faux, reports }
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

type Creature = CreatureOwn & { before?: { owned: string[]; shared: number } }
type Gifted = Creature & { filled: number }

const creature = (world: World) => call<Creature>(world, "/creature")

describe("an agent's creature", () => {
  it("starts having been given nothing, with nothing on", async () => {
    const world = open()
    await call(world, "/init", "POST", { ownerId: "user-1" })
    // Its boxes and what is in them are its workspace's wardrobe, which the gateway keeps.
    expect(await creature(world)).toEqual({ fed: 0, joy: 0, outfit: {} })
    const { agent } = await call<{ agent: AgentSummary }>(world, "/")
    expect(agent.outfit).toEqual({})
  })

  it("is given a treat as often as anyone likes, and none of them fills a box", async () => {
    const world = open()
    await call(world, "/init", "POST", { ownerId: "user-1" })
    for (let given = 1; given <= TREATS_PER_BOX + 1; given++) {
      expect(await call<Creature>(world, "/creature/feed", "POST")).toEqual({
        fed: given,
        joy: 0,
        outfit: {},
      })
    }
  })

  it("eats what it is given on its own page, every few treats a box for its workspace", async () => {
    const world = open()
    await call(world, "/init", "POST", { ownerId: "user-1" })
    const fed = await call<Gifted>(world, "/gifts", "POST", { treats: 2 * TREATS_PER_BOX + 1 })
    expect(fed).toMatchObject({ fed: 2 * TREATS_PER_BOX + 1, joy: 1, filled: 2 })
    // Once the wardrobe has everything, treats fill nothing, and do not count toward a box.
    const full = await call<Gifted>(world, "/gifts", "POST", { treats: TREATS_PER_BOX, full: true })
    expect(full).toMatchObject({ fed: 3 * TREATS_PER_BOX + 1, joy: 1, filled: 0 })
    // What it came with is on. What is not a thing, and what is not a number, is nothing.
    const dressed = await call<Gifted>(world, "/gifts", "POST", { item: "tophat" })
    expect(dressed).toMatchObject({ outfit: { hat: "tophat" }, filled: 0 })
    expect(
      await call<Gifted>(world, "/gifts", "POST", { item: "no-such", treats: "many" }),
    ).toEqual(dressed)
    expect(await call<Gifted>(world, "/gifts", "POST", { treats: -3 })).toEqual(dressed)
  })

  it("wears things there are, where they are worn, which the gateway checked are in the wardrobe", async () => {
    const world = open()
    await call(world, "/init", "POST", { ownerId: "user-1" })
    const [hat, glasses] = [
      WEAR_ITEMS.find((item) => item.slot === "hat")!,
      WEAR_ITEMS.find((item) => item.slot === "glasses")!,
    ]
    const worn = await call<Creature>(world, "/creature/outfit", "PUT", {
      outfit: { hat: hat.id, glasses: glasses.id },
    })
    expect(worn.outfit).toEqual({ hat: hat.id, glasses: glasses.id })
    // The agent's own summary says what it has on, for wherever its creature is drawn.
    const { agent } = await call<{ agent: AgentSummary }>(world, "/")
    expect(agent.outfit).toEqual({ hat: hat.id, glasses: glasses.id })

    for (const [outfit, error] of [
      [{ hat: glasses.id }, `${glasses.name} is not worn there`],
      [{ hat: "no-such" }, 'There is no such thing as "no-such"'],
      [{ tail: hat.id }, 'Nothing is worn on "tail"'],
    ] as const) {
      const refused = await send(world, "/creature/outfit", "PUT", { outfit })
      expect(refused.status).toBe(400)
      expect(await refused.json()).toMatchObject({ error })
    }
    expect((await creature(world)).outfit).toEqual({ hat: hat.id, glasses: glasses.id })
    expect((await call<Creature>(world, "/creature/outfit", "PUT", { outfit: {} })).outfit).toEqual(
      {},
    )
  })

  it("tells whoever is watching the agent when anything about its creature changes", async () => {
    const world = open()
    await call(world, "/init", "POST", { ownerId: "user-1" })
    const stream = await send(world, "/events")
    const events = readSse<AgentEvent>(stream.body!)[Symbol.asyncIterator]()
    const next = async () => (await events.next()).value as AgentEvent
    expect(await next()).toEqual({ type: "ready" })
    await call(world, "/creature/feed", "POST")
    expect(await next()).toEqual({ type: "changed", what: "creature" })
    // Its workspace's wardrobe changing is told of too, though nothing of its own did.
    await call(world, "/creature/wardrobe", "POST")
    expect(await next()).toEqual({ type: "changed", what: "creature" })
    expect(await creature(world)).toEqual({ fed: 1, joy: 0, outfit: {} })
    await events.return?.(undefined)
  })
})
