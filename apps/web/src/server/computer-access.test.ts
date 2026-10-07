import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { personalWorkspaceId } from "@durable-computer/protocol"
import type { AppDatabase } from "@durable-computer/runtime"
import { openNodeAppDatabase } from "@durable-computer/runtime/node"
import { describe, expect, it } from "vitest"
import {
  agentsOn,
  answerersOf,
  ask,
  askedBy,
  type ComputerRow,
  computersNear,
  computersOf,
  fits,
  forgetAgent,
  forgetComputer,
  grant,
  isTheirs,
  leftBehind,
  mayRemove,
  mayUse,
  misfitsOfAgent,
  misfitsOfComputer,
  requestsFor,
} from "./computer-access.ts"
import { migrateAppDatabase } from "./schema.ts"
import { acceptInvitation, createWorkspace, invite, removeMember, type Who } from "./teams.ts"

const person = (id: string): Who => ({
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
  email: `${id}@example.com`,
  emailVerified: true,
})
const sawyer = person("sawyer")
const maya = person("maya")
const jon = person("jon")

function open(): AppDatabase {
  return openNodeAppDatabase(join(mkdtempSync(join(tmpdir(), "dc-computers-")), "app.sqlite")).app
}

async function database() {
  const app = open()
  await migrateAppDatabase(app)
  await app.run("CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT, email TEXT, image TEXT)")
  await app.run("CREATE TABLE account (accountId TEXT, providerId TEXT, userId TEXT)")
  for (const who of [sawyer, maya, jon]) {
    await app.run(
      "INSERT INTO user (id, name, email) VALUES (?, ?, ?)",
      who.id,
      who.name,
      who.email,
    )
  }
  return app
}

/** A team of Sawyer's with Maya in it. Jon is in nothing. */
async function team(db: AppDatabase): Promise<string> {
  const id = await createWorkspace(db, sawyer, { name: "Tidewater" })
  const sent = await invite(
    db,
    sawyer,
    id,
    { who: [maya.email] },
    { origin: "http://app", github: async () => undefined, email: async () => false },
  )
  await acceptInvitation(db, maya, sent.invitations[0]!.link.split("/").pop()!)
  return id
}

let made = 0
async function agent(db: AppDatabase, owner: Who, workspaceId?: string): Promise<string> {
  const id = `agent-${++made}`
  await db.run(
    "INSERT INTO dc_agents (id, owner_id, workspace_id, created_at) VALUES (?, ?, ?, ?)",
    id,
    owner.id,
    workspaceId ?? personalWorkspaceId(owner.id),
    made,
  )
  return id
}

async function computer(db: AppDatabase, owner: Who, workspaceId?: string): Promise<ComputerRow> {
  const id = `computer-${++made}`
  await db.run(
    `INSERT INTO dc_computers
       (id, owner_id, workspace_id, name, platform, hostname, home, read_only, created_at)
     VALUES (?, ?, ?, ?, 'linux', 'host', '/home/x', 0, ?)`,
    id,
    owner.id,
    workspaceId ?? personalWorkspaceId(owner.id),
    `${owner.id}-laptop`,
    made,
  )
  return (await db.get<ComputerRow>("SELECT * FROM dc_computers WHERE id = ?", id))!
}

describe("whose a computer is", () => {
  it("someone's list holds their own computers and their teams', and nobody else's", async () => {
    const db = await database()
    const teamId = await team(db)
    const mine = await computer(db, sawyer)
    const teams = await computer(db, maya, teamId)
    const mayas = await computer(db, maya)

    expect((await computersOf(db, sawyer.id)).map((row) => row.id)).toEqual([mine.id, teams.id])
    expect((await computersOf(db, maya.id)).map((row) => row.id)).toEqual([teams.id, mayas.id])
    expect(await computersOf(db, jon.id)).toEqual([])
    expect(await isTheirs(db, sawyer.id, teams)).toBe(true)
    expect(await isTheirs(db, sawyer.id, mayas)).toBe(false)
    expect(await isTheirs(db, jon.id, teams)).toBe(false)
  })

  it("is removed by whoever paired it, or by an admin of its team", async () => {
    const db = await database()
    const teamId = await team(db)
    const mayas = await computer(db, maya, teamId)
    const sawyers = await computer(db, sawyer, teamId)
    // Maya is a member: she removes what she paired, and not what the owner paired.
    expect(await mayRemove(db, maya.id, mayas)).toBe(true)
    expect(await mayRemove(db, maya.id, sawyers)).toBe(false)
    expect(await mayRemove(db, sawyer.id, mayas)).toBe(true)
    expect(await mayRemove(db, jon.id, mayas)).toBe(false)
    expect(await mayRemove(db, sawyer.id, await computer(db, maya))).toBe(false)
  })

  it("serves any agent its owner can use when it is someone's own, and only its team's when it is a team's", async () => {
    const db = await database()
    const teamId = await team(db)
    const other = await createWorkspace(db, sawyer, { name: "Elsewhere" })
    const mine = await computer(db, sawyer)
    const teams = await computer(db, sawyer, teamId)

    expect(await fits(db, mine, personalWorkspaceId(sawyer.id))).toBe(true)
    expect(await fits(db, mine, teamId)).toBe(true)
    expect(await fits(db, mine, other)).toBe(true)
    expect(await fits(db, mine, personalWorkspaceId(maya.id))).toBe(false)
    expect(await fits(db, teams, teamId)).toBe(true)
    expect(await fits(db, teams, other)).toBe(false)
    expect(await fits(db, teams, personalWorkspaceId(sawyer.id))).toBe(false)
    // Maya is not in the other team, so her own computer cannot serve an agent there.
    expect(await fits(db, await computer(db, maya), other)).toBe(false)
  })
})

