import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type {
  AgentActivity,
  AgentSummary,
  ChatState,
  ChatSummary,
  ScheduleSummary,
} from "@durable-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@durable-computer/runtime/node"
import { justBashSandbox } from "@durable-computer/sandbox"
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
  /** Everything `onActivity` was told, in the order it was told. */
  activity: Told[]
}
type Told = { agentId: string } & AgentActivity
const worlds: World[] = []

function open(directory: string, now?: () => number): World {
  const faux = fauxProvider({ provider: "test", models: [{ id: "model" }], tokensPerSecond: 5_000 })
  const models = createModels()
  models.setProvider(faux.provider)
  const reports: AgentNotification[] = []
  const errors: unknown[] = []
  const activity: Told[] = []
  const namespace = new NodeActorNamespace({
    directory: join(directory, "actors"),
    blobs: (name) => fileBlobs(join(directory, "blobs", encodeURIComponent(name))),
    now,
    factory: (host) =>
      createAgentActor(host, {
        models,
        defaultModel: "test/model",
        modelOptions: [
          { id: "test/model", name: "Test", reasoning: false, inputCost: 0, outputCost: 0 },
        ],
        keepAliveMs: 100,
        sandbox: (host) => justBashSandbox({ id: host.name, database: host.sql }),
        onNotify: (notification) => reports.push(notification),
        onReport: (error) => errors.push(error),
        onActivity: (change) => activity.push(change),
      }),
    onError: (error) => errors.push(error),
  })
  namespace.start()
  const world = { namespace, faux, reports, errors, activity }
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
    // The turn that made the schedule is over, as the hook was told.
    await until(
      async () => world.activity.at(-1),
      (told) => told?.working === false,
    )
    const rested = world.activity.length
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
    const run = await chatState(world, after!.lastRun!.chatId!)
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
    // What the run came to is the agent's latest line, under the task's title.
    const { agent } = await until(
      () => call<{ agent: AgentSummary }>(world, "/"),
      (state) => state.agent.latest?.kind === "scheduled",
    )
    expect(agent.latest).toMatchObject({
      from: "Weather check",
      text: "Sunny, 21°C.",
      chatId: chat.id,
    })
    // Nobody wrote to the agent to set the run going. The hook was told that it was at work
    // all the same, and then that it was not, with what the run came to.
    expect(
      await until(
        async () => world.activity.at(-1),
        (told) => told?.latest?.kind === "scheduled" && !told.working,
      ),
    ).toMatchObject({ latest: { from: "Weather check", text: "Sunny, 21°C." } })
    expect(world.activity.slice(rested).some((told) => told.working)).toBe(true)
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
    const run = await chatState(world, done!.lastRun!.chatId!)
    const tool = run.messages.flatMap((m) => m.parts).find((part) => part.type === "tool")
    expect(tool).toMatchObject({
      status: "error",
      output: "A scheduled run cannot change schedules.",
    })
    expect((await schedules(world)).length).toBe(1)
  })

  it("runs a reminder given as a duration once, not every time that duration passes", async () => {
    // A clock the test moves, so "in a minute" does not take one.
    const clock = { now: Date.now() }
    const world = open(temporary(), () => clock.now)
    const chat = await setup(world)
    world.faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("schedule", { action: "create", schedule: "1m", prompt: "Say: stretch." })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("In a minute."),
      fauxAssistantMessage("Stretch."),
      fauxAssistantMessage("Stretch, again?"),
    ])
    await say(world, chat.id, "remind me to stretch in a minute")
    const [created] = await schedules(world)
    expect(created!.nextRunAt).toBe(created!.createdAt + 60_000)

    // Touching the schedule makes the agent look at the clock again.
    const nudge = (title: string) => call(world, `/schedules/${created!.id}`, "PATCH", { title })
    clock.now += 61_000
    await nudge("Stretch")
    const [ran] = await until(
      () => schedules(world),
      ([schedule]) => schedule?.lastRun?.outcome === "delivered",
    )
    // Spent: it has no next time and is switched off, as a one-off should be.
    expect(ran).toMatchObject({ runCount: 1, nextRunAt: null, enabled: false })

    // Another minute, and another ten, bring nothing more.
    for (const later of [61_000, 600_000]) {
      clock.now += later
      await nudge(`Stretch ${later}`).catch(() => {})
      await new Promise((resolve) => setTimeout(resolve, 400))
    }
    expect((await schedules(world))[0]).toMatchObject({ runCount: 1, enabled: false })
    expect(
      texts(await chatState(world, chat.id)).filter((text) => text.includes("Stretch.")),
    ).toEqual(["Stretch | Stretch."])
    expect(world.errors).toEqual([])
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

