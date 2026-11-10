// Runs tools-check.mjs against this slot's real server, held by an Exact drive. No port polling:
// the browser check starts when the drive says it has served the page, and only its group stops.
//   node tools/tools-drive.mjs
//   TOOLS_SAME_ORIGIN=1 node tools/tools-drive.mjs
import { spawn } from "node:child_process"
import { once } from "node:events"
import { createInterface } from "node:readline"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const here = fileURLToPath(new URL("..", import.meta.url))
const slot = Number(process.env.DCX_SLOT ?? readFileSync(`${here}.slot`, "utf8").trim())
const same = process.env.TOOLS_SAME_ORIGIN === "1"
const api = process.env.API_BASE_URL ?? `http://127.0.0.1:${3911 + slot}`
const env = {
  ...process.env,
  API_BASE_URL: api,
  EXACT_PORT: String(8766 + slot),
  DC_ALLOW_PRIVATE_HOSTS: "1",
}
if (same) env.DC_EXACT_APP = `${here}target/web-dist`
const args = ["agent", "web", "--size", "1280x800"]
if (same) args.push("--url", `${api}/x/`)
args.push("clock +300000 real")
const drive = spawn("./x", args, {
  cwd: here,
  env,
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
})
const ended = once(drive, "exit")
let check
let started = false
let result = 1
const stop = () => {
  try {
    process.kill(-drive.pid, "SIGTERM")
  } catch {}
}
process.once("SIGTERM", stop)
process.once("SIGINT", stop)
const served = (line) => {
  if (started || !line.startsWith("web: do-exact served at")) return
  started = true
  check = spawn(process.execPath, ["tools/tools-check.mjs"], { cwd: here, env, stdio: "inherit" })
  check.once("exit", (code) => {
    result = code ?? 1
    stop()
  })
}
for (const output of [drive.stdout, drive.stderr]) {
  createInterface({ input: output }).on("line", (line) => {
    console.log(line)
    served(line)
  })
}
await ended
if (check && check.exitCode === null) check.kill("SIGTERM")
if (!started) console.error("tools-drive: the drive ended before serving its page")
process.exitCode = result
