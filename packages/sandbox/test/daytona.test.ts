import { spawn } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  type DaytonaClientLike,
  daytonaName,
  daytonaSandbox,
  type DaytonaSandboxLike,
  SandboxUnavailableError,
} from "../src/daytona/index.ts"
import { registerSandboxConformance } from "../src/testing.ts"

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message)
  }
}

type FakeMachine = DaytonaSandboxLike & { name: string; created: Record<string, unknown> }

/**
 * Daytona's API for tests. Sandboxes are directories on this machine and commands really run, but
 * only while the sandbox is `started`, as with the real thing.
 */
function fakeDaytona() {
  const root = mkdtempSync(join(tmpdir(), "dc-daytona-"))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  const machines = new Map<string, FakeMachine>()
  const log: string[] = []
  const faults = {
    get: undefined as Error | undefined,
    create: undefined as Error | undefined,
    start: undefined as Error | undefined,
    /** States a sandbox passes through, one per lookup, before settling. */
    script: [] as string[],
  }

  const requireStarted = (machine: FakeMachine) => {
    if (machine.state !== "started") throw new ApiError(400, "Sandbox is not started")
  }
  const make = (name: string, params: Record<string, unknown>): FakeMachine => {
    const machine: FakeMachine = {
      name,
      created: params,
      state: "started",
      refreshData: async () => {},
      waitUntilStarted: async () => {
        log.push("wait")
      },
      process: {
        executeCommand: (command, cwd, env) =>
          new Promise((resolve, reject) => {
            try {
              requireStarted(machine)
            } catch (error) {
              reject(error)
              return
            }
            const child = spawn("sh", ["-c", command], {
              cwd,
              env: { PATH: process.env.PATH, HOME: root, ...env },
            })
            let result = ""
            child.stdout.on("data", (chunk: Buffer) => (result += chunk.toString()))
            // Daytona returns stdout only.
            child.stderr.resume()
            child.on("error", reject)
            child.on("close", (code) => resolve({ result, exitCode: code ?? 1 }))
          }),
      },
      fs: {
        downloadFile: async (path) => {
          requireStarted(machine)
          return readFile(path)
        },
        uploadFile: async (file, path) => {
          requireStarted(machine)
          await writeFile(path, file)
        },
      },
    }
    return machine
  }

  const client: DaytonaClientLike<DaytonaSandboxLike> = {
    get: async (name) => {
      log.push(`get ${name}`)
      if (faults.get) throw faults.get
      const machine = machines.get(name)
      if (machine === undefined) throw new ApiError(404, "Sandbox not found")
      const next = faults.script.shift()
      if (next !== undefined) machine.state = next
      return machine
    },
    create: async (params) => {
      log.push(`create ${String(params.name)}`)
      if (faults.create) throw faults.create
      const machine = make(String(params.name), params)
      machines.set(machine.name, machine)
      return machine
    },
    start: async (machine) => {
      log.push("start")
      if (faults.start) throw faults.start
      machine.state = "started"
    },
    delete: async (machine) => {
      const { name } = machine as FakeMachine
      log.push(`delete ${name}`)
      machines.delete(name)
    },
  }
  return { client, machines, log, faults, home: root, make }
}

function open(id = "Agent_1") {
  const fake = fakeDaytona()
  const clock = { now: 1_000_000 }
  const sandbox = daytonaSandbox({
    id,
    apiKey: "test",
    home: fake.home,
    client: async () => fake.client,
    sleep: async () => {
      fake.log.push("sleep")
    },
    now: () => clock.now,
  })
  return { ...fake, sandbox, clock, name: daytonaName(id) }
}

registerSandboxConformance({ describe, it, expect }, "daytona", async () => open().sandbox)

