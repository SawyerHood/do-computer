import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AppAnswer, AppCall } from "@durable-computer/daemon/events"
import { afterEach, describe, expect, it } from "vitest"
import { DaemonRunner } from "../src/daemon.ts"

// A stand-in for the daemon: it asks the app one thing, writes down what it was answered and
// what it was started with, and stays until its input closes, as the daemon does.
const STAND_IN = `
const fs = require("node:fs")
const out = process.env.DC_DAEMON_DIR + "/heard.json"
const heard = { screen: process.env.DC_DAEMON_SCREEN, browser: process.env.DC_DAEMON_BROWSER, answers: [] }
fs.writeFileSync(out, JSON.stringify(heard))
console.log("[2026-10-09T10:00:00.000Z] started")
console.log('@dc-call {"id":"c1","op":"hold","held":true}')
console.log("@dc-call not json")
let rest = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  const lines = (rest + chunk).split("\\n")
  rest = lines.pop()
  for (const line of lines) heard.answers.push(JSON.parse(line))
  fs.writeFileSync(out, JSON.stringify(heard))
})
process.stdin.on("end", () => process.exit(0))
`

let running: DaemonRunner | undefined
afterEach(async () => {
  await running?.stop()
  running = undefined
})

function runner(options: {
  onCall?: (call: AppCall) => Promise<AppAnswer>
  abilities?: () => { screen: boolean; browser: boolean }
}) {
  const dir = mkdtempSync(join(tmpdir(), "dc-calls-"))
  const script = join(dir, "daemon.cjs")
  writeFileSync(script, STAND_IN)
  running = new DaemonRunner({
    script,
    dir,
    node: process.execPath,
    env: () => ({ ...process.env }),
    onChange: () => {},
    onRevoked: () => {},
    ...options,
  })
  const heard = () => {
    try {
      return JSON.parse(readFileSync(join(dir, "heard.json"), "utf8")) as {
        screen?: string
        browser?: string
        answers: AppAnswer[]
      }
    } catch {
      return undefined
    }
  }
  const until = async (met: () => boolean) => {
    for (let tries = 0; tries < 200 && !met(); tries++)
      await new Promise((resolve) => setTimeout(resolve, 25))
    expect(met()).toBe(true)
  }
  return { runner: running, heard, until }
}

describe("what the daemon asks of the app", () => {
  it("is answered on the daemon's input, a line each, and kept out of what its owner reads", async () => {
    const calls: AppCall[] = []
    const {
      runner: daemon,
      heard,
      until,
    } = runner({
      onCall: async (call) => {
        calls.push(call)
        return { id: call.id, value: { done: true } }
      },
    })
    daemon.start("https://do.example", false)
    await until(() => heard()?.answers.length === 1)
    expect(calls).toEqual([{ id: "c1", op: "hold", held: true }])
    expect(heard()?.answers).toEqual([{ id: "c1", value: { done: true } }])
    expect(daemon.lines).toEqual(["[2026-10-09T10:00:00.000Z] started", "@dc-call not json"])
  })

  it("is answered with what went wrong when the app could not do it", async () => {
    const {
      runner: daemon,
      heard,
      until,
    } = runner({
      onCall: async () => {
        throw new Error("The screen fell over.")
      },
    })
    daemon.start("https://do.example", false)
    await until(() => heard()?.answers.length === 1)
    expect(heard()?.answers).toEqual([
      { id: "c1", error: { refused: false, message: "The screen fell over." } },
    ])
  })

  it("is refused by an app that has no screen to offer", async () => {
    const { runner: daemon, heard, until } = runner({})
    daemon.start("https://do.example", false)
    await until(() => heard()?.answers.length === 1)
    expect(heard()?.answers[0]?.error?.refused).toBe(true)
  })
})

describe("what agents may use, as the daemon is told", () => {
  it("is the screen when it is switched on, and no browser when that is switched off", async () => {
    let allowed = { screen: false, browser: true }
    const { runner: daemon, heard, until } = runner({ abilities: () => allowed })
    daemon.start("https://do.example", false)
    await until(() => heard() !== undefined)
    expect(heard()?.screen).toBeUndefined()
    expect(heard()?.browser).toBeUndefined()

    // The daemon says what it can do as it connects, so a change starts it again.
    allowed = { screen: true, browser: false }
    await daemon.restart()
    await until(() => heard()?.screen === "1")
    expect(heard()?.browser).toBe("0")
    expect(daemon.running).toBe(true)
  })
})
