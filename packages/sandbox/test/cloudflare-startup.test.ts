import { afterEach, describe, expect, it, vi } from "vitest"
import {
  ContainerMachine,
  containerSandbox,
  type ContainerLike,
  type ContainerProcessLike,
} from "../src/cloudflare/index.ts"
import { SETUP_TIMEOUT_MS } from "../src/cloudflare/deadline.ts"
import { fakeStore } from "./fake-container.ts"

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
  it("bounds setup output even if the provider never finishes it", async () => {
    vi.useFakeTimers()
    const w = world()
    const setup = {
      ...process(),
      exitCode: never<number>(),
      output: () => never<Awaited<ReturnType<ContainerProcessLike["output"]>>>(),
    }
    w.exec.mockImplementation(async (argv) => (argv[0] === "mkdir" ? setup : process()))
    const result = w.sandbox.exec("must not run")
    const failed = expect(result).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(SETUP_TIMEOUT_MS + 1_000)
    await failed
    expect(setup.kill).toHaveBeenCalledWith(9)
    expect(w.exec.mock.calls.some(([argv]) => argv.includes("must not run"))).toBe(false)
  })

  it("bounds a pending setup exec RPC and kills a process that arrives late", async () => {
    vi.useFakeTimers()
    const w = world()
    const created = deferred<ContainerProcessLike>()
    w.exec.mockImplementation(async (argv) => (argv[0] === "mkdir" ? created.promise : process()))
    const result = w.sandbox.exec("must not run")
    const failed = expect(result).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(SETUP_TIMEOUT_MS + 1_000)
    await failed
    const late = { ...process(), exitCode: never<number>() }
    created.resolve(late)
    await vi.advanceTimersByTimeAsync(0)
    expect(late.kill).toHaveBeenCalledWith(9)
  })

  it("aborts a startup waiter without cancelling setup for another caller", async () => {
    const w = world()
    const entered = deferred<void>()
    const output = deferred<Awaited<ReturnType<ContainerProcessLike["output"]>>>()
    const setup = {
      ...process(),
      output: () => {
        entered.resolve()
        return output.promise
      },
    }
    w.exec.mockImplementation(async (argv) => (argv[0] === "mkdir" ? setup : process()))
    const first = w.begin("first", "must not run")
    await entered.promise
    const second = w.begin("second", "must run")
    await w.abort("first")
    expect((await first).status).toBe(500)
    expect(setup.kill).not.toHaveBeenCalled()
    output.resolve({ stdout: new ArrayBuffer(0), stderr: new ArrayBuffer(0), exitCode: 0 })
    expect(await (await second).text()).toContain('"exitCode":0')
    expect(w.exec.mock.calls.some(([argv]) => argv.includes("must not run"))).toBe(false)
    expect(w.exec.mock.calls.some(([argv]) => argv.includes("must run"))).toBe(true)
    expect(w.exec.mock.calls.filter(([argv]) => argv[0] === "mkdir")).toHaveLength(1)
  })

  it("can abort during preparation", async () => {
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

  it("propagates caller cancellation through the sandbox client during setup", async () => {
    const w = world()
    const entered = deferred<void>()
    const output = deferred<Awaited<ReturnType<ContainerProcessLike["output"]>>>()
    w.exec.mockImplementation(async (argv) =>
      argv[0] === "mkdir"
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

  it("clears startup deadlines after a successful start", async () => {
    vi.useFakeTimers()
    const w = world()
    await w.sandbox.exec("true")
    expect(vi.getTimerCount()).toBe(0)
  })
})
