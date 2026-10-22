import { mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { expect, it } from "vitest"
import { commands } from "../src/adapters/command.ts"

it("passes literal text on stdin and collects binary output", async () => {
  const text = "--not-an-option; $(not-a-shell)"
  const result = await commands(process.env)(
    process.execPath,
    ["-e", "process.stdin.pipe(process.stdout)"],
    { input: text },
  )
  expect(result.toString()).toBe(text)
})
it.skipIf(process.platform === "win32")(
  "does not wait for an escaped descendant to close inherited pipes",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "dc-screen-pipes-"))
    const file = join(directory, "pid")
    try {
      const script = `const {spawn}=require("node:child_process"); const child=spawn(process.execPath,["-e","setTimeout(()=>{},30000)"],{detached:true,stdio:["ignore",1,2]}); require("node:fs").writeFileSync(process.argv[1],String(child.pid)); child.unref()`
      await expect(
        commands(process.env, 1000)(process.execPath, ["-e", script, file]),
      ).rejects.toThrow(/timed out/)
      expect(Number(await readFile(file, "utf8"))).toBeGreaterThan(0)
    } finally {
      const pid = Number(await readFile(file, "utf8").catch(() => "0"))
      if (pid > 0) {
        try {
          process.kill(-pid, "SIGKILL")
        } catch {}
      }
      await rm(directory, { recursive: true, force: true })
    }
  },
  5000,
)
it("does not spawn a pre-aborted command", async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(
    commands(process.env)("must-not-exist", [], { signal: controller.signal }),
  ).rejects.toMatchObject({ name: "AbortError" })
})
it("settles a command at its own deadline", async () => {
  await expect(
    commands(process.env, 30)(process.execPath, ["-e", "setInterval(() => {}, 1000)"]),
  ).rejects.toThrow(/timed out/)
})
it("aborts a command without waiting for normal process completion", async () => {
  const controller = new AbortController()
  const pending = commands(process.env)(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    signal: controller.signal,
  })
  const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" })
  controller.abort()
  await rejected
})