/** A model turn that uses one tool, then a closing turn. */
const useTool = (name: string, args: Parameters<typeof fauxToolCall>[1], then = "Done.") => [
  fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" }),
  fauxAssistantMessage(then),
]
const toolOutput = (state: ChatState) =>
  state.messages
    .flatMap((message) => message.parts)
    .flatMap((part) => (part.type === "tool" ? [part] : []))
    .at(-1)

/** Run a schedule now and wait for that run to be over. */
async function runNow(world: World, id: string): Promise<ScheduleSummary> {
  const before = (await schedules(world)).find((schedule) => schedule.id === id)!.runCount
  await call(world, `/schedules/${id}/run`, "POST")
  const all = await until(
    () => schedules(world),
    (list) => {
      const now = list.find((schedule) => schedule.id === id)
      return now !== undefined && now.runCount > before && !now.running
    },
  )
  return all.find((schedule) => schedule.id === id)!
}

describe("a schedule with a check", () => {
  it("does not start the agent until the check prints something", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    world.faux.setResponses(
      useTool("schedule", {
        action: "create",
        schedule: "every 6h",
        prompt: "Say what broke.",
        title: "Build watch",
        check: "cat broken.txt 2>/dev/null || true",
      }),
    )
    const made = toolOutput(await say(world, chat.id, "watch the build"))
    expect(made).toMatchObject({ status: "done" })
    expect(made!.output).toContain("Checked first on computer, and you are started if it prints")
    const [created] = await schedules(world)
    expect(created).toMatchObject({
      check: {
        command: "cat broken.txt 2>/dev/null || true",
        computer: "computer",
        wake: "output",
      },
      skipCount: 0,
    })

    // Nothing is queued for the model: asking it anything would fail the run.
    world.faux.setResponses([])
    const calls = world.faux.state.callCount
    const quiet = await runNow(world, created!.id)
    expect(quiet).toMatchObject({
      lastRun: { outcome: "skipped", chatId: null },
      runCount: 1,
      skipCount: 1,
    })
    expect((await runNow(world, created!.id)).skipCount).toBe(2)
    expect(world.faux.state.callCount).toBe(calls)
    expect(world.reports.filter((notification) => notification.kind === "scheduled")).toEqual([])

    world.faux.setResponses(
      useTool("bash", { command: "echo 'tests failed on main' > broken.txt" }),
    )
    await say(world, chat.id, "break it")
    world.faux.setResponses([fauxAssistantMessage("The tests are failing on main.")])
    const woken = await runNow(world, created!.id)
    expect(woken).toMatchObject({ lastRun: { outcome: "delivered" }, runCount: 3, skipCount: 2 })
    const run = texts(await chatState(world, woken.lastRun!.chatId!))
    expect(run[0]).toContain("was run first and printed what follows")
    expect(run[0]).toContain("tests failed on main")
    expect(run[0]).toContain("Say what broke.")
    expect(texts(await chatState(world, chat.id)).at(-1)).toContain(
      "The tests are failing on main.",
    )
  })

  it("can start the agent only when what the check prints has changed", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    world.faux.setResponses([...useTool("bash", { command: "echo v1 > release.txt" }, "Written.")])
    await say(world, chat.id, "note the release")
    world.faux.setResponses(
      useTool("schedule", {
        action: "create",
        schedule: "every 6h",
        prompt: "Say which release is out.",
        check: "cat release.txt",
        wake_on: "change",
      }),
    )
    await say(world, chat.id, "tell me about new releases")
    const [created] = await schedules(world)
    expect(created!.check).toMatchObject({ wake: "change" })

    world.faux.setResponses([])
    // The first look is only taken note of, and the same again is no change.
    expect((await runNow(world, created!.id)).lastRun).toMatchObject({ outcome: "skipped" })
    expect((await runNow(world, created!.id)).lastRun).toMatchObject({ outcome: "skipped" })

    world.faux.setResponses(useTool("bash", { command: "echo v2 > release.txt" }, "Written."))
    await say(world, chat.id, "release again")
    world.faux.setResponses([fauxAssistantMessage("v2 is out.")])
    const woken = await runNow(world, created!.id)
    expect(woken).toMatchObject({ lastRun: { outcome: "delivered" }, skipCount: 2 })
    const run = texts(await chatState(world, woken.lastRun!.chatId!))
    expect(run[0]).toContain("- v1\n+ v2")

    world.faux.setResponses([])
    expect((await runNow(world, created!.id)).lastRun).toMatchObject({ outcome: "skipped" })
  })

  it("starts the agent once to say its check is broken, and not again while it stays broken", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    world.faux.setResponses(
      useTool("schedule", {
        action: "create",
        schedule: "every 6h",
        prompt: "Report the queue.",
        check: "echo no such queue; exit 3",
      }),
    )
    await say(world, chat.id, "watch the queue")
    const [created] = await schedules(world)

    world.faux.setResponses([fauxAssistantMessage("The check is failing: no such queue.")])
    const first = await runNow(world, created!.id)
    expect(first).toMatchObject({ lastRun: { outcome: "delivered" }, skipCount: 0 })
    const run = texts(await chatState(world, first.lastRun!.chatId!))
    expect(run[0]).toContain("could not be run")
    expect(run[0]).toContain("It ended with exit code 3.\nno such queue")

    world.faux.setResponses([])
    const calls = world.faux.state.callCount
    const second = await runNow(world, created!.id)
    expect(second).toMatchObject({
      lastRun: { outcome: "check-failed", chatId: null },
      skipCount: 1,
    })
    expect(world.faux.state.callCount).toBe(calls)

    // Trying it says the same, and mending it starts over.
    world.faux.setResponses(useTool("schedule", { action: "check", id: created!.id }))
    expect(toolOutput(await say(world, chat.id, "try it"))!.output).toContain("exit code 3")
    world.faux.setResponses(
      useTool("schedule", { action: "update", id: created!.id, check: "echo 4 waiting" }),
    )
    await say(world, chat.id, "mend it")
    world.faux.setResponses(useTool("schedule", { action: "check", id: created!.id }))
    const tried = toolOutput(await say(world, chat.id, "try it again"))!.output
    expect(tried).toContain("4 waiting")
    expect(tried).toContain("A run now would start you")
    world.faux.setResponses([fauxAssistantMessage("Four are waiting.")])
    expect((await runNow(world, created!.id)).lastRun).toMatchObject({ outcome: "delivered" })

    // Without its check, it is a schedule like any other.
    world.faux.setResponses(useTool("schedule", { action: "update", id: created!.id, check: "" }))
    await say(world, chat.id, "drop the check")
    expect((await schedules(world))[0]!.check).toBeNull()
  })

  it("does not run a check where running commands has been switched off", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    world.faux.setResponses(
      useTool("schedule", {
        action: "create",
        schedule: "every 6h",
        prompt: "Report.",
        check: "echo ran > proof.txt; echo something",
      }),
    )
    await say(world, chat.id, "watch")
    const [created] = await schedules(world)
    await call(world, "/approvals/rules", "PATCH", { "tool:bash": "deny" })

    world.faux.setResponses([fauxAssistantMessage("My check is switched off.")])
    const ran = await runNow(world, created!.id)
    const run = texts(await chatState(world, ran.lastRun!.chatId!))
    expect(run[0]).toContain("has switched off running commands on computer")

    // And a check cannot be made while it is: it is a command like any other.
    world.faux.setResponses(
      useTool("schedule", {
        action: "create",
        schedule: "every 6h",
        prompt: "Report.",
        check: "echo again",
      }),
    )
    const refused = toolOutput(await say(world, chat.id, "another"))
    expect(refused).toMatchObject({ status: "error" })
    expect(refused!.output).toContain("switched this off")
    expect((await schedules(world)).length).toBe(1)

    await call(world, "/approvals/rules", "PATCH", { "tool:bash": "allow" })
    world.faux.setResponses(useTool("bash", { command: "ls proof.txt 2>&1" }))
    expect(toolOutput(await say(world, chat.id, "look"))!.output).toContain("No such file")
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
