import { CALLER_HEADER, encodeCaller } from "@do-computer/agent"
import { agentFor } from "./agents.ts"
import { socketUser } from "./auth.ts"

/**
 * Where a browser connects to follow an agent, and to follow the library of the agent's
 * workspace: `/api/agents/<id>/socket` and `/api/agents/<id>/library/socket`.
 */
const SOCKET_PATH = /^\/api\/agents\/([^/]+)\/(socket|library\/socket)$/

/** The agent a socket request is for and what of it, or undefined when the path is not one. */
export function agentSocket(pathname: string): { agentId: string; library: boolean } | undefined {
  const match = SOCKET_PATH.exec(pathname)
  if (match === null) return undefined
  try {
    const agentId = decodeURIComponent(match[1]!)
    return agentId === "" || agentId.includes("/")
      ? undefined
      : { agentId, library: match[2] !== "socket" }
  } catch {
    return undefined
  }
}

/**
 * Check a request to follow an agent, and resolve with the request to hand on, saying who is
 * asking, and the workspace the agent is in. Undefined when it is not from someone who may use
 * the agent, or carries neither a ticket nor a cookie from the app itself.
 */
export async function admitToAgent(
  request: Request,
  agentId: string,
): Promise<{ request: Request; workspaceId: string } | undefined> {
  // A cookie only from the app's own pages, or a ticket (auth.ts).
  const user = await socketUser(request)
  if (user === undefined) return undefined
  const access = await agentFor(user, agentId)
  if (access === undefined) return undefined
  const headers = new Headers(request.headers)
  // Who is asking is only ever what this gateway says.
  headers.set(CALLER_HEADER, encodeCaller({ id: user.id, name: user.name }))
  return { request: new Request(request, { headers }), workspaceId: access.workspaceId }
}
