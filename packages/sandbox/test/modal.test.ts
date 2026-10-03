import { spawn } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  modalName,
  modalSandbox,
  type ModalSandboxLike,
  type ModalSessionLike,
} from "../src/modal/index.ts"
import { registerSandboxConformance } from "../src/testing.ts"

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

class NamedError extends Error {
  constructor(name: string, message: string) {
    super(message)
    this.name = name
  }
}

type FakeSandbox = ModalSandboxLike & { ended: number | null; commands: string[][] }

/**
 * Modal for tests. A sandbox is a handle that works until it has ended; the volume is a directory
 * on this machine that every sandbox of the same name shares, and commands really run in it.
 */
function fakeModal() {
  const volume = mkdtempSync(join(tmpdir(), "dc-modal-"))
  cleanups.push(() => rmSync(volume, { recursive: true, force: true }))
  const running = new Map<string, FakeSandbox>()
  const log: string[] = []
  const faults = { open: undefined as Error | undefined, raceOnCreate: false }

  const make = (): FakeSandbox => {
    const sandbox: FakeSandbox = {
      ended: null,
      commands: [],
      poll: async () => sandbox.ended,
      terminate: async () => {
        sandbox.ended = 137
      },
      exec: async (command, params) => {
        if (sandbox.ended !== null) throw new NamedError("ClientClosedError", "Sandbox has ended")
        sandbox.commands.push(command)
        const child = spawn(command[0]!, command.slice(1), {
          cwd: params?.workdir,
          env: { PATH: process.env.PATH, ...params?.env },
        })
        child.stderr.resume()
        const exit = new Promise<number>((resolve, reject) => {
          child.on("error", reject)
          child.on("close", (code) => resolve(code ?? 1))
        })
        const stdout = new ReadableStream<string>({
          start(controller) {
            child.stdout.setEncoding("utf8")
            child.stdout.on("data", (chunk: string) => controller.enqueue(chunk))
            child.stdout.on("end", () => controller.close())
          },
        })
        return { stdout, wait: () => exit }
      },
      filesystem: {
        readBytes: async (path) => {
          if (sandbox.ended !== null) throw new NamedError("ClientClosedError", "ended")
          return new Uint8Array(await readFile(path))
        },
        writeBytes: async (data, path) => {
          if (sandbox.ended !== null) throw new NamedError("ClientClosedError", "ended")
          await writeFile(path, data)
        },
      },
    }
    return sandbox
  }

  const session: ModalSessionLike = {
    find: async (name) => {
      log.push(`find ${name}`)
      const sandbox = running.get(name)
      if (sandbox === undefined || sandbox.ended !== null) {
        throw new NamedError("NotFoundError", `Sandbox with name '${name}' not found`)
      }
      return sandbox
    },
    create: async (name) => {
      log.push(`create ${name}`)
      if (faults.raceOnCreate) {
        faults.raceOnCreate = false
        running.set(name, make())
        throw new NamedError("AlreadyExistsError", "Sandbox with this name already exists")
      }
      const sandbox = make()
      running.set(name, sandbox)
      return sandbox
    },
    deleteVolume: async (name) => {
      log.push(`delete volume ${name}`)
    },
  }
  return { session, running, log, faults, home: volume }
}

function open(id = "agent 1") {
  const fake = fakeModal()
  const clock = { now: 1_000_000 }
  let opened = 0
  const sandbox = modalSandbox({
    id,
    tokenId: "ak-test",
    tokenSecret: "as-test",
    home: fake.home,
    session: async () => {
      opened++
      if (fake.faults.open) throw fake.faults.open
      return fake.session
    },
    now: () => clock.now,
  })
  return { ...fake, sandbox, clock, name: modalName(id), opened: () => opened }
}

registerSandboxConformance({ describe, it, expect }, "modal", async () => open().sandbox)

describe("modal: finding and replacing the machine", () => {
  it("creates a named machine on first use and keeps using it", async () => {
    const { sandbox, log, name, opened } = open()
    expect(opened()).toBe(0)
    expect(name).toBe("dc-agent-1")

    expect((await sandbox.exec("echo hi; echo oops >&2")).output).toBe("hi\noops\n")
    await sandbox.exec("true")
    expect(log).toEqual([`find ${name}`, `create ${name}`])
    expect(opened()).toBe(1)
  })

  it("attaches to a machine another process already started", async () => {
    const { sandbox, log, name, session } = open()
    await session.create(name)
    log.length = 0
    await sandbox.exec("true")
    expect(log).toEqual([`find ${name}`])
  })

  it("uses the winner's machine when it loses a race to create one", async () => {
    const { sandbox, log, name, faults } = open()
    faults.raceOnCreate = true
    expect((await sandbox.exec("echo ok")).output).toBe("ok\n")
    expect(log).toEqual([`find ${name}`, `create ${name}`, `find ${name}`])
  })

  it("starts a new machine when the old one has ended, with the same workspace", async () => {
    const { sandbox, log, name, running, clock } = open()
    await sandbox.exec("echo durable > kept.txt")
    const first = running.get(name)!
    log.length = 0

    // Modal stopped it for being idle; the agent comes back twenty minutes later.
    first.ended = 0
    clock.now += 20 * 60_000
    expect((await sandbox.exec("cat kept.txt")).output).toBe("durable\n")
    expect(log).toEqual([`find ${name}`, `create ${name}`])
    expect(running.get(name)).not.toBe(first)
  })

  it("recovers when the machine ends between two commands", async () => {
    const { sandbox, log, name, running } = open()
    await sandbox.exec("true")
    log.length = 0
    running.get(name)!.ended = 137
    expect((await sandbox.exec("echo again")).output).toBe("again\n")
    expect(log).toEqual([`find ${name}`, `create ${name}`])
  })

  it("asks the volume to be written back on flush, but only if a machine was used", async () => {
    const { sandbox, running, name, opened, home } = open()
    await sandbox.flush()
    expect(opened()).toBe(0)

    await sandbox.exec("true")
    await sandbox.flush()
    expect(running.get(name)!.commands.at(-1)!.at(-1)).toContain(`sync '${home}'`)
  })

  it("stops the machine and deletes its workspace volume", async () => {
    const { sandbox, log, running, name } = open()
    await sandbox.exec("true")
    const machine = running.get(name)!
    log.length = 0

    await sandbox.destroy!()
    expect(machine.ended).not.toBe(null)
    expect(log).toEqual([`find ${name}`, `delete volume ${name}`])

    // With no machine running there is still a volume to delete.
    log.length = 0
    await sandbox.destroy!()
    expect(log).toEqual([`find ${name}`, `delete volume ${name}`])
  })

  it("reports bad credentials and tries again next time", async () => {
    const { sandbox, faults, opened } = open()
    faults.open = new Error("Token ID or secret is invalid")
    await expect(sandbox.exec("true")).rejects.toThrow(/Token ID or secret is invalid/)
    await expect(sandbox.exec("true")).rejects.toThrow(/Token ID or secret is invalid/)
    expect(opened()).toBe(2)
    faults.open = undefined
    expect((await sandbox.exec("echo in")).output).toBe("in\n")
  })
})
