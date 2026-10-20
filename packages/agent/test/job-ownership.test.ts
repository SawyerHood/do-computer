import type { Context } from "@earendil-works/chord"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { Harness } from "@earendil-works/pi-durable"
import type { JobFollowed, Sandbox, SandboxJobs } from "@do-computer/sandbox"
import { afterEach, expect, it, vi } from "vitest"
import { Jobs, type JobRecord } from "../src/jobs.ts"
import { ComputerEnv, type ComputerTarget } from "../src/computers.ts"

const opened: Jobs[] = []
afterEach(() => {
  for (const jobs of opened.splice(0)) jobs.close()
  vi.useRealTimers()
})
const running: JobFollowed = { state: "running", output: "", next: 0, kept: true }
const done: JobFollowed = {
  state: "exited",
  exitCode: 0,
  timedOut: false,
  output: "",
  next: 0,
  kept: false,
}
function world() {
  const state: {
    jobs: Record<string, JobRecord>
    next: number
    intents: Record<string, JobRecord>
  } = { jobs: {}, next: 1, intents: {} }
  const live = new Set<string>()
  const runner: SandboxJobs = {
    start: vi.fn(async (job) => {
      live.add(job.id)
      return done
    }),
    follow: vi.fn(async () => running),
    stop: vi.fn(async (id) => {
      live.delete(id)
    }),
    check: vi.fn(async (ids) =>
      Object.fromEntries(
        ids.map((id: string) => [id, { state: live.has(id) ? "running" : "lost", size: 0 }]),
      ),
    ),
    remove: vi.fn(async () => {}),
    log: (id) => `/home/test/.do-computer/jobs/a/${id}/output.log`,
  }
  const target = {
    id: "computer",
    computer: { name: "paired" },
    cwd: "/home/test",
    machine: false,
    sandbox: { jobs: () => runner, home: "/home/test" } as unknown as Sandbox,
  } as ComputerTarget
  const harness = {
    snapshot: vi.fn(async () => structuredClone(state)),
    commit: vi.fn(async (work: (tx: unknown) => Promise<unknown>, _context: Context) =>
      work({ doc: async () => state }),
    ),
  } as unknown as Harness
  const errors: unknown[] = []
  const create = () => {
    const jobs = new Jobs({
      agentId: "a",
      now: Date.now,
      context: BACKGROUND_CONTEXT,
      computer: async () => target,
      onError: (error) => errors.push(error),
    })
    jobs.attach(harness)
    opened.push(jobs)
    return jobs
  }
  const invoke = (jobs: Jobs, context = BACKGROUND_CONTEXT) => {
    const tool = jobs.bashTool as unknown as {
      execute: (args: unknown, api: unknown, context: Context) => Promise<unknown>
    }
    return tool.execute(
      { command: "test command" },
      { env: new ComputerEnv(target), conversationId: "chat", output() {}, diagnostic() {} },
      context,
    )
  }
  return { state, runner, harness, create, invoke, errors, live }
}

it("commits durable ownership before issuing start and removes it on foreground completion", async () => {
  const w = world(),
    jobs = w.create()
  vi.mocked(w.runner.start).mockImplementation(async (job) => {
    expect(w.state.intents[job.id]).toMatchObject({ command: "test command", chatId: "chat" })
    return done
  })
  await w.invoke(jobs)
  expect(w.state.intents).toEqual({})
  expect(w.state.jobs).toEqual({})
})

it("does not wait for unreachable cleanup on abort, and recovers the intent after restart", async () => {
  const w = world(),
    jobs = w.create(),
    entered = Promise.withResolvers<void>(),
    ac = new AbortController()
  vi.mocked(w.runner.start).mockImplementation(async (job, options) => {
    w.live.add(job.id)
    entered.resolve()
    return new Promise((_, reject) =>
      options.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
    )
  })
  vi.mocked(w.runner.stop).mockImplementation(() => new Promise(() => {}))
  const toolContext = { abortSignal: ac.signal } as Context
  const result = w.invoke(jobs, toolContext),
    rejected = expect(result).rejects.toThrow("aborted")
  await entered.promise
  ac.abort()
  await rejected
  expect(Object.keys(w.state.intents)).toHaveLength(1)
  const folder = Object.keys(w.state.intents)[0]!
  jobs.close()
  vi.mocked(w.runner.stop).mockImplementation(async (id) => {
    w.live.delete(id)
  })
  await w.create().tick()
  expect(w.runner.stop).toHaveBeenCalledWith(folder)
  expect(w.state.intents).toEqual({})
})

it("retains ownership when the background handoff commit fails", async () => {
  const w = world(),
    jobs = w.create(),
    toolContext = {} as Context
  vi.mocked(w.runner.start).mockImplementation(async (job) => {
    w.live.add(job.id)
    return running
  })
  const commit = vi.mocked(w.harness.commit).getMockImplementation()!
  vi.spyOn(w.harness, "commit").mockImplementation((...args) => {
    if (args[1] === toolContext) return Promise.reject(new Error("handoff failed"))
    return commit(...args)
  })
  await expect(w.invoke(jobs, toolContext)).rejects.toThrow("handoff failed")
  expect(Object.keys(w.state.intents)).toHaveLength(1)
  expect(w.state.jobs).toEqual({})
  jobs.close()
  await w.create().tick()
  expect(w.state.intents).toEqual({})
})

it("does not reclaim a successfully handed-off job from a stale intent snapshot", async () => {
  const w = world(),
    jobs = w.create(),
    entered = Promise.withResolvers<void>(),
    follow = Promise.withResolvers<JobFollowed>()
  vi.mocked(w.runner.start).mockImplementation(async (job) => {
    w.live.add(job.id)
    entered.resolve()
    return follow.promise
  })
  const result = w.invoke(jobs)
  await entered.promise
  const snapshot = Promise.withResolvers<void>()
  vi.mocked(w.harness.snapshot).mockImplementationOnce(async () => {
    const stale = structuredClone(w.state)
    await snapshot.promise
    return stale as never
  })
  const tick = jobs.tick()
  await Promise.resolve()
  await Promise.resolve()
  follow.resolve(running)
  await result
  expect(Object.keys(w.state.jobs)).toHaveLength(1)
  snapshot.resolve()
  await tick
  expect(w.runner.stop).not.toHaveBeenCalled()
})

it("bounds a reconciliation attempt without discarding an uncertain intent", async () => {
  vi.useFakeTimers()
  const w = world(),
    jobs = w.create()
  w.state.intents.orphan = {
    chatId: "chat",
    computerId: "computer",
    computer: "paired",
    command: "test command",
    folder: "orphan",
    log: "/log",
    status: "running",
    startedAt: Date.now(),
    lifeMs: 1000,
    seen: 0,
  }
  vi.mocked(w.runner.stop).mockImplementation(() => new Promise(() => {}))
  const tick = jobs.tick()
  await vi.advanceTimersByTimeAsync(30_000)
  await tick
  expect(w.state.intents.orphan).toBeDefined()
  expect(w.errors.map(String)).toContain("Error: Job cleanup timed out")
})