describe("what an agent can see and ask for", () => {
  it("is its owner's computers for a personal agent", async () => {
    const db = await database()
    const teamId = await team(db)
    const mine = await computer(db, sawyer)
    await computer(db, sawyer, teamId)
    await computer(db, maya)
    const own = await agent(db, sawyer)
    expect((await computersNear(db, own)).map((row) => row.id)).toEqual([mine.id])
  })

  it("is the team's computers and its members' own for a team's agent", async () => {
    const db = await database()
    const teamId = await team(db)
    const mine = await computer(db, sawyer)
    const teams = await computer(db, sawyer, teamId)
    const mayas = await computer(db, maya)
    await computer(db, jon)
    const shared = await agent(db, sawyer, teamId)
    expect((await computersNear(db, shared)).map((row) => row.id)).toEqual([
      mine.id,
      teams.id,
      mayas.id,
    ])
  })

  it("asks once, and the people the computer belongs to are who answers", async () => {
    const db = await database()
    const teamId = await team(db)
    const mayas = await computer(db, maya)
    const teams = await computer(db, maya, teamId)
    const shared = await agent(db, sawyer, teamId)

    const first = await ask(db, {
      computerId: mayas.id,
      agentId: shared,
      chatId: "1",
      reason: " to\nlook ",
    })
    expect(first.fresh).toBe(true)
    const again = await ask(db, {
      computerId: mayas.id,
      agentId: shared,
      chatId: "2",
      reason: "again",
    })
    expect(again).toEqual({ id: first.id, fresh: false })
    expect(await askedBy(db, shared)).toEqual([mayas.id])
    expect(await answerersOf(db, mayas)).toEqual([maya.id])
    expect((await answerersOf(db, teams)).sort()).toEqual([maya.id, sawyer.id])

    // Everyone who can use the agent sees that it is waiting; only Maya can answer.
    const seen = await requestsFor(db, sawyer.id)
    expect(seen.map(({ request }) => request.reason)).toEqual(["to look"])
    expect(await isTheirs(db, sawyer.id, seen[0]!.computer)).toBe(false)
    expect(await isTheirs(db, maya.id, seen[0]!.computer)).toBe(true)
    expect(await requestsFor(db, jon.id)).toEqual([])

    // Granting it answers the request.
    expect(await mayUse(db, shared, mayas.id)).toBe(false)
    await grant(db, mayas.id, shared, maya.id)
    expect(await askedBy(db, shared)).toEqual([])
    expect((await agentsOn(db, [mayas.id])).get(mayas.id)).toEqual([shared])
    expect(await mayUse(db, shared, mayas.id)).toBe(true)
    // Being connected to one computer says nothing about another, or about another agent.
    expect(await mayUse(db, shared, teams.id)).toBe(false)
    expect(await mayUse(db, await agent(db, sawyer, teamId), mayas.id)).toBe(false)
  })
})

