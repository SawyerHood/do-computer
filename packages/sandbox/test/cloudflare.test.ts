import { homedir } from "node:os"
import { afterEach, describe, expect, it } from "vitest"
import {
  ContainerMachine,
  containerSandbox,
  ContainerUnavailable,
  DEFAULT_IMAGE,
} from "../src/cloudflare/index.ts"
import { SandboxError } from "../src/index.ts"
import { registerSandboxConformance } from "../src/testing.ts"
import { fakeContainer, fakeStore } from "./fake-container.ts"

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function world(options: { configured?: boolean; image?: string } = {}) {
  const fake = fakeContainer()
  cleanups.push(fake.cleanup)
  const storage = fakeStore()
  const clock = { now: 1_000_000 }
  const machine = new ContainerMachine(
    () => (options.configured === false ? undefined : fake.container),
    storage.store,
    {
      image: options.image ?? DEFAULT_IMAGE,
      instance: "standard-1",
      internet: true,
      home: fake.home,
    },
    () => clock.now,
  )
  const sandbox = containerSandbox({
    id: "agent-1",
    fetch: (request) => machine.fetch(request),
    home: fake.home,
  })
  /** Let time pass and run the alarm if it is due, as the runtime would. */
  const advance = async (ms: number) => {
    clock.now += ms
    if (storage.alarm !== null && storage.alarm <= clock.now) {
      storage.takeAlarm()
      await machine.alarm()
    }
  }
  return { fake, storage, clock, machine, sandbox, advance }
}

registerSandboxConformance(
  { describe, it, expect },
  "cloudflare containers",
  async () => world().sandbox,
)

