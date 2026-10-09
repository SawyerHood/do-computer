import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { supervise } from "../src/supervisor.ts"
import {
  incomingPath,
  previousPath,
  RESTART_EXIT_CODE,
  restorePrevious,
  update,
} from "../src/update.ts"

/** A daemon that can only say which version it is, which is all an update asks of a new one. */
const daemon = (version: string) =>
  `if (process.argv.includes("--version")) console.log("${version}")\n`
const sum = (text: string) => createHash("sha256").update(text).digest("hex")

/** A server that serves `bundle` and says of it what `offered` says. */
function server(bundle: string, offered: Record<string, unknown>) {
  const asked: string[] = []
  const serve = (async (input: string | URL | Request) => {
    const url = String(input)
    asked.push(new URL(url).pathname)
    return url.endsWith("/api/daemon-version") ? Response.json(offered) : new Response(bundle)
  }) as typeof fetch
  return { asked, fetch: serve }
}

function installed(version: string) {
  const script = join(mkdtempSync(join(tmpdir(), "dc-daemon-update-")), "daemon.cjs")
  writeFileSync(script, daemon(version))
  return {
    script,
    options: { server: "https://app.example", current: version, script, node: process.execPath },
  }
}

describe("updating the daemon", () => {
  it("leaves a daemon that is the one the server serves alone", async () => {
    const { script, options } = installed("one")
    const at = server(daemon("one"), { version: "one", sha256: sum(daemon("one")) })
    expect(await update({ ...options, fetch: at.fetch })).toEqual({ outcome: "current" })
    expect(at.asked).toEqual(["/api/daemon-version"])
    expect(readFileSync(script, "utf8")).toBe(daemon("one"))
  })

  it("puts a newer daemon in its place, and keeps the one it replaced", async () => {
    const { script, options } = installed("one")
    const at = server(daemon("two"), { version: "two", sha256: sum(daemon("two")) })
    expect(await update({ ...options, fetch: at.fetch })).toEqual({
      outcome: "installed",
      from: "one",
      version: "two",
    })
    expect(readFileSync(script, "utf8")).toBe(daemon("two"))
    expect(readFileSync(previousPath(script), "utf8")).toBe(daemon("one"))
    expect(existsSync(incomingPath(script))).toBe(false)
    // The one before can be put back, once.
    expect(await restorePrevious(script)).toBe(true)
    expect(readFileSync(script, "utf8")).toBe(daemon("one"))
    expect(await restorePrevious(script)).toBe(false)
  })

  it("does not install a download that is not what the server said it would send", async () => {
    const { script, options } = installed("one")
    const at = server(daemon("two").slice(0, 20), { version: "two", sha256: sum(daemon("two")) })
    await expect(update({ ...options, fetch: at.fetch })).rejects.toThrow(
      /not what the server said/,
    )
    expect(readFileSync(script, "utf8")).toBe(daemon("one"))
    expect(existsSync(incomingPath(script))).toBe(false)
  })

  it("does not install a daemon that does not run, or is not the version it was said to be", async () => {
    const { script, options } = installed("one")
    const broken = "this is not JavaScript ("
    await expect(
      update({ ...options, fetch: server(broken, { version: "two", sha256: sum(broken) }).fetch }),
    ).rejects.toThrow()
    const other = daemon("three")
    await expect(
      update({ ...options, fetch: server(other, { version: "two", sha256: sum(other) }).fetch }),
    ).rejects.toThrow(/says it is "three", not two/)
    expect(readFileSync(script, "utf8")).toBe(daemon("one"))
    expect(existsSync(incomingPath(script))).toBe(false)
    expect(existsSync(previousPath(script))).toBe(false)
  })

  it("does not fetch again a version that would not start", async () => {
    const { script, options } = installed("one")
    const at = server(daemon("two"), { version: "two", sha256: sum(daemon("two")) })
    expect(await update({ ...options, bad: "two", fetch: at.fetch })).toEqual({
      outcome: "skipped",
      version: "two",
    })
    expect(at.asked).toEqual(["/api/daemon-version"])
    expect(readFileSync(script, "utf8")).toBe(daemon("one"))
  })

  it("says so when the server is from before daemons updated themselves", async () => {
    const { options } = installed("one")
    const at = server(daemon("two"), { version: "two" })
    await expect(update({ ...options, fetch: at.fetch })).rejects.toThrow(/add up to/)
  })
})

describe("keeping the daemon running across updates", () => {
  const run = async (
    codes: number[],
    options: { restore?: boolean; stopping?: boolean; ms?: number } = {},
  ) => {
    const events: string[] = []
    let now = 0
    const code = await supervise({
      work: async () => {
        events.push("start")
        now += options.ms ?? 1_000
        return codes.shift() ?? 0
      },
      restore: async () => {
        events.push("restore")
        return options.restore ?? true
      },
      onBad: () => void events.push("bad"),
      stopping: () => options.stopping === true,
      log: () => {},
      now: () => now,
    })
    return { code, events }
  }

  it("ends when the daemon ends, with what it ended with", async () => {
    expect(await run([3])).toEqual({ code: 3, events: ["start"] })
  })

  it("starts the daemon again when it has replaced itself", async () => {
    expect(await run([RESTART_EXIT_CODE, RESTART_EXIT_CODE, 0])).toEqual({
      code: 0,
      events: ["start", "start", "start"],
    })
  })

  it("puts the old daemon back when the new one fails at once, and notes the version", async () => {
    expect(await run([RESTART_EXIT_CODE, 1, 0])).toEqual({
      code: 0,
      events: ["start", "start", "restore", "bad", "start"],
    })
  })

  it("leaves a new daemon that ran for a while, or ended well, as it is", async () => {
    expect(await run([RESTART_EXIT_CODE, 1], { ms: 60_000 })).toEqual({
      code: 1,
      events: ["start", "start"],
    })
    expect(await run([RESTART_EXIT_CODE, 0])).toEqual({ code: 0, events: ["start", "start"] })
  })

  it("does not take being stopped for the new daemon failing", async () => {
    expect(await run([130], { stopping: true })).toEqual({ code: 130, events: ["start"] })
  })

  it("gives up where there is no old daemon to put back", async () => {
    expect(await run([RESTART_EXIT_CODE, 1], { restore: false })).toEqual({
      code: 1,
      events: ["start", "start", "restore"],
    })
  })
})
