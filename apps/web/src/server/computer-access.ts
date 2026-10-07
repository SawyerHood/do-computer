import { isPersonalWorkspace, type Person, personalWorkspaceId } from "@durable-computer/protocol"
import type { AppDatabase } from "@durable-computer/runtime"
import { roleIn, workspaceIdsOf } from "./teams.ts"

/**
 * Whose a paired computer is, which agents can work on it, and who is asked when an agent wants
 * one, as rows in the app database. Like teams, nothing here knows about requests or the
 * platform, so that who may do what can be tested against a database alone.
 *
 * A computer belongs to a workspace: the own one of whoever paired it, or a team's. Someone's own
 * computer can be connected to any agent they can use, in any workspace; a team's computer to the
 * team's agents. The people a computer belongs to are the ones who connect it and who answer when
 * an agent asks for it: its owner, or everyone in its team.
 */

export type ComputerRow = {
  id: string
  /** Who paired it. Its daemon runs as them on that machine. */
  owner_id: string
  workspace_id: string
  name: string
  platform: string
  hostname: string
  /** Null for a computer paired before this was kept. */
  home: string | null
  read_only: number
  token_hash: string | null
  created_at: number
}

export type RequestRow = {
  id: string
  computer_id: string
  agent_id: string
  chat_id: string | null
  reason: string
  created_at: number
}

const MAX_REASON_CHARS = 300

const marks = (values: readonly unknown[]) => values.map(() => "?").join(", ")

/** The computers in someone's list: their own, and those of the teams they are in. */
export async function computersOf(db: AppDatabase, userId: string): Promise<ComputerRow[]> {
  const workspaceIds = await workspaceIdsOf(db, userId)
  return db.all<ComputerRow>(
    `SELECT * FROM dc_computers WHERE workspace_id IN (${marks(workspaceIds)}) ORDER BY created_at`,
    ...workspaceIds,
  )
}

/** Whether a computer is the user's to hand out: their own, or one of a team they are in. */
export async function isTheirs(
  db: AppDatabase,
  userId: string,
  computer: ComputerRow,
): Promise<boolean> {
  return (await roleIn(db, userId, computer.workspace_id)) !== undefined
}

/** Whether the user may remove a computer: whoever paired it, or an admin of its team. */
export async function mayRemove(
  db: AppDatabase,
  userId: string,
  computer: ComputerRow,
): Promise<boolean> {
  const role = await roleIn(db, userId, computer.workspace_id)
  if (role === undefined) return false
  return computer.owner_id === userId || role !== "member"
}

/**
 * Whether a computer could serve an agent in a workspace at all, whoever asks. Someone's own
 * computer serves the agents they can use; a team's serves the team's.
 */
export async function fits(
  db: AppDatabase,
  computer: ComputerRow,
  agentWorkspaceId: string,
): Promise<boolean> {
  if (!isPersonalWorkspace(computer.workspace_id)) return computer.workspace_id === agentWorkspaceId
  return (await roleIn(db, computer.owner_id, agentWorkspaceId)) !== undefined
}

/** Who answers when an agent asks for a computer: its owner, or everyone in its team. */
export async function answerersOf(db: AppDatabase, computer: ComputerRow): Promise<string[]> {
  if (isPersonalWorkspace(computer.workspace_id)) return [computer.owner_id]
  const members = await db.all<{ user_id: string }>(
    "SELECT user_id FROM dc_members WHERE workspace_id = ?",
    computer.workspace_id,
  )
  return members.map((member) => member.user_id)
}

async function workspaceOfAgent(db: AppDatabase, agentId: string): Promise<string | undefined> {
  const row = await db.get<{ owner_id: string; workspace_id: string | null }>(
    "SELECT owner_id, workspace_id FROM dc_agents WHERE id = ?",
    agentId,
  )
  return row === undefined ? undefined : (row.workspace_id ?? personalWorkspaceId(row.owner_id))
}

/**
 * The computers an agent could be connected to: those of its workspace, and the own computers of
 * the people it works for. These are what it can see and ask for.
 */
export async function computersNear(db: AppDatabase, agentId: string): Promise<ComputerRow[]> {
  const workspaceId = await workspaceOfAgent(db, agentId)
  if (workspaceId === undefined) return []
  const workspaceIds = [workspaceId]
  if (!isPersonalWorkspace(workspaceId)) {
    const members = await db.all<{ user_id: string }>(
      "SELECT user_id FROM dc_members WHERE workspace_id = ?",
      workspaceId,
    )
    workspaceIds.push(...members.map((member) => personalWorkspaceId(member.user_id)))
  }
  return db.all<ComputerRow>(
    `SELECT * FROM dc_computers WHERE workspace_id IN (${marks(workspaceIds)})
      ORDER BY created_at`,
    ...workspaceIds,
  )
}

