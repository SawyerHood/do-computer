import { getPlatform } from "#platform"
import {
  type AddableKind,
  type AgentComputer,
  type ComputerAnswer,
  computerActorName,
} from "@durable-computer/agent"
import { linkStatus } from "@durable-computer/computers"
import {
  type AddComputerRequest,
  type ComputerRequest,
  type ComputerSummary,
  type ConfirmPairingRequest,
  PAIRED_COMPUTER,
  personalWorkspaceId,
} from "@durable-computer/protocol"
import { fail, json } from "./agents.ts"
import { getAuth, type SessionUser } from "./auth.ts"
import { servedDaemon } from "./daemon-version.ts"
import {
  agentsOn,
  agentsUsing,
  askersOf,
  type ComputerRow,
  computersOf,
  fits,
  foldersOn,
  forgetAgent,
  forgetComputer,
  grant,
  isGranted,
  isMachine,
  isTheirs,
  leftBehind,
  machinesOf,
  machinesOnlyOf,
  mayRemove,
  mayUse,
  type Misfits,
  misfitsOfAgent,
  misfitsOfComputer,
  peopleById,
  type RequestRow,
  requestsFor,
  ungrant,
} from "./computer-access.ts"
import { UNSHARED_KINDS } from "./sandbox.ts"
import { defaultComputerFor, deploymentComputers } from "./settings.ts"
import { agentAccess, roleIn } from "./teams.ts"

const PAIRING_TTL_MS = 10 * 60_000
const MAX_PENDING_PAIRINGS = 200
const MAX_COMPUTERS_PER_USER = 20
/** How many machines a workspace can have. Each costs something to keep, even when idle. */
const MAX_MACHINES_PER_WORKSPACE = 10
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
      computers: (AgentComputer & { id: string })[]
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
  if (isMachine(row)) {
    // The record first: what the agent is told is every machine the record says it can use.
    await grant(db, row.id, agentId, by)
    if (!(await mayUse(db, agentId, row.id))) {
      await ungrant(db, row.id, agentId)
      return fail(409, "That agent can no longer be connected to this computer.")
    }
    const told = await tellMachines(agentId)
    return { name: told?.find((machine) => machine.id === row.id)?.name ?? row.name }
  }
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
      } satisfies AgentComputer),
    }),
  )
  if (!registered.ok) return fail(502, "The agent could not be told about the computer.")
  const { name } = (await registered.json()) as AgentComputer
  await grant(db, row.id, agentId, by)
  // Telling the agent took a while. If in the meantime it was moved, the computer changed
  // hands or its owner left, whatever tidied up after that did not see this connection.
  if (!(await mayUse(db, agentId, row.id))) {
    await disconnect(row.id, agentId)
    return fail(409, "That agent can no longer be connected to this computer.")
  }
  return { name }
}

/** Have an agent forget a computer: one it had, or one it had asked for. */
async function tellGone(computerId: string, agentId: string): Promise<void> {
  await getPlatform()
    .agents.get(agentId)
    .fetch(new Request(`http://agent/computers/${computerId}`, { method: "DELETE" }))
    .catch(() => {})
}

/** An agent can no longer work on a computer, and forgets it. */
async function disconnect(computerId: string, agentId: string): Promise<void> {
  // Access ends with this delete, since the agent's host looks here before each use. Telling
  // the agent is so that it knows.
  await ungrant(getPlatform().db, computerId, agentId)
  await tellGone(computerId, agentId)
}

/**
 * Tell an agent which machines it can use, all of them, as the record has it. What the agent
 * knows is only ever what it was last told, and the record is asked before every use, so one
 * that could not be told catches up the next time it looks. Resolves with what the agent calls
 * them, or undefined where it could not be told.
 */
export async function tellMachines(
  agentId: string,
): Promise<(AgentComputer & { id: string })[] | undefined> {
  const { db, agents } = getPlatform()
  const response = await agents
    .get(agentId)
    .fetch(
      new Request("http://agent/computers", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ machines: await machinesOf(db, agentId) }),
      }),
    )
    .catch(() => undefined)
  if (response?.ok !== true) return undefined
  return ((await response.json()) as { computers: (AgentComputer & { id: string })[] }).computers
}

