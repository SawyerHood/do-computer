import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type AgentEvent,
  type AgentUsage,
  type ChatActivity,
  type ChatEvent,
  type ChatState,
  type ChatSummary,
  EMPTY_CHAT,
  readSse,
  reduceChat,
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
import { describeRun, readSummary } from "../src/activity.ts"
import { createAgentActor } from "../src/index.ts"

type Reply = { status?: number; body: unknown }
type World = {
  namespace: NodeActorNamespace
  faux: ReturnType<typeof fauxProvider>
  reports: unknown[]
  /** What the summarizing model was sent, one entry for each request. */
  asked: string[]
  /** What it answers next; the last one repeats. */
  replies: Reply[]
}
const worlds: World[] = []

const reply = (content: string): Reply => ({
  body: {
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 200, completion_tokens: 20, cost: 0.0004 },
  },
})

function open(directory: string, summaries = true): World {
  const faux = fauxProvider({ provider: "test", models: [{ id: "model" }], tokensPerSecond: 5_000 })
  const models = createModels()
  models.setProvider(faux.provider)
  const world: World = { namespace: undefined as never, faux, reports: [], asked: [], replies: [] }
  world.namespace = new NodeActorNamespace({
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
        sandbox: (host) => justBashSandbox({ id: host.name, database: host.sql }),
        ...(summaries
          ? {
              summaries: {
                apiKey: "key",
                model: "tiny/summarizer",
                fetch: async (_url, init) => {
                  const sent = JSON.parse(String(init.body)) as {
                    model: string
                    messages: { role: string; content: string }[]
                  }
                  expect(sent.model).toBe("tiny/summarizer")
                  world.asked.push(sent.messages.at(-1)!.content)
                  const next = world.replies.length > 1 ? world.replies.shift()! : world.replies[0]!
                  return Response.json(next.body, { status: next.status ?? 200 })
                },
              },
            }
          : {}),
        onReport: (error) => world.reports.push(error),
      }),
    onError: (error) => world.reports.push(error),
  })
  world.namespace.start()
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

/** Send a message and return the chat once the run has finished. */
async function converse(world: World, chatId: string, text: string): Promise<ChatState> {
  const response = await world.namespace
    .get("agent-1")
    .fetch(new Request(`http://actor/chats/${chatId}/events`))
  await call(world, `/chats/${chatId}/messages`, "POST", { text, requestId: crypto.randomUUID() })
  let state = EMPTY_CHAT
  let started = false
  for await (const event of readSse<ChatEvent>(response.body!)) {
    state = reduceChat(state, event)
    started ||= state.busy
    if (started && !state.busy) break
  }
  return state
}

async function setup(world: World): Promise<ChatSummary> {
  await call(world, "/init", "POST", { ownerId: "user-1" })
  return call<ChatSummary>(world, "/chats", "POST", {})
}

const work = (command: string, answer: string) => [
  fauxAssistantMessage([fauxToolCall("bash", { command })], { stopReason: "toolUse" }),
  fauxAssistantMessage(answer),
]
const activity = (world: World, chatId: string) =>
  call<ChatActivity>(world, `/chats/${chatId}/activity`)
const temporary = () => mkdtempSync(join(tmpdir(), "dc-activity-"))

