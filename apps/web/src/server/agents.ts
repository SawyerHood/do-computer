import { getPlatform } from "#platform"
import {
  type AgentSummary,
  type ApiError,
  BodyTooLarge,
  declaredTooLarge,
  readLimited,
} from "@durable-computer/protocol"
import {
  APP_ORIGIN_HEADER,
  CALLER_HEADER,
  encodeCaller,
  LIBRARY_AGENT_HEADER,
} from "@durable-computer/agent"
import { isPersonalWorkspace, personalWorkspaceId } from "@durable-computer/protocol"
import { getAuth, getUser, type SessionUser } from "./auth.ts"
import { provideFor } from "./computers.ts"
import { announce } from "./presence.ts"
import { defaultModelFor } from "./settings.ts"
import { type AgentAccess, agentAccess, roleIn, workspaceIdsOf } from "./teams.ts"

/** How many agents one workspace can hold: a person's own, or a team's. */
export const MAX_AGENTS_PER_WORKSPACE = 20

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

type AgentRow = { id: string; owner_id: string; workspace_id: string | null; created_at: number }

/** Call an agent's actor. The path is relative to the actor, for example `/chats`. */
export function callAgent(agentId: string, path: string, init?: RequestInit): Promise<Response> {
  return getPlatform()
    .agents.get(agentId)
    .fetch(new Request(`http://agent${path}`, init))
}

/**
 * An agent the user may use: one in their own workspace, or in a team they are in. Decided here,
 * from the session and the app database, never from the client.
 */
export function agentFor(user: SessionUser, agentId: string): Promise<AgentAccess | undefined> {
  return agentAccess(getPlatform().db, user.id, agentId)
}

/** The name of the team a workspace is, or null for someone's own. Agents are told this. */
export async function teamName(workspaceId: string): Promise<string | null> {
  if (isPersonalWorkspace(workspaceId)) return null
  const row = await getPlatform().db.get<{ name: string }>(
    "SELECT name FROM dc_workspaces WHERE id = ?",
    workspaceId,
  )
  return row?.name ?? null
}

/** Tell an agent which team it is in, or that it is one person's. */
export async function tellAgentItsTeam(agentId: string, team: string | null): Promise<boolean> {
  const response = await callAgent(agentId, "/team", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ team }),
  })
  return response.ok
}

/**
 * Actor routes only the gateway may call. `computers` is the agent's record of what is paired to
 * it, which must only ever say what the pairing table says. `peers` is where another agent's
 * messages arrive, which must only ever come from an agent of the same workspace. `slack` is
 * where what was said in Slack arrives, which must only ever be what Slack signed.
 */
const INTERNAL = ["init", "destroy", "computers", "team", "peers", "slack"]

/** The largest body forwarded to an agent: a library upload, and everything else. */
const MAX_UPLOAD_BYTES = 26 * 1024 * 1024
const MAX_BODY_BYTES = 1024 * 1024
/** A message can carry a few scaled-down pictures with its words. */
const MAX_MESSAGE_BYTES = 3 * 1024 * 1024

/** Every agent the user can use: their own and their teams', each marked with its workspace. */
export async function listAgents(user: SessionUser): Promise<Response> {
  const { db } = getPlatform()
  const workspaceIds = await workspaceIdsOf(db, user.id)
  const rows = await db.all<AgentRow>(
    `SELECT id, owner_id, workspace_id, created_at FROM dc_agents
      WHERE workspace_id IN (${workspaceIds.map(() => "?").join(", ")}) ORDER BY created_at`,
    ...workspaceIds,
  )
  const agents = await Promise.all(
    rows.map(async (row): Promise<AgentSummary | undefined> => {
      const response = await callAgent(row.id, "/")
      if (!response.ok) return undefined
      const { agent } = (await response.json()) as { agent: AgentSummary }
      return { ...agent, workspaceId: row.workspace_id ?? personalWorkspaceId(row.owner_id) }
    }),
  )
  return json({ agents: agents.filter((agent) => agent !== undefined) })
}

