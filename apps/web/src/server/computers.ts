import { getPlatform } from "#platform"
import {
  type ComputerAnswer,
  computerActorName,
  type PairedComputer,
} from "@durable-computer/agent"
import { linkStatus } from "@durable-computer/computers"
import {
  type ComputerRequest,
  type ComputerSummary,
  type ConfirmPairingRequest,
  personalWorkspaceId,
} from "@durable-computer/protocol"
import { fail, json } from "./agents.ts"
import { getAuth, type SessionUser } from "./auth.ts"
import {
  agentsOn,
  type ComputerRow,
  computersOf,
  fits,
  forgetAgent,
  forgetComputer,
  grant,
  isTheirs,
  leftBehind,
  mayRemove,
  misfitsOfAgent,
  misfitsOfComputer,
  peopleById,
  type RequestRow,
  requestsFor,
  ungrant,
} from "./computer-access.ts"
import { agentAccess, roleIn } from "./teams.ts"

const PAIRING_TTL_MS = 10 * 60_000
const MAX_PENDING_PAIRINGS = 200
const MAX_COMPUTERS_PER_USER = 20
/** Letters and digits that are hard to confuse when read off a terminal. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
export const TOKEN_PREFIX = "dcc_"

type PairRow = {
  code: string
  poll_hash: string
  name: string
  platform: string
  hostname: string
  home: string
  read_only: number
  created_at: number
  expires_at: number
  computer_id: string | null
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

function randomToken(bytes = 32): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes))
  return btoa(String.fromCharCode(...raw))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "")
}

function randomCode(): string {
  const raw = crypto.getRandomValues(new Uint8Array(8))
  const letters = [...raw].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("")
  return `${letters.slice(0, 4)}-${letters.slice(4)}`
}

/** A name the agent can say: lowercase letters, digits and hyphens. */
function slug(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/\.local$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
  return cleaned || "computer"
}

const text = (value: unknown, limit: number): string | undefined =>
  typeof value === "string" && value.trim() !== "" && value.length <= limit
    ? value.trim()
    : undefined

/**
 * A daemon asks to be paired. Public: the request does nothing until a signed-in user confirms
 * its code, and the secret that later collects the token is returned only here.
 */