describe("summaries of what the agent did", () => {
  it("are written by the small model once a run has ended, and announced", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    world.replies = [
      reply('{"title": "List the workspace", "outcome": "Found four identity files."}'),
    ]
    const events = await world.namespace.get("agent-1").fetch(new Request("http://actor/events"))
    const announced = (async () => {
      for await (const event of readSse<AgentEvent>(events.body!)) {
        if (event.type === "changed" && event.what === "activity") return true
      }
      return false
    })()

    world.faux.setResponses(work("ls", "There are four files."))
    const state = await converse(world, chat.id, "What is in my workspace?")
    const asked = state.messages.find((message) => message.role === "user")!
    await expect
      .poll(async () => (await activity(world, chat.id)).runs[asked.id], { timeout: 10_000 })
      .toEqual({ title: "List the workspace", outcome: "Found four identity files." })
    expect(await announced).toBe(true)

    // It was shown the run as it ended: what was asked, the step, and the answer.
    const shown = world.asked.at(-1)!
    expect(shown).toContain("Asked: What is in my workspace?")
    expect(shown).toContain("Status: finished")
    expect(shown).toContain("1. Ran: ls")
    expect(shown).toContain("Said back: There are four files.")
    expect(world.reports).toEqual([])

    // Looking again does not have it written again.
    const calls = world.asked.length
    await activity(world, chat.id)
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(world.asked.length).toBe(calls)
  })

  it("are written every few steps while a long run is still going, and again when it ends", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    world.replies = [
      reply('{"title": "Tidy the notes", "outcome": "Listed the files; now sorting them."}'),
      reply('{"title": "Tidy the notes", "outcome": "Sorted the notes into three folders."}'),
    ]
    const step = (command: string) =>
      fauxAssistantMessage([fauxToolCall("bash", { command })], { stopReason: "toolUse" })
    world.faux.setResponses([
      step("echo one"),
      step("echo two"),
      step("echo three"),
      // Long enough for the summary of the first three to be asked for while it runs.
      step("sleep 1; echo four"),
      fauxAssistantMessage("All tidy."),
    ])
    const state = await converse(world, chat.id, "tidy my notes")
    const asked = state.messages.find((message) => message.role === "user")!
    await expect
      .poll(async () => (await activity(world, chat.id)).runs[asked.id]?.outcome, {
        timeout: 10_000,
      })
      .toBe("Sorted the notes into three folders.")
    expect(world.asked).toHaveLength(2)
    expect(world.asked[0]).toContain("Status: still working")
    expect(world.asked[0]).toContain("3. Ran: echo three")
    expect(world.asked[1]).toContain("Status: finished")
    expect(world.asked[1]).toContain("Steps (4):")
  })

  it("count toward what the agent has cost, under the model that wrote them", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    world.replies = [reply('{"title": "Say hi", "outcome": "Printed a greeting."}')]
    world.faux.setResponses(work("echo hi", "Done."))
    await converse(world, chat.id, "say hi in the shell")
    await expect
      .poll(async () => Object.keys((await activity(world, chat.id)).runs).length, {
        timeout: 10_000,
      })
      .toBe(1)
    const usage = await call<AgentUsage>(world, "/usage")
    const row = usage.models.find((entry) => entry.model === "openrouter/tiny/summarizer")!
    expect(row.cost).toBeGreaterThan(0)
    expect(row.inputTokens % 200).toBe(0)
    expect(usage.total.cost).toBeCloseTo(row.cost)
  })

  it("leave a reply that is only words alone, and are not written without a model for them", async () => {
    const talk = open(temporary())
    const chat = await setup(talk)
    talk.replies = [reply('{"title": "x", "outcome": "y"}')]
    talk.faux.setResponses([fauxAssistantMessage("Hello.")])
    await converse(talk, chat.id, "hi")
    await new Promise((resolve) => setTimeout(resolve, 1_800))
    expect(await activity(talk, chat.id)).toEqual({ runs: {} })
    expect(talk.asked).toEqual([])

    const none = open(temporary(), false)
    const other = await setup(none)
    none.faux.setResponses(work("ls", "Listed."))
    await converse(none, other.id, "list it")
    await new Promise((resolve) => setTimeout(resolve, 1_800))
    expect(await activity(none, other.id)).toEqual({ runs: {} })
  })

  it("show nothing for a reply that cannot be used, and do not ask for it again", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    world.replies = [reply("Sure! Here is a summary of the work.")]
    world.faux.setResponses(work("ls", "Listed."))
    await converse(world, chat.id, "list it")
    await expect.poll(() => world.asked.length, { timeout: 10_000 }).toBe(1)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(await activity(world, chat.id)).toEqual({ runs: {} })
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(world.asked.length).toBe(1)
  })

  it("report a model that fails, and leave the chat alone for a while after", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    world.replies = [{ status: 500, body: { error: { message: "overloaded" } } }]
    world.faux.setResponses(work("ls", "Listed."))
    await converse(world, chat.id, "list it")
    await expect.poll(() => world.reports.length, { timeout: 10_000 }).toBe(1)
    expect(String(world.reports[0])).toContain("could not be written: overloaded")
    const calls = world.asked.length
    expect(await activity(world, chat.id)).toEqual({ runs: {} })
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(world.asked.length).toBe(calls)
  })
})

describe("what the summarizing model is given, and what is taken from it", () => {
  it("describes a long run by its latest steps, and says which ones failed", () => {
    const steps = Array.from({ length: 45 }, (_, index) => ({
      type: "tool" as const,
      toolCallId: `c${index}`,
      name: "bash",
      args: { command: `step ${index}` },
      status: index === 44 ? ("error" as const) : ("done" as const),
      output: index === 44 ? "permission denied" : "ok",
    }))
    const text = describeRun({ id: "1", asked: "do it", steps, answer: "", status: "working" })
    expect(text).toContain("Status: still working")
    expect(text).toContain("Steps (45):")
    expect(text).toContain("(5 earlier steps are not listed)")
    expect(text).not.toContain("Ran: step 4\n")
    expect(text).toContain("Ran: step 44 [failed: permission denied]")
    expect(text).toContain("Said back: (nothing yet)")
  })

  it("reads the title and outcome out of a reply, however it is wrapped", () => {
    expect(readSummary('{"title":"Fix the build.","outcome":"Repaired the config."}')).toEqual({
      title: "Fix the build",
      outcome: "Repaired the config.",
    })
    expect(
      readSummary('```json\n{"title": "Fix the build", "outcome": "Repaired it."}\n```'),
    ).toEqual({ title: "Fix the build", outcome: "Repaired it." })
    expect(readSummary("no json here")).toBeUndefined()
    expect(readSummary('{"title": "", "outcome": "x"}')).toBeUndefined()
    expect(readSummary('{"title": 3, "outcome": "x"}')).toBeUndefined()
  })
})
