import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ChatSummary } from "@do-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@do-computer/runtime/node"
import { Type } from "@earendil-works/pi-ai"
import { createModels } from "@earendil-works/pi-ai/models"
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"
import {
  defineExtension,
  defineTask,
  defineTool,
  type Extension,
  type HarnessInspection,
  type TaskInspection,
} from "@earendil-works/pi-durable"
import { afterEach, describe, expect, it } from "vitest"
import { createAgentActor } from "../src/index.ts"
import { liveWork } from "../src/live.ts"
import { quietOnReminder } from "./quiet.ts"

/** A task that never ends by itself, as one a deployment had and a later one has not. */
const Stall = defineTask<Record<string, never>, { phase: "run" }, null>({
  name: "test.stall",
  version: 1,
  initial: () => ({ phase: "run" }),
  phases: {
    run: (_task, _runtime, context) =>
      new Promise<void>((_resolve, reject) => {
        const signal = context.abortSignal
        signal?.addEventListener("abort", () => reject(signal.reason))
      }),
  },
  abort: async (_task, runtime, context) => {
    await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context)
  },
})

const Stalling = defineExtension({
  name: "test.stalling",
  tasks: [Stall],
  tools: [
    defineTool({
      name: "stall",
      description: "Start work that does not end.",
      parameters: Type.Object({}),
      execute: async (_args, api, context) => {
        await api.createTask(
          Stall,
          {},
          { ownership: { kind: "conversation" }, background: true },
          context,
        )
        return { output: [{ type: "text", text: "Started." }] }
      },
    }),
  ],
})

type World = {
  namespace: NodeActorNamespace
  faux: ReturnType<typeof fauxProvider>
  reports: unknown[]
  /** Every wake-up the agent set or cleared, in order. */
  alarms: (number | null)[]
}

const worlds: World[] = []

function open(directory: string, extensions: Extension[]): World {
  const faux = quietOnReminder(
    fauxProvider({ provider: "test", models: [{ id: "model" }], tokensPerSecond: 2_000 }),
  )
  const models = createModels()
  models.setProvider(faux.provider)
  const reports: unknown[] = []
  const alarms: (number | null)[] = []
  const namespace = new NodeActorNamespace({
    directory: join(directory, "actors"),
    blobs: (name) => fileBlobs(join(directory, "blobs", encodeURIComponent(name))),
    factory: (host) => {
      const setAlarm = host.setAlarm.bind(host)
      return createAgentActor(
        Object.assign(host, {
          setAlarm: (at: number | null) => {
            alarms.push(at)
            return setAlarm(at)
          },
        }),
        {
          models,
          defaultModel: "test/model",
          modelOptions: [
            { id: "test/model", name: "Test", reasoning: false, inputCost: 0, outputCost: 0 },
          ],
          keepAliveMs: 50,
          extensions,
          onReport: (error) => reports.push(error),
        },
      )
    },
    onError: (error) => reports.push(error),
  })
  namespace.start()
  const world = { namespace, faux, reports, alarms }
  worlds.push(world)
  return world
}

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.namespace.close().catch(() => {})
})

