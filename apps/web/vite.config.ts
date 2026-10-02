import { fileURLToPath } from "node:url"
import { cloudflare } from "@cloudflare/vite-plugin"
import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// One app, two server builds. DC_TARGET picks the runtime-specific server entry and platform
// module; everything else is shared.
const target = process.env.DC_TARGET === "cloudflare" ? "cloudflare" : "node"
const resolve = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: { "#platform": resolve(`./src/server/platform.${target}.ts`) },
  },
  build: { outDir: target === "cloudflare" ? "dist/cloudflare" : "dist/node" },
  plugins: [
    ...(target === "cloudflare" ? [cloudflare({ viteEnvironment: { name: "ssr" } })] : []),
    tailwindcss(),
    // The entry is resolved inside src/; a path that does not resolve falls back silently to
    // the framework's default entry.
    tanstackStart({ server: { entry: `server.${target}.ts` } }),
    viteReact(),
  ],
})
