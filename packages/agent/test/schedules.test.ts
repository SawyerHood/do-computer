import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type {
  AgentActivity,
  AgentSummary,
  ChatState,
  ChatSummary,
  ScheduleSummary,
} from "@do-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@do-computer/runtime/node"
import { justBashSandbox } from "@do-computer/sandbox"
import { createModels } from "@earendil-works/pi-ai/models"
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
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

/**
 * A model turn that creates a schedule firing `inMs` from when the model answers, then a closing
 * turn. Counted from here it could be in the past by the time a slow machine got to the model.
 */
const createSchedule = (inMs: number, prompt: string, title?: string) => [
  () =>
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

describe("automations on the bus", () => {
  /** An agent with the bus on, and its main chat, where its schedules are made. */
  async function onTheBus(world: World): Promise<ChatSummary> {
    await call(world, "/init", "POST", { ownerId: "user-1" })
    await call(world, "/", "PATCH", { bus: true })
    return call<ChatSummary>(world, "/chats/main", "POST")
  }
  const send = (text: string) =>
    fauxAssistantMessage([fauxToolCall("send", { text })], { stopReason: "toolUse" })
  const ask = async (world: World, chatId: string, text: string) => {
    await call(world, `/chats/${chatId}/messages`, "POST", { text, requestId: crypto.randomUUID() })
  }
  /** What people are shown as said in a chat with the bus on: its own words are not text there. */
  const spoken = (state: ChatState) =>
    texts({
      ...state,
      messages: state.messages
        .map((message) => ({ ...message, parts: message.parts.filter((p) => p.type === "text") }))
        .filter((message) => message.parts.length > 0),
    })
  const events = (state: ChatState) =>
    state.messages.flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "notice" && part.kind === "automation" ? [part] : [],
      ),
    )

  type Turn = { run: boolean; seen: string; last: string }
  /** Answer each request from what it was shown: the run, or the main chat. */
  function script(world: World, reply: (turn: Turn) => ReturnType<typeof fauxAssistantMessage>) {
    const turns: Turn[] = []
    world.faux.setResponses(
      Array.from({ length: 30 }, () => (context: { messages: { role: string }[] }) => {
        const seen = JSON.stringify(context.messages)
        const turn = {
          run: seen.includes("You are running the scheduled task"),
          seen,
          // The newest message, which is not the prompt: it names automations too.
          last: JSON.stringify(context.messages.findLast((message) => message.role !== "system")),
        }
        turns.push(turn)
        return reply(turn)
      }),
    )
    return turns
  }
  const creating = (inMs: number) =>
    fauxAssistantMessage(
      [
        fauxToolCall("schedule", {
          action: "create",
          schedule: new Date(Date.now() + inMs).toISOString(),
          prompt: "Check the weather.",
          title: "Weather check",
        }),
      ],
      { stopReason: "toolUse" },
    )

  it("tells the main chat what a run came to, which can stay quiet about it", async () => {
    const world = open(temporary())
    const main = await onTheBus(world)
    const turns = script(world, (turn) => {
      if (turn.run) return fauxAssistantMessage("Sunny, 21°C. Same as yesterday.")
      if (turn.last.includes("automation")) return fauxAssistantMessage("Nothing new; quiet.")
      if (turn.last.includes("Scheduled.")) return send("I will check the weather shortly.")
      if (turn.last.includes("toolResult")) return fauxAssistantMessage("ok")
      return creating(300)
    })
    await ask(world, main.id, "check the weather shortly")
    const [done] = await until(
      () => schedules(world),
      ([schedule]) => schedule?.lastRun != null,
    )
    expect(done!.lastRun).toMatchObject({ outcome: "reported" })
    const state = await until(
      () => chatState(world, main.id),
      (state) => !state.busy && turns.some((turn) => turn.last.includes("automation")),
    )
    const run = turns.find((turn) => turn.run)!
    // The run is told where its result goes, and not to stay silent.
    expect(run.seen).toContain("your final reply goes to your main conversation")
    expect(run.seen).not.toContain("[SILENT]")
    expect(run.seen).not.toContain("delivered to the user automatically")
    // The main chat is told as an event, keyed by the run.
    const told = turns.find((turn) => turn.last.includes("automation"))!
    expect(told.last).toContain('kind=\\"automation\\"')
    expect(told.last).toContain("Sunny, 21°C. Same as yesterday.")
    expect(state.messages.some((message) => message.id.startsWith("live"))).toBe(false)
    // It stayed quiet: nothing more is shown, and nobody was told.
    expect(spoken(state)).toEqual([
      "check the weather shortly",
      "I will check the weather shortly.",
    ])
    expect(events(state)).toEqual([
      expect.objectContaining({
        kind: "automation",
        text: "Weather check",
        outcome: "reported",
        chatId: done!.lastRun!.chatId,
        detail: "Sunny, 21°C. Same as yesterday.",
      }),
    ])
    expect(world.reports.filter((one) => one.kind === "scheduled")).toEqual([])
    expect(world.reports.map((one) => one.text)).toEqual(["I will check the weather shortly."])
    // A run that events set going is not reminded that it sent nothing.
    expect(turns.some((turn) => turn.last.includes("unsent"))).toBe(false)
    expect(world.errors).toEqual([])
  })

  it("sends what is worth sending from a run's result, and only that is told", async () => {
    const world = open(temporary())
    const main = await onTheBus(world)
    script(world, (turn) => {
      if (turn.run) return fauxAssistantMessage("Rain from 3pm.")
      if (turn.last.includes("automation")) return send("Heads up: rain from 3pm.")
      if (turn.last.includes("Scheduled.")) return send("Will do.")
      if (turn.last.includes("toolResult")) return fauxAssistantMessage("ok")
      return creating(300)
    })
    await ask(world, main.id, "warn me about rain")
    const state = await until(
      () => chatState(world, main.id),
      (state) => !state.busy && spoken(state).includes("Heads up: rain from 3pm."),
    )
    expect(spoken(state)).toEqual(["warn me about rain", "Will do.", "Heads up: rain from 3pm."])
    expect(world.reports.map((one) => one.text)).toEqual(["Will do.", "Heads up: rain from 3pm."])
    expect(world.reports.filter((one) => one.kind === "scheduled")).toEqual([])
  })

  it("tells the main chat once, across a restart while the event waits its turn", async () => {
    const directory = temporary()
    const world = open(directory)
    const main = await onTheBus(world)
    script(world, (turn) => {
      if (turn.last.includes("Scheduled.")) return send("Will do.")
      if (turn.last.includes("toolResult")) return fauxAssistantMessage("ok")
      return creating(400)
    })
    await ask(world, main.id, "check the weather in a moment")
    await until(
      () => chatState(world, main.id),
      (state) => !state.busy && spoken(state).includes("Will do."),
    )
    // The main chat is at work, on a long answer, when the run reports: its event waits.
    let release = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    world.faux.setResponses(
      Array.from({ length: 5 }, () => async (context: { messages: unknown[] }) => {
        if (JSON.stringify(context.messages).includes("You are running the scheduled task")) {
          return fauxAssistantMessage("Sunny.")
        }
        await held
        return fauxAssistantMessage("slow")
      }),
    )
    await ask(world, main.id, "think about it slowly")
    await until(
      () => schedules(world),
      ([schedule]) => schedule?.lastRun != null,
    )
    // Closed while the main chat still works and the event waits for it to finish.
    expect((await chatState(world, main.id)).busy).toBe(true)
    const closing = world.namespace.close()
    release()
    await closing
    worlds.splice(worlds.indexOf(world), 1)

    const again = open(directory)
    const turns = script(again, (turn) =>
      turn.seen.includes("automation") ? fauxAssistantMessage("Quiet.") : send("Done thinking."),
    )
    const state = await until(
      () => chatState(again, main.id),
      (state) => !state.busy && events(state).length > 0 && turns.length > 0,
    )
    await new Promise((resolve) => setTimeout(resolve, 400))
    const after = await chatState(again, main.id)
    expect(events(after)).toHaveLength(1)
    expect(events(state)[0]).toMatchObject({ detail: "Sunny." })
    // The model was shown it once.
    const last = turns.at(-1)!.seen
    expect(last.split('kind=\\"automation\\"').length - 1).toBe(1)
  })

  it("tells the main chat a run failed, with what it wrote first, and one that said nothing", async () => {
    const world = open(temporary())
    const main = await onTheBus(world)
    let runs = 0
    const turns = script(world, (turn) => {
      if (turn.run) {
        runs++
        return runs === 1
          ? fauxAssistantMessage("Half of the forecast", {
              stopReason: "error",
              errorMessage: "The provider is on fire.",
            })
          : fauxAssistantMessage("")
      }
      if (turn.last.includes("automation")) return fauxAssistantMessage("quiet")
      if (turn.last.includes("Scheduled.")) return send("Will do.")
      if (turn.last.includes("toolResult")) return fauxAssistantMessage("ok")
      return creating(300)
    })
    await ask(world, main.id, "check the weather")
    const [first] = await until(
      () => schedules(world),
      ([schedule]) => schedule?.lastRun != null,
    )
    expect(first!.lastRun).toMatchObject({ outcome: "failed" })
    const failed = await until(
      () => chatState(world, main.id),
      (state) => events(state).length === 1,
    )
    expect(events(failed)[0]).toMatchObject({ outcome: "failed" })
    expect(events(failed)[0]!.detail).toContain("It did not finish: The provider is on fire.")
    expect(events(failed)[0]!.detail).toContain("Half of the forecast")
    const told = await until(
      async () => turns.find((turn) => turn.last.includes("automation")),
      (found) => found !== undefined,
    )
    expect(told!.last).toContain('outcome=\\"failed\\"')

    // A run that ends with nothing to say failed too: it was asked for a result.
    await call(world, `/schedules/${first!.id}/run`, "POST")
    const empty = await until(
      () => chatState(world, main.id),
      (state) => events(state).length === 2,
    )
    expect(events(empty)[1]).toMatchObject({
      outcome: "failed",
      detail: "It ended without saying anything.",
    })
    expect((await schedules(world))[0]!.lastRun).toMatchObject({ outcome: "failed" })
  })

  it("is failed where it was stopped while a step ran, whatever it wrote before", async () => {
    const world = open(temporary())
    const main = await onTheBus(world)
    script(world, (turn) => {
      if (turn.run) {
        return fauxAssistantMessage(
          [fauxText("Let me check the forecast."), fauxToolCall("bash", { command: "sleep 20" })],
          { stopReason: "toolUse" },
        )
      }
      if (turn.last.includes("automation")) return fauxAssistantMessage("quiet")
      if (turn.last.includes("Scheduled.")) return send("Will do.")
      if (turn.last.includes("toolResult")) return fauxAssistantMessage("ok")
      return creating(300)
    })
    await ask(world, main.id, "check the weather")
    // The run is at its step when it is stopped.
    const [running] = await until(
      () => schedules(world),
      ([schedule]) => schedule?.running === true,
    )
    const chats = await until(
      async () => (await call<{ chats: ChatSummary[] }>(world, "/")).chats,
      (all) => all.some((one) => one.kind === "schedule"),
    )
    const run = chats.find((one) => one.kind === "schedule")!
    await until(
      () => chatState(world, run.id),
      (state) =>
        state.messages.some((one) =>
          one.parts.some((part) => part.type === "tool" && part.status === "running"),
        ),
    )
    await call(world, `/chats/${run.id}/abort`, "POST")
    const [done] = await until(
      () => schedules(world),
      ([schedule]) => schedule?.lastRun != null,
    )
    expect(running).toBeDefined()
    expect(done!.lastRun).toMatchObject({ outcome: "failed" })
    const state = await until(
      () => chatState(world, main.id),
      (state) => events(state).length === 1,
    )
    expect(events(state)[0]).toMatchObject({ outcome: "failed" })
    expect(events(state)[0]!.detail).toMatch(
      /^It (did not finish|was stopped before it finished)\./,
    )
    expect(events(state)[0]!.detail).toContain("Let me check the forecast.")
  })

  it("cuts a long result short in the event, and says where the rest is", async () => {
    const world = open(temporary())
    const main = await onTheBus(world)
    const long = "word ".repeat(3_000)
    const turns = script(world, (turn) => {
      if (turn.run) return fauxAssistantMessage(long)
      if (turn.last.includes("automation")) return fauxAssistantMessage("quiet")
      if (turn.last.includes("Scheduled.")) return send("Will do.")
      if (turn.last.includes("toolResult")) return fauxAssistantMessage("ok")
      return creating(300)
    })
    await ask(world, main.id, "write a lot")
    const told = await until(
      async () => turns.find((turn) => turn.last.includes("automation")),
      (found) => found !== undefined,
    )
    const [done] = await schedules(world)
    expect(told!.last).toContain(`cut short: the rest is in chat ${done!.lastRun!.chatId}`)
    expect(told!.last.length).toBeLessThan(9_000)
  })

  it("is delivered as it is without the bus where the switch went off while it ran", async () => {
    const world = open(temporary())
    const main = await onTheBus(world)
    let release = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    let started = false
    // Made, said, and then the run, which waits until the switch is off.
    world.faux.setResponses([
      creating(300),
      send("Will do."),
      fauxAssistantMessage("ok"),
      async () => {
        started = true
        await held
        return fauxAssistantMessage("Sunny.")
      },
      fauxAssistantMessage("Noted."),
    ])
    await ask(world, main.id, "check the weather")
    await until(
      async () => started,
      (yes) => yes,
    )
    await call(world, "/", "PATCH", { bus: false })
    release()
    const [done] = await until(
      () => schedules(world),
      ([schedule]) => schedule?.lastRun != null,
    )
    expect(done!.lastRun).toMatchObject({ outcome: "delivered" })
    expect(world.reports.filter((one) => one.kind === "scheduled")).toMatchObject([
      { heading: "Weather check", text: "Sunny." },
    ])
    const state = await chatState(world, main.id)
    expect(events(state)).toEqual([])
    expect(texts(state).some((text) => text.includes("Sunny."))).toBe(true)
  })

  it("fails where there is no main chat to tell", async () => {
    const world = open(temporary())
    await call(world, "/init", "POST", { ownerId: "user-1" })
    await call(world, "/", "PATCH", { bus: true })
    const side = await call<ChatSummary>(world, "/chats", "POST", {})
    world.faux.setResponses([
      ...createSchedule(250, "Check the weather."),
      fauxAssistantMessage("Sunny."),
    ])
    await say(world, side.id, "check the weather")
    const [done] = await until(
      () => schedules(world),
      ([schedule]) => schedule?.lastRun != null,
    )
    expect(done!.lastRun).toMatchObject({ outcome: "failed" })
  })

  it("is as it was where the bus is off: delivered where it was asked for", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    let runPrompt = ""
    world.faux.setResponses([
      ...createSchedule(250, "Check the weather."),
      (context) => {
        runPrompt = JSON.stringify(context.messages)
        return fauxAssistantMessage("Sunny.")
      },
    ])
    await say(world, chat.id, "check the weather")
    const [done] = await until(
      () => schedules(world),
      ([schedule]) => schedule?.lastRun != null,
    )
    expect(done!.lastRun).toMatchObject({ outcome: "delivered" })
    expect(runPrompt).toContain("[SILENT]")
    expect(world.reports.filter((one) => one.kind === "scheduled")).toHaveLength(1)
  })
})
