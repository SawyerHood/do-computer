import { afterEach, describe, expect, it, vi } from "vitest"
import {
  ContainerMachine,
  containerSandbox,
  type ContainerLike,
  type ContainerProcessLike,
} from "../src/cloudflare/index.ts"
import { fakeStore } from "./fake-container.ts"

const BOOT = "deployment boot"
const never = <T>() => new Promise<T>(() => {})
const deferred = <T>() => Promise.withResolvers<T>()
const process = (): ContainerProcessLike => ({
  stdout: null,
  exitCode: Promise.resolve(0),
  output: async () => ({ stdout: new ArrayBuffer(0), stderr: new ArrayBuffer(0), exitCode: 0 }),
  kill: vi.fn(),
})

function world() {
  let running = false
  const exec = vi.fn<ContainerLike["exec"]>(async () => process())
  const container: ContainerLike = {
    get running() {
      return running
    },
    start: () => {
      running = true
    },
    exec,
    snapshotContainer: async () => ({ id: "snapshot", size: 0 }),
    destroy: async () => {
      running = false
    },
    setInactivityTimeout: async () => {},
  }
  const machine = new ContainerMachine(() => container, fakeStore().store, {
    image: "test",
    instance: "standard-1",
    internet: true,
    home: "/workspace",
    boot: { script: BOOT },
  })
  const sandbox = containerSandbox({ id: "test", fetch: (request) => machine.fetch(request) })
  const begin = (id: string, command = "requested command") =>
    machine.fetch(
      new Request("http://sandbox/exec", {
        method: "POST",
        body: JSON.stringify({ id, command }),
      }),
    )
  const abort = (id: string) =>
    machine.fetch(
      new Request("http://sandbox/abort", {
        method: "POST",
        body: JSON.stringify({ id }),
      }),
    )
  return { exec, machine, sandbox, begin, abort, container }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("cloudflare startup deadlines and cancellation", () => {
  it("bounds boot output even if the provider never finishes it", async () => {
    vi.useFakeTimers()
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {})
    const w = world()
    const boot = {
      ...process(),
      exitCode: never<number>(),
      output: () => never<Awaited<ReturnType<ContainerProcessLike["output"]>>>(),
    }
    w.exec.mockImplementation(async (argv) => (argv.includes(BOOT) ? boot : process()))
    const result = w.sandbox.exec("echo alive")
    await vi.advanceTimersByTimeAsync(0)
    expect(w.exec.mock.calls.find(([argv]) => argv.includes(BOOT))?.[0]).toEqual([
      "timeout",
      "--kill-after=5",
      "120.000",
      "bash",
      "-c",
      BOOT,
    ])
    await vi.advanceTimersByTimeAsync(130_000)
    expect((await result).exitCode).toBe(0)
    expect(boot.kill).toHaveBeenCalledWith(9)
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("timed out"))
    expect(vi.getTimerCount()).toBe(0)
  })

  it("bounds a pending boot exec RPC and kills a process that arrives late", async () => {
    vi.useFakeTimers()
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const w = world()
    const created = deferred<ContainerProcessLike>()
    w.exec.mockImplementation(async (argv) => (argv.includes(BOOT) ? created.promise : process()))
    const result = w.sandbox.exec("echo alive")
    await vi.advanceTimersByTimeAsync(130_000)
    expect((await result).exitCode).toBe(0)
    const late = { ...process(), exitCode: never<number>() }
    created.resolve(late)
    await vi.advanceTimersByTimeAsync(0)
    expect(late.kill).toHaveBeenCalledWith(9)
  })

  it("aborts a startup waiter without cancelling boot for another caller", async () => {
    const w = world()
    const entered = deferred<void>()
    const output = deferred<Awaited<ReturnType<ContainerProcessLike["output"]>>>()
    const boot = {
      ...process(),
      output: () => {
        entered.resolve()
        return output.promise
      },
    }
    w.exec.mockImplementation(async (argv) => (argv.includes(BOOT) ? boot : process()))
    const first = w.begin("first", "must not run")
    await entered.promise
    const second = w.begin("second", "must run")
    await w.abort("first")
    expect((await first).status).toBe(500)
    expect(boot.kill).not.toHaveBeenCalled()
    output.resolve({ stdout: new ArrayBuffer(0), stderr: new ArrayBuffer(0), exitCode: 0 })
    expect(await (await second).text()).toContain('"exitCode":0')
    expect(w.exec.mock.calls.some(([argv]) => argv.includes("must not run"))).toBe(false)
    expect(w.exec.mock.calls.some(([argv]) => argv.includes("must run"))).toBe(true)
    expect(w.exec.mock.calls.filter(([argv]) => argv.includes(BOOT))).toHaveLength(1)
  })

  it("can abort during preparation before boot starts", async () => {
    const w = world()
    const entered = deferred<void>()
    const prepared = deferred<ContainerProcessLike>()
    w.exec.mockImplementation(async (argv) => {
      if (argv[0] === "mkdir") {
        entered.resolve()
        return prepared.promise
      }
      return process()
    })
    const result = w.begin("preparing", "must not run")
    await entered.promise
    await w.abort("preparing")
    expect((await result).status).toBe(500)
    prepared.resolve(process())
    await w.sandbox.exec("next command")
    expect(w.exec.mock.calls.some(([argv]) => argv.includes("must not run"))).toBe(false)
  })

  it("can abort during the login lookup without launching the command", async () => {
    const w = world()
    const entered = deferred<void>()
    const login = deferred<ContainerProcessLike>()
    w.exec.mockImplementation(async (argv) => {
      if (argv.includes('id -un; getent passwd "$(id -u)" | cut -d: -f6')) {
        entered.resolve()
        return login.promise
      }
      return process()
    })
    const result = w.begin("login", "must not run")
    await entered.promise
    await w.abort("login")
    expect((await result).status).toBe(500)
    login.resolve(process())
    await w.sandbox.exec("next command")
    expect(w.exec.mock.calls.some(([argv]) => argv.includes("must not run"))).toBe(false)
  })

  it("propagates caller cancellation through the sandbox client during boot", async () => {
    const w = world()
    const entered = deferred<void>()
    const output = deferred<Awaited<ReturnType<ContainerProcessLike["output"]>>>()
    w.exec.mockImplementation(async (argv) =>
      argv.includes(BOOT)
        ? {
            ...process(),
            output: () => {
              entered.resolve()
              return output.promise
            },
          }
        : process(),
    )
    const controller = new AbortController()
    const result = w.sandbox.exec("must not run", { signal: controller.signal })
    const failed = expect(result).rejects.toThrow()
    await entered.promise
    controller.abort()
    await failed
    output.resolve({ stdout: new ArrayBuffer(0), stderr: new ArrayBuffer(0), exitCode: 0 })
    await w.sandbox.exec("next command")
    expect(w.exec.mock.calls.some(([argv]) => argv.includes("must not run"))).toBe(false)
  })

  it("kills a command process returned after its caller aborts", async () => {
    const w = world()
    await w.sandbox.exec("warm up")
    const entered = deferred<void>()
    const created = deferred<ContainerProcessLike>()
    w.exec.mockImplementation(async (argv) => {
      if (argv.includes("late command")) {
        entered.resolve()
        return created.promise
      }
      return process()
    })
    const result = w.begin("late", "late command")
    await entered.promise
    await w.abort("late")
    expect((await result).status).toBe(500)
    const late = { ...process(), exitCode: never<number>() }
    created.resolve(late)
    await Promise.resolve()
    await Promise.resolve()
    expect(late.kill).toHaveBeenCalledWith(9)
  })

  it("unblocks an aborted caller even if the process output never closes", async () => {
    const w = world()
    await w.sandbox.exec("warm up")
    const stuck = {
      ...process(),
      stdout: new ReadableStream<Uint8Array>(),
      exitCode: never<number>(),
    }
    w.exec.mockResolvedValue(stuck)
    const response = await w.begin("stuck")
    const body = response.text()
    const failed = expect(body).rejects.toThrow("Command aborted")
    await w.abort("stuck")
    await failed
    expect(stuck.kill).toHaveBeenCalledWith(15)
  })

  it("clears the boot deadline after a successful boot", async () => {
    vi.useFakeTimers()
    const w = world()
    await w.sandbox.exec("true")
    expect(vi.getTimerCount()).toBe(0)
  })
})
