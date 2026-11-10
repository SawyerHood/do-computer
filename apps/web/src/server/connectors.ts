import { getPlatform } from "#platform"
import {
  CALLER_HEADER,
  CONNECTOR_CALLBACK_PATH,
  CONNECTOR_REDIRECT_HEADER,
  encodeCaller,
} from "@do-computer/agent"
import {
  type AddConnectorRequest,
  CONNECTOR_FROM_APP,
  CONNECTOR_RETURN_PATH,
  type ConnectorResult,
} from "@do-computer/protocol"
import { agentFor, fail, json } from "./agents.ts"
import { getUser, type SessionUser } from "./auth.ts"

/** How long a user has to finish signing in to a service. */
const STATE_TTL_MS = 15 * 60_000
const CALLBACK_PATH = CONNECTOR_CALLBACK_PATH

const origin = (request: Request) => getPlatform().config.baseUrl ?? new URL(request.url).origin

/** A web client may return only to its connector page, on an explicitly trusted origin. */
export function connectorClientReturn(request: Request): string | undefined {
  const value = new URL(request.url).searchParams.get("client_return")
  if (value === null) return undefined
  try {
    const url = new URL(value)
    const allowed = [origin(request), ...getPlatform().config.clientOrigins]
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !allowed.includes(url.origin) ||
      !/^\/a\/[^/]+\/connectors$/.test(url.pathname)
    )
      return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

/**
 * Add a connector, or reconnect one. Done here and not by the generic proxy because only the
 * gateway may say where a sign-in returns to, and it has to remember who is signing in.
 */
export async function connectConnector(
  user: SessionUser,
  request: Request,
  agentId: string,
  connectorId?: string,
  /** The connector to add, where it is not what the request itself asks for. */
  adding?: AddConnectorRequest,
): Promise<Response> {
  if ((await agentFor(user, agentId)) === undefined) return fail(404, "Dood not found")
  const clientReturn = connectorClientReturn(request)
  if (new URL(request.url).searchParams.has("client_return") && clientReturn === undefined) {
    return fail(400, "The client return address is not allowed")
  }
  const redirect = new URL(`${origin(request)}${CALLBACK_PATH}`)
  if (clientReturn !== undefined) redirect.searchParams.set("client_return", clientReturn)
  const { db, agents } = getPlatform()
  const path = connectorId === undefined ? "/connectors" : `/connectors/${connectorId}/connect`
  const response = await agents.get(agentId).fetch(
    new Request(`http://agent${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [CONNECTOR_REDIRECT_HEADER]: redirect.toString(),
      },
      body:
        connectorId !== undefined
          ? "{}"
          : adding === undefined
            ? await request.text()
            : JSON.stringify(adding),
    }),
  )
  if (!response.ok) return response
  const { state, ...result } = (await response.json()) as ConnectorResult & { state?: string }
  if (result.authorizationUrl !== undefined && state !== undefined) {
    const now = Date.now()
    await db.batch([
      { sql: "DELETE FROM dc_oauth_states WHERE created_at < ?", params: [now - STATE_TTL_MS] },
      {
        sql: `INSERT INTO dc_oauth_states (state, user_id, agent_id, connector_id, created_at)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT (state) DO UPDATE SET user_id = excluded.user_id,
                agent_id = excluded.agent_id, connector_id = excluded.connector_id,
                created_at = excluded.created_at, desktop_port = NULL`,
        params: [state, user.id, agentId, result.connector.id, now],
      },
    ])
  }
  return json(result, connectorId === undefined ? 201 : 200)
}

/**
 * The desktop app says that a sign-in it started is being done in its owner's browser, and at
 * which port of that computer it waits for the service's answer. Only whoever started the
 * sign-in may say so.
 */
export async function connectorInBrowser(user: SessionUser, request: Request): Promise<Response> {
  const { state, port } = (await request.json().catch(() => ({}))) as {
    state?: unknown
    port?: unknown
  }
  if (typeof state !== "string" || state === "") return fail(400, "state is required")
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1024 || port > 65535) {
    return fail(400, "port must be a port of this computer")
  }
  const { db } = getPlatform()
  const started = await db.get<{ state: string }>(
    "SELECT state FROM dc_oauth_states WHERE state = ? AND user_id = ? AND created_at >= ?",
    state,
    user.id,
    Date.now() - STATE_TTL_MS,
  )
  if (started === undefined) return fail(404, "No sign-in of yours is waiting under that state")
  await db.run("UPDATE dc_oauth_states SET desktop_port = ? WHERE state = ?", port, state)
  return json({ ok: true })
}

/**
 * Where a service sends the user back after they sign in. The `state` it echoes says which
 * connector this is for; the signed-in user must be the one who started it.
 */
export async function connectorCallback(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const client = url.searchParams.get("dc_client") === "1"
  const back = (agentId: string | undefined, outcome: Record<string, string>) => {
    if (client)
      return json({ ok: outcome.connected !== undefined, error: outcome.connector_error ?? "" })
    const target = new URL(agentId ? `/a/${agentId}/connectors` : "/", origin(request))
    for (const [key, value] of Object.entries(outcome)) target.searchParams.set(key, value)
    return Response.redirect(target.toString(), 302)
  }
  const { db, agents } = getPlatform()
  const state = url.searchParams.get("state") ?? ""
  const row = await db.get<{
    user_id: string
    agent_id: string
    connector_id: string
    created_at: number
    desktop_port: number | null
  }>(
    `SELECT user_id, agent_id, connector_id, created_at, desktop_port
     FROM dc_oauth_states WHERE state = ?`,
    state,
  )
  const fresh = row !== undefined && row.created_at >= Date.now() - STATE_TTL_MS
  const clientReturn = connectorClientReturn(request)
  // The browser may have no cookie. Give the answer back to the client, which finishes with
  // its bearer session; the state is not consumed until that same user has been checked.
  if (!client && clientReturn !== undefined) {
    const target = new URL(clientReturn)
    for (const key of ["state", "code", "error", "error_description", "iss"]) {
      const value = url.searchParams.get(key)
      if (value !== null) target.searchParams.set(key, value)
    }
    return Response.redirect(target.toString(), 302)
  }
  // A sign-in the desktop app sent to its owner's browser is the app's to finish, in the
  // session that started it. The browser only carries the service's answer back to the app,
  // on the computer it is on itself, and need not be signed in here at all.
  if (fresh && row.desktop_port !== null && !url.searchParams.has(CONNECTOR_FROM_APP)) {
    const app = new URL(`http://127.0.0.1:${row.desktop_port}${CONNECTOR_RETURN_PATH}`)
    app.search = url.search
    return Response.redirect(app.toString(), 302)
  }
  const user = await getUser(request)
  if (user === undefined)
    return client
      ? fail(401, "Sign in again to finish connecting")
      : Response.redirect(`${origin(request)}/login`, 302)

  if (!fresh || row.user_id !== user.id) {
    return back(undefined, {
      connector_error: "That sign-in link has expired. Try connecting again.",
    })
  }
  // One use: whatever happens next, this state is spent.
  await db.run("DELETE FROM dc_oauth_states WHERE state = ?", state)

  const denied = url.searchParams.get("error")
  const code = url.searchParams.get("code")
  // Who the service says it is (RFC 9207), for the agent to check before it uses the code.
  const iss = url.searchParams.get("iss")
  if (denied !== null || code === null) {
    return back(row.agent_id, {
      connector_error: url.searchParams.get("error_description") ?? "The sign-in was cancelled.",
    })
  }
  const response = await agents.get(row.agent_id).fetch(
    new Request(`http://agent/connectors/${row.connector_id}/authorize`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [CALLER_HEADER]: encodeCaller({ id: user.id, name: user.name }),
      },
      body: JSON.stringify({ code, ...(iss ? { iss } : {}) }),
    }),
  )
  if (!response.ok) {
    const failure = (await response.json().catch(() => ({}))) as { error?: string }
    return back(row.agent_id, {
      connector_error: failure.error ?? "The sign-in could not be completed.",
    })
  }
  // Where the agent asked for it from a chat, that chat is where the answer is.
  const { chatId } = (await response.json().catch(() => ({}))) as { chatId?: string }
  if (!client && typeof chatId === "string" && /^\d+$/.test(chatId)) {
    return Response.redirect(`${origin(request)}/a/${row.agent_id}/c/${chatId}`, 302)
  }
  return back(row.agent_id, { connected: row.connector_id })
}
