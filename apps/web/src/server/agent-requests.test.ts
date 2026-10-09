import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { personalWorkspaceId } from "@durable-computer/protocol"
import { openNodeAppDatabase } from "@durable-computer/runtime/node"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { readConfig } from "./platform.ts"
import { migrateAppDatabase } from "./schema.ts"

/** What stands in for the platform: a real database, and agents and machines that take notes. */
const world = vi.hoisted(() => ({
  db: undefined as unknown,
  /** Every call made to an agent, as `METHOD agent path`. */
  calls: [] as string[],
  bodies: [] as { agentId: string; path: string; body: unknown }[],
  destroyed: [] as string[],
  failDestroy: false,
}))

vi.mock("#platform", () => ({
  getPlatform: () => ({
    target: "node",
    config: readConfig({
      DC_SANDBOX: "just-bash",
      DC_SANDBOX_KINDS: "just-bash,daytona,none",
      DAYTONA_API_KEY: "key",
    }),
    db: world.db,
    agents: {
      get: (agentId: string) => ({
        fetch: async (request: Request) => {
          const path = new URL(request.url).pathname
          world.calls.push(`${request.method} ${agentId} ${path}`)
          if (request.method !== "GET") {
            world.bodies.push({ agentId, path, body: await request.json().catch(() => undefined) })
          }
          return Response.json({ agent: { id: agentId, name: null }, computers: [] })
        },
      }),
    },
    presence: { get: () => ({ fetch: async () => Response.json({ ok: true }) }) },
    // No workspace here is signed in to a model provider.
    modelAccess: { get: () => ({ fetch: async () => Response.json({ models: [] }) }) },
    machines: {
      kinds: [],
      default: "just-bash",
      create: (kind: string, key: string) =>
        kind === "daytona"
          ? {
              home: "/home/daytona",
              destroy: async () => {
                if (world.failDestroy) throw new Error("the provider is down")
                world.destroyed.push(key)
              },
            }
          : undefined,
    },
  }),
}))

const { addableKinds, addMachineFor, removeMachineFor } = await import("./computers.ts")
const { createAgentBeside, MAX_AGENTS_PER_WORKSPACE } = await import("./agents.ts")
const { computerDirectory } = await import("./computer-directory.ts")
type Row = import("./computer-access.ts").ComputerRow
type Db = import("@durable-computer/runtime").AppDatabase

const db = () => world.db as Db
const WORKSPACE = personalWorkspaceId("sawyer")

async function agent(id: string, ownerId = "sawyer", workspaceId = personalWorkspaceId(ownerId)) {
  await db().run(
    "INSERT INTO dc_agents (id, owner_id, workspace_id, created_at) VALUES (?, ?, ?, ?)",
    id,
    ownerId,
    workspaceId,
    Date.now(),
  )
}
const machines = () => db().all<Row>("SELECT * FROM dc_computers ORDER BY created_at, name")

beforeEach(async () => {
  world.db = openNodeAppDatabase(
    join(mkdtempSync(join(tmpdir(), "dc-requests-")), "app.sqlite"),
  ).app
  world.calls.length = 0
  world.bodies.length = 0
  world.destroyed.length = 0
  world.failDestroy = false
  await migrateAppDatabase(db())
  // The accounts table is the sign-in library's, which these tests do without.
  await db().run("CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT, email TEXT, image TEXT)")
  await db().run("INSERT INTO user (id, name, email) VALUES ('sawyer', 'Sawyer', 's@example.com')")
  await agent("a1")
  await agent("a2")
})