describe("what ends", () => {
  it("when an agent moves: the connections its new workspace cannot have", async () => {
    const db = await database()
    const teamId = await team(db)
    const shared = await agent(db, sawyer, teamId)
    const mine = await computer(db, sawyer)
    const mayas = await computer(db, maya)
    const teams = await computer(db, maya, teamId)
    for (const row of [mine, mayas, teams]) await grant(db, row.id, shared, row.owner_id)
    const wanted = await computer(db, maya)
    await ask(db, { computerId: wanted.id, agentId: shared, chatId: "1", reason: "" })

    expect(await misfitsOfAgent(db, shared)).toEqual({ grants: [], requests: [] })
    expect(await mayUse(db, shared, mayas.id)).toBe(true)
    // Sawyer takes it home: his own computer stays, Maya's and the team's go.
    await db.run(
      "UPDATE dc_agents SET workspace_id = ? WHERE id = ?",
      personalWorkspaceId(sawyer.id),
      shared,
    )
    // From that moment, before anything is tidied up, it may no longer use them.
    expect(await mayUse(db, shared, mayas.id)).toBe(false)
    expect(await mayUse(db, shared, teams.id)).toBe(false)
    expect(await mayUse(db, shared, mine.id)).toBe(true)
    const gone = await misfitsOfAgent(db, shared)
    expect(gone.grants.map((grant) => grant.computerId).sort()).toEqual([mayas.id, teams.id].sort())
    // What it had asked Maya for can no longer be granted, and is dropped.
    expect(gone.requests).toEqual([{ computerId: wanted.id, agentId: shared }])
    expect(await askedBy(db, shared)).toEqual([])
  })

  it("when a computer is given to a team: the agents outside it", async () => {
    const db = await database()
    const teamId = await team(db)
    const own = await agent(db, sawyer)
    const shared = await agent(db, sawyer, teamId)
    const mine = await computer(db, sawyer)
    await grant(db, mine.id, own, sawyer.id)
    await grant(db, mine.id, shared, sawyer.id)
    await db.run("UPDATE dc_computers SET workspace_id = ? WHERE id = ?", teamId, mine.id)
    expect(await misfitsOfComputer(db, mine.id)).toEqual({
      grants: [{ computerId: mine.id, agentId: own }],
      requests: [],
    })
  })

  it("when someone leaves a team: what they paired for it, and their own computers' part in it", async () => {
    const db = await database()
    const teamId = await team(db)
    const shared = await agent(db, sawyer, teamId)
    const mayasOwn = await agent(db, maya)
    const mayas = await computer(db, maya)
    const forTeam = await computer(db, maya, teamId)
    const sawyers = await computer(db, sawyer, teamId)
    await grant(db, mayas.id, shared, maya.id)
    await grant(db, mayas.id, mayasOwn, maya.id)
    await grant(db, forTeam.id, shared, maya.id)
    await grant(db, sawyers.id, shared, sawyer.id)

    await removeMember(db, sawyer, teamId, maya.id)
    const left = await leftBehind(db, maya.id, teamId)
    expect(left.computers.map((row) => row.id)).toEqual([forTeam.id])
    // Her own computer keeps serving her own agent.
    expect(left.grants).toEqual([{ computerId: mayas.id, agentId: shared }])
  })

  it("when a computer or an agent is gone: everything about it", async () => {
    const db = await database()
    const own = await agent(db, sawyer)
    const other = await agent(db, sawyer)
    const mine = await computer(db, sawyer)
    const second = await computer(db, sawyer)
    await grant(db, mine.id, own, sawyer.id)
    await grant(db, mine.id, other, sawyer.id)
    await ask(db, { computerId: second.id, agentId: own, chatId: "1", reason: "" })

    await forgetAgent(db, own)
    expect((await agentsOn(db, [mine.id])).get(mine.id)).toEqual([other])
    expect(await askedBy(db, own)).toEqual([])
    // The computer itself is untouched by an agent going.
    expect((await computersOf(db, sawyer.id)).length).toBe(2)

    await forgetComputer(db, mine.id)
    expect((await agentsOn(db, [mine.id])).get(mine.id)).toBeUndefined()
    expect((await computersOf(db, sawyer.id)).map((row) => row.id)).toEqual([second.id])
  })
})

describe("a computer from before it could have several agents", () => {
  it("becomes its pairer's own, still connected to the agent it was paired with", async () => {
    const db = open()
    await migrateAppDatabase(db, 7)
    await db.run(
      `INSERT INTO dc_computers
         (id, owner_id, agent_id, name, platform, hostname, read_only, token_hash, created_at)
       VALUES ('c1', 'sawyer', 'agent-x', 'laptop', 'darwin', 'host', 0, 'hash', 5)`,
    )
    await migrateAppDatabase(db)
    const row = (await db.get<ComputerRow & { agent_id?: string }>(
      "SELECT * FROM dc_computers WHERE id = 'c1'",
    ))!
    expect(row.workspace_id).toBe(personalWorkspaceId("sawyer"))
    expect(row.token_hash).toBe("hash")
    expect(row.home).toBeNull()
    expect("agent_id" in row).toBe(false)
    expect((await agentsOn(db, ["c1"])).get("c1")).toEqual(["agent-x"])
  })
})
