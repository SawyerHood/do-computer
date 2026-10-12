import type { AgentComputer } from "@do-computer/agent"
import {
  isPersonalWorkspace,
  PAIRED_COMPUTER,
  type Person,
  personalWorkspaceId,
} from "@do-computer/protocol"
import type { AppDatabase } from "@do-computer/runtime"
import { roleIn, workspaceIdsOf } from "./teams.ts"

/**
 * Whose a computer is, which agents can work on it, and who is asked when an agent wants one,
 * as rows in the app database. Like teams, nothing here knows about requests or the platform,
 * so that who may do what can be tested against a database alone.
 *
 * A computer is one somebody paired, or a machine the app made for a workspace. Either belongs
 * to a workspace: the own one of whoever paired or added it, or a team's. Someone's own computer
 * can be connected to any agent they can use, in any workspace; a team's computer to the team's
 * agents. The people a computer belongs to are the ones who connect it and who answer when an
 * agent asks for it: its owner, or everyone in its team.
 *
 * An agent has no computer of its own. A machine is `open` to every agent of its workspace, or
 * for the agents `chosen` for it; a paired computer is always for the agents chosen.
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
  /** `paired`, or the kind of machine it is. */
  kind: string
  /** What a machine is named after at its provider. Null on a paired computer. */
  machine_key: string | null
  /** `open` or `chosen`. Only a machine is ever open. */
  access: string
  /** The agent that added it, where one did. Null or absent where a person did. */
  added_by_agent?: string | null
}

/** Whether a computer is a machine the app made, as opposed to one somebody paired. */
export const isMachine = (computer: Pick<ComputerRow, "kind">) => computer.kind !== PAIRED_COMPUTER

/** Whether a computer serves every agent of a workspace without being connected to each. */
const openTo = (computer: ComputerRow, agentWorkspaceId: string) =>
  isMachine(computer) && computer.access === "open" && computer.workspace_id === agentWorkspaceId

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

/** Which agents were connected to each of some computers, one by one. */
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

/**
 * Which agents can work on each of some computers, whichever way they came to: every agent of
 * the workspace on an open machine, and otherwise the ones connected to it.
 */
export async function agentsUsing(
  db: AppDatabase,
  computers: readonly ComputerRow[],
): Promise<Map<string, string[]>> {
  const chosen = await agentsOn(
    db,
    computers.map((computer) => computer.id),
  )
  const inWorkspace = new Map<string, string[]>()
  for (const computer of computers) {
    if (!isMachine(computer) || computer.access !== "open") continue
    if (!inWorkspace.has(computer.workspace_id)) {
      const rows = await db.all<{ id: string }>(
        "SELECT id FROM dc_agents WHERE workspace_id = ? ORDER BY created_at",
        computer.workspace_id,
      )
      inWorkspace.set(
        computer.workspace_id,
        rows.map((row) => row.id),
      )
    }
    chosen.set(computer.id, inWorkspace.get(computer.workspace_id)!)
  }
  return chosen
}

/** The computers an agent can work on right now: the ones it is connected to, and the open machines of its workspace. */
export async function computersOfAgent(db: AppDatabase, agentId: string): Promise<ComputerRow[]> {
  const workspaceId = await workspaceOfAgent(db, agentId)
  if (workspaceId === undefined) return []
  const rows = await db.all<ComputerRow>(
    `SELECT * FROM dc_computers
      WHERE id IN (SELECT computer_id FROM dc_computer_grants WHERE agent_id = ?)
         OR (workspace_id = ? AND access = 'open' AND kind != ?)
      ORDER BY created_at`,
    agentId,
    workspaceId,
    PAIRED_COMPUTER,
  )
  const usable: ComputerRow[] = []
  for (const row of rows) {
    if (openTo(row, workspaceId) || (await fits(db, row, workspaceId))) usable.push(row)
  }
  return usable
}

/** The ids of the computers an agent can work on. */
export async function computerIdsOfAgent(db: AppDatabase, agentId: string): Promise<string[]> {
  return (await computersOfAgent(db, agentId)).map((row) => row.id)
}

/** The folder each agent has to itself on each of some machines. */
export async function foldersOn(
  db: AppDatabase,
  computerIds: readonly string[],
): Promise<Map<string, { agentId: string; path: string }[]>> {
  const byComputer = new Map<string, { agentId: string; path: string }[]>()
  if (computerIds.length === 0) return byComputer
  const rows = await db.all<{ computer_id: string; agent_id: string; path: string }>(
    `SELECT computer_id, agent_id, path FROM dc_computer_folders
      WHERE computer_id IN (${marks(computerIds)}) ORDER BY created_at`,
    ...computerIds,
  )
  for (const row of rows) {
    byComputer.set(row.computer_id, [
      ...(byComputer.get(row.computer_id) ?? []),
      { agentId: row.agent_id, path: row.path },
    ])
  }
  return byComputer
}

/** A folder's name: lowercase letters, digits and hyphens, from whatever the agent is called. */
const folderName = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)

/** Names under a machine's home directory that are not an agent's to have: the library's folder. */
const RESERVED_FOLDERS = new Set(["library"])

/**
 * The folder an agent has to itself on a machine. The first time it is asked for it is named
 * after what the agent is called then, under the machine's home directory, and it is the same
 * ever after: a folder full of work is not renamed because its agent was.
 */