describe("an agent adding a machine", () => {
  it("can add every kind that agents can share", () => {
    expect(addableKinds().map((kind) => kind.id)).toEqual(["daytona"])
  })

  it("adds one to its workspace, open to its agents, for whoever it was working for", async () => {
    const added = await addMachineFor("a1", { name: "Build Box", by: "sawyer" })
    expect(added).toMatchObject({ name: "build-box", kind: "daytona" })
    expect(await machines()).toMatchObject([
      {
        workspace_id: WORKSPACE,
        owner_id: "sawyer",
        name: "build-box",
        kind: "daytona",
        access: "open",
        home: "/home/daytona",
        added_by_agent: "a1",
      },
    ])
    // Every agent of the workspace is told what there is now.
    expect(world.calls).toEqual(expect.arrayContaining(["PUT a1 /computers", "PUT a2 /computers"]))
    // A name that is taken gets a number, as it does from the app.
    expect(await addMachineFor("a2", { name: "build box" })).toMatchObject({ name: "build-box-2" })
  })

  it("makes it the agent's maker's where the person it worked for is not in the workspace", async () => {
    await addMachineFor("a1", { by: "stranger" })
    expect(await machines()).toMatchObject([{ owner_id: "sawyer", name: "computer" }])
  })

  it("refuses a kind there is not, and a machine too many", async () => {
    expect(await addMachineFor("a1", { kind: "just-bash" })).toEqual({
      error: 'There is no kind of machine "just-bash" to add. The kinds are: daytona.',
    })
    expect(await addMachineFor("gone", {})).toEqual({
      error: "This agent is not in a workspace any more.",
    })
    for (let n = 0; n < 10; n++) expect(await addMachineFor("a1", {})).not.toHaveProperty("error")
    expect(await addMachineFor("a1", {})).toMatchObject({
      error: expect.stringContaining("already has 10 machines"),
    })
  })

  it("is told which machines it added, and removes only those", async () => {
    const mine = (await addMachineFor("a1", { name: "mine" })) as { id: string }
    const other = (await addMachineFor("a2", { name: "other" })) as { id: string }
    const directory = computerDirectory(db(), {
      get: () => ({ fetch: async () => Response.json({}) }),
    })
    expect(
      (await directory.list("a1")).map((computer) => [computer.name, computer.mine === true]),
    ).toEqual([
      ["mine", true],
      ["other", false],
    ])

    expect(await removeMachineFor("a1", other.id)).toMatchObject({
      error: expect.stringContaining("You can only remove a machine you added"),
    })
    await agent("elsewhere", "maya")
    expect(await removeMachineFor("elsewhere", mine.id)).toEqual({
      error: "There is no such machine in your workspace.",
    })
    expect(world.destroyed).toEqual([])

    // One that could not be deleted at its provider is kept, so that it can be found again.
    world.failDestroy = true
    expect(await removeMachineFor("a1", mine.id)).toEqual({
      error: "The machine could not be deleted, so it was kept: the provider is down",
    })
    expect((await machines()).length).toBe(2)
    world.failDestroy = false
    expect(await removeMachineFor("a1", mine.id)).toEqual({ ok: true })
    expect(world.destroyed).toEqual([mine.id])
    expect((await machines()).map((row) => row.name)).toEqual(["other"])
  })
})

describe("an agent making another", () => {
  it("makes it in its own workspace, with the name and character asked for", async () => {
    const made = await createAgentBeside("a1", {
      name: "Scout",
      tagline: "Watches the news",
      personality: "You are brief.",
      by: "sawyer",
    })
    expect(made).toMatchObject({ name: "Scout" })
    const id = (made as { id: string }).id
    expect(await db().get("SELECT owner_id, workspace_id FROM dc_agents WHERE id = ?", id)).toEqual(
      { owner_id: "sawyer", workspace_id: WORKSPACE },
    )
    expect(
      world.bodies.find((sent) => sent.agentId === id && sent.path === "/init")?.body,
    ).toMatchObject({ ownerId: "sawyer", team: null })
    expect(world.bodies.find((sent) => sent.agentId === id && sent.path === "/")?.body).toEqual({
      name: "Scout",
      tagline: "Watches the news",
      soul: "You are brief.",
    })
  })

  it("keeps to the number of agents a workspace can have", async () => {
    for (let n = 2; n < MAX_AGENTS_PER_WORKSPACE; n++) await agent(`more-${n}`)
    expect(await createAgentBeside("a1", { name: "Extra" })).toEqual({
      error: `The workspace already has ${MAX_AGENTS_PER_WORKSPACE} agents, which is the most it can have.`,
    })
  })
})