/** Tell every agent of a workspace which machines it can use: one was added, removed or changed. */
export async function tellWorkspace(workspaceId: string): Promise<void> {
  const rows = await getPlatform().db.all<{ id: string }>(
    "SELECT id FROM dc_agents WHERE workspace_id = ?",
    workspaceId,
  )
  await Promise.all(rows.map((row) => tellMachines(row.id)))
}

/** Whether a machine can serve more than one agent. One whose files are with an agent cannot. */
const shareable = (row: Pick<ComputerRow, "kind">) =>
  isMachine(row) && !UNSHARED_KINDS.includes(row.kind)

/** A name in a workspace that no other computer of it has: `wanted`, or that with a number. */
async function freeName(workspaceId: string, wanted: string): Promise<string> {
  const taken = new Set(
    (
      await getPlatform().db.all<{ name: string }>(
        "SELECT name FROM dc_computers WHERE workspace_id = ?",
        workspaceId,
      )
    ).map((row) => row.name.toLowerCase()),
  )
  let name = wanted
  for (let suffix = 2; taken.has(name.toLowerCase()); suffix++) name = `${wanted}-${suffix}`
  return name
}

/** Record a machine for a workspace. Nothing is made at a provider until something runs on it. */
async function insertMachine(input: {
  workspaceId: string
  by: string
  kind: string
  name: string
  /** What its files are kept under: itself, or the one agent a kind that is not shared is for. */
  key?: string
  access: "open" | "chosen"
  /** The agent that is adding it, where one is. */
  agentId?: string
}): Promise<ComputerRow> {
  const { db, machines } = getPlatform()
  const id = crypto.randomUUID()
  const key = input.key ?? id
  // Null for a kind only its agent can say the home directory of.
  const home = machines.create(input.kind, key)?.home ?? null
  await db.run(
    `INSERT INTO dc_computers
       (id, owner_id, workspace_id, name, platform, hostname, home, read_only, token_hash,
        created_at, kind, machine_key, access, added_by_agent)
     VALUES (?, ?, ?, ?, 'linux', '', ?, 0, NULL, ?, ?, ?, ?, ?)`,
    id,
    input.by,
    input.workspaceId,
    await freeName(input.workspaceId, input.name),
    home,
    Date.now(),
    input.kind,
    key,
    input.access,
    input.agentId ?? null,
  )
  return (await db.get<ComputerRow>("SELECT * FROM dc_computers WHERE id = ?", id))!
}

/** The kinds of machine that can be added to a workspace: every kind that agents can share. */
export function addableKinds(): AddableKind[] {
  return deploymentComputers().kinds.filter(
    (kind) => kind.id !== "none" && !UNSHARED_KINDS.includes(kind.id),
  )
}

/** The workspace an agent is in, and who made it. */
async function placeOf(
  agentId: string,
): Promise<{ workspaceId: string; ownerId: string } | undefined> {
  const row = await getPlatform().db.get<{ owner_id: string; workspace_id: string | null }>(
    "SELECT owner_id, workspace_id FROM dc_agents WHERE id = ?",
    agentId,
  )
  return row === undefined
    ? undefined
    : { workspaceId: row.workspace_id ?? personalWorkspaceId(row.owner_id), ownerId: row.owner_id }
}

/**
 * An agent adds a machine to its workspace, as someone in it could from the app, within the
 * same limits. `by` is who it was working for: the machine is theirs, where they are still in
 * the workspace, and otherwise whoever made the agent's. Resolves with the machine, or with why
 * it could not be added, in words for the agent.
 */
