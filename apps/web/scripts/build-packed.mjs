// The Node build with everything it imports packed into it (`dist/packed`), which the desktop
// app brings with it to run on its owner's computer. A script, and not a setting written
// before the command, because the desktop app is built on Windows too, where that is not said
// the same way.
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

// Vite's command, which the package does not name as something to import.
const vite = join(
  dirname(createRequire(import.meta.url).resolve("vite/package.json")),
  "bin",
  "vite.js",
)
const built = spawnSync(process.execPath, [vite, "build"], {
  stdio: "inherit",
  env: { ...process.env, DC_TARGET: "node", DC_PACKED: "1" },
})
process.exit(built.status ?? 1)
