import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { build } from "esbuild"
import { afterAll, beforeAll, expect, it } from "vitest"

let root: string
let bundle: string
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "dc-doctor-"))
  bundle = join(root, "daemon.cjs")
  await build({
    entryPoints: [resolve(import.meta.dirname, "../src/main.ts")],
    outfile: bundle,
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    logLevel: "silent",
    define: { DAEMON_VERSION: '"test"' },
  })
})
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true })
})

async function doctor(
  args: string[],
  parent?: { screen: boolean; available: boolean },
  appEnabled = true,
) {
  const dir = await mkdtemp(join(root, "config-"))
  const config = JSON.stringify({
    server: "https://must-not-connect.invalid",
    computerId: "test",
    name: "test",
    token: "test-secret-marker",
    readOnly: false,
    screen: false,
  })
  await writeFile(join(dir, "daemon.json"), config, { mode: 0o600 })
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("DC_DAEMON_")),
  )
  Object.assign(
    env,
    { DC_DAEMON_DIR: dir },
    parent ? { DC_DAEMON_EMBEDDED: "1", DC_DAEMON_SCREEN: appEnabled ? "1" : "0" } : {},
  )
  const child = spawn(process.execPath, [bundle, "--doctor", ...args], { env, stdio: "pipe" })
  let buffer = ""
  let output = ""
  let stderr = ""
  const ops: string[] = []
  child.stdout.setEncoding("utf8")
  child.stdout.on("data", (text: string) => {
    buffer += text
    for (;;) {
      const at = buffer.indexOf("\n")
      if (at === -1) break
      const line = buffer.slice(0, at)
      buffer = buffer.slice(at + 1)
      if (line.startsWith("@dc-call ")) {
        const call = JSON.parse(line.slice("@dc-call ".length))
        ops.push(call.op)
        child.stdin.write(
          JSON.stringify({ id: call.id, value: { protocolVersion: 1, ...parent } }) + "\n",
        )
      } else output += line + "\n"
    }
  })
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (text: string) => {
    stderr += text
  })
  child.stdin.on("error", () => {})
  const code = await new Promise<number | null>((resolve, reject) => {
    // Keep the parent's stdin open: disposal must release its reader and let doctor exit.
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error(`doctor did not exit: ${stderr}`))
    }, 3000)
    child.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })
  expect(await readFile(join(dir, "daemon.json"), "utf8")).toBe(config)
  expect(output).not.toContain("test-secret-marker")
  expect(stderr).toBe("")
  return { code, report: JSON.parse(output), ops }
}

it("diagnoses an explicit opt-out without pairing, connecting, or changing config", async () => {
  const { code, report, ops } = await doctor(["--screen=off", "--browser=off"])
  expect(code).toBe(0)
  expect(report.screen).toMatchObject({ adapter: "none", enabled: false, state: "disabled" })
  expect(report.browser).toMatchObject({
    adapter: "dev-browser",
    enabled: false,
    state: "disabled",
  })
  expect(ops).toEqual([])
})
it("reports unsupported IPC on a standalone daemon instead of suggesting a nonexistent app toggle", async () => {
  const { code, report } = await doctor(["--screen=ipc", "--browser=off"])
  expect(code).toBe(1)
  expect(report.screen).toMatchObject({ adapter: "ipc", available: false, state: "unsupported" })
  expect(report.screen.reason).toMatch(/requires a desktop-app parent/)
})
it("verifies a real answering parent without capturing the screen", async () => {
  const { code, report, ops } = await doctor(["--screen=ipc", "--browser=off"], {
    screen: true,
    available: true,
  })
  expect(code).toBe(0)
  expect(report.screen).toMatchObject({
    adapter: "ipc",
    enabled: true,
    available: true,
    state: "ready",
  })
  expect(ops).toEqual(["hello"])
})
it("does not let an app override an explicit daemon opt-out", async () => {
  const { code, report, ops } = await doctor(
    ["--no-screen", "--screen-adapter=ipc", "--browser=off"],
    { screen: true, available: true },
  )
  expect(code).toBe(0)
  expect(report.screen).toMatchObject({ available: true, enabled: false, state: "disabled" })
  expect(ops).toEqual(["hello"])
})
it("does not let a daemon opt-in override disabled app permission", async () => {
  const { report, ops } = await doctor(
    ["--screen=ipc", "--browser=off"],
    { screen: false, available: true },
    false,
  )
  expect(report.screen).toMatchObject({ available: true, enabled: false, state: "disabled" })
  expect(ops).toEqual(["hello"])
})
it("read-only wins over both adapter permissions", async () => {
  const { report, ops } = await doctor(["--read-only", "--screen=ipc", "--browser=auto"], {
    screen: true,
    available: true,
  })
  expect(report.screen.enabled).toBe(false)
  expect(report.browser.enabled).toBe(false)
  expect(ops).toEqual(["hello"])
})