async function call<T>(world: World, path: string, method = "GET", payload?: unknown): Promise<T> {
  const response = await world.namespace.get("agent-1").fetch(
    new Request(`http://actor${path}`, {
      method,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      headers: payload === undefined ? undefined : { "content-type": "application/json" },
    }),
  )
  const result = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(`${response.status}: ${result.error}`)
  return result
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const working = async (world: World) =>
  (await call<{ agent: { working: boolean } }>(world, "/")).agent.working

describe("work this deployment cannot run", () => {
  it("is not woken for, and is not the agent at work", async () => {
    const directory = mkdtempSync(join(tmpdir(), "dc-blocked-"))
    const before = open(directory, [Stalling])
    await call(before, "/init", "POST", { ownerId: "user-1" })
    const chat = await call<ChatSummary>(before, "/chats/main", "POST", {})
    before.faux.setResponses([
      fauxAssistantMessage([fauxToolCall("stall", {})], { stopReason: "toolUse" }),
      fauxAssistantMessage("It is started."),
    ])
    await call(before, `/chats/${chat.id}/messages`, "POST", {
      text: "start it",
      requestId: crypto.randomUUID(),
    })
    // The answer is in and the task goes on: it keeps the agent waking, as live work does.
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      const state = await call<{ busy: boolean; messages: unknown[] }>(before, `/chats/${chat.id}`)
      if (!state.busy && state.messages.length >= 2) break
      await pause(20)
    }
    const woken = before.alarms.length
    await pause(300)
    expect(before.alarms.length).toBeGreaterThan(woken)
    expect(before.alarms.at(-1)).not.toBeNull()
    expect(before.reports).toEqual([])
    await before.namespace.close()

    // A deployment without the task's definition. Its recorded alarm wakes the agent once.
    const after = open(directory, [])
    const settle = Date.now() + 5_000
    while (after.reports.length === 0 && Date.now() < settle) await pause(20)
    await pause(300)
    expect(after.alarms.filter((at) => at !== null)).toEqual([])

    // Asking after it does not set it waking again, and it is said once that it cannot run.
    expect(await working(after)).toBe(false)
    expect(await working(after)).toBe(false)
    await pause(200)
    expect(after.alarms.filter((at) => at !== null)).toEqual([])
    expect(after.reports.map(String)).toEqual([
      expect.stringMatching(/test\.stall v1.*cannot run in this deployment: missing_task/),
    ])
  })
})

describe("liveWork", () => {
  let next = 1
  const task = (
    state: TaskInspection["state"],
    more: { conversationId?: string; owner?: string } = {},
  ) =>
    ({
      record: {
        id: String(next++),
        conversationId: more.conversationId ?? "c1",
        owner: more.owner,
      },
      state,
    }) as unknown as TaskInspection
  const blocked = { kind: "blocked", reason: "missing_task" } as const
  const inspection = (tasks: TaskInspection[], submissions: string[] = []) =>
    ({
      scheduling: "running",
      tasks,
      submissions: submissions.map((conversationId) => ({ conversationId })),
    }) as unknown as HarnessInspection
  const id = (one: TaskInspection) => String(one.record.id)

  it("counts tasks and messages as live where nothing is blocked", () => {
    expect(liveWork(inspection([])).live).toBe(false)
    expect(liveWork(inspection([task({ kind: "running" })])).live).toBe(true)
    expect(liveWork(inspection([task({ kind: "waiting", on: [] })])).live).toBe(true)
    expect(liveWork(inspection([], ["c1"])).live).toBe(true)
  })

  it("does not count a blocked task, what waits on it, or a message behind it", () => {
    const tool = task(blocked)
    const generation = task({ kind: "waiting", on: [tool.record.id] })
    const work = liveWork(inspection([tool, generation], ["c1"]))
    expect(work.live).toBe(false)
    expect(work.blocked).toEqual([tool])
  })

  it("does not count a task whose outcome is held for blocked work it owns", () => {
    const owner = task({ kind: "completing" })
    const child = task(blocked, { owner: id(owner) })
    expect(liveWork(inspection([owner, child])).live).toBe(false)
    // One that owns nothing live is about to end by itself.
    expect(liveWork(inspection([task({ kind: "completing" }), task(blocked)])).live).toBe(true)
  })

  it("counts what can still get further beside a blocked task", () => {
    const stuck = task(blocked)
    const other = task({ kind: "running" })
    expect(
      liveWork(
        inspection([
          stuck,
          task({ kind: "waiting", on: [stuck.record.id, other.record.id] }),
          other,
        ]),
      ).live,
    ).toBe(true)
    expect(liveWork(inspection([stuck, other])).live).toBe(true)
    // A message in a chat with nothing stuck in it is about to be taken up.
    expect(liveWork(inspection([stuck], ["c2"])).live).toBe(true)
    expect(liveWork(inspection([stuck], ["c1"])).live).toBe(false)
  })
})
