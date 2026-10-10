import { getPlatform } from "#platform"
import type { SocketLike } from "@durable-computer/runtime/node"
import handler, { createServerEntry } from "@tanstack/react-start/server-entry"
import { admitToAgent, agentSocket } from "./server/agent-socket.ts"
import { authenticateDaemon, computerActorName, CONNECT_PATH } from "./server/computers.ts"
import { admitToPresence, PRESENCE_PATH, presenceWorkspace } from "./server/presence.ts"

export default createServerEntry({
  fetch: (request) => handler.fetch(request),
})

export { CONNECT_PATH, PRESENCE_PATH }

/**
 * Open the data directory and wake the agents. Called once when the server starts, not on the
 * first request: schedules have to fire on a server nobody has visited since it restarted, and a
 * wrong setting should stop the server instead of failing every request.
 */
export function start(): void {
  getPlatform()
}

/**
 * A daemon's WebSocket request, for the HTTP server that owns the socket. Resolves with a
 * function that attaches the accepted socket, or undefined when the token is not valid.
 */
export async function acceptDaemon(
  request: Request,
): Promise<((socket: SocketLike) => Promise<void>) | undefined> {
  const computerId = await authenticateDaemon(request)
  if (computerId === undefined) return undefined
  return (socket) => getPlatform().connectComputer(computerActorName(computerId), socket, request)
}

/**
 * A member's presence WebSocket, for the HTTP server that owns the socket. Resolves with a
 * function that attaches the accepted socket, or undefined when the request is not a member's.
 */
export async function acceptPresence(
  request: Request,
): Promise<((socket: SocketLike) => Promise<void>) | undefined> {
  const workspaceId = presenceWorkspace(new URL(request.url).pathname)
  if (workspaceId === undefined) return undefined
  const admitted = await admitToPresence(request, workspaceId)
  if (admitted === undefined) return undefined
  return (socket) => getPlatform().connectPresence(workspaceId, socket, admitted)
}

/**
 * The WebSocket an agent, or the library of its workspace, is followed over, for the HTTP
 * server that owns the socket. Resolves with a function that attaches the accepted socket, with
 * undefined when the request is not from someone who may use the agent, and with null when the
 * address is not one of these at all.
 */
export async function acceptFollower(
  request: Request,
): Promise<((socket: SocketLike) => Promise<void>) | undefined | null> {
  const followed = agentSocket(new URL(request.url).pathname)
  if (followed === undefined) return null
  const admitted = await admitToAgent(request, followed.agentId)
  if (admitted === undefined) return undefined
  const platform = getPlatform()
  return (socket) =>
    followed.library
      ? platform.connectLibrary(admitted.workspaceId, socket, admitted.request)
      : platform.connectAgent(followed.agentId, socket, admitted.request)
}