export async function addMachineFor(
  agentId: string,
  input: { kind?: string; name?: string; by?: string },
): Promise<{ id: string; name: string; kind: string } | { error: string }> {
  const { db } = getPlatform()
  const place = await placeOf(agentId)
  if (place === undefined) return { error: "This agent is not in a workspace any more." }
  const { workspaceId } = place
  const by =
    input.by !== undefined && (await roleIn(db, input.by, workspaceId)) !== undefined
      ? input.by
      : place.ownerId
  const kinds = addableKinds()
  if (kinds.length === 0) {
    return { error: "This deployment has no kind of machine that can be added." }
  }
  const usual = await defaultComputerFor(by)
  const kind = input.kind ?? (kinds.some((offered) => offered.id === usual) ? usual : kinds[0]!.id)
  if (!kinds.some((offered) => offered.id === kind)) {
    return {
      error: `There is no kind of machine "${kind}" to add. The kinds are: ${kinds.map((offered) => offered.id).join(", ")}.`,
    }
  }
  const count = await db.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM dc_computers WHERE workspace_id = ? AND kind != ?",
    workspaceId,
    PAIRED_COMPUTER,
  )
  if ((count?.n ?? 0) >= MAX_MACHINES_PER_WORKSPACE) {
    return {
      error: `The workspace already has ${MAX_MACHINES_PER_WORKSPACE} machines, which is the most it can have. One has to be removed first.`,
    }
  }
  const row = await insertMachine({
    workspaceId,
    by,
    kind,
    name: slug(text(input.name, 60) ?? "computer"),
    access: "open",
    agentId,
  })
  await tellWorkspace(workspaceId)
  return { id: row.id, name: row.name, kind: row.kind }
}

/**
 * An agent deletes a machine it added, with everything on it. Only one it added: the rest are
 * for the people they belong to. As from the app, it is forgotten only once it is gone at its
 * provider.
 */
export async function removeMachineFor(
  agentId: string,
  computerId: string,
): Promise<{ ok: true } | { error: string }> {
  const { db } = getPlatform()
  const place = await placeOf(agentId)
  const row = await db.get<ComputerRow>("SELECT * FROM dc_computers WHERE id = ?", computerId)
  if (place === undefined || row === undefined || row.workspace_id !== place.workspaceId) {
    return { error: "There is no such machine in your workspace." }
  }
  if (!isMachine(row) || !shareable(row) || row.added_by_agent !== agentId) {
    return {
      error: `You can only remove a machine you added, and "${row.name}" is not one. Whoever it belongs to can remove it from Computers, in the workspace settings of the app.`,
    }
  }
  const problem = await destroyMachine(row)
  if (problem !== undefined) {
    return { error: `The machine could not be deleted, so it was kept: ${problem}` }
  }
  await revokeComputer(row)
  await tellWorkspace(row.workspace_id)
  return { ok: true }
}

/**
 * See that a new agent has somewhere to work. If its workspace has no machine it could use, one
 * is added, of the kind its maker chose as their default: open to the workspace, so that the
 * agents made after it share it. A kind whose files are with one agent is added for this agent
 * alone, and the kind that means no computer adds nothing. Then the agent is told what it has.
 */
export async function provideFor(agentId: string, workspaceId: string, by: string): Promise<void> {
  const { db } = getPlatform()
  const kind = await defaultComputerFor(by)
  if (UNSHARED_KINDS.includes(kind)) {
    const row = await insertMachine({
      workspaceId,
      by,
      kind,
      name: "computer",
      key: agentId,
      access: "chosen",
    })
    await grant(db, row.id, agentId, by)
  } else if (kind !== "none" && (await machinesOf(db, agentId)).length === 0) {
    const count = await db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM dc_computers WHERE workspace_id = ? AND kind != ?",
      workspaceId,
      PAIRED_COMPUTER,
    )
    if ((count?.n ?? 0) < MAX_MACHINES_PER_WORKSPACE) {
      await insertMachine({ workspaceId, by, kind, name: "computer", access: "open" })
    }
  }
  await tellMachines(agentId)
}

