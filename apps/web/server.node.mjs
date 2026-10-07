// Serves the Node build: static client assets, then the app's fetch handler, plus the WebSocket
// that paired computers' daemons connect on. Build first with `pnpm build:node`. Configuration
// comes from the environment; see README.md.
import { fileURLToPath } from "node:url"
import { serve } from "srvx"
import { staticMiddleware } from "srvx/static"
import { WebSocketServer } from "ws"

const app = await import("./dist/node/server/server.node.js")

try {
  app.start()
} catch (error) {
  // A setting the owner has to fix. Say what, without a stack trace to read past.
  console.error(`durable computer cannot start: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
}

const port = Number(process.env.PORT ?? 3000)
const hostname = process.env.HOST ?? "127.0.0.1"

const server = serve({
  port,
  hostname,
  // A backstop for every route: the app reads each body it accepts against a smaller limit.
  maxRequestBodySize: 32 * 1024 * 1024,
  middleware: [
    staticMiddleware({ dir: fileURLToPath(new URL("./dist/node/client", import.meta.url)) }),
  ],
  fetch: (request) => app.default.fetch(request),
})

await server.ready()

// Daemons and members' browsers dial in here. The app decides who may connect; this only moves
// the socket across.
const sockets = new WebSocketServer({ noServer: true })
server.node.server.on("upgrade", async (incoming, socket, head) => {
  const refuse = (status) => {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`)
    socket.destroy()
  }
  try {
    const url = new URL(incoming.url ?? "/", `http://${incoming.headers.host ?? "localhost"}`)
    const presence = url.pathname.startsWith(app.PRESENCE_PATH)
    if (url.pathname !== app.CONNECT_PATH && !presence) return refuse("404 Not Found")
    const headers = new Headers()
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (typeof value === "string") headers.set(name, value)
    }
    const request = new Request(url, { headers })
    // A member's browser saying where it is, or a paired computer's daemon.
    const attach = await (presence ? app.acceptPresence(request) : app.acceptDaemon(request))
    if (attach === undefined) return refuse("401 Unauthorized")
    sockets.handleUpgrade(incoming, socket, head, (accepted) => {
      attach(accepted).catch(() => accepted.close(1011, "Could not attach"))
    })
  } catch {
    refuse("500 Internal Server Error")
  }
})

console.log(`durable computer listening on ${server.url}`)

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    for (const client of sockets.clients) client.close(1001, "Server is shutting down")
    await server.close()
    process.exit(0)
  })
}
