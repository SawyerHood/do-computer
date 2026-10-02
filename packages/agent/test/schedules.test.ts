import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ChatState, ChatSummary, ScheduleSummary } from "@durable-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@durable-computer/runtime/node"
import { createModels } from "@earendil-works/pi-ai/models"
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"
import { afterEach, describe, expect, it } from "vitest"
import { type AgentNotification, createAgentActor } from "../src/index.ts"

type World = {
  namespace: NodeActorNamespace
  faux: ReturnType<typeof fauxProvider>
  reports: AgentNotification[]
  errors: unknown[]
}
const worlds: World[] = []

function open(directory: string): World {
  const faux = fauxProvider({ provider: "test", models: [{ id: "model" }], tokensPerSecond: 5_000 })
  const models = createModels()
  models.setProvider(faux.provider)
  const reports: AgentNotification[] = []
  const errors: unknown[] = []
  const namespace = new NodeActorNamespace({
    directory: join(directory, "actors"),
    blobs: (name) => fileBlobs(join(directory, "blobs", encodeURIComponent(name))),
    factory: (host) =>
      createAgentActor(host, {
        models,
        defaultModel: "test/model",
        modelOptions: [
          { id: "test/model", name: "Test", reasoning: false, inputCost: 0, outputCost: 0 },
        ],
        keepAliveMs: 100,
        onNotify: (notification) => reports.push(notification),
        onReport: (error) => errors.push(error),
      }),
    onError: (error) => errors.push(error),
  })
  namespace.start()
  const world = { namespace, faux, reports, errors }
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

async function until<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  ms = 8_000,
): Promise<T> {
  const deadline = Date.now() + ms
  for (;;) {
    const value = await read()
    if (done(value)) return value
    if (Date.now() > deadline) throw new Error(`Timed out; last value: ${JSON.stringify(value)}`)
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
}

const chatState = (world: World, chatId: string) => call<ChatState>(world, `/chats/${chatId}`)
const schedules = async (world: World) =>
  (await call<{ schedules: ScheduleSummary[] }>(world, "/schedules")).schedules

/** Send a message and wait for the run it starts to finish. */
async function say(world: World, chatId: string, text: string, extra: object = {}) {
  const before = (await chatState(world, chatId)).messages.length
  await call(world, `/chats/${chatId}/messages`, "POST", {
    text,
    requestId: crypto.randomUUID(),
    ...extra,
  })
  return until(
    () => chatState(world, chatId),
    (state) => !state.busy && state.messages.length > before + 1,
  )
}

/** A model turn that creates a schedule firing `inMs` from now, then a closing turn. */
const createSchedule = (inMs: number, prompt: string, title?: string) => [
  fauxAssistantMessage(
    [
      fauxToolCall("schedule", {
        action: "create",
        schedule: new Date(Date.now() + inMs).toISOString(),
        prompt,
        ...(title ? { title } : {}),
      }),
    ],
    { stopReason: "toolUse" },
  ),
  fauxAssistantMessage("I'll do that."),
]

async function setup(world: World): Promise<ChatSummary> {
  await call(world, "/init", "POST", { ownerId: "user-1" })
  return call<ChatSummary>(world, "/chats", "POST", {})
}

const temporary = () => mkdtempSync(join(tmpdir(), "dc-schedules-"))
const texts = (state: ChatState) =>
  state.messages.map((message) =>
    message.parts.map((part) => ("text" in part ? part.text : `<${part.type}>`)).join(" | "),
  )

describe("schedules", () => {
  it("runs a scheduled task in its own chat and reports back where it was asked for", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    let runPrompt = ""
    world.faux.setResponses([
      ...createSchedule(350, "Check the weather and summarize it.", "Weather check"),
      (context) => {
        runPrompt = JSON.stringify(context.messages.filter((message) => message.role === "user"))
        return fauxAssistantMessage("Sunny, 21°C.")
      },
    ])
    const asked = await say(world, chat.id, "check the weather shortly")
    expect(
      asked.messages.flatMap((m) => m.parts).find((part) => part.type === "tool"),
    ).toMatchObject({
      name: "schedule",
      status: "done",
    })
    const [created] = await schedules(world)
    expect(created).toMatchObject({
      title: "Weather check",
      enabled: true,
      running: false,
      runCount: 0,
    })

    const reported = await until(
      () => chatState(world, chat.id),
      (state) => texts(state).some((text) => text.includes("Sunny")),
    )
    expect(texts(reported).at(-1)).toBe("Weather check | Sunny, 21°C.")
    expect(runPrompt).toContain('scheduled task \\"Weather check\\"')
    expect(runPrompt).toContain("Check the weather and summarize it.")

    const [after] = await until(
      () => schedules(world),
      ([schedule]) => schedule?.lastRun != null,
    )
    // A one-shot is spent once it has run.
    expect(after).toMatchObject({ enabled: false, nextRunAt: null, running: false, runCount: 1 })
    expect(after!.lastRun).toMatchObject({ outcome: "delivered" })
    // The run has its own chat, with the full transcript, kept apart from the user's chats.
    const run = await chatState(world, after!.lastRun!.chatId)
    expect(run.messages.at(-1)!.parts).toEqual([{ type: "text", text: "Sunny, 21°C." }])
    expect(after!.lastRun!.chatId).not.toBe(chat.id)
    // The report is announced once. (These tests poll rather than follow the chat, so the
    // agent's ordinary replies are announced too; those are not what is being checked.)
    expect(world.reports.filter((notification) => notification.kind === "scheduled")).toEqual([
      {
        agentId: "agent-1",
        agentName: null,
        kind: "scheduled",
        heading: "Weather check",
        text: "Sunny, 21°C.",
        chatId: chat.id,
      },
    ])
    expect(world.errors).toEqual([])
  })

  it("puts the report in the model's context when the user replies", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    world.faux.setResponses([
      ...createSchedule(250, "Report the build status."),
      fauxAssistantMessage("Build is red."),
    ])
    await say(world, chat.id, "watch the build")
    await until(
      () => chatState(world, chat.id),
      (state) => texts(state).some((t) => t.includes("Build is red")),
    )
    let context = ""
    world.faux.setResponses([
      (seen) => {
        context = JSON.stringify(seen.messages)
        return fauxAssistantMessage("The test job failed.")
      },
    ])
    await say(world, chat.id, "tell me more")
    expect(context).toContain("ran and reported the following")
    expect(context).toContain("Build is red.")
  })

  it("delivers nothing when the task has nothing to report", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    world.faux.setResponses([
      ...createSchedule(250, "Only speak if something changed."),
      fauxAssistantMessage("[SILENT]"),
    ])
    const asked = await say(world, chat.id, "watch quietly")
    const [done] = await until(
      () => schedules(world),
      ([schedule]) => schedule?.lastRun != null,
    )
    expect(done!.lastRun).toMatchObject({ outcome: "silent" })
    expect((await chatState(world, chat.id)).messages.length).toBe(asked.messages.length)
    expect(world.reports.filter((notification) => notification.kind === "scheduled")).toEqual([])
  })

  it("still runs a schedule that came due while the process was down", async () => {
    const directory = temporary()
    const before = open(directory)
    const chat = await setup(before)
    before.faux.setResponses(createSchedule(500, "Say good morning."))
    await say(before, chat.id, "greet me soon")
    await before.namespace.close()
    await new Promise((resolve) => setTimeout(resolve, 700))

    const after = open(directory)
    after.faux.setResponses([fauxAssistantMessage("Good morning!")])
    const state = await until(
      () => chatState(after, chat.id),
      (value) => texts(value).some((text) => text.includes("Good morning!")),
    )
    expect(texts(state).filter((text) => text.includes("Good morning!")).length).toBe(1)
    expect((await schedules(after))[0]).toMatchObject({ runCount: 1, enabled: false })
  })

  it("does not let a scheduled run create schedules", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    world.faux.setResponses([
      ...createSchedule(250, "Try to schedule more work."),
      fauxAssistantMessage(
        [fauxToolCall("schedule", { action: "create", schedule: "every 1m", prompt: "again" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("I could not."),
    ])
    await say(world, chat.id, "go")
    const [done] = await until(
      () => schedules(world),
      ([schedule]) => schedule?.lastRun != null,
    )
    const run = await chatState(world, done!.lastRun!.chatId)
    const tool = run.messages.flatMap((m) => m.parts).find((part) => part.type === "tool")
    expect(tool).toMatchObject({
      status: "error",
      output: "A scheduled run cannot change schedules.",
    })
    expect((await schedules(world)).length).toBe(1)
  })

  it("can be paused, resumed, run on demand and removed", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    world.faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("schedule", {
            action: "create",
            schedule: "every 2h",
            prompt: "Stretch reminder.",
          }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Every two hours it is."),
    ])
    await say(world, chat.id, "remind me to stretch")
    const [created] = await schedules(world)
    expect(created!.nextRunAt! - Date.now()).toBeGreaterThan(7_000_000)

    const paused = await call<ScheduleSummary>(world, `/schedules/${created!.id}`, "PATCH", {
      enabled: false,
    })
    expect(paused.enabled).toBe(false)

    world.faux.setResponses([fauxAssistantMessage("Time to stretch.")])
    await call(world, `/schedules/${created!.id}/run`, "POST")
    const [ran] = await until(
      () => schedules(world),
      ([schedule]) => schedule?.lastRun != null,
    )
    // Running it by hand leaves its own timing, and its paused state, alone.
    expect(ran).toMatchObject({ enabled: false, runCount: 1, nextRunAt: created!.nextRunAt })

    const resumed = await call<ScheduleSummary>(world, `/schedules/${created!.id}`, "PATCH", {
      enabled: true,
      schedule: "every 30m",
    })
    expect(resumed).toMatchObject({ enabled: true, schedule: "every 30m" })
    expect(resumed.nextRunAt! - Date.now()).toBeLessThan(1_900_000)
    await expect(
      call(world, `/schedules/${created!.id}`, "PATCH", { schedule: "sometime" }),
    ).rejects.toThrow("400")

    await call(world, `/schedules/${created!.id}`, "DELETE")
    expect(await schedules(world)).toEqual([])
    await expect(call(world, `/schedules/${created!.id}`, "DELETE")).rejects.toThrow("400")
  })

  it("explains a schedule it cannot read, and caps how many can be active", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    world.faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("schedule", { action: "create", schedule: "whenever", prompt: "x" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("That did not parse."),
    ])
    const state = await say(world, chat.id, "do it whenever")
    const tool = state.messages.flatMap((m) => m.parts).find((part) => part.type === "tool")
    expect(tool).toMatchObject({ status: "error" })
    expect(tool?.type === "tool" && tool.output).toContain('Could not parse schedule "whenever"')

    world.faux.setResponses([
      fauxAssistantMessage(
        Array.from({ length: 21 }, (_, index) =>
          fauxToolCall("schedule", {
            action: "create",
            schedule: "every 1h",
            prompt: `task ${index}`,
          }),
        ),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Made as many as allowed."),
    ])
    await say(world, chat.id, "make 21 schedules")
    expect((await schedules(world)).length).toBe(20)
  })
})

describe("message time", () => {
  it("tells the model when each message was sent, without showing it to the user", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    let seen = ""
    world.faux.setResponses([
      (context) => {
        seen = JSON.stringify(context.messages.filter((message) => message.role === "user"))
        return fauxAssistantMessage("ok")
      },
    ])
    const state = await say(world, chat.id, "what time is it?", { timezone: "Asia/Tokyo" })
    expect(seen).toContain("<meta sent_at=")
    expect(seen).toContain("(Asia/Tokyo)")
    expect(state.messages[0]!.parts).toEqual([{ type: "text", text: "what time is it?" }])
    expect((await call<{ timezone: string }>(world, "/")).timezone).toBe("Asia/Tokyo")
  })
})