/** Make an agent in one of the user's workspaces: their own unless the request names a team. */
export async function createAgent(user: SessionUser, request: Request): Promise<Response> {
  const { db } = getPlatform()
  const input = (await request.json().catch(() => ({}))) as { workspaceId?: unknown } | null
  const workspaceId =
    typeof input?.workspaceId === "string" ? input.workspaceId : personalWorkspaceId(user.id)
  if ((await roleIn(db, user.id, workspaceId)) === undefined) return fail(404, "Team not found")
  const made = await makeAgent(user.id, workspaceId)
  if ("error" in made) return fail(made.status, made.error)
  return json({ agent: { ...made.agent, workspaceId } }, 201)
}

/**
 * Make an agent in a workspace, as `ownerId`, who is in it. Resolves with the agent, or with why
 * there is none.
 */
async function makeAgent(
  ownerId: string,
  workspaceId: string,
): Promise<{ agent: AgentSummary } | { status: number; error: string }> {
  const { db } = getPlatform()
  const count = await db.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM dc_agents WHERE workspace_id = ?",
    workspaceId,
  )
  if ((count?.n ?? 0) >= MAX_AGENTS_PER_WORKSPACE) {
    return {
      status: 409,
      error: isPersonalWorkspace(workspaceId)
        ? `An account can have at most ${MAX_AGENTS_PER_WORKSPACE} agents`
        : `A team can have at most ${MAX_AGENTS_PER_WORKSPACE} agents`,
    }
  }
  const id = crypto.randomUUID()
  await db.run(
    "INSERT INTO dc_agents (id, owner_id, workspace_id, created_at) VALUES (?, ?, ?, ?)",
    id,
    ownerId,
    workspaceId,
    Date.now(),
  )
  const response = await callAgent(id, "/init", {
    method: "POST",
    headers: { "content-type": "application/json" },
    // A new agent starts on the model its maker chose as their default.
    body: JSON.stringify({
      ownerId,
      team: await teamName(workspaceId),
      model: await defaultModelFor(ownerId, workspaceId),
    }),
  })
  if (!response.ok) {
    await db.run("DELETE FROM dc_agents WHERE id = ?", id)
    return { status: 502, error: "The agent could not be started" }
  }
  // It has no computer of its own. It works on its workspace's, which gets one if it has none.
  await provideFor(id, workspaceId, ownerId)
  const { agent } = (await response.json()) as { agent: AgentSummary }
  await announce(workspaceId)
  return { agent }
}

/**
 * An agent makes another in its own workspace, as someone in it could from the app, within the
 * same limit. `by` is who it was working for: the new agent is made as theirs, where they are
 * still in the workspace, and otherwise as whoever made the first one's. It is given the name
 * and character it was asked to have, so it starts as someone and not as a blank.
 */
export async function createAgentBeside(
  agentId: string,
  input: { name: string; tagline?: string; personality?: string; by?: string },
): Promise<{ id: string; name: string } | { error: string }> {
  const { db } = getPlatform()
  const row = await db.get<AgentRow>(
    "SELECT id, owner_id, workspace_id, created_at FROM dc_agents WHERE id = ?",
    agentId,
  )
  if (row === undefined) return { error: "This agent is not in a workspace any more." }
  const workspaceId = row.workspace_id ?? personalWorkspaceId(row.owner_id)
  const ownerId =
    input.by !== undefined && (await roleIn(db, input.by, workspaceId)) !== undefined
      ? input.by
      : row.owner_id
  if ((await roleIn(db, ownerId, workspaceId)) === undefined) {
    return { error: "Nobody this agent works for is in its workspace any more." }
  }
  const made = await makeAgent(ownerId, workspaceId)
  if ("error" in made) {
    return {
      error:
        made.status === 409
          ? `The workspace already has ${MAX_AGENTS_PER_WORKSPACE} agents, which is the most it can have.`
          : made.error,
    }
  }
  const named = await callAgent(made.agent.id, "/", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: input.name,
      ...(input.tagline === undefined ? {} : { tagline: input.tagline }),
      ...(input.personality === undefined ? {} : { soul: input.personality }),
    }),
  })
  if (!named.ok) {
    const { error } = (await named.json().catch(() => ({}))) as { error?: string }
    return {
      error: `The agent was made but could not be given its name: ${error ?? "it did not answer"}. The person can name it in the app.`,
    }
  }
  await announce(workspaceId)
  return { id: made.agent.id, name: input.name }
}