/** Add a machine to a workspace, for its agents to share. Anyone in the workspace can. */
export async function addComputer(user: SessionUser, request: Request): Promise<Response> {
  const { db } = getPlatform()
  const input = (await request.json().catch(() => ({}))) as Partial<AddComputerRequest>
  const workspaceId =
    typeof input.workspaceId === "string" ? input.workspaceId : personalWorkspaceId(user.id)
  if ((await roleIn(db, user.id, workspaceId)) === undefined) return fail(404, "Team not found")
  const kind = input.kind
  if (
    typeof kind !== "string" ||
    kind === "none" ||
    UNSHARED_KINDS.includes(kind) ||
    !deploymentComputers().kinds.some((offered) => offered.id === kind)
  ) {
    return fail(400, "This deployment has no machine of that kind to add.")
  }
  const count = await db.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM dc_computers WHERE workspace_id = ? AND kind != ?",
    workspaceId,
    PAIRED_COMPUTER,
  )
  if ((count?.n ?? 0) >= MAX_MACHINES_PER_WORKSPACE) {
    return fail(409, `A workspace can have at most ${MAX_MACHINES_PER_WORKSPACE} machines.`)
  }
  const row = await insertMachine({
    workspaceId,
    by: user.id,
    kind,
    name: slug(text(input.name, 60) ?? "computer"),
    access: "open",
  })
  await tellWorkspace(workspaceId)
  return json({ computerId: row.id, name: row.name }, 201)
}

/**
 * Say who can use a machine: every agent of its workspace, or the agents chosen for it. Closing
 * one keeps the agents that had it, so that nothing they are doing stops; from then on they are
 * disconnected one by one. Anyone the machine belongs to can.
 */
async function setAccess(row: ComputerRow, access: unknown, by: string): Promise<Response> {
  const { db } = getPlatform()
  if (access !== "open" && access !== "chosen") return fail(400, "Say who can use it.")
  if (!shareable(row)) {
    return fail(409, "Only a machine that agents can share can be opened to a workspace.")
  }
  if (access === row.access) return json({ ok: true })
  if (access === "chosen") {
    const using = (await agentsUsing(db, [row])).get(row.id) ?? []
    for (const agentId of using) await grant(db, row.id, agentId, by)
  }
  await db.run("UPDATE dc_computers SET access = ? WHERE id = ?", access, row.id)
  // Open to all, nobody is on it for having been chosen.
  if (access === "open") {
    await db.run("DELETE FROM dc_computer_grants WHERE computer_id = ?", row.id)
  }
  await tellWorkspace(row.workspace_id)
  return json({ ok: true })
}

/**
 * Delete a machine at its provider, with everything on it. Resolves with why it could not be
 * done, or undefined once it is gone. A kind whose files are with an agent has nothing here to
 * delete: they go with the agent.
 */
