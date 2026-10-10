import { fileURLToPath } from "node:url"
import { cloudflare } from "@cloudflare/vite-plugin"
import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

// One app, two server builds. DC_TARGET picks the runtime-specific server entry and platform
// module; everything else is shared.
const target = process.env.DC_TARGET === "cloudflare" ? "cloudflare" : "node"
const resolve = (path: string) => fileURLToPath(new URL(path, import.meta.url))

/**
 * The Node dev server has nobody to take the app's WebSockets: a paired computer's, a team's
 * presence, and the one an agent is followed over. Left alone, such a request is never
 * answered, and a browser waits on it. It is refused at once, which the client takes as "no
 * sockets here" and follows by event stream. The built server (`server.node.mjs`) and the
 * Workers runtime take them.
 */
const refuseAppSockets = (): Plugin => ({
  name: "dc:refuse-app-sockets",
  apply: "serve",
  configureServer(server) {
    server.httpServer?.on("upgrade", (request, socket) => {
      if (!(request.url ?? "").startsWith("/api/")) return
      socket.write("HTTP/1.1 501 Not Implemented\r\nConnection: close\r\n\r\n")
      socket.destroy()
    })
  },
})

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: { "#platform": resolve(`./src/server/platform.${target}.ts`) },
  },
  build: { outDir: target === "cloudflare" ? "dist/cloudflare" : "dist/node" },
  // On Node the sandbox providers' SDKs are loaded from node_modules as they are. Bundled, the
  // Daytona SDK cannot find the modules it loads on demand to move files, and every file read
  // and write fails while commands still work.
  ...(target === "node" ? { ssr: { external: ["@daytona/sdk", "modal"] } } : {}),
  plugins: [
    ...(target === "cloudflare"
      ? [cloudflare({ viteEnvironment: { name: "ssr" } })]
      : [refuseAppSockets()]),
    tailwindcss(),
    // The entry is resolved inside src/; a path that does not resolve falls back silently to
    // the framework's default entry.
    tanstackStart({ server: { entry: `server.${target}.ts` } }),
    viteReact(),
  ],
})
