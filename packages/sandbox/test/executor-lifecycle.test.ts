import { afterEach, expect, it, vi } from "vitest"
import {
  ContainerMachine,
  containerSandbox,
  type ContainerLike,
  type ContainerProcessLike,
} from "../src/cloudflare/index.ts"
import { START_TIMEOUT_MS, SETUP_TIMEOUT_MS, EXEC_GRACE_MS } from "../src/cloudflare/deadline.ts"
import { fakeStore } from "./fake-container.ts"

const never = <T>() => new Promise<T>(() => {})
const done = (): ContainerProcessLike => ({
  stdout: null,
  exitCode: Promise.resolve(0),
  output: async () => ({ stdout: new ArrayBuffer(0), stderr: new ArrayBuffer(0), exitCode: 0 }),
  kill: vi.fn(),
})
function world() {
  let running = false
  const exec = vi.fn<ContainerLike["exec"]>(async () => done())
  const container: ContainerLike = {
    get running() {
      return running
    },
    start() {
      running = true
    },
    exec,
    setInactivityTimeout: async () => {},
    destroy: async () => {
      running = false
    },
    snapshotContainer: async () => ({ id: "saved", size: 0 }),
  }
  const store = fakeStore().store
  const restart = () =>
    new ContainerMachine(() => container, store, {
      image: "test",
      instance: "test",
      home: "/workspace",
      internet: false,
    })
  const machine = restart()
  const post = (path: string, body: unknown) =>
    machine.fetch(
      new Request(`http://sandbox/${path}`, { method: "POST", body: JSON.stringify(body) }),
    )
  return { machine, container, exec, post, restart, store }
}
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it("settles client abort even if both transport requests stay pending", async () => {
  const paths: string[] = []
  const sandbox = containerSandbox({
    id: "test",
    fetch: (request) => {
      paths.push(new URL(request.url).pathname)
      return never<Response>()
    },
  })
  const ac = new AbortController(),
    pending = sandbox.exec("unused", { signal: ac.signal })
  const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" })
  ac.abort()
  await rejected
  expect(paths).toEqual(["/exec", "/abort"])
})

it("bounds the client wait even when the execution transport never responds", async () => {
  vi.useFakeTimers()
  const sandbox = containerSandbox({ id: "test", fetch: () => never<Response>() })
  const pending = sandbox.exec("unused", { timeoutMs: 10 })
  const rejected = expect(pending).rejects.toThrow("Timed out")
  await vi.advanceTimersByTimeAsync(START_TIMEOUT_MS + SETUP_TIMEOUT_MS + 10 + EXEC_GRACE_MS)
  await rejected
  expect(vi.getTimerCount()).toBe(0)
})

it("remembers cancellation delivered before the exec request", async () => {
  const w = world()
  await w.post("abort", { id: "cancel-first" })
  const result = await w.post("exec", { id: "cancel-first", command: "must not run" })
  expect(result.status).toBe(500)
  expect(w.exec).not.toHaveBeenCalled()
  expect(w.container.running).toBe(false)
})

it("bounds preparation and retries setup instead of trusting a half-prepared VM", async () => {
  vi.useFakeTimers()
  const w = world()
  w.exec.mockImplementation(async (argv) =>
    argv[0] === "mkdir" ? never<ContainerProcessLike>() : done(),
  )
  const pending = w.post("exec", { id: "first", command: "unused" })
  await vi.advanceTimersByTimeAsync(SETUP_TIMEOUT_MS)
  expect((await pending).status).toBe(500)
  w.exec.mockImplementation(async () => done())
  const next = await w.post("exec", { id: "next", command: "echo recovered" })
  expect(await next.text()).toContain('"exitCode":0')
  expect(w.exec.mock.calls.filter(([argv]) => argv[0] === "mkdir")).toHaveLength(2)
  expect(vi.getTimerCount()).toBe(0)
})

it("recovers interrupted preparation after the Durable Object itself restarts", async () => {
  const w = world()
  w.exec.mockRejectedValueOnce(new Error("preparation interrupted"))
  expect((await w.post("exec", { id: "before", command: "unused" })).status).toBe(500)
  expect(await w.store.get("needsSetup")).toBe(true)
  const recovered = w.restart()
  const response = await recovered.fetch(
    new Request("http://sandbox/exec", {
      method: "POST",
      body: JSON.stringify({ id: "after", command: "recovered" }),
    }),
  )
  expect(await response.text()).toContain('"exitCode":0')
  expect(w.exec.mock.calls.filter(([argv]) => argv[0] === "mkdir")).toHaveLength(2)
  expect(await w.store.get("needsSetup")).toBe(false)
})

it("bounds the resume control-plane RPC outside ordinary startup", async () => {
  vi.useFakeTimers()
  const w = world()
  await (await w.post("exec", { id: "ready", command: "ready" })).text()
  w.container.setInactivityTimeout = () => never<void>()
  const pending = w.machine.resumed()
  const rejected = expect(pending).rejects.toThrow("timed out")
  await vi.advanceTimersByTimeAsync(SETUP_TIMEOUT_MS)
  await rejected
  expect(vi.getTimerCount()).toBe(0)
})

it("does not snapshot or stop shared startup after its only caller aborts", async () => {
  vi.useFakeTimers()
  const w = world(),
    snapshot = vi.spyOn(w.container, "snapshotContainer"),
    destroy = vi.spyOn(w.container, "destroy")
  w.exec.mockImplementation(() => never<ContainerProcessLike>())
  const pending = w.post("exec", { id: "boot-abort", command: "unused" })
  await vi.advanceTimersByTimeAsync(0)
  await w.post("abort", { id: "boot-abort" })
  expect((await pending).status).toBe(500)
  await w.machine.alarm()
  expect(snapshot).not.toHaveBeenCalled()
  expect(destroy).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(SETUP_TIMEOUT_MS + 5000)
  expect(vi.getTimerCount()).toBe(0)
})

it("bounds a command allocation RPC and kills a late process", async () => {
  vi.useFakeTimers()
  const w = world(),
    allocation = Promise.withResolvers<ContainerProcessLike>()
  w.exec.mockImplementation(async (argv) => (argv.includes("late") ? allocation.promise : done()))
  const pending = w.post("exec", { id: "late", command: "late", timeoutMs: 10 })
  await vi.advanceTimersByTimeAsync(10 + EXEC_GRACE_MS)
  expect((await pending).status).toBe(500)
  const process = { ...done(), exitCode: never<number>() }
  allocation.resolve(process)
  await vi.advanceTimersByTimeAsync(0)
  expect(process.kill).toHaveBeenCalledWith(9)
  const next = await w.post("exec", { id: "next", command: "next" })
  expect(await next.text()).toContain('"exitCode":0')
  await vi.advanceTimersByTimeAsync(5000)
  expect(vi.getTimerCount()).toBe(0)
})

it("bounds stdout drain independently of an already resolved exit code", async () => {
  vi.useFakeTimers()
  const w = world()
  const stuck = { ...done(), stdout: new ReadableStream<Uint8Array>() }
  w.exec.mockImplementation(async (argv) => (argv.includes("held pipe") ? stuck : done()))
  const response = await w.post("exec", { id: "pipe", command: "held pipe", timeoutMs: 10 })
  const rejected = expect(response.text()).rejects.toThrow("timed out")
  await vi.advanceTimersByTimeAsync(10 + EXEC_GRACE_MS)
  await rejected
  const next = await w.post("exec", { id: "next", command: "next" })
  expect(await next.text()).toContain('"exitCode":0')
  await vi.advanceTimersByTimeAsync(5000)
  expect(vi.getTimerCount()).toBe(0)
})