/** Which agents can work on each of some computers. */
export async function agentsOn(
  db: AppDatabase,
  computerIds: readonly string[],
): Promise<Map<string, string[]>> {
  const byComputer = new Map<string, string[]>()
  if (computerIds.length === 0) return byComputer
  const rows = await db.all<{ computer_id: string; agent_id: string }>(
    `SELECT computer_id, agent_id FROM dc_computer_grants
      WHERE computer_id IN (${marks(computerIds)}) ORDER BY created_at`,
    ...computerIds,
  )
  for (const row of rows) {
    byComputer.set(row.computer_id, [...(byComputer.get(row.computer_id) ?? []), row.agent_id])
  }
  return byComputer
}

/** The ids of the computers an agent can work on. */
export async function computerIdsOfAgent(db: AppDatabase, agentId: string): Promise<string[]> {
  const rows = await db.all<{ computer_id: string }>(
    "SELECT computer_id FROM dc_computer_grants WHERE agent_id = ?",
    agentId,
  )
  return rows.map((row) => row.computer_id)
}

/** Let an agent work on a computer. What it asked, if it asked, is thereby answered. */
export async function grant(
  db: AppDatabase,
  computerId: string,
  agentId: string,
  by: string,
  now = Date.now(),
): Promise<void> {
  await db.batch([
    {
      sql: `INSERT INTO dc_computer_grants (computer_id, agent_id, granted_by, created_at)
            VALUES (?, ?, ?, ?) ON CONFLICT (computer_id, agent_id) DO NOTHING`,
      params: [computerId, agentId, by, now],
    },
    {
      sql: "DELETE FROM dc_computer_requests WHERE computer_id = ? AND agent_id = ?",
      params: [computerId, agentId],
    },
  ])
}

export async function ungrant(db: AppDatabase, computerId: string, agentId: string): Promise<void> {
  await db.run(
    "DELETE FROM dc_computer_grants WHERE computer_id = ? AND agent_id = ?",
    computerId,
    agentId,
  )
}

/**
 * Whether an agent may work on a computer right now: it was connected to it, and the computer
 * could still be connected to it today. Asked before every use, so that access ends when the
 * connection does, and does not rest on the agent having been told.
 */
export async function mayUse(
  db: AppDatabase,
  agentId: string,
  computerId: string,
): Promise<boolean> {
  const granted = await db.get<{ agent_id: string }>(
    "SELECT agent_id FROM dc_computer_grants WHERE computer_id = ? AND agent_id = ?",
    computerId,
    agentId,
  )
  if (granted === undefined) return false
  const computer = await db.get<ComputerRow>("SELECT * FROM dc_computers WHERE id = ?", computerId)
  const workspaceId = await workspaceOfAgent(db, agentId)
  return computer !== undefined && workspaceId !== undefined && fits(db, computer, workspaceId)
}

/**
 * Record that an agent asks for a computer. Asking again while nobody has answered changes
 * nothing: `fresh` says whether this was the first time, which is when people are told.
 */
export async function ask(
  db: AppDatabase,
  input: { computerId: string; agentId: string; chatId: string | null; reason: string },
  now = Date.now(),
): Promise<{ id: string; fresh: boolean }> {
  const id = crypto.randomUUID()
  await db.run(
    `INSERT INTO dc_computer_requests (id, computer_id, agent_id, chat_id, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (computer_id, agent_id) DO NOTHING`,
    id,
    input.computerId,
    input.agentId,
    input.chatId,
    input.reason.replace(/\s+/g, " ").trim().slice(0, MAX_REASON_CHARS),
    now,
  )
  // Whichever of two that asked at once got there first is the one that is kept.
  const kept = await db.get<{ id: string }>(
    "SELECT id FROM dc_computer_requests WHERE computer_id = ? AND agent_id = ?",
    input.computerId,
    input.agentId,
  )
  return { id: kept?.id ?? id, fresh: kept?.id === id }
}

/** The computers an agent has asked for and not been answered about. */
export async function askedBy(db: AppDatabase, agentId: string): Promise<string[]> {
  const rows = await db.all<{ computer_id: string }>(
    "SELECT computer_id FROM dc_computer_requests WHERE agent_id = ?",
    agentId,
  )
  return rows.map((row) => row.computer_id)
}

/**
 * What the agents someone can use are waiting to hear, oldest first, each with its computer.
 * Whether they are one of the people who can answer is for the caller to say, with `isTheirs`.
 */
export async function requestsFor(
  db: AppDatabase,
  userId: string,
): Promise<{ request: RequestRow; computer: ComputerRow }[]> {
  const workspaceIds = await workspaceIdsOf(db, userId)
  const requests = await db.all<RequestRow>(
    `SELECT r.* FROM dc_computer_requests r JOIN dc_agents a ON a.id = r.agent_id
      WHERE a.workspace_id IN (${marks(workspaceIds)}) ORDER BY r.created_at`,
    ...workspaceIds,
  )
  const found: { request: RequestRow; computer: ComputerRow }[] = []
  for (const request of requests) {
    const computer = await db.get<ComputerRow>(
      "SELECT * FROM dc_computers WHERE id = ?",
      request.computer_id,
    )
    if (computer !== undefined) found.push({ request, computer })
  }
  return found
}

