import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { personalWorkspaceId } from "@do-computer/protocol"
import { openNodeAppDatabase } from "@do-computer/runtime/node"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SessionUser } from "./auth.ts"
import { readConfig } from "./platform.ts"
import { migrateAppDatabase } from "./schema.ts"

/** What stands in for the platform: a real database, and feeds that note what they are told. */
const world = vi.hoisted(() => ({ db: undefined as unknown, told: [] as [string, unknown][] }))

vi.mock("#platform", () => ({
  getPlatform: () => ({
    target: "node",
    config: readConfig({ DC_SANDBOX: "just-bash" }),
    db: world.db,
    presence: {
      get: (name: string) => ({
        fetch: async (request: Request) => {
          world.told.push([name, await request.json().catch(() => undefined)])
          return Response.json({ ok: true })
        },
      }),
    },
    machines: { kinds: [], default: "just-bash", create: () => undefined },
  }),
}))

const { readAgentOrder, writeAgentOrder, forgetAgentOrder } = await import("./agent-order.ts")
type Db = import("@do-computer/runtime").AppDatabase

const db = () => world.db as Db
const person = (id: string): SessionUser => ({ id, name: id, email: `${id}@example.com` })
const sawyer = person("sawyer")
const maya = person("maya")
const jon = person("jon")
const TEAM = "team-a"
const MINE = personalWorkspaceId("sawyer")

let made = 0
const agent = (id: string, ownerId: string, workspaceId: string) =>
  db().run(
    "INSERT INTO dc_agents (id, owner_id, workspace_id, created_at) VALUES (?, ?, ?, ?)",
    id,
    ownerId,
    workspaceId,
    ++made,
  )
const member = (userId: string, role: string) =>
  db().run(
    "INSERT INTO dc_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, 1)",
    TEAM,
    userId,
    role,
  )
const put = (user: SessionUser, workspaceId: string, body: unknown) =>
  writeAgentOrder(
    user,
    workspaceId,
    new Request("http://app/", { method: "PUT", body: JSON.stringify(body) }),
  )
async function order(user: SessionUser): Promise<Record<string, string[]>> {
  return ((await (await readAgentOrder(user)).json()) as { order: Record<string, string[]> }).order
}

beforeEach(async () => {
  world.db = openNodeAppDatabase(join(mkdtempSync(join(tmpdir(), "dc-order-")), "app.sqlite")).app
  await migrateAppDatabase(db())
  // Sawyer and Maya share a team. Jon is in neither it nor anyone else's own workspace.
  await member("sawyer", "owner")
  await member("maya", "member")
  await agent("juniper", "sawyer", TEAM)
  await agent("scout", "maya", TEAM)
  await agent("pip", "sawyer", TEAM)
  await agent("mine", "sawyer", MINE)
  await agent("also-mine", "sawyer", MINE)
  world.told = []
})

describe("the order someone put their Doods in", () => {
  it("is nothing until they put a workspace in order, and then that order", async () => {
    expect(await order(sawyer)).toEqual({})
    const response = await put(sawyer, TEAM, { ids: ["pip", "juniper", "scout"] })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ids: ["pip", "juniper", "scout"] })
    expect(await order(sawyer)).toEqual({ [TEAM]: ["pip", "juniper", "scout"] })

    // Putting it in order again replaces it, and each workspace has its own.
    await put(sawyer, TEAM, { ids: ["scout", "pip", "juniper"] })
    await put(sawyer, MINE, { ids: ["also-mine", "mine"] })
    expect(await order(sawyer)).toEqual({
      [TEAM]: ["scout", "pip", "juniper"],
      [MINE]: ["also-mine", "mine"],
    })
  })

  it("is each person's own, in a team they share", async () => {
    await put(sawyer, TEAM, { ids: ["pip", "juniper", "scout"] })
    expect(await order(maya)).toEqual({})
    await put(maya, TEAM, { ids: ["scout", "juniper", "pip"] })
    expect(await order(sawyer)).toEqual({ [TEAM]: ["pip", "juniper", "scout"] })
    expect(await order(maya)).toEqual({ [TEAM]: ["scout", "juniper", "pip"] })
  })

  it("is told to their own other devices, and nobody else's", async () => {
    await put(sawyer, TEAM, { ids: ["pip", "juniper"] })
    await forgetAgentOrder(sawyer, TEAM)
    expect(world.told).toEqual([
      ["personal:sawyer", { type: "order", workspaceId: TEAM, ids: ["pip", "juniper"] }],
      ["personal:sawyer", { type: "order", workspaceId: TEAM, ids: null }],
    ])
  })

  it("keeps only the workspace's own Doods, each once", async () => {
    const response = await put(sawyer, TEAM, { ids: ["pip", "mine", "gone", "pip", "juniper"] })
    expect(await response.json()).toEqual({ ids: ["pip", "juniper"] })
    expect(await order(sawyer)).toEqual({ [TEAM]: ["pip", "juniper"] })
  })

  it("is refused for a workspace they are not in, and when it is not a list of ids", async () => {
    expect((await put(jon, TEAM, { ids: ["pip"] })).status).toBe(404)
    expect((await put(jon, MINE, { ids: ["mine"] })).status).toBe(404)
    expect((await forgetAgentOrder(jon, TEAM)).status).toBe(404)
    expect((await put(sawyer, TEAM, { ids: "pip" })).status).toBe(400)
    expect((await put(sawyer, TEAM, { ids: [1, 2] })).status).toBe(400)
    expect(await order(sawyer)).toEqual({})
    expect(world.told).toEqual([])
  })

  it("is given up, and they are latest-first again", async () => {
    await put(sawyer, TEAM, { ids: ["pip", "juniper", "scout"] })
    await put(sawyer, MINE, { ids: ["mine", "also-mine"] })
    expect(await (await forgetAgentOrder(sawyer, TEAM)).json()).toEqual({ ids: null })
    expect(await order(sawyer)).toEqual({ [MINE]: ["mine", "also-mine"] })
  })

  it("is not given for a team they have left", async () => {
    await put(maya, TEAM, { ids: ["scout", "juniper"] })
    await db().run("DELETE FROM dc_members WHERE user_id = ?", "maya")
    expect(await order(maya)).toEqual({})
  })
})

describe("an order a browser kept before the server did", () => {
  it("stands where the person has none yet", async () => {
    const response = await put(sawyer, TEAM, { ids: ["juniper", "pip"], carried: true })
    expect(await response.json()).toEqual({ ids: ["juniper", "pip"] })
    expect(await order(sawyer)).toEqual({ [TEAM]: ["juniper", "pip"] })
  })

  it("does not undo one already kept, and is answered with that one", async () => {
    await put(sawyer, TEAM, { ids: ["pip", "scout", "juniper"] })
    world.told = []
    const response = await put(sawyer, TEAM, { ids: ["juniper", "pip"], carried: true })
    expect(await response.json()).toEqual({ ids: ["pip", "scout", "juniper"] })
    expect(await order(sawyer)).toEqual({ [TEAM]: ["pip", "scout", "juniper"] })
    // Nothing changed, so there is nothing to tell.
    expect(world.told).toEqual([])
  })
})
