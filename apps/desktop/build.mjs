// Builds the app into dist/: the main program and the script its windows are given, each as
// one CommonJS file, the app's own pages, and the daemon it brings with it. Electron is the
// only thing left outside; it is the program that runs all of this.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs"
import { build } from "esbuild"

const common = { bundle: true, logLevel: "warning", target: "node22" }
// The deployment the app opens without asking. A build for nobody in particular has none.
const server = (process.env.DC_DESKTOP_SERVER ?? "").replace(/\/+$/, "")

rmSync("dist", { recursive: true, force: true })
mkdirSync("dist/pages", { recursive: true })

await build({
  ...common,
  entryPoints: { main: "src/main.ts", preload: "src/preload.ts" },
  outdir: "dist",
  outExtension: { ".js": ".cjs" },
  platform: "node",
  format: "cjs",
  external: ["electron"],
  define: { DEFAULT_SERVER: JSON.stringify(server) },
})
await build({
  ...common,
  entryPoints: ["src/pages/welcome.ts", "src/pages/computer.ts", "src/pages/offline.ts"],
  outdir: "dist/pages",
  platform: "browser",
  target: "chrome130",
  format: "iife",
})
for (const file of ["welcome.html", "computer.html", "offline.html", "pages.css"]) {
  cpSync(`src/pages/${file}`, `dist/pages/${file}`)
}
cpSync("assets", "dist/assets", { recursive: true })

const daemon = "../daemon/dist/daemon.cjs"
if (!existsSync(daemon)) {
  throw new Error("Build the daemon first: pnpm --filter @durable-computer/daemon build")
}
cpSync(daemon, "dist/daemon.cjs")
console.log(`desktop: built${server === "" ? "" : ` for ${server}`}`)
