import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type AgentUsage,
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
import { createAgentActor } from "../src/index.ts"
import { mightBeMidway } from "../src/keep-going.ts"

type World = {
  namespace: NodeActorNamespace
  faux: ReturnType<typeof fauxProvider>
  reports: unknown[]
  /** What the judging model was shown, one entry for each time it was asked. */
  judged: string[]
  /** What it answers next; the last one repeats. An Error fails the call. */
  verdicts: (string | Error)[]
}
const worlds: World[] = []

function open(directory: string, judge = true): World {
  const faux = fauxProvider({ provider: "test", models: [{ id: "model" }], tokensPerSecond: 5_000 })
  const models = createModels()
  models.setProvider(faux.provider)
  const world: World = {
    namespace: undefined as never,
    faux,
    reports: [],
    judged: [],
    verdicts: [],
  }
  const reply = (content: string) =>
    Response.json({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 150, completion_tokens: 2, cost: 0.00002 },
    })
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
        ...(judge
          ? {
              judge: {
                apiKey: "key",
                model: "tiny/judge",
                fetch: async (_url, init) => {
                  const sent = JSON.parse(String(init.body)) as {
                    messages: { role: string; content: string }[]
                  }
                  world.judged.push(sent.messages[1]!.content)
                  const next =
                    world.verdicts.length > 1 ? world.verdicts.shift()! : world.verdicts[0]!
                  if (next instanceof Error) {
                    return Response.json({ error: { message: next.message } }, { status: 500 })
                  }
                  return reply(next)
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

const step = (command: string) =>
  fauxAssistantMessage([fauxToolCall("bash", { command })], { stopReason: "toolUse" })
const shape = (state: ChatState) =>
  state.messages.map((message) => [
    message.role,
    message.parts.map((part) => (part.type === "text" ? part.text : part.type)).join(" + "),
  ])
const temporary = () => mkdtempSync(join(tmpdir(), "dc-keep-going-"))

describe("an agent that stops on a progress update", () => {
  it("is set going again, and finishes what it was doing", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    world.verdicts = ["CONTINUE", "DONE"]
    let nudged = ""
    world.faux.setResponses([
      step("echo a > a.txt"),
      // A word on the way with no tool call: its turn ends here, though it means to go on.
      fauxAssistantMessage("a.txt is done, making b.txt next."),
      (context) => {
        nudged = JSON.stringify(context.messages.at(-1))
        return step("echo b > b.txt")
      },
      fauxAssistantMessage("Both files are made."),
    ])
    const state = await converse(world, chat.id, "Make a.txt and b.txt, one at a time.")

    expect(shape(state)).toEqual([
      ["user", "Make a.txt and b.txt, one at a time."],
      ["assistant", "tool"],
      ["assistant", "a.txt is done, making b.txt next."],
      ["assistant", "tool"],
      ["assistant", "Both files are made."],
    ])
    // The agent was told why it is going again. Nobody said that in the chat, so it is not in it.
    expect(nudged).toContain('<meta kind=\\"continue\\">')
    expect(state.messages.filter((message) => message.role === "user")).toHaveLength(1)
    // The small model was shown what was asked, what was done, and the message in question.
    expect(world.judged[0]).toContain("Asked: Make a.txt and b.txt, one at a time.")
    expect(world.judged[0]).toContain("1. Ran: echo a > a.txt")
    expect(world.judged[0]).toContain("The message it just sent: a.txt is done, making b.txt next.")
    expect(world.reports).toEqual([])
    // What the asking cost is counted as the agent's, under the model that was asked. It is
    // written down after the fact, so it is there a moment later.
    await expect
      .poll(async () => {
        const usage = await call<AgentUsage>(world, "/usage")
        const row = usage.models.find((entry) => entry.model === "openrouter/tiny/judge")
        return row === undefined ? undefined : [row.inputTokens, row.outputTokens]
      })
      .toEqual([300, 4])
  })

  it("is left alone when the small model says it was done", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    world.verdicts = ["DONE"]
    world.faux.setResponses([step("echo a > a.txt"), fauxAssistantMessage("a.txt is made.")])
    const state = await converse(world, chat.id, "Make a.txt.")
    expect(state.messages.at(-1)!.parts).toEqual([{ type: "text", text: "a.txt is made." }])
    expect(world.judged).toHaveLength(1)
  })

  it("is only set going a few times in a row, so one that never acts does stop", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    world.verdicts = ["CONTINUE"]
    const promises = () =>
      Array.from({ length: 6 }, () => fauxAssistantMessage("On it, starting now."))
    world.faux.setResponses(promises())
    const state = await converse(world, chat.id, "Tidy my notes.")
    // Its first reply, and one more for each of the three times it was set going.
    expect(state.messages.filter((message) => message.role === "assistant")).toHaveLength(4)
    expect(world.judged).toHaveLength(3)

    // The next thing the user says starts the count again.
    world.faux.setResponses(promises())
    await converse(world, chat.id, "Please do.")
    expect(world.judged).toHaveLength(6)
  })

  it("stops as before when nothing is there to judge, or the judging fails", async () => {
    const none = open(temporary(), false)
    const chat = await setup(none)
    none.faux.setResponses([step("echo a"), fauxAssistantMessage("Done with a, doing b next.")])
    const ended = await converse(none, chat.id, "Do a and b.")
    expect(ended.messages.at(-1)!.parts).toEqual([
      { type: "text", text: "Done with a, doing b next." },
    ])

    const failing = open(temporary())
    const other = await setup(failing)
    failing.verdicts = [new Error("overloaded")]
    failing.faux.setResponses([step("echo a"), fauxAssistantMessage("Done with a, doing b next.")])
    const kept = await converse(failing, other.id, "Do a and b.")
    // The answer is not lost to a failed check. It is reported, and the run ends.
    expect(kept.messages.at(-1)!.parts).toEqual([
      { type: "text", text: "Done with a, doing b next." },
    ])
    expect(failing.reports.map(String).join("\n")).toContain(
      "Could not check whether the agent meant to stop: overloaded",
    )
  })
})

describe("an agent that says how the work is going with the progress tool", () => {
  it("is heard in the chat and carries on, with nothing judging it", async () => {
    // No small model at all: the tool alone keeps the turn going.
    const world = open(temporary(), false)
    const chat = await setup(world)
    let told = ""
    world.faux.setResponses([
      step("echo a > a.txt"),
      fauxAssistantMessage(
        [fauxToolCall("progress", { message: "a.txt is done, making b.txt next." })],
        { stopReason: "toolUse" },
      ),
      (context) => {
        told = JSON.stringify(context.messages.at(-1))
        // A word and a step in one reply.
        return fauxAssistantMessage(
          [
            fauxToolCall("progress", { message: "Writing b.txt now." }),
            fauxToolCall("bash", { command: "echo b > b.txt" }),
          ],
          { stopReason: "toolUse" },
        )
      },
      fauxAssistantMessage("Both files are made."),
    ])
    const state = await converse(world, chat.id, "Make a.txt and b.txt, one at a time.")

    // What it said is among its words, not among its steps.
    const expected = [
      ["user", "Make a.txt and b.txt, one at a time."],
      ["assistant", "tool"],
      ["assistant", "a.txt is done, making b.txt next."],
      ["assistant", "Writing b.txt now. + tool"],
      ["assistant", "Both files are made."],
    ]
    expect(shape(state)).toEqual(expected)
    expect(told).toContain("Shown to them")
    // It reads the same to someone who opens the chat afterwards.
    expect(shape(await call<ChatState>(world, `/chats/${chat.id}`))).toEqual(expected)
    expect(world.reports).toEqual([])
  })

  it("is heard once when it also writes the same words in that reply", async () => {
    const world = open(temporary(), false)
    const chat = await setup(world)
    world.faux.setResponses([
      fauxAssistantMessage(
        [
          { type: "text", text: "a.txt is done." },
          fauxToolCall("progress", { message: "a.txt is done. Pausing before b.txt." }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("All made."),
    ])
    const state = await converse(world, chat.id, "Make a.txt and b.txt.")
    expect(shape(state).slice(1)).toEqual([
      ["assistant", "a.txt is done. Pausing before b.txt."],
      ["assistant", "All made."],
    ])
  })
})

describe("which final messages are worth asking about", () => {
  it("asks about a short message after some work, or one that says what comes next", () => {
    expect(mightBeMidway("b.txt done, waiting 3s then making c.txt next.", 2)).toBe(true)
    expect(mightBeMidway("On it, I'll look into that now.", 0)).toBe(true)
    expect(mightBeMidway("Let me check the logs.", 0)).toBe(true)
  })

  it("does not ask about a question, a long answer, or plain talk before any work", () => {
    expect(mightBeMidway("Which folder should I use?", 3)).toBe(false)
    expect(mightBeMidway("Hello! Good to meet you.", 0)).toBe(false)
    expect(mightBeMidway("x".repeat(501), 3)).toBe(false)
    expect(mightBeMidway("", 3)).toBe(false)
  })
})
