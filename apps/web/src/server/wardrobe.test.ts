import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  BOX_EVERY_MS,
  type CreatureOwn,
  type CreatureState,
  personalWorkspaceId,
  WEAR_ITEMS,
} from "@do-computer/protocol"
import { openNodeAppDatabase } from "@do-computer/runtime/node"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readConfig } from "./platform.ts"
import { migrateAppDatabase } from "./schema.ts"

type Kept = CreatureOwn & { before?: { owned: string[]; shared: number } }

/** What stands in for the platform: a real database, and agents that keep their creature. */
const world = vi.hoisted(() => ({
  db: undefined as unknown,
  creatures: new Map<string, unknown>(),
  /** The agents told that their workspace's wardrobe changed. */
  told: [] as string[],
}))

vi.mock("#platform", () => ({
  getPlatform: () => ({
    target: "node",
    config: readConfig({ DC_SANDBOX: "just-bash" }),
    db: world.db,
    agents: {
      get: (agentId: string) => ({
        fetch: async (request: Request) => {
          const kept = (world.creatures.get(agentId) ?? { fed: 0, joy: 0, outfit: {} }) as Kept
          const path = new URL(request.url).pathname
          if (path === "/creature/feed") kept.fed++
          if (path === "/creature/wardrobe") world.told.push(agentId)
          if (path === "/creature/outfit") {
            kept.outfit = ((await request.json()) as { outfit: CreatureOwn["outfit"] }).outfit
          }
          world.creatures.set(agentId, kept)
          return Response.json(kept)
        },
      }),
    },
  }),
}))

const { creatureRoute, openWardrobeBox, addSharedBoxes, addToWardrobe } =
  await import("./wardrobe.ts")
type Db = import("@do-computer/runtime").AppDatabase
type Access = import("./teams.ts").AgentAccess

const db = () => world.db as Db
const MINE = personalWorkspaceId("sawyer")
const TEAM = "team-a"

let made = 0
async function dood(id: string, workspaceId: string, kept?: Kept): Promise<Access> {
  await db().run(
    "INSERT INTO dc_agents (id, owner_id, workspace_id, created_at) VALUES (?, ?, ?, ?)",
    id,
    "sawyer",
    workspaceId,
    ++made,
  )
  if (kept !== undefined) world.creatures.set(id, kept)
  return { id, ownerId: "sawyer", workspaceId, createdAt: made, role: "owner" }
}

async function ask<T>(
  access: Access,
  path: string,
  method = "GET",
  payload?: unknown,
): Promise<{ status: number; body: T }> {
  const route = ["creature", ...path.split("/").filter(Boolean)]
  const body =
    payload === undefined
      ? undefined
      : (new TextEncoder().encode(JSON.stringify(payload)).buffer as ArrayBuffer)
  const response = await creatureRoute(access, route, method, body)
  return { status: response.status, body: (await response.json()) as T }
}

const look = async (access: Access) => (await ask<CreatureState>(access, "")).body
const open = (access: Access) =>
  ask<{ item: string; creature: CreatureState }>(access, "open", "POST")