export async function startPairing(request: Request): Promise<Response> {
  await getAuth()
  const { db, config } = getPlatform()
  const input = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const hostname = text(input.hostname, 200)
  const platform = text(input.platform, 40)
  const home = text(input.home, 1000)
  if (hostname === undefined || platform === undefined || home === undefined) {
    return fail(400, "hostname, platform and home are required")
  }
  const now = Date.now()
  await db.run("DELETE FROM dc_pair_requests WHERE expires_at < ?", now)
  const pending = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM dc_pair_requests")
  if ((pending?.n ?? 0) >= MAX_PENDING_PAIRINGS) {
    return fail(429, "Too many computers are waiting to be paired. Try again in a few minutes.")
  }
  const code = randomCode()
  const pollToken = randomToken()
  await db.run(
    `INSERT INTO dc_pair_requests
       (code, poll_hash, name, platform, hostname, home, read_only, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    code,
    await sha256(pollToken),
    slug(text(input.name, 80) ?? hostname),
    platform,
    hostname,
    home,
    input.readOnly === true ? 1 : 0,
    now,
    now + PAIRING_TTL_MS,
  )
  const origin = config.baseUrl ?? new URL(request.url).origin
  return json({
    code,
    pollToken,
    verifyUrl: `${origin}/pair?code=${code}`,
    expiresAt: now + PAIRING_TTL_MS,
  })
}

/** The daemon asks whether its request was confirmed. The token is handed over exactly once. */
export async function pollPairing(request: Request): Promise<Response> {
  await getAuth()
  const { db } = getPlatform()
  const input = (await request.json().catch(() => ({}))) as { pollToken?: unknown }
  if (typeof input.pollToken !== "string") return fail(400, "pollToken is required")
  const row = await db.get<PairRow>(
    "SELECT * FROM dc_pair_requests WHERE poll_hash = ?",
    await sha256(input.pollToken),
  )
  if (row === undefined || row.expires_at < Date.now()) return json({ status: "expired" })
  if (row.computer_id === null) return json({ status: "pending" })
  const token = `${TOKEN_PREFIX}${randomToken()}`
  await db.batch([
    {
      sql: "UPDATE dc_computers SET token_hash = ? WHERE id = ? AND token_hash IS NULL",
      params: [await sha256(token), row.computer_id],
    },
    { sql: "DELETE FROM dc_pair_requests WHERE code = ?", params: [row.code] },
  ])
  const computer = await db.get<ComputerRow>(
    "SELECT * FROM dc_computers WHERE id = ?",
    row.computer_id,
  )
  if (computer === undefined) return json({ status: "expired" })
  return json({ status: "approved", computerId: computer.id, name: computer.name, token })
}

const normalizeCode = (code: string) => code.trim().toUpperCase()

/** What the confirmation page shows before the user agrees. */
export async function getPairing(code: string): Promise<Response> {
  const row = await getPlatform().db.get<PairRow>(
    "SELECT * FROM dc_pair_requests WHERE code = ? AND expires_at >= ? AND computer_id IS NULL",
    normalizeCode(code),
    Date.now(),
  )
  if (row === undefined) return fail(404, "That code is not valid or has expired.")
  return json({
    code: row.code,
    name: row.name,
    platform: row.platform,
    hostname: row.hostname,
    home: row.home,
    readOnly: row.read_only === 1,
  })
}

/** The home directory on a computer, from when it was paired or from what its daemon says. */
async function homeOf(row: ComputerRow): Promise<string | undefined> {
  if (row.home !== null && row.home !== "") return row.home
  const { db, agents, computers } = getPlatform()
  const status = await linkStatus(computers.get(computerActorName(row.id))).catch(() => undefined)
  if (status?.hello?.home) return status.hello.home
  // Paired before this was kept, and its daemon is not here to ask: an agent that has it knows.
  for (const agentId of (await agentsOn(db, [row.id])).get(row.id) ?? []) {
    const response = await agents
      .get(agentId)
      .fetch(new Request("http://agent/computers"))
      .catch(() => undefined)
    if (response?.ok !== true) continue
    const { computers: known } = (await response.json()) as {
      computers: (PairedComputer & { id: string })[]
    }
    const home = known.find((computer) => computer.id === row.id)?.home
    if (home) return home
  }
  return undefined
}

/**
 * Let an agent work on a computer: the agent is told about it, and then the connection is
 * recorded. Resolves with the name the agent knows it by, or with why it could not be done.
 */
async function connect(
  row: ComputerRow,
  agentId: string,
  by: string,
): Promise<{ name: string } | Response> {
  const { db, agents, computers } = getPlatform()
  const home = await homeOf(row)
  if (home === undefined) {
    return fail(
      409,
      "Start the daemon on that computer once, so that its home directory is known, and try again.",
    )
  }
  const status = await linkStatus(computers.get(computerActorName(row.id))).catch(() => undefined)
  // The agent decides the final name, so two computers of one agent never share one.
  const registered = await agents.get(agentId).fetch(
    new Request(`http://agent/computers/${row.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: row.name,
        platform: row.platform,
        hostname: row.hostname,
        home,
        readOnly: status?.hello?.readOnly ?? row.read_only === 1,
        pairedAt: Date.now(),
      } satisfies PairedComputer),
    }),
  )
  if (!registered.ok) return fail(502, "The agent could not be told about the computer.")
  const { name } = (await registered.json()) as PairedComputer
  await grant(db, row.id, agentId, by)
  return { name }
}

/** An agent can no longer work on a computer, and forgets it. */
async function disconnect(computerId: string, agentId: string): Promise<void> {
  const { db, agents } = getPlatform()
  // Access ends with this delete; the rest is tidying up.
  await ungrant(db, computerId, agentId)
  await agents
    .get(agentId)
    .fetch(new Request(`http://agent/computers/${computerId}`, { method: "DELETE" }))
    .catch(() => {})
}

/**
 * A signed-in user takes the computer behind a code: as their own, or for a team of theirs, and
 * connected to whichever agents they name.
 */
