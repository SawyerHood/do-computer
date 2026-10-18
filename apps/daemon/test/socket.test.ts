import { createServer } from "node:net"
import { once } from "node:events"
import { expect, it } from "vitest"
import { connectSocket } from "../src/socket.ts"

it("closes a connection whose WebSocket upgrade never completes", async () => {
  const peers = new Set<import("node:net").Socket>()
  const server = createServer((peer) => {
    peers.add(peer)
    peer.on("data", () => {})
    peer.on("close", () => peers.delete(peer))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address() as import("node:net").AddressInfo
  const socket = connectSocket(`ws://127.0.0.1:${address.port}`, "test-token", 30)
  const errors: Error[] = []
  socket.on("error", (error) => errors.push(error))
  try {
    await new Promise<void>((resolve) => socket.once("close", () => resolve()))
    expect(socket.readyState).toBe(socket.CLOSED)
    expect(errors[0]?.message).toContain("timed out")
  } finally {
    socket.terminate()
    for (const peer of peers) peer.destroy()
    const closed = once(server, "close")
    server.close()
    await closed
  }
})
