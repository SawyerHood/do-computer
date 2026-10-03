import { getPlatform } from "#platform"
import { computerActorName, type PairedComputer } from "@durable-computer/agent"
import { linkStatus } from "@durable-computer/computers"
import type { ComputerSummary } from "@durable-computer/protocol"
import { fail, json } from "./agents.ts"
import { getAuth, type SessionUser } from "./auth.ts"

const PAIRING_TTL_MS = 10 * 60_000
const MAX_PENDING_PAIRINGS = 200
const MAX_COMPUTERS_PER_USER = 20
/** Letters and digits that are hard to confuse when read off a terminal. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
export const TOKEN_PREFIX = "dcc_"

type ComputerRow = {
  id: string
  owner_id: string
  agent_id: string
  name: string
  platform: string
  hostname: string
  read_only: number
  token_hash: string | null
  created_at: number
}

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

/** A signed-in user gives one of their agents access to the computer behind a code. */
export async function confirmPairing(user: SessionUser, request: Request): Promise<Response> {
  const { db, agents } = getPlatform()
  const input = (await request.json().catch(() => ({}))) as { code?: unknown; agentId?: unknown }
  if (typeof input.code !== "string" || typeof input.agentId !== "string") {
    return fail(400, "code and agentId are required")
  }
  const row = await db.get<PairRow>(
    "SELECT * FROM dc_pair_requests WHERE code = ? AND expires_at >= ? AND computer_id IS NULL",
    normalizeCode(input.code),
    Date.now(),
  )
  if (row === undefined) return fail(404, "That code is not valid or has expired.")
  const agent = await db.get<{ id: string }>(
    "SELECT id FROM dc_agents WHERE id = ? AND owner_id = ?",
    input.agentId,
    user.id,
  )
  if (agent === undefined) return fail(404, "Agent not found")
  const owned = await db.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM dc_computers WHERE owner_id = ?",
    user.id,
  )
  if ((owned?.n ?? 0) >= MAX_COMPUTERS_PER_USER) {
    return fail(409, `An account can have at most ${MAX_COMPUTERS_PER_USER} computers.`)
  }

  const id = crypto.randomUUID()
  const now = Date.now()
  // The agent decides the final name, so two computers of one agent never share one.
  const registered = await agents.get(agent.id).fetch(
    new Request(`http://agent/computers/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: row.name,
        platform: row.platform,
        hostname: row.hostname,
        home: row.home,
        readOnly: row.read_only === 1,
        pairedAt: now,
      } satisfies PairedComputer),
    }),
  )
  if (!registered.ok) return fail(502, "The agent could not be told about the computer.")
  const { name } = (await registered.json()) as PairedComputer
  await db.batch([
    {
      sql: `INSERT INTO dc_computers
              (id, owner_id, agent_id, name, platform, hostname, read_only, token_hash, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      params: [id, user.id, agent.id, name, row.platform, row.hostname, row.read_only, now],
    },
    { sql: "UPDATE dc_pair_requests SET computer_id = ? WHERE code = ?", params: [id, row.code] },
  ])
  return json({ computerId: id, name }, 201)
}

export async function listComputers(user: SessionUser): Promise<Response> {
  const { db, computers } = getPlatform()
  const rows = await db.all<ComputerRow>(
    "SELECT * FROM dc_computers WHERE owner_id = ? ORDER BY created_at",
    user.id,
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
        agentId: row.agent_id,
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

/** Remove a computer: its token stops working, its daemon is disconnected, the agent forgets it. */
export async function removeComputer(user: SessionUser, computerId: string): Promise<Response> {
  const { db, agents, computers } = getPlatform()
  const row = await db.get<ComputerRow>(
    "SELECT * FROM dc_computers WHERE id = ? AND owner_id = ?",
    computerId,
    user.id,
  )
  if (row === undefined) return fail(404, "Computer not found")
  // Access ends with this delete; the rest is tidying up.
  await db.run("DELETE FROM dc_computers WHERE id = ?", row.id)
  await computers
    .get(computerActorName(row.id))
    .fetch(new Request("http://computer/revoke", { method: "POST" }))
    .catch(() => {})
  await agents
    .get(row.agent_id)
    .fetch(new Request(`http://agent/computers/${row.id}`, { method: "DELETE" }))
    .catch(() => {})
  return json({ ok: true })
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