export async function folderFor(
  db: AppDatabase,
  computer: ComputerRow,
  agentId: string,
  agentName: string | null,
  now = Date.now(),
): Promise<string> {
  const kept = () =>
    db.get<{ path: string }>(
      "SELECT path FROM dc_computer_folders WHERE computer_id = ? AND agent_id = ?",
      computer.id,
      agentId,
    )
  const existing = await kept()
  if (existing !== undefined) return existing.path
  const home = (computer.home ?? "").replace(/\/+$/, "")
  const taken = new Set(
    (
      await db.all<{ path: string }>(
        "SELECT path FROM dc_computer_folders WHERE computer_id = ?",
        computer.id,
      )
    ).map((row) => row.path),
  )
  const wanted = folderName(agentName ?? "") || `agent-${folderName(agentId).slice(0, 8)}`
  let name = wanted
  for (let suffix = 2; RESERVED_FOLDERS.has(name) || taken.has(`${home}/${name}`); suffix++) {
    name = `${wanted}-${suffix}`
  }
  await db.run(
    `INSERT INTO dc_computer_folders (computer_id, agent_id, path, created_at)
     VALUES (?, ?, ?, ?) ON CONFLICT (computer_id, agent_id) DO NOTHING`,
    computer.id,
    agentId,
    `${home}/${name}`,
    now,
  )
  // Whichever of two that asked at once got there first is the one that is kept.
  return (await kept())?.path ?? `${home}/${name}`
}

/**
 * The machines an agent can work on right now, as the agent is told of them: each with the
 * agent's own folder there if it has one yet, and the other agents' folders.
 */
export async function machinesOf(
  db: AppDatabase,
  agentId: string,
): Promise<(AgentComputer & { id: string })[]> {
  const rows = (await computersOfAgent(db, agentId)).filter(isMachine)
  const folders = await foldersOn(
    db,
    rows.map((row) => row.id),
  )
  return rows.map((row) => {
    const there = folders.get(row.id) ?? []
    const mine = there.find((folder) => folder.agentId === agentId)?.path
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      machineKey: row.machine_key ?? row.id,
      platform: row.platform,
      hostname: row.hostname,
      // Empty for a kind only the agent can say the home directory of: it fills it in.
      home: row.home ?? "",
      ...(mine === undefined ? {} : { folder: mine }),
      neighbors: there.filter((folder) => folder.agentId !== agentId).map((folder) => folder.path),
      readOnly: false,
      pairedAt: row.created_at,
    }
  })
}

/**
 * The machines that only one agent can use: the ones chosen for it and for nobody else. These
 * are what goes with an agent when it is deleted or moved, since nothing else has a use for them.
 */
export async function machinesOnlyOf(db: AppDatabase, agentId: string): Promise<ComputerRow[]> {
  return db.all<ComputerRow>(
    `SELECT c.* FROM dc_computers c
      WHERE c.kind != ? AND c.access = 'chosen'
        AND EXISTS (SELECT 1 FROM dc_computer_grants g
                     WHERE g.computer_id = c.id AND g.agent_id = ?)
        AND NOT EXISTS (SELECT 1 FROM dc_computer_grants g
                         WHERE g.computer_id = c.id AND g.agent_id != ?)
      ORDER BY c.created_at`,
    PAIRED_COMPUTER,
    agentId,
    agentId,
  )
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
 * Whether an agent may work on a computer right now: it is an open machine of the agent's
 * workspace, or the agent was connected to it and could still be today. Asked before every use,
 * so that access ends when the connection does, and does not rest on the agent having been told.
 */
export async function mayUse(
  db: AppDatabase,
  agentId: string,
  computerId: string,
): Promise<boolean> {
  const computer = await db.get<ComputerRow>("SELECT * FROM dc_computers WHERE id = ?", computerId)
  const workspaceId = await workspaceOfAgent(db, agentId)
  if (computer === undefined || workspaceId === undefined) return false
  if (openTo(computer, workspaceId)) return true
  const granted = await db.get<{ agent_id: string }>(
    "SELECT agent_id FROM dc_computer_grants WHERE computer_id = ? AND agent_id = ?",
    computerId,
    agentId,
  )
  return granted !== undefined && fits(db, computer, workspaceId)
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
    { sql: "DELETE FROM dc_computer_folders WHERE computer_id = ?", params: [computerId] },
  ])
}

/** Forget which computers an agent could work on and what it had asked for: it is gone. */
export async function forgetAgent(db: AppDatabase, agentId: string): Promise<void> {
  await db.batch([
    { sql: "DELETE FROM dc_computer_grants WHERE agent_id = ?", params: [agentId] },
    { sql: "DELETE FROM dc_computer_requests WHERE agent_id = ?", params: [agentId] },
    { sql: "DELETE FROM dc_computer_folders WHERE agent_id = ?", params: [agentId] },
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
  // A machine they added for the team does not run as them, and stays.
  const computers = await db.all<ComputerRow>(
    "SELECT * FROM dc_computers WHERE workspace_id = ? AND owner_id = ? AND kind = ?",
    workspaceId,
    userId,
    PAIRED_COMPUTER,
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