/** Forward a request to one of the user's agents. `path` is what follows the agent id. */
export async function proxyToAgent(
  request: Request,
  user: SessionUser,
  agentId: string,
  path: string,
): Promise<Response> {
  const access = await agentFor(user, agentId)
  if (access === undefined) return fail(404, "Agent not found")
  // The route as the actor will read it, which is after the address has been parsed: `..`, an
  // encoded dot, a backslash or a doubled slash each change what comes first, and judging the
  // path as it was sent would let any of them past.
  const route = new URL(`http://agent/${path}`).pathname.split("/").filter(Boolean)
  // Routes the actor keeps for the gateway itself.
  if (route[0] !== undefined && INTERNAL.includes(route[0])) return fail(404, "Not found")
  const url = new URL(request.url)
  let body: ArrayBuffer | undefined
  if (request.method !== "GET" && request.method !== "HEAD") {
    // Every user's requests share this process's memory, so a body is read only up to a limit.
    const limit =
      route[0] === "library"
        ? MAX_UPLOAD_BYTES
        : route[0] === "chats" && route[2] === "messages" && route.length === 3
          ? MAX_MESSAGE_BYTES
          : MAX_BODY_BYTES
    if (declaredTooLarge(request.headers, limit)) return fail(413, "That is too large to send.")
    try {
      // The length the browser gave is passed on so that an upload is held in memory once.
      // What is read is a buffer of its own, so it is handed on as it is and not copied.
      const declared = Number(request.headers.get("content-length") ?? "")
      body = (await readLimited(request.body, limit, declared)).buffer
    } catch (error) {
      if (error instanceof BodyTooLarge) return fail(413, "That is too large to send.")
      // The client went away mid-upload. Nobody is left to answer; this only keeps it quiet.
      return fail(400, "The request was cut off before it was complete.")
    }
  }
  // Built from nothing, so that who is asking is only ever what this gateway says.
  const headers: Record<string, string> = {
    "content-type": request.headers.get("content-type") ?? "application/json",
    [CALLER_HEADER]: encodeCaller({ id: user.id, name: user.name }),
    // Where the app is, for a link the agent hands someone.
    [APP_ORIGIN_HEADER]: getPlatform().config.baseUrl ?? url.origin,
  }
  // So that a file the browser already has is not sent again.
  const cached = request.headers.get("if-none-match")
  if (cached !== null) headers["if-none-match"] = cached
  // The library is its workspace's, which answers for itself. It is told which agent the
  // request came through: a file's chat is that agent's.
  if (route[0] === "library") {
    return getPlatform()
      .libraries.get(access.workspaceId)
      .fetch(
        // The path as it was parsed, which is as the library will read it.
        new Request(`http://library/${route.join("/")}${url.search}`, {
          method: request.method,
          headers: { ...headers, [LIBRARY_AGENT_HEADER]: agentId },
          body,
          signal: request.signal,
        }),
      )
  }
  return callAgent(agentId, `/${path}${url.search}`, {
    method: request.method,
    headers,
    body,
    signal: request.signal,
  })
}

/**
 * Serve a library file as a page, to whoever holds an address for it. There is no session here:
 * a page is shown in a frame that is kept apart from the app, and so apart from its cookies, and
 * the address itself carries the permission, which the library checks.
 */
export async function viewLibraryFile(request: Request, agentId: string): Promise<Response> {
  const missing = () => new Response("Not found", { status: 404 })
  // The library is the one of the agent's workspace. An agent the record does not have has none.
  const known = await getPlatform().db.get<{ owner_id: string; workspace_id: string | null }>(
    "SELECT owner_id, workspace_id FROM dc_agents WHERE id = ?",
    agentId,
  )
  if (known === undefined) return missing()
  const { pathname } = new URL(request.url)
  const rest = pathname.slice(`/d/${encodeURIComponent(agentId)}/`.length)
  const headers: Record<string, string> = {}
  for (const name of ["if-none-match", "sec-fetch-dest"]) {
    const value = request.headers.get(name)
    if (value !== null) headers[name] = value
  }
  const response = await getPlatform()
    .libraries.get(known.workspace_id ?? personalWorkspaceId(known.owner_id))
    .fetch(new Request(`http://library/view/${rest}`, { headers, signal: request.signal }))
  // The library answers in JSON, for the app. This is read by a browser.
  return response.status === 404 ? missing() : response
}

export { getAuth }