export async function confirmPairing(user: SessionUser, request: Request): Promise<Response> {
  const { db } = getPlatform()
  const input = (await request.json().catch(() => ({}))) as Partial<ConfirmPairingRequest> & {
    agentId?: unknown
  }
  if (typeof input.code !== "string") return fail(400, "code is required")
  const workspaceId =
    typeof input.workspaceId === "string" ? input.workspaceId : personalWorkspaceId(user.id)
  if ((await roleIn(db, user.id, workspaceId)) === undefined) return fail(404, "Team not found")
  const agentIds = [
    ...new Set(
      [
        ...(Array.isArray(input.agentIds) ? input.agentIds : []),
        // What a client from before a computer could have several agents sends.
        ...(typeof input.agentId === "string" ? [input.agentId] : []),
      ].filter((id): id is string => typeof id === "string"),
    ),
  ]
  const row = await db.get<PairRow>(
    "SELECT * FROM dc_pair_requests WHERE code = ? AND expires_at >= ? AND computer_id IS NULL",
    normalizeCode(input.code),
    Date.now(),
  )
  if (row === undefined) return fail(404, "That code is not valid or has expired.")
  const id = crypto.randomUUID()
  const now = Date.now()
  const computer: ComputerRow = {
    id,
    owner_id: user.id,
    workspace_id: workspaceId,
    name: row.name,
    platform: row.platform,
    hostname: row.hostname,
    home: row.home,
    read_only: row.read_only,
    token_hash: null,
    created_at: now,
  }
  // Anyone who can use an agent can give it a computer of theirs, a team's agent included.
  for (const agentId of agentIds) {
    const agent = await agentAccess(db, user.id, agentId)
    if (agent === undefined) return fail(404, "Agent not found")
    if (!(await fits(db, computer, agent.workspaceId))) {
      return fail(409, "A team's computer can only be connected to that team's agents.")
    }
  }
  const owned = await db.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM dc_computers WHERE owner_id = ?",
    user.id,
  )
  if ((owned?.n ?? 0) >= MAX_COMPUTERS_PER_USER) {
    return fail(409, `An account can have at most ${MAX_COMPUTERS_PER_USER} computers.`)
  }
  await db.batch([
    {
      sql: `INSERT INTO dc_computers
              (id, owner_id, workspace_id, name, platform, hostname, home, read_only, token_hash,
               created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      params: [
        id,
        user.id,
        workspaceId,
        row.name,
        row.platform,
        row.hostname,
        row.home,
        row.read_only,
        now,
      ],
    },
    { sql: "UPDATE dc_pair_requests SET computer_id = ? WHERE code = ?", params: [id, row.code] },
  ])
  let name = row.name
  for (const agentId of agentIds) {
    const connected = await connect(computer, agentId, user.id)
    // The computer is paired either way; an agent that could not be told can be connected later.
    if (!(connected instanceof Response)) name = connected.name
  }
  return json({ computerId: id, name }, 201)
}

/** The computers in the user's list: their own, and those of the teams they are in. */
export async function listComputers(user: SessionUser): Promise<Response> {
  const { db, computers } = getPlatform()
  const rows = await computersOf(db, user.id)
  const agentIds = await agentsOn(
    db,
    rows.map((row) => row.id),
  )
  const people = await peopleById(
    db,
    rows.map((row) => row.owner_id),
  )
  const summaries = await Promise.all(
    rows.map(async (row): Promise<ComputerSummary> => {
      const status = await linkStatus(computers.get(computerActorName(row.id))).catch(
        () => undefined,
      )
      return {
        id: row.id,
        name: row.name,
        platform: row.platform,
        hostname: row.hostname,
        workspaceId: row.workspace_id,
        pairedBy: people.get(row.owner_id) ?? { id: row.owner_id, name: "Someone", image: null },
        agentIds: agentIds.get(row.id) ?? [],
        canManage: await mayRemove(db, user.id, row),
        createdAt: row.created_at,
        online: status?.online ?? false,
        // What the daemon reports now wins over what it said when it was paired.
        readOnly: status?.hello?.readOnly ?? row.read_only === 1,
        lastSeenAt: status?.lastSeenAt ?? null,
      }
    }),
  )
  return json({ computers: summaries })
}

async function computerOf(user: SessionUser, computerId: string): Promise<ComputerRow | undefined> {
  const { db } = getPlatform()
  const row = await db.get<ComputerRow>("SELECT * FROM dc_computers WHERE id = ?", computerId)
  // Someone it does not belong to is not told that it exists.
  return row !== undefined && (await isTheirs(db, user.id, row)) ? row : undefined
}

/** Remove a computer: whoever paired it can, and so can an admin of the team it belongs to. */
export async function removeComputer(user: SessionUser, computerId: string): Promise<Response> {
  const row = await computerOf(user, computerId)
  if (row === undefined) return fail(404, "Computer not found")
  if (!(await mayRemove(getPlatform().db, user.id, row))) {
    return fail(403, "Only whoever paired it, or an admin of the team, can remove it.")
  }
  await revokeComputer(row)
  return json({ ok: true })
}

/**
 * Change whose a computer is: its pairer's own, or a team of theirs. Only whoever paired it can,
 * since it is their account there that the agents act as. Agents it can no longer serve lose it.
 */
export async function moveComputer(
  user: SessionUser,
  computerId: string,
  request: Request,
): Promise<Response> {
  const { db } = getPlatform()
  const row = await computerOf(user, computerId)
  if (row === undefined) return fail(404, "Computer not found")
  const input = (await request.json().catch(() => ({}))) as { workspaceId?: unknown }
  if (typeof input.workspaceId !== "string") return fail(400, "Say whose it should be.")
  if (row.owner_id !== user.id) return fail(403, "Only whoever paired it can change whose it is.")
  if ((await roleIn(db, user.id, input.workspaceId)) === undefined) {
    return fail(404, "Team not found")
  }
  await db.run("UPDATE dc_computers SET workspace_id = ? WHERE id = ?", input.workspaceId, row.id)
  for (const gone of await misfitsOfComputer(db, row.id)) {
    await disconnect(gone.computerId, gone.agentId)
  }
  return json({ ok: true })
}

/** Connect an agent to a computer. Anyone the computer belongs to can, for an agent they can use. */
export async function connectAgent(
  user: SessionUser,
  computerId: string,
  agentId: string,
): Promise<Response> {
  const { db } = getPlatform()
  const row = await computerOf(user, computerId)
  if (row === undefined) return fail(404, "Computer not found")
  const agent = await agentAccess(db, user.id, agentId)
  if (agent === undefined) return fail(404, "Agent not found")
  if (!(await fits(db, row, agent.workspaceId))) {
    return fail(409, "A team's computer can only be connected to that team's agents.")
  }
  const connected = await connect(row, agent.id, user.id)
  return connected instanceof Response ? connected : json(connected)
}

/** Take a computer away from an agent. Anyone the computer belongs to can. */
export async function disconnectAgent(
  user: SessionUser,
  computerId: string,
  agentId: string,
): Promise<Response> {
  const row = await computerOf(user, computerId)
  if (row === undefined) return fail(404, "Computer not found")
  await disconnect(row.id, agentId)
  return json({ ok: true })
}

/** What the user's agents are waiting to hear about computers they asked for. */
export async function listComputerRequests(user: SessionUser): Promise<Response> {
  const { db } = getPlatform()
  const waiting = await requestsFor(db, user.id)
  const people = await peopleById(
    db,
    waiting.map(({ computer }) => computer.owner_id),
  )
  const requests: ComputerRequest[] = []
  for (const { request, computer } of waiting) {
    requests.push({
      id: request.id,
      computer: {
        id: computer.id,
        name: computer.name,
        workspaceId: computer.workspace_id,
        readOnly: computer.read_only === 1,
        pairedBy: people.get(computer.owner_id) ?? {
          id: computer.owner_id,
          name: "Someone",
          image: null,
        },
      },
      agentId: request.agent_id,
      chatId: request.chat_id,
      reason: request.reason,
      canAnswer: await isTheirs(db, user.id, computer),
      createdAt: request.created_at,
    })
  }
  return json({ requests })
}

/**
 * Answer an agent that asked for a computer: connect it, or say no. Anyone the computer belongs
 * to can answer. Either way the agent is told, in the chat it asked from.
 */
export async function answerComputerRequest(
  user: SessionUser,
  requestId: string,
  request: Request,
): Promise<Response> {
  const { db, agents } = getPlatform()
  const input = (await request.json().catch(() => ({}))) as { approve?: unknown }
  if (typeof input.approve !== "boolean") return fail(400, "Say whether to approve it.")
  const asked = await db.get<RequestRow>(
    "SELECT * FROM dc_computer_requests WHERE id = ?",
    requestId,
  )
  const row = asked === undefined ? undefined : await computerOf(user, asked.computer_id)
  if (asked === undefined || row === undefined) return fail(404, "That request is gone.")
  const agent = await db.get<{ owner_id: string; workspace_id: string | null }>(
    "SELECT owner_id, workspace_id FROM dc_agents WHERE id = ?",
    asked.agent_id,
  )
  let name = row.name
  if (input.approve) {
    if (
      agent === undefined ||
      !(await fits(db, row, agent.workspace_id ?? personalWorkspaceId(agent.owner_id)))
    ) {
      await db.run("DELETE FROM dc_computer_requests WHERE id = ?", asked.id)
      return fail(409, "That agent can no longer be connected to this computer.")
    }
    const connected = await connect(row, asked.agent_id, user.id)
    if (connected instanceof Response) return connected
    name = connected.name
  }
  await db.run("DELETE FROM dc_computer_requests WHERE id = ?", asked.id)
  await agents
    .get(asked.agent_id)
    .fetch(
      new Request(`http://agent/computers/${row.id}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId: asked.id,
          chatId: asked.chat_id,
          approved: input.approve,
          by: user.name,
          name,
        } satisfies ComputerAnswer),
      }),
    )
    .catch(() => {})
  return json({ ok: true })
}

