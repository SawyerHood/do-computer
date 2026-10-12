import { getPlatform } from "#platform"
import {
  CALLER_HEADER,
  CONNECTOR_CALLBACK_PATH,
  CONNECTOR_REDIRECT_HEADER,
  encodeCaller,
} from "@do-computer/agent"
import type { AddConnectorRequest, ConnectorResult } from "@do-computer/protocol"
import { agentFor, fail, json } from "./agents.ts"
import { getUser, type SessionUser } from "./auth.ts"

/** How long a user has to finish signing in to a service. */
const STATE_TTL_MS = 15 * 60_000
const CALLBACK_PATH = CONNECTOR_CALLBACK_PATH

const origin = (request: Request) => getPlatform().config.baseUrl ?? new URL(request.url).origin

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
  if ((await agentFor(user, agentId)) === undefined) return fail(404, "Agent not found")
  const { db, agents } = getPlatform()
  const path = connectorId === undefined ? "/connectors" : `/connectors/${connectorId}/connect`
  const response = await agents.get(agentId).fetch(
    new Request(`http://agent${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [CONNECTOR_REDIRECT_HEADER]: `${origin(request)}${CALLBACK_PATH}`,
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
                created_at = excluded.created_at`,
        params: [state, user.id, agentId, result.connector.id, now],
      },
    ])
  }
  return json(result, connectorId === undefined ? 201 : 200)
}

/**
 * Where a service sends the user back after they sign in. The `state` it echoes says which
 * connector this is for; the signed-in user must be the one who started it.
 */
export async function connectorCallback(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const back = (agentId: string | undefined, outcome: Record<string, string>) => {
    const target = new URL(agentId ? `/a/${agentId}/connectors` : "/", origin(request))
    for (const [key, value] of Object.entries(outcome)) target.searchParams.set(key, value)
    return Response.redirect(target.toString(), 302)
  }
  const user = await getUser(request)
  if (user === undefined) return Response.redirect(`${origin(request)}/login`, 302)

  const { db, agents } = getPlatform()
  const state = url.searchParams.get("state") ?? ""
  const row = await db.get<{
    user_id: string
    agent_id: string
    connector_id: string
    created_at: number
  }>(
    "SELECT user_id, agent_id, connector_id, created_at FROM dc_oauth_states WHERE state = ?",
    state,
  )
  if (row === undefined || row.user_id !== user.id || row.created_at < Date.now() - STATE_TTL_MS) {
    return back(undefined, {
      connector_error: "That sign-in link has expired. Try connecting again.",
    })
  }
  // One use: whatever happens next, this state is spent.
  await db.run("DELETE FROM dc_oauth_states WHERE state = ?", state)

  const denied = url.searchParams.get("error")
  const code = url.searchParams.get("code")
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
      body: JSON.stringify({ code }),
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
  if (typeof chatId === "string" && /^\d+$/.test(chatId)) {
    return Response.redirect(`${origin(request)}/a/${row.agent_id}/c/${chatId}`, 302)
  }
  return back(row.agent_id, { connected: row.connector_id })
}
