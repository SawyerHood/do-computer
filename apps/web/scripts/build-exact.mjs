// The Exact app (apps/do-exact) built for this server to serve at `/x/` (`DC_EXACT_APP`, see
// src/server/exact-app.ts), into dist/exact. Not part of any other build: it needs Exact's own
// tools, which a checkout gets with `bun setup.mjs` there (apps/do-exact/PORTING.md).
//
// The app's address for the API is fixed in the build, so it is given here: the deployment's
// public origin, `DC_BASE_URL`, else `API_BASE_URL`. Served from that origin, the app takes the
// browser's own session.
//
//   DC_BASE_URL=https://agent.example.com pnpm build:exact
//   DC_EXACT_APP=dist/exact DC_BASE_URL=https://agent.example.com pnpm start
import { spawnSync } from "node:child_process"
import { existsSync, rmSync } from "node:fs"
import { fileURLToPath } from "node:url"

const app = fileURLToPath(new URL("../../do-exact/", import.meta.url))
const out = fileURLToPath(new URL("../dist/exact", import.meta.url))
const given = process.env.DC_BASE_URL || process.env.API_BASE_URL
let origin
try {
  origin = new URL(given ?? "").origin
} catch {
  console.error(
    "build:exact: set DC_BASE_URL to the origin this server is reached at, as https://agent.example.com.",
  )
  process.exit(1)
}
if (!existsSync(`${app}exact.mjs`)) {
  console.error(`build:exact: ${app} is not set up. See its PORTING.md, "Setting up a checkout".`)
  process.exit(1)
}
rmSync(out, { recursive: true, force: true })
const built = spawnSync(`${app}x`, ["web-build", "--out", out], {
  stdio: "inherit",
  env: { ...process.env, API_BASE_URL: origin, API_SOCKET_URL: origin.replace(/^http/, "ws") },
})
if (built.status === 0)
  console.log(`build:exact: ${out}, for ${origin}. Serve it with DC_EXACT_APP=${out}.`)
process.exit(built.status ?? 1)