beforeEach(async () => {
  const directory = mkdtempSync(join(tmpdir(), "dc-wardrobe-"))
  world.db = openNodeAppDatabase(join(directory, "app.db")).app
  world.creatures.clear()
  world.told.length = 0
  await migrateAppDatabase(db())
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(1_000_000_000_000)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("a workspace's wardrobe", () => {
  it("starts with a box waiting, which any of its Doods can open, for all of them", async () => {
    const pip = await dood("pip", MINE)
    const moss = await dood("moss", MINE)
    expect(await look(pip)).toEqual({
      fed: 0,
      joy: 0,
      boxes: 1,
      shared: 0,
      owned: [],
      foundBy: {},
      outfit: {},
    })
    const opened = await open(moss)
    expect(opened.status).toBe(200)
    const { item } = opened.body
    expect(opened.body.creature).toMatchObject({
      boxes: 0,
      owned: [item],
      foundBy: { [item]: "moss" },
    })
    // Every Dood there was told, so that whoever watches one asks for its creature again.
    expect(world.told.sort()).toEqual(["moss", "pip"])
    // The box was the workspace's: there is no other beside Pip, and what was in it is Pip's to wear.
    expect((await open(pip)).status).toBe(409)
    const slot = WEAR_ITEMS.find((entry) => entry.id === item)!.slot
    const worn = await ask<CreatureState>(pip, "outfit", "PUT", { outfit: { [slot]: item } })
    expect(worn.body.outfit).toEqual({ [slot]: item })
    // Two at once.
    const both = await ask<CreatureState>(moss, "outfit", "PUT", { outfit: { [slot]: item } })
    expect(both.status).toBe(200)
  })

  it("is the workspace's own: a Dood elsewhere cannot wear what is in it", async () => {
    const pip = await dood("pip", MINE)
    const juniper = await dood("juniper", TEAM)
    const { item } = (await open(pip)).body
    const slot = WEAR_ITEMS.find((entry) => entry.id === item)!.slot
    const refused = await ask<{ error: string }>(juniper, "outfit", "PUT", {
      outfit: { [slot]: item },
    })
    expect(refused.status).toBe(400)
    expect(refused.body.error).toMatch(/has not been found yet/)
    // And has a box of its own workspace's.
    expect((await look(juniper)).boxes).toBe(1)
  })

  it("has the next box six hours after the last was opened, for the whole workspace", async () => {
    const pip = await dood("pip", MINE)
    const moss = await dood("moss", MINE)
    const opened = (await open(pip)).body.creature
    expect(opened.nextBoxAt).toBe(Date.now() + BOX_EVERY_MS)
    vi.setSystemTime(Date.now() + BOX_EVERY_MS - 1)
    expect((await look(moss)).boxes).toBe(0)
    vi.setSystemTime(Date.now() + 1)
    expect(await look(moss)).toMatchObject({ boxes: 1 })
    // Left for days, it is still the one: one of the workspace's own waits at most.
    vi.setSystemTime(Date.now() + 5 * BOX_EVERY_MS)
    const left = await look(pip)
    expect(left.boxes).toBe(1)
    expect(left.nextBoxAt).toBeUndefined()
  })

  it("keeps the boxes treats filled besides its own, and opens its own first", async () => {
    const pip = await dood("pip", MINE)
    await look(pip)
    await addSharedBoxes(MINE, 2)
    expect(await look(pip)).toMatchObject({ boxes: 3, shared: 2 })
    expect((await open(pip)).body.creature).toMatchObject({
      boxes: 2,
      shared: 2,
      nextBoxAt: expect.any(Number),
    })
    expect((await open(pip)).body.creature).toMatchObject({ boxes: 1, shared: 1 })
  })

  it("finds two different things in two boxes opened at once", async () => {
    const pip = await dood("pip", MINE)
    const moss = await dood("moss", MINE)
    await look(pip)
    await addSharedBoxes(MINE, 3)
    // The same chance for every box: each would find the same thing if nothing kept them apart.
    const found = await Promise.all([
      openWardrobeBox(MINE, "pip", () => 0),
      openWardrobeBox(MINE, "moss", () => 0),
      openWardrobeBox(MINE, "pip", () => 0),
    ])
    expect(new Set(found).size).toBe(3)
    const after = await look(moss)
    expect(after.owned).toHaveLength(3)
    expect(after.boxes).toBe(1)
  })

  it("takes in what its Doods had found each for itself before there were wardrobes", async () => {
    const pip = await dood("pip", MINE, {
      fed: 3,
      joy: 0,
      outfit: { hat: "tophat" },
      before: { owned: ["tophat", "beanie"], shared: 1 },
    })
    await dood("moss", MINE, {
      fed: 0,
      joy: 0,
      outfit: {},
      before: { owned: ["beanie", "monocle", "no-such"], shared: 0 },
    })
    expect(await look(pip)).toMatchObject({
      fed: 3,
      boxes: 2,
      shared: 1,
      owned: ["tophat", "beanie", "monocle"],
      foundBy: { tophat: "pip", beanie: "pip", monocle: "moss" },
      outfit: { hat: "tophat" },
    })
  })

  it("has things put in it that did not come from a box, once each", async () => {
    const pip = await dood("pip", MINE)
    await addToWardrobe(MINE, ["crown", "no-such"], "pip")
    await addToWardrobe(MINE, ["crown"], "moss")
    expect(await look(pip)).toMatchObject({ owned: ["crown"], foundBy: { crown: "pip" } })
  })

  it("has no box turn up once it has everything", async () => {
    const pip = await dood("pip", MINE)
    await open(pip)
    await addToWardrobe(
      MINE,
      WEAR_ITEMS.map((item) => item.id),
      "pip",
    )
    vi.setSystemTime(Date.now() + 3 * BOX_EVERY_MS)
    expect((await look(pip)).boxes).toBe(0)
  })
})
