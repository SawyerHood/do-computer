import { getPlatform } from "#platform"
import {
  type AgentSummary,
  type ApiError,
  BodyTooLarge,
  declaredTooLarge,
  readLimited,
} from "@durable-computer/protocol"
import { getAuth, getUser, type SessionUser } from "./auth.ts"
import { defaultsFor } from "./settings.ts"

const MAX_AGENTS_PER_USER = 20

export const json = (value: unknown, status = 200) => Response.json(value, { status })
export const fail = (status: number, error: string, code?: string) =>
  json({ error, code } satisfies ApiError, status)

/** Run `handle` for the signed-in user, or answer 401. */
export async function withUser(
  request: Request,
  handle: (user: SessionUser) => Promise<Response>,
): Promise<Response> {
  const user = await getUser(request)
  if (user === undefined) return fail(401, "Sign in first", "unauthenticated")
  return handle(user)
}

type AgentRow = { id: string; owner_id: string; created_at: number }

/** Call an agent's actor. The path is relative to the actor, for example `/chats`. */
export function callAgent(agentId: string, path: string, init?: RequestInit): Promise<Response> {
  return getPlatform()
    .agents.get(agentId)
    .fetch(new Request(`http://agent${path}`, init))
}

export async function ownedAgent(
  user: SessionUser,
  agentId: string,
): Promise<AgentRow | undefined> {
  // Ownership is decided here, from the session and the app database, never from the client.
  return getPlatform().db.get<AgentRow>(
    "SELECT id, owner_id, created_at FROM dc_agents WHERE id = ? AND owner_id = ?",
    agentId,
    user.id,
  )
}

/**
 * Actor routes only the gateway may call. `computers` is the agent's record of what is paired to
 * it, which must only ever say what the pairing table says.
 */
const INTERNAL = ["init", "destroy", "computers"]

/** The largest body forwarded to an agent: a library upload, and everything else. */
const MAX_UPLOAD_BYTES = 26 * 1024 * 1024
const MAX_BODY_BYTES = 1024 * 1024

export async function listAgents(user: SessionUser): Promise<Response> {
  const rows = await getPlatform().db.all<AgentRow>(
    "SELECT id, owner_id, created_at FROM dc_agents WHERE owner_id = ? ORDER BY created_at",
    user.id,
  )
  const agents = await Promise.all(
    rows.map(async (row): Promise<AgentSummary | undefined> => {
      const response = await callAgent(row.id, "/")
      if (!response.ok) return undefined
      return ((await response.json()) as { agent: AgentSummary }).agent
    }),
  )
  return json({ agents: agents.filter((agent) => agent !== undefined) })
}

export async function createAgent(user: SessionUser): Promise<Response> {
  const { db } = getPlatform()
  const count = await db.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM dc_agents WHERE owner_id = ?",
    user.id,
  )
  if ((count?.n ?? 0) >= MAX_AGENTS_PER_USER) {
    return fail(409, `An account can have at most ${MAX_AGENTS_PER_USER} agents`)
  }
  const id = crypto.randomUUID()
  await db.run(
    "INSERT INTO dc_agents (id, owner_id, created_at) VALUES (?, ?, ?)",
    id,
    user.id,
    Date.now(),
  )
  const response = await callAgent(id, "/init", {
    method: "POST",
    headers: { "content-type": "application/json" },
    // A new agent starts on the model and the kind of computer its owner chose as defaults.
    body: JSON.stringify({ ownerId: user.id, ...(await defaultsFor(user.id)) }),
  })
  if (!response.ok) {
    await db.run("DELETE FROM dc_agents WHERE id = ?", id)
    return fail(502, "The agent could not be started")
  }
  return json({ agent: ((await response.json()) as { agent: AgentSummary }).agent }, 201)
}

/** Forward a request to one of the user's agents. `path` is what follows the agent id. */
export async function proxyToAgent(
  request: Request,
  user: SessionUser,
  agentId: string,
  path: string,
): Promise<Response> {
  if ((await ownedAgent(user, agentId)) === undefined) return fail(404, "Agent not found")
  // Routes the actor keeps for the gateway itself.
  if (INTERNAL.some((route) => path === route || path.startsWith(`${route}/`))) {
    return fail(404, "Not found")
  }
  const url = new URL(request.url)
  let body: ArrayBuffer | undefined
  if (request.method !== "GET" && request.method !== "HEAD") {
    // Every user's requests share this process's memory, so a body is read only up to a limit.
    const limit = path === "library" ? MAX_UPLOAD_BYTES : MAX_BODY_BYTES
    if (declaredTooLarge(request.headers, limit)) return fail(413, "That is too large to send.")
    try {
      body = (await readLimited(request.body, limit)).slice().buffer
    } catch (error) {
      if (error instanceof BodyTooLarge) return fail(413, "That is too large to send.")
      // The client went away mid-upload. Nobody is left to answer; this only keeps it quiet.
      return fail(400, "The request was cut off before it was complete.")
    }
  }
  return callAgent(agentId, `/${path}${url.search}`, {
    method: request.method,
    headers: { "content-type": request.headers.get("content-type") ?? "application/json" },
    body,
    signal: request.signal,
  })
}

export { getAuth }