async function destroyMachine(row: ComputerRow): Promise<string | undefined> {
  try {
    await getPlatform()
      .machines.create(row.kind, row.machine_key ?? row.id)
      ?.destroy?.()
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** End the connections that no longer hold, and tell the agents whose requests were dropped. */
async function end(gone: Misfits): Promise<void> {
  for (const grant of gone.grants) await disconnect(grant.computerId, grant.agentId)
  for (const request of gone.requests) await tellGone(request.computerId, request.agentId)
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
    kind: PAIRED_COMPUTER,
    machine_key: null,
    access: "chosen",
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
  const agentIds = await agentsUsing(db, rows)
  const folders = await foldersOn(
    db,
    rows.map((row) => row.id),
  )
  const people = await peopleById(
    db,
    rows.map((row) => row.owner_id),
  )
  const served = await servedDaemon()
  const summaries = await Promise.all(
    rows.map(async (row): Promise<ComputerSummary> => {
      // A machine has no daemon to be away: it starts when something runs on it.
      const status = isMachine(row)
        ? { online: true, hello: null, lastSeenAt: null }
        : await linkStatus(computers.get(computerActorName(row.id))).catch(() => undefined)
      const hello = status?.hello ?? null
      const daemon =
        hello === null
          ? undefined
          : hello.version === served
            ? ("current" as const)
            : hello.updates === true
              ? ("updating" as const)
              : ("outdated" as const)
      // Someone is looking at a daemon that is behind and can catch up, so it is told to.
      if (daemon === "updating" && status?.online === true) {
        await computers
          .get(computerActorName(row.id))
          .fetch(new Request("http://computer/update", { method: "POST" }))
          .catch(() => undefined)
      }
      return {
        id: row.id,
        name: row.name,
        kind: row.kind,
        platform: row.platform,
        hostname: row.hostname,
        workspaceId: row.workspace_id,
        pairedBy: people.get(row.owner_id) ?? { id: row.owner_id, name: "Someone", image: null },
        access: isMachine(row) && row.access === "open" ? "open" : "chosen",
        shareable: shareable(row),
        agentIds: agentIds.get(row.id) ?? [],
        folders: folders.get(row.id) ?? [],
        canManage: await mayRemove(db, user.id, row),
        createdAt: row.created_at,
        online: status?.online ?? false,
        // What the daemon reports now wins over what it said when it was paired.
        readOnly: status?.hello?.readOnly ?? row.read_only === 1,
        lastSeenAt: status?.lastSeenAt ?? null,
        ...(daemon === undefined ? {} : { daemon }),
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

/**
 * Remove a computer: whoever paired or added it can, and so can an admin of the team it belongs
 * to. A machine is deleted at its provider, with everything on it, and is only forgotten here
 * once that has worked: otherwise it would go on costing money where nobody can find it.
 */
export async function removeComputer(user: SessionUser, computerId: string): Promise<Response> {
  const row = await computerOf(user, computerId)
  if (row === undefined) return fail(404, "Computer not found")
  if (!(await mayRemove(getPlatform().db, user.id, row))) {
    return fail(403, "Only whoever added it, or an admin of the team, can remove it.")
  }
  if (isMachine(row) && !shareable(row)) {
    return fail(409, "This one is part of its agent, and goes when the agent is deleted.")
  }
  if (isMachine(row)) {
    const problem = await destroyMachine(row)
    if (problem !== undefined) {
      return fail(502, `The machine could not be deleted, so it was kept: ${problem}`)
    }
  }
  await revokeComputer(row)
  return json({ ok: true })
}

/**
 * Change something about a computer: who can use a machine (`access`), or whose a paired
 * computer is (`workspaceId`).
 */
export async function patchComputer(
  user: SessionUser,
  computerId: string,
  request: Request,
): Promise<Response> {
  const { db } = getPlatform()
  const row = await computerOf(user, computerId)
  if (row === undefined) return fail(404, "Computer not found")
  const input = (await request.json().catch(() => ({}))) as {
    workspaceId?: unknown
    access?: unknown
  }
  if (input.access !== undefined) return setAccess(row, input.access, user.id)
  // Whose a computer is: its pairer's own, or a team of theirs. Only whoever paired it can say,
  // since it is their account there that the agents act as. Agents it can no longer serve lose it.
  if (typeof input.workspaceId !== "string") return fail(400, "Say whose it should be.")
  if (isMachine(row)) return fail(409, "A machine stays with the workspace it was added to.")
  if (row.owner_id !== user.id) return fail(403, "Only whoever paired it can change whose it is.")
  if ((await roleIn(db, user.id, input.workspaceId)) === undefined) {
    return fail(404, "Team not found")
  }
  await db.run("UPDATE dc_computers SET workspace_id = ? WHERE id = ?", input.workspaceId, row.id)
  await end(await misfitsOfComputer(db, row.id))
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
  if (isMachine(row) && !shareable(row) && row.machine_key !== agent.id) {
    return fail(409, "This one is part of another agent and cannot be shared.")
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
  // Only an agent that has it: this must not reach an agent that has nothing to do with it.
  if (!(await isGranted(getPlatform().db, row.id, agentId))) return json({ ok: true })
  if (isMachine(row)) {
    await ungrant(getPlatform().db, row.id, agentId)
    await tellMachines(agentId)
  } else await disconnect(row.id, agentId)
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
      await tellGone(row.id, asked.agent_id)
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
 * An agent is being deleted. The machines that only it could use go with it, unless they are to
 * be kept: each is deleted at its provider first, and if one cannot be, nothing has been
 * forgotten yet and that is the answer. Resolves with the ones to forget once the agent is gone.
 * A machine whose files are with the agent always goes, since the agent takes them with it.
 */
export async function deleteMachinesOf(
  agentId: string,
  keep: boolean,
): Promise<ComputerRow[] | Response> {
  const rows = await machinesOnlyOf(getPlatform().db, agentId)
  const going = rows.filter((row) => !shareable(row) || !keep)
  for (const row of going) {
    const problem = await destroyMachine(row)
    if (problem !== undefined) {
      return fail(
        502,
        `The agent's computer ${row.name} could not be deleted, so nothing was: ${problem}`,
      )
    }
  }
  return going
}

/** Forget machines that are gone: the ones `deleteMachinesOf` said would go. */
export async function forgetMachines(rows: readonly ComputerRow[]): Promise<void> {
  for (const row of rows) await forgetComputer(getPlatform().db, row.id)
}

/**
 * An agent is being moved to another workspace. The machines that only it can use go there with
 * it: nothing in the workspace it leaves has a use for them. Call it before the agent's
 * connections are looked over, so that these still fit.
 */
export async function moveMachinesOf(agentId: string, workspaceId: string): Promise<void> {
  const { db } = getPlatform()
  for (const row of await machinesOnlyOf(db, agentId)) {
    await db.run("UPDATE dc_computers SET workspace_id = ? WHERE id = ?", workspaceId, row.id)
  }
}

/**
 * Someone is no longer in a team. The computers they paired for it are removed, since those run
 * as them, and their own computers stop serving its agents.
 */
export async function removeComputersOfMember(userId: string, workspaceId: string): Promise<void> {
  const left = await leftBehind(getPlatform().db, userId, workspaceId)
  for (const row of left.computers) await revokeComputer(row)
  await end(left)
}

/**
 * An agent was moved to another workspace. The computers that cannot serve it there stop doing
 * so: another team's, and those of people who are not in the workspace it is in now. They agreed
 * to serve the people it was shared with then.
 */
export async function removeMisfitComputersOf(agentId: string): Promise<void> {
  await end(await misfitsOfAgent(getPlatform().db, agentId))
  // It is in another workspace now, with other machines open to it.
  await tellMachines(agentId)
}

/**
 * A team is gone, and so are its computers: the ones paired for it, and its machines, which are
 * deleted. One that cannot be deleted just now is forgotten all the same, and said so: the team
 * is gone, and there is nowhere left to list it.
 */
export async function removeComputersOfWorkspace(workspaceId: string): Promise<void> {
  const rows = await getPlatform().db.all<ComputerRow>(
    "SELECT * FROM dc_computers WHERE workspace_id = ?",
    workspaceId,
  )
  for (const row of rows) {
    if (isMachine(row)) {
      const problem = await destroyMachine(row)
      if (problem !== undefined) {
        console.error(
          `The machine ${row.machine_key ?? row.id} (${row.kind}) of a deleted team could not be deleted: ${problem}`,
        )
      }
    }
    await revokeComputer(row)
  }
}

/**
 * A computer is gone. The agents that had it forget it, and for a paired one its token stops
 * working and its daemon is disconnected.
 */
async function revokeComputer(row: ComputerRow): Promise<void> {
  const { db, computers } = getPlatform()
  // The agents that had it, and the ones that were waiting to hear about it.
  const agentIds = new Set([
    ...((await agentsUsing(db, [row])).get(row.id) ?? []),
    ...(await askersOf(db, row.id)),
  ])
  // Access ends with this delete; the rest is tidying up.
  await forgetComputer(db, row.id)
  if (!isMachine(row)) {
    await computers
      .get(computerActorName(row.id))
      .fetch(new Request("http://computer/revoke", { method: "POST" }))
      .catch(() => {})
  }
  for (const agentId of agentIds) await tellGone(row.id, agentId)
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