describe("daytona: finding and starting the machine", () => {
  it("creates the machine on first use, under a name that stays the same", async () => {
    const { sandbox, log, machines, name } = open()
    expect(log).toEqual([])
    expect(name).toBe("dc-agent-1")

    expect((await sandbox.exec("echo hi")).output).toBe("hi\n")
    expect(log).toEqual([`get ${name}`, `create ${name}`])
    expect(machines.get(name)!.created).toEqual({
      name,
      autoStopInterval: 15,
      autoDeleteInterval: -1,
      labels: { "do-computer": "Agent_1" },
    })

    await sandbox.exec("true")
    expect(log.length).toBe(2)
  })

  it("uses the machine that already exists, starting it if it had stopped", async () => {
    const { sandbox, log, machines, make, name } = open()
    const existing = make(name, {})
    existing.state = "stopped"
    machines.set(name, existing)

    expect((await sandbox.exec("echo back")).output).toBe("back\n")
    expect(log).toEqual([`get ${name}`, "start", `get ${name}`])
  })

  it("does not create a replacement when the lookup fails for another reason", async () => {
    const { sandbox, log, faults } = open()
    faults.get = new ApiError(503, "upstream unavailable")
    await expect(sandbox.exec("true")).rejects.toThrow(SandboxUnavailableError)
    await expect(sandbox.exec("true")).rejects.toThrow(/Not creating a replacement/)
    expect(log.some((entry) => entry.startsWith("create"))).toBe(false)

    // It recovers by itself once Daytona answers again.
    faults.get = undefined
    expect((await sandbox.exec("echo ok")).output).toBe("ok\n")
  })

  it("adopts the machine when it loses a race to create it", async () => {
    const { sandbox, machines, make, name, client } = open()
    client.create = async () => {
      // Someone else gets there first.
      machines.set(name, make(name, { by: "other" }))
      throw new ApiError(409, "Sandbox name already exists")
    }
    expect((await sandbox.exec("echo shared")).output).toBe("shared\n")
    expect(machines.get(name)!.created).toEqual({ by: "other" })
  })

  it("waits out a machine that is on its way down before starting it", async () => {
    const { sandbox, log, machines, make, name, faults } = open()
    machines.set(name, make(name, {}))
    faults.script = ["stopping", "stopping", "stopped"]
    await sandbox.exec("true")
    expect(log).toEqual([
      `get ${name}`,
      "sleep",
      `get ${name}`,
      "sleep",
      `get ${name}`,
      "start",
      `get ${name}`,
    ])
  })

  it("waits for a machine that is already starting instead of starting it again", async () => {
    const { sandbox, log, machines, make, name, faults } = open()
    machines.set(name, make(name, {}))
    faults.script = ["starting", "started"]
    await sandbox.exec("true")
    expect(log).toEqual([`get ${name}`, "wait", `get ${name}`])
  })

  it("says so when the machine is broken", async () => {
    const { sandbox, machines, make, name, faults } = open()
    machines.set(name, make(name, {}))
    faults.script = ["error"]
    await expect(sandbox.exec("true")).rejects.toThrow(/is in state "error"/)
  })

  it("starts the machine again after Daytona stopped it for being idle", async () => {
    const { sandbox, log, machines, name, clock } = open()
    await sandbox.exec("echo first > kept.txt")
    log.length = 0

    // Twenty minutes later Daytona has stopped it. The agent is still running and uses it again.
    clock.now += 20 * 60_000
    machines.get(name)!.state = "stopped"
    expect((await sandbox.exec("cat kept.txt")).output).toBe("first\n")
    expect(log).toEqual([`get ${name}`, "start", `get ${name}`])
  })

  it("recovers when the machine stops between two commands", async () => {
    const { sandbox, log, machines, name } = open()
    await sandbox.exec("true")
    log.length = 0
    machines.get(name)!.state = "stopped"
    // No time has passed, so the machine was trusted; the failure is what reveals the stop.
    expect((await sandbox.exec("echo again")).output).toBe("again\n")
    expect(log).toEqual([`get ${name}`, "start", `get ${name}`])
  })

  it("deletes the machine, and treats one that is already gone as deleted", async () => {
    const { sandbox, log, machines, name, faults } = open()
    await sandbox.exec("true")
    log.length = 0

    await sandbox.destroy!()
    expect(machines.has(name)).toBe(false)
    await sandbox.destroy!()
    expect(log).toEqual([`get ${name}`, `delete ${name}`, `get ${name}`])

    // "Could not tell" is not "gone": the caller has to hear about it.
    faults.get = new ApiError(503, "upstream unavailable")
    await expect(sandbox.destroy!()).rejects.toThrow("upstream unavailable")
  })

  it("does not create a machine just to delete it", async () => {
    const { sandbox, log, name } = open()
    await sandbox.destroy!()
    expect(log).toEqual([`get ${name}`])
  })

  it("passes a command's own failure through without retrying it", async () => {
    const { sandbox, log } = open()
    await sandbox.exec("true")
    log.length = 0
    const result = await sandbox.exec("echo once >> count.txt; exit 7")
    expect(result.exitCode).toBe(7)
    expect((await sandbox.exec("wc -l < count.txt")).output.trim()).toBe("1")
    expect(log).toEqual([])
  })
})
