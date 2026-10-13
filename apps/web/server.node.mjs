// Serves the Node build: static client assets, then the app's fetch handler, plus the WebSocket
// that paired computers' daemons connect on. Build first with `pnpm build:node`. Configuration
// comes from the environment; see docs/reference/configuration.md.
import { fileURLToPath } from "node:url"
import { serve } from "srvx"
import { staticMiddleware } from "srvx/static"
import { WebSocketServer } from "ws"

const app = await import("./dist/node/server/server.node.js")

try {
  app.start()
} catch (error) {
  // A setting the owner has to fix. Say what, without a stack trace to read past.
  console.error(`Do Computer cannot start: ${error instanceof Error ? error.message : error}`)
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

// Daemons and people's browsers dial in here. The app decides who may connect; this only moves
// the socket across.
const sockets = new WebSocketServer({ noServer: true })
server.node.server.on("upgrade", async (incoming, socket, head) => {
  const refuse = (status) => {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`)
    socket.destroy()
  }
  try {
    const url = new URL(incoming.url ?? "/", `http://${incoming.headers.host ?? "localhost"}`)
    const headers = new Headers()
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (typeof value === "string") headers.set(name, value)
    }
    const request = new Request(url, { headers })
    // A paired computer's daemon, a member's browser saying where it is, or a browser
    // following an agent or its workspace's library.
    const attach =
      url.pathname === app.CONNECT_PATH
        ? await app.acceptDaemon(request)
        : url.pathname.startsWith(app.PRESENCE_PATH)
          ? await app.acceptPresence(request)
          : await app.acceptFollower(request)
    if (attach === null) return refuse("404 Not Found")
    if (attach === undefined) return refuse("401 Unauthorized")
    sockets.handleUpgrade(incoming, socket, head, (accepted) => {
      attach(accepted).catch(() => accepted.close(1011, "Could not attach"))
    })
  } catch {
    refuse("500 Internal Server Error")
  }
})

console.log(`Do Computer listening on ${server.url}`)

let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  for (const client of sockets.clients) client.close(1001, "Server is shutting down")
  // A connection that is slow to go must not keep the server from stopping.
  setTimeout(() => process.exit(0), 3_000).unref()
  await server.close()
  process.exit(0)
}

for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, stop)

// The desktop app runs the server as part of itself, and tells it to stop by closing its
// input. That is also how the server ends if the app is killed, on every system.
if (process.env.DC_STOP_WITH_INPUT === "1") {
  process.stdin.on("end", stop).on("close", stop).on("error", stop)
  process.stdin.resume()
}