/** An agent is being deleted: nothing is connected to it or asked for by it any more. */
export async function forgetComputersOf(agentId: string): Promise<void> {
  await forgetAgent(getPlatform().db, agentId)
}

/**
 * Someone is no longer in a team. The computers they paired for it are removed, since those run
 * as them, and their own computers stop serving its agents.
 */
export async function removeComputersOfMember(userId: string, workspaceId: string): Promise<void> {
  const left = await leftBehind(getPlatform().db, userId, workspaceId)
  for (const row of left.computers) await revokeComputer(row)
  for (const gone of left.grants) await disconnect(gone.computerId, gone.agentId)
}

/**
 * An agent was moved to another workspace. The computers that cannot serve it there stop doing
 * so: another team's, and those of people who are not in the workspace it is in now. They agreed
 * to serve the people it was shared with then.
 */
export async function removeMisfitComputersOf(agentId: string): Promise<void> {
  for (const gone of await misfitsOfAgent(getPlatform().db, agentId)) {
    await disconnect(gone.computerId, gone.agentId)
  }
}

/** A team is gone, and so are the computers that were paired for it. */
export async function removeComputersOfWorkspace(workspaceId: string): Promise<void> {
  const rows = await getPlatform().db.all<ComputerRow>(
    "SELECT * FROM dc_computers WHERE workspace_id = ?",
    workspaceId,
  )
  for (const row of rows) await revokeComputer(row)
}

/** Its token stops working, its daemon is disconnected, the agents that had it forget it. */
async function revokeComputer(row: ComputerRow): Promise<void> {
  const { db, agents, computers } = getPlatform()
  const agentIds = (await agentsOn(db, [row.id])).get(row.id) ?? []
  // Access ends with this delete; the rest is tidying up.
  await forgetComputer(db, row.id)
  await computers
    .get(computerActorName(row.id))
    .fetch(new Request("http://computer/revoke", { method: "POST" }))
    .catch(() => {})
  for (const agentId of agentIds) {
    await agents
      .get(agentId)
      .fetch(new Request(`http://agent/computers/${row.id}`, { method: "DELETE" }))
      .catch(() => {})
  }
}

/** The computer a daemon's bearer token belongs to, or undefined. */
export async function authenticateDaemon(request: Request): Promise<string | undefined> {
  const header = request.headers.get("authorization") ?? ""
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : ""
  if (!token.startsWith(TOKEN_PREFIX)) return undefined
  await getAuth()
  const row = await getPlatform().db.get<{ id: string }>(
    "SELECT id FROM dc_computers WHERE token_hash = ?",
    await sha256(token),
  )
  return row?.id
}

export const CONNECT_PATH = "/api/computers/connect"
export { computerActorName }
