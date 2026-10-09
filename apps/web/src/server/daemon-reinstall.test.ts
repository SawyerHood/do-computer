import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { reinstallCommand } from "./daemon-reinstall.ts"

/**
 * A daemon from before daemons updated themselves, as far as this needs one: it runs the
 * command it is given in a shell of its own, as a daemon runs what it is sent, and says how
 * that went.
 */
const OLD = `const { spawnSync } = require("node:child_process")
const done = spawnSync("bash", ["-c", process.env.COMMAND], { encoding: "utf8" })
process.stdout.write(JSON.stringify({ code: done.status, said: done.stdout + done.stderr }))
`
/** The daemon the server serves: it says its version, and otherwise leaves word that it started. */
const NEW = `if (process.argv.includes("--version")) console.log("new")
else require("node:fs").writeFileSync(require("node:path").join(process.env.DC_DAEMON_DIR, "started"), "yes")
`

const server = createServer((_request, response) => response.end(NEW))
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
afterAll(() => void server.close())

/** Have an old daemon in a home of its own run `command`, as the server would send it. */
async function run(command: string) {
  const dir = join(mkdtempSync(join(tmpdir(), "dc-reinstall-")), ".durable-computer")
  const script = join(dir, "bin/daemon.cjs")
  mkdirSync(join(dir, "bin"), { recursive: true })
  writeFileSync(script, OLD)
  const child = spawn(process.execPath, [script, "https://app.example"], {
    env: { ...process.env, DC_DAEMON_DIR: dir, COMMAND: command },
  })
  let printed = ""
  child.stdout.on("data", (chunk) => (printed += String(chunk)))
  await new Promise((resolve) => child.on("close", resolve))
  return { dir, script, ...(JSON.parse(printed) as { code: number; said: string }) }
}

describe("replacing an old daemon from the server", () => {
  it("puts the served daemon in the running one's place, keeps the old one, and starts the new", async () => {
    const { dir, script, code, said } = await run(reinstallCommand(origin, "new"))
    expect(said).toContain("Installed daemon new.")
    expect(code).toBe(0)
    expect(readFileSync(script, "utf8")).toBe(NEW)
    expect(readFileSync(`${script}.previous`, "utf8")).toBe(OLD)
    // It is started a moment after the command has answered.
    await expect.poll(() => existsSync(join(dir, "started")), { timeout: 5_000 }).toBe(true)
  })

  it("leaves the daemon as it is when the download is not the version the server serves", async () => {
    const { dir, script, code, said } = await run(reinstallCommand(origin, "another"))
    expect(code).toBe(1)
    expect(said).toContain("not the daemon the server serves")
    expect(readFileSync(script, "utf8")).toBe(OLD)
    expect(existsSync(`${script}.new`)).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    expect(existsSync(join(dir, "started"))).toBe(false)
  })

  it("says so when the server cannot be reached, and changes nothing", async () => {
    const { script, code } = await run(reinstallCommand("http://127.0.0.1:9", "new"))
    expect(code).not.toBe(0)
    expect(readFileSync(script, "utf8")).toBe(OLD)
  })
})
