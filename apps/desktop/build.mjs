// Builds the app into dist/: the main program and the script its windows are given, each as
// one CommonJS file, the app's own pages, and the daemon it brings with it. Electron is the
// only thing left outside; it is the program that runs all of this.
import { execFileSync } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
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

// What is drawn over the screen while an agent uses it: a page, and the script its window is
// given. The companion on the desktop is a page of the deployment, and has only a script.
await build({
  ...common,
  entryPoints: { "overlay-preload": "src/overlay-preload.ts", "pet-preload": "src/pet-preload.ts" },
  outdir: "dist",
  outExtension: { ".js": ".cjs" },
  platform: "node",
  format: "cjs",
  external: ["electron"],
})
await build({
  ...common,
  entryPoints: ["src/pages/overlay.ts"],
  outdir: "dist/pages",
  platform: "browser",
  target: "chrome130",
  format: "iife",
})
for (const file of ["overlay.html", "overlay.css"]) {
  cpSync(`src/pages/${file}`, `dist/pages/${file}`)
}

// What uses the screen for agents: Cua Driver. It is programs for one system and a package
// that can only be imported, so it is not part of main.cjs: its packages are copied as they
// are, to where the app looks for them (see `driverDir` in src/main.ts).
//
// Which system is the one being built for. A Mac is given both kinds of chip, since the app
// made for it is one that runs on either.
const arch = process.env.DC_DESKTOP_ARCH ?? process.arch
const targets =
  process.platform === "darwin"
    ? ["darwin-arm64", "darwin-x64"]
    : process.platform === "win32"
      ? [`win32-${arch}-msvc`]
      : [`linux-${arch}-gnu`]
const driverTo = "dist/driver/node_modules"
const installed = realpathSync("node_modules/@trycua/cua-driver")
const manifest = (dir) => JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"))

/** Copy a package that is installed beside `from`, as its dependencies are, and say whether it was. */
function bring(name, from) {
  const dir = path.join(from, ...name.split("/").map(() => ".."), name)
  if (!existsSync(dir)) return undefined
  cpSync(realpathSync(dir), path.join(driverTo, name), { recursive: true, dereference: true })
  return realpathSync(dir)
}

/** Fetch a package that was not installed: one for a system other than the one building. */
function fetch(name, version) {
  const into = mkdtempSync(path.join(tmpdir(), "dc-driver-"))
  const shell = process.platform === "win32"
  // npm says the name of the file it made, which is the last thing it prints.
  const packed = execFileSync("npm", ["pack", `${name}@${version}`, "--pack-destination", into], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    shell,
  })
  const file = packed.trim().split(/\r?\n/).at(-1)
  mkdirSync(path.join(driverTo, name), { recursive: true })
  execFileSync("tar", ["-xzf", file, "--strip-components=1", "-C", path.resolve(driverTo, name)], {
    cwd: into,
    stdio: "inherit",
  })
  rmSync(into, { recursive: true, force: true })
}

bring("@trycua/cua-driver", installed)
bring("@ubjs/core", installed)
const ubjs = bring("@ubjs/node", installed)
if (ubjs === undefined) throw new Error("The driver's own packages are not installed: pnpm install")
for (const target of targets) {
  // Each has a program of its own for the system: the driver, and what lets Node call it.
  for (const [name, from] of [
    [`@trycua/cua-driver-${target}`, installed],
    [`@ubjs/node-${target}`, ubjs],
  ]) {
    if (bring(name, from) === undefined) fetch(name, manifest(from).optionalDependencies[name])
  }
}

const daemon = "../daemon/dist/daemon.cjs"
if (!existsSync(daemon)) {
  throw new Error("Build the daemon first: pnpm --filter @durable-computer/daemon build")
}
cpSync(daemon, "dist/daemon.cjs")
console.log(`desktop: built${server === "" ? "" : ` for ${server}`}`)
