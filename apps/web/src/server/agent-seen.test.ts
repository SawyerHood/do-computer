import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type AgentSummary, personalWorkspaceId } from "@durable-computer/protocol"
import { openNodeAppDatabase } from "@durable-computer/runtime/node"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SessionUser } from "./auth.ts"
import { readConfig } from "./platform.ts"
import { migrateAppDatabase } from "./schema.ts"

/** What stands in for the platform: a real database, and agents that answer with who they are. */
const world = vi.hoisted(() => ({ db: undefined as unknown }))

vi.mock("#platform", () => ({
  getPlatform: () => ({
    target: "node",
    config: readConfig({ DC_SANDBOX: "just-bash" }),
    db: world.db,
    agents: {
      get: (agentId: string) => ({
        fetch: async () => Response.json({ agent: { id: agentId, name: null }, ok: true }),
      }),
    },
    presence: { get: () => ({ fetch: async () => Response.json({ ok: true }) }) },
    machines: { kinds: [], default: "just-bash", create: () => undefined },
  }),
}))

const { listAgents } = await import("./agents.ts")
const { deleteAgent } = await import("./agent-delete.ts")
const { markAgentSeen } = await import("./agent-seen.ts")
type Db = import("@durable-computer/runtime").AppDatabase

const db = () => world.db as Db
const person = (id: string): SessionUser => ({ id, name: id, email: `${id}@example.com` })
const sawyer = person("sawyer")
const maya = person("maya")
const jon = person("jon")
const TEAM = "team-a"

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
const rows = () =>
  db().all("SELECT user_id, agent_id, seen_at FROM dc_agent_seen ORDER BY user_id, agent_id")
/** Each agent the user is listed, with when they last looked at it. */
async function listed(user: SessionUser): Promise<Record<string, number | undefined>> {
  const { agents } = (await (await listAgents(user)).json()) as { agents: AgentSummary[] }
  return Object.fromEntries(agents.map((each) => [each.id, each.seenAt]))
}
const at = (time: number) => vi.spyOn(Date, "now").mockReturnValue(time)

beforeEach(async () => {
  world.db = openNodeAppDatabase(join(mkdtempSync(join(tmpdir(), "dc-seen-")), "app.sqlite")).app
  await migrateAppDatabase(db())
  // Sawyer and Maya share a team. Jon is in neither it nor anyone else's own workspace.
  await member("sawyer", "owner")
  await member("maya", "member")
  await agent("shared", "sawyer", TEAM)
  await agent("mine", "sawyer", personalWorkspaceId("sawyer"))
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("when someone last looked at an agent", () => {
  it("is nothing until they have, and then the time they did", async () => {
    expect(await listed(sawyer)).toEqual({ shared: undefined, mine: undefined })
    // Left out, and not there as null: the app reads an absent one as never looked at.
    const { agents } = (await (await listAgents(sawyer)).json()) as { agents: object[] }
    expect(agents.every((each) => !("seenAt" in each))).toBe(true)

    at(1_000)
    const response = await markAgentSeen(sawyer, "shared")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ seenAt: 1_000 })
    expect(await listed(sawyer)).toEqual({ shared: 1_000, mine: undefined })

    // Looking again moves it on, and is still one row.
    at(2_000)
    expect(await (await markAgentSeen(sawyer, "shared")).json()).toEqual({ seenAt: 2_000 })
    expect(await rows()).toEqual([{ user_id: "sawyer", agent_id: "shared", seen_at: 2_000 }])
  })

  it("is kept for each person apart, in a team they share", async () => {
    at(1_000)
    await markAgentSeen(sawyer, "shared")
    // Sawyer having looked says nothing of Maya.
    expect(await listed(maya)).toEqual({ shared: undefined })

    at(5_000)
    await markAgentSeen(maya, "shared")
    expect(await listed(maya)).toEqual({ shared: 5_000 })
    expect(await listed(sawyer)).toEqual({ shared: 1_000, mine: undefined })
    expect(await rows()).toEqual([
      { user_id: "maya", agent_id: "shared", seen_at: 5_000 },
      { user_id: "sawyer", agent_id: "shared", seen_at: 1_000 },
    ])
  })

  it("is not kept for someone who cannot reach the agent, or for an agent there is not", async () => {
    for (const [user, agentId] of [
      [jon, "shared"],
      [maya, "mine"],
      [sawyer, "nobody"],
    ] as const) {
      const response = await markAgentSeen(user, agentId)
      expect(response.status).toBe(404)
      expect(await response.json()).toMatchObject({ error: "Agent not found" })
    }
    expect(await rows()).toEqual([])
  })

  it("goes with the agent when it is deleted, for everyone who had looked", async () => {
    at(1_000)
    await markAgentSeen(sawyer, "shared")
    await markAgentSeen(maya, "shared")
    await markAgentSeen(sawyer, "mine")

    expect((await deleteAgent(sawyer, "shared")).status).toBe(200)
    expect(await rows()).toEqual([{ user_id: "sawyer", agent_id: "mine", seen_at: 1_000 }])
    expect(await listed(sawyer)).toEqual({ mine: 1_000 })
  })
})