/** The agents that asked for a computer and have not been answered. */
export async function askersOf(db: AppDatabase, computerId: string): Promise<string[]> {
  const rows = await db.all<{ agent_id: string }>(
    "SELECT agent_id FROM dc_computer_requests WHERE computer_id = ?",
    computerId,
  )
  return rows.map((row) => row.agent_id)
}

/** Whether an agent is connected to a computer, as far as the record goes. */
export async function isGranted(
  db: AppDatabase,
  computerId: string,
  agentId: string,
): Promise<boolean> {
  const row = await db.get<{ agent_id: string }>(
    "SELECT agent_id FROM dc_computer_grants WHERE computer_id = ? AND agent_id = ?",
    computerId,
    agentId,
  )
  return row !== undefined
}

/** Forget everything about a computer. Access to it ends with this. */
export async function forgetComputer(db: AppDatabase, computerId: string): Promise<void> {
  await db.batch([
    { sql: "DELETE FROM dc_computers WHERE id = ?", params: [computerId] },
    { sql: "DELETE FROM dc_computer_grants WHERE computer_id = ?", params: [computerId] },
    { sql: "DELETE FROM dc_computer_requests WHERE computer_id = ?", params: [computerId] },
  ])
}

/** Forget which computers an agent could work on and what it had asked for: it is gone. */
export async function forgetAgent(db: AppDatabase, agentId: string): Promise<void> {
  await db.batch([
    { sql: "DELETE FROM dc_computer_grants WHERE agent_id = ?", params: [agentId] },
    { sql: "DELETE FROM dc_computer_requests WHERE agent_id = ?", params: [agentId] },
  ])
}

export type Grant = { computerId: string; agentId: string }

/** What no longer holds: connections to end, and requests that were dropped. */
export type Misfits = { grants: Grant[]; requests: Grant[] }

/**
 * The connections and requests that no longer hold, given where an agent or a computer is now:
 * each one whose computer could not serve its agent's workspace. The requests are dropped here.
 * The connections are for the caller to end, and it has the agents to tell of both.
 */
async function misfits(db: AppDatabase, where: string, value: string): Promise<Misfits> {
  type Pair = { computer_id: string; agent_id: string }
  const select = (table: string) =>
    db.all<Pair>(`SELECT computer_id, agent_id FROM ${table} WHERE ${where} = ?`, value)
  const wrong = async (pairs: readonly Pair[]) => {
    const found: Grant[] = []
    for (const pair of pairs) {
      const computer = await db.get<ComputerRow>(
        "SELECT * FROM dc_computers WHERE id = ?",
        pair.computer_id,
      )
      const workspaceId = await workspaceOfAgent(db, pair.agent_id)
      if (
        computer === undefined ||
        workspaceId === undefined ||
        !(await fits(db, computer, workspaceId))
      ) {
        found.push({ computerId: pair.computer_id, agentId: pair.agent_id })
      }
    }
    return found
  }
  const requests = await wrong(await select("dc_computer_requests"))
  for (const request of requests) {
    await db.run(
      "DELETE FROM dc_computer_requests WHERE computer_id = ? AND agent_id = ?",
      request.computerId,
      request.agentId,
    )
  }
  return { grants: await wrong(await select("dc_computer_grants")), requests }
}

/** What of an agent's no longer holds, after it was moved to another workspace. */
export const misfitsOfAgent = (db: AppDatabase, agentId: string) => misfits(db, "agent_id", agentId)

/** What of a computer's no longer holds, after whose it is changed. */
export const misfitsOfComputer = (db: AppDatabase, computerId: string) =>
  misfits(db, "computer_id", computerId)

/**
 * What ends when someone is no longer in a team: the computers they paired for it, which run as
 * them, and the connections of their own computers to its agents. Call it once they are out.
 */
export async function leftBehind(
  db: AppDatabase,
  userId: string,
  workspaceId: string,
): Promise<{ computers: ComputerRow[] } & Misfits> {
  const computers = await db.all<ComputerRow>(
    "SELECT * FROM dc_computers WHERE workspace_id = ? AND owner_id = ?",
    workspaceId,
    userId,
  )
  const own = await db.all<{ id: string }>(
    "SELECT id FROM dc_computers WHERE workspace_id = ?",
    personalWorkspaceId(userId),
  )
  const gone: Misfits = { grants: [], requests: [] }
  for (const computer of own) {
    const wrong = await misfitsOfComputer(db, computer.id)
    gone.grants.push(...wrong.grants)
    gone.requests.push(...wrong.requests)
  }
  return { computers, ...gone }
}

/** People by id, as far as the account table knows them. */
export async function peopleById(
  db: AppDatabase,
  userIds: readonly string[],
): Promise<Map<string, Person>> {
  const people = new Map<string, Person>()
  const ids = [...new Set(userIds)]
  if (ids.length === 0) return people
  const rows = await db.all<{ id: string; name: string | null; image: string | null }>(
    `SELECT id, name, image FROM user WHERE id IN (${marks(ids)})`,
    ...ids,
  )
  for (const row of rows) {
    people.set(row.id, { id: row.id, name: row.name ?? "Someone", image: row.image })
  }
  return people
}
