// Serves the Node build: static client assets, then the app's fetch handler.
// Build first with `pnpm build:node`. Configuration comes from the environment; see README.md.
import { fileURLToPath } from "node:url"
import { serve } from "srvx"
import { staticMiddleware } from "srvx/static"

const { default: app } = await import("./dist/node/server/server.js")

const port = Number(process.env.PORT ?? 3000)
const hostname = process.env.HOST ?? "127.0.0.1"

const server = serve({
  port,
  hostname,
  middleware: [
    staticMiddleware({ dir: fileURLToPath(new URL("./dist/node/client", import.meta.url)) }),
  ],
  fetch: (request) => app.fetch(request),
})

await server.ready()
console.log(`durable computer listening on ${server.url}`)

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await server.close()
    process.exit(0)
  })
}
