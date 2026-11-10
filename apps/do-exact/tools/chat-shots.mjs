// Pictures of a chat with something of everything in it (tools/chat-scenario.mjs), in this app,
// at 1280x800 and 390x844, light and dark, into .exact/shots/exact/chat-*. Run from the app:
//   node tools/chat-shots.mjs [out dir]
// The React app's same pictures: node tools/chat-react-shots.mjs.
import { spawnSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { REPLIES, STEPS } from "./chat-scenario.mjs"

const here = new URL(".", import.meta.url).pathname
const app = resolve(here, "..")
const out = process.argv[2] ?? ".exact/shots/exact"
mkdirSync(resolve(app, out), { recursive: true })
const q = (text) => `'${text.replaceAll("'", "'\\''")}'`

for (const [name, size] of [["wide", "1280x800"], ["phone", "390x844"]]) {
  const steps = ["clock data", "tap sign-toggle", "type sign-name Ada", "type sign-email ada@example.com", `type sign-password ${q("correct horse")}`, "tap sign-submit", "clock data"]
  steps.push("tap new-dood", "clock data", "clock settle", "clock data")
  const both = (what) => steps.push(
    `screenshot ${out}/${name}-chat-${what}-light.png`, "prefer prefers-color-scheme dark", "clock +300 real",
    `screenshot ${out}/${name}-chat-${what}-dark.png`, "prefer prefers-color-scheme light", "clock +300 real")
  both("empty")
  for (const step of STEPS) {
    steps.push(`type composer ${q(step.say)}`, "tap send", "clock data", `clock +${step.wait ?? 3500} real`)
    if (step.shot !== undefined) both(step.shot)
  }
  const run = spawnSync("./x", ["agent", "web", "--size", size, ...steps], {
    cwd: app, encoding: "utf8", env: { ...process.env, DC_ECHO_REPLIES: JSON.stringify(REPLIES) },
  })
  for (const line of `${run.stdout}${run.stderr}`.split("\n")) if (/^screenshot|error|fail|refused|not found/i.test(line)) console.log(line)
}