describe("cloudflare containers: the machine's life", () => {
  it("starts nothing until a command runs, then starts from the image", async () => {
    const { fake, sandbox, storage } = world()
    expect(fake.state.starts).toEqual([])

    const result = await sandbox.exec("echo hello && pwd")
    expect(result).toEqual({ exitCode: 0, output: `hello\n${fake.home}\n`, timedOut: false })
    expect(fake.state.starts).toEqual([
      {
        image: DEFAULT_IMAGE,
        entrypoint: ["sleep", "infinity"],
        enableInternet: true,
        instance: "standard-1",
      },
    ])
    // Kept alive between checks, and checked.
    expect(fake.state.inactivityTimeouts.at(-1)).toBe(5 * MINUTE)
    expect(storage.alarm).not.toBe(null)

    await sandbox.exec("true")
    expect(fake.state.starts.length).toBe(1)
  })

  it("uses an image named in the Wrangler configuration by its pinned reference", async () => {
    const { fake, sandbox } = world({ image: "custom" })
    await sandbox.exec("true")
    expect(fake.state.starts[0]!.image).toBe("registry.example/custom@sha256:abc")
  })

  it("saves an idle machine and stops it, and the next command gets its files back", async () => {
    const { fake, sandbox, advance, storage } = world()
    await sandbox.exec("echo kept > note.txt && mkdir -p deep/dir && echo two > deep/dir/b.txt")
    // A background process, which a snapshot cannot carry.
    await sandbox.exec("nohup sleep 300 > /dev/null 2>&1 &")

    for (let minute = 0; minute < 10; minute++) await advance(MINUTE)
    expect(fake.state.running).toBe(true)
    await advance(MINUTE)
    expect(fake.state.running).toBe(false)
    expect(fake.state.destroyed).toEqual(["idle"])
    expect(storage.values.get("snapshotId")).toBe("snap-1")

    const read = await sandbox.exec("cat note.txt deep/dir/b.txt; pgrep -f '[s]leep 300' | wc -l")
    expect(read.output).toBe("kept\ntwo\n0\n")
    expect(fake.state.starts.at(-1)).toEqual({
      containerSnapshot: { id: "snap-1" },
      entrypoint: ["sleep", "infinity"],
      enableInternet: true,
      instance: "standard-1",
    })
  })

  it("does not stop a machine while a command is running", async () => {
    const { fake, sandbox, advance } = world()
    const long = sandbox.exec("sleep 1.5; echo finished")
    await new Promise((resolve) => setTimeout(resolve, 300))
    for (let minute = 0; minute < 30; minute++) await advance(MINUTE)
    expect(fake.state.running).toBe(true)
    expect((await long).output).toBe("finished\n")
    expect(fake.state.destroyed).toEqual([])
  })

  it("checkpoints a machine in steady use, so an unexpected stop loses little", async () => {
    const { fake, sandbox, advance, storage } = world()
    for (let step = 0; step < 4; step++) {
      await sandbox.exec(`echo ${step} > step.txt`)
      await advance(5 * MINUTE)
    }
    // Used every five minutes: never idle, but saved once fifteen minutes had passed.
    expect(fake.state.running).toBe(true)
    expect(storage.values.get("snapshotId")).toBe("snap-1")

    // The platform stops the machine without warning, after one more write.
    await sandbox.exec("echo unsaved > late.txt")
    fake.stop()
    const after = await sandbox.exec("cat step.txt; ls late.txt 2>&1 | grep -c 'No such file'")
    expect(after.output).toBe("3\n1\n")
  })

  it("restores and re-saves a stopped machine before its snapshot would expire", async () => {
    const { fake, sandbox, advance, storage } = world()
    await sandbox.exec("echo long-lived > keep.txt")
    for (let minute = 0; minute < 11; minute++) await advance(MINUTE)
    expect(fake.state.running).toBe(false)

    await advance(19 * DAY)
    expect(storage.values.get("snapshotId")).toBe("snap-1")
    await advance(2 * DAY)
    expect(storage.values.get("snapshotId")).toBe("snap-2")
    expect(fake.state.running).toBe(false)
    expect(fake.state.destroyed.at(-1)).toBe("refreshed")
    // And again, for as long as nobody uses it.
    await advance(21 * DAY)
    expect(storage.values.get("snapshotId")).toBe("snap-3")

    expect((await sandbox.exec("cat keep.txt")).output).toBe("long-lived\n")
  })

  it("does not hand out an empty disk when the saved one cannot be restored", async () => {
    const { fake, sandbox, advance } = world()
    await sandbox.exec("echo precious > data.txt")
    for (let minute = 0; minute < 11; minute++) await advance(MINUTE)
    fake.state.expired.add("snap-1")

    await expect(sandbox.exec("cat data.txt")).rejects.toThrow(/Snapshot "snap-1" was not found/)
    await expect(sandbox.exec("ls")).rejects.toThrow(ContainerUnavailable)
    expect(fake.state.starts.every((start, index) => index === 0 || !("image" in start))).toBe(true)
  })

  it("starts over from the image after a reset", async () => {
    const { fake, sandbox, machine, storage } = world()
    await sandbox.exec("echo old > old.txt")
    await machine.fetch(new Request("http://sandbox/save", { method: "POST" }))
    expect(storage.values.get("snapshotId")).toBe("snap-1")

    await machine.fetch(new Request("http://sandbox/reset", { method: "POST" }))
    expect(fake.state.running).toBe(false)
    expect((await sandbox.exec("ls | wc -l")).output.trim()).toBe("0")
    expect(fake.state.starts.at(-1)!.image).toBe(DEFAULT_IMAGE)
  })

  it("forgets the machine and its saved disk when the sandbox is destroyed", async () => {
    const { fake, sandbox, machine, storage } = world()
    await sandbox.exec("echo secret > private.txt")
    await machine.fetch(new Request("http://sandbox/save", { method: "POST" }))

    await sandbox.destroy!()
    expect(fake.state.running).toBe(false)
    expect(storage.values.has("snapshotId")).toBe(false)
  })

  it("stops a command, and what it started, when the caller aborts", async () => {
    const { sandbox } = world()
    const controller = new AbortController()
    const running = sandbox.exec("(sleep 60; echo child-finished > child.txt) & wait", {
      signal: controller.signal,
    })
    await new Promise((resolve) => setTimeout(resolve, 300))
    const started = Date.now()
    controller.abort()
    await expect(running).rejects.toThrow()
    expect(Date.now() - started).toBeLessThan(5_000)
    expect((await sandbox.exec("pgrep -f '[s]leep 60' | wc -l")).output.trim()).toBe("0")
  })

  it("gives a command only the environment it was passed", async () => {
    const { sandbox } = world()
    process.env.DC_TEST_SECRET = "from-the-server"
    const result = await sandbox.exec('echo "[$DC_TEST_SECRET][$GREETING][$HOME]"', {
      env: { GREETING: "hi" },
    })
    delete process.env.DC_TEST_SECRET
    // HOME is the image user's, looked up on the machine: here, whoever runs the tests.
    expect(result.output).toBe(`[][hi][${homedir()}]\n`)
  })

  it("reports file failures as typed errors", async () => {
    const { sandbox, fake } = world()
    const code = async (work: Promise<unknown>) =>
      work.then(
        () => "ok",
        (error) => (error instanceof SandboxError ? error.code : `other: ${error}`),
      )
    expect(await code(sandbox.fs.readFile(`${fake.home}/missing.txt`))).toBe("not_found")
    await sandbox.exec("mkdir folder")
    expect(await code(sandbox.fs.readFile(`${fake.home}/folder`))).toBe("is_directory")
    expect(
      await code(sandbox.fs.writeFile(`${fake.home}/nowhere/file.txt`, new Uint8Array([1]))),
    ).toBe("not_found")
    expect(await code(sandbox.fs.writeFile(`${fake.home}/folder`, new Uint8Array([1])))).toBe(
      "is_directory",
    )
    // An empty file is a write with nothing in it, not an error.
    await sandbox.fs.writeFile(`${fake.home}/empty.txt`, new Uint8Array())
    expect((await sandbox.fs.stat(`${fake.home}/empty.txt`))?.size).toBe(0)
  })

  it("says what is missing when the deployment has no container", async () => {
    const { sandbox } = world({ configured: false })
    await expect(sandbox.exec("true")).rejects.toThrow(/no container configured/)
  })
})
