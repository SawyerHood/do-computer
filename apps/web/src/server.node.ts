import { getPlatform } from "#platform"
import type { SocketLike } from "@durable-computer/runtime/node"
import handler, { createServerEntry } from "@tanstack/react-start/server-entry"
import { authenticateDaemon, computerActorName, CONNECT_PATH } from "./server/computers.ts"

export default createServerEntry({
  fetch: (request) => handler.fetch(request),
})

export { CONNECT_PATH }

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
