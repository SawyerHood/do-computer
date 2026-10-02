import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type ChatEvent,
  type ChatState,
  type ChatSummary,
  EMPTY_CHAT,
  readSse,
  reduceChat,
  type ToolPart,
} from "@durable-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@durable-computer/runtime/node"
import { justBashSandbox, type Sandbox } from "@durable-computer/sandbox"
import { createModels } from "@earendil-works/pi-ai/models"
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"
import { afterEach, describe, expect, it } from "vitest"
import { createAgentActor } from "../src/index.ts"

type World = {
  namespace: NodeActorNamespace
  faux: ReturnType<typeof fauxProvider>
  reports: unknown[]
}
const worlds: World[] = []

function open(
  directory: string,
  wrap: (sandbox: Sandbox) => Sandbox = (sandbox) => sandbox,
): World {
  const faux = fauxProvider({ provider: "test", models: [{ id: "model" }], tokensPerSecond: 5_000 })
  const models = createModels()
  models.setProvider(faux.provider)
  const reports: unknown[] = []
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
        sandbox: (host) => wrap(justBashSandbox({ id: host.name, database: host.sql })),
        onReport: (error) => reports.push(error),
      }),
    onError: (error) => reports.push(error),
  })
  namespace.start()
  const world = { namespace, faux, reports }
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

const tools = (state: ChatState) =>
  state.messages
    .flatMap((message) => message.parts)
    .filter((part): part is ToolPart => part.type === "tool")

/** One model turn that runs a shell command, then a closing turn. */
const bash = (command: string) => [
  fauxAssistantMessage([fauxToolCall("bash", { command })], { stopReason: "toolUse" }),
  fauxAssistantMessage("done"),
]

async function setup(world: World): Promise<ChatSummary> {
  await call(world, "/init", "POST", { ownerId: "user-1" })
  return call<ChatSummary>(world, "/chats", "POST", {})
}

const temporary = () => mkdtempSync(join(tmpdir(), "dc-computer-"))

describe("agent computer", () => {
  it("lets the agent write files and run commands, and keeps them across a restart", async () => {
    const directory = temporary()
    const before = open(directory)
    const chat = await setup(before)
    before.faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("write", { path: "notes/todo.txt", content: "buy milk\ncall mom\n" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxToolCall("bash", { command: "wc -l < notes/todo.txt && pwd" })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("Saved your list."),
    ])
    const state = await converse(before, chat.id, "keep a todo list")
    const [write, shell] = tools(state)
    expect(write).toMatchObject({ name: "write", status: "done" })
    expect(shell).toMatchObject({ name: "bash", status: "done" })
    expect(shell!.output).toContain("2\n/workspace")
    await before.namespace.close()

    const after = open(directory)
    after.faux.setResponses(bash("cat notes/todo.txt"))
    const later = await converse(after, chat.id, "what was on it?")
    expect(tools(later).at(-1)!.output).toContain("buy milk\ncall mom")
    expect(after.reports).toEqual([])
  })

  it("tells the model what kind of computer it has", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    let prompt = ""
    world.faux.setResponses([
      (context) => {
        prompt = JSON.stringify(context)
        return fauxAssistantMessage("ok")
      },
    ])
    await converse(world, chat.id, "hi")
    expect(prompt).toContain("Your workspace is /workspace")
    expect(prompt).toContain("no real programs such as git")
  })

  it("mirrors identity and memory into workspace files", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    await call(world, "/", "PATCH", {
      name: "Juniper",
      user: "Name is Sawyer",
      soul: "You are brief.",
    })
    world.faux.setResponses(bash("cat IDENTITY.md USER.md SOUL.md"))
    const state = await converse(world, chat.id, "who are you?")
    const output = tools(state)[0]!.output!
    expect(output).toContain("name: Juniper")
    expect(output).toContain("Name is Sawyer")
    expect(output).toContain("You are brief.")

    // A change made in the settings page reaches the files before the next command.
    await call(world, "/", "PATCH", { name: "Hazel" })
    world.faux.setResponses(bash("cat IDENTITY.md"))
    const next = await converse(world, chat.id, "and now?")
    expect(tools(next).at(-1)!.output).toContain("name: Hazel")
  })

  it("has the files in place for every tool of a round, however slow the computer is", async () => {
    // A computer a network away: each file takes a while to write.
    const slow = (sandbox: Sandbox): Sandbox => ({
      ...sandbox,
      fs: {
        ...sandbox.fs,
        writeFile: async (path, data) => {
          await new Promise((resolve) => setTimeout(resolve, 120))
          await sandbox.fs.writeFile(path, data)
        },
      },
    })
    const world = open(temporary(), slow)
    const chat = await setup(world)
    await call(world, "/", "PATCH", { name: "Juniper" })
    // Three tools at once, as a model does. None may run before the files are written.
    world.faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("bash", { command: "cat IDENTITY.md" }),
          fauxToolCall("bash", { command: "cat IDENTITY.md" }),
          fauxToolCall("read", { path: "IDENTITY.md" }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("done"),
    ])
    const state = await converse(world, chat.id, "who are you, three times?")
    const results = tools(state)
    expect(results.map((tool) => tool.status)).toEqual(["done", "done", "done"])
    for (const tool of results) expect(tool.output).toContain("name: Juniper")
    expect(world.reports).toEqual([])
  })

  it("does not mistake a file that is waiting to be rewritten for an edit", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    await call(world, "/", "PATCH", { name: "Juniper", tagline: "Calm" })
    world.faux.setResponses(bash("cat IDENTITY.md"))
    await converse(world, chat.id, "who are you?")

    // In one round: rename through the tool, and write an unrelated file. When the write
    // finishes, IDENTITY.md still says Juniper; that is staleness, not an edit by the agent.
    world.faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("set_identity", { name: "Ray", tagline: "Brief" }),
          fauxToolCall("write", { path: "notes.txt", content: "unrelated" }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("done"),
    ])
    const state = await converse(world, chat.id, "rename yourself and take a note")
    const written = tools(state).find((tool) => tool.name === "write")!
    expect(written.status).toBe("done")
    expect(JSON.stringify(written)).not.toContain("IDENTITY.md")
    // The rename stands; the stale file did not undo it.
    expect(
      (await call<{ agent: { name: string; tagline: string } }>(world, "/")).agent,
    ).toMatchObject({ name: "Ray", tagline: "Brief" })
    world.faux.setResponses(bash("cat IDENTITY.md"))
    expect(tools(await converse(world, chat.id, "and now?")).at(-1)!.output).toContain("name: Ray")

    // A real edit by the agent is still taken.
    world.faux.setResponses(bash("sed -i 's/^tagline: .*/tagline: Sharper/' IDENTITY.md"))
    await converse(world, chat.id, "sharpen your tagline")
    expect((await call<{ agent: { tagline: string } }>(world, "/")).agent.tagline).toBe("Sharper")
    expect(world.reports).toEqual([])
  })

  it("says so when the files cannot be written, and still runs the tool", async () => {
    const broken = (sandbox: Sandbox): Sandbox => ({
      ...sandbox,
      fs: {
        ...sandbox.fs,
        writeFile: async () => {
          throw new Error("uploads are not supported here")
        },
      },
    })
    const world = open(temporary(), broken)
    const chat = await setup(world)
    world.faux.setResponses(bash("echo still works"))
    const state = await converse(world, chat.id, "run something")
    expect(tools(state)[0]).toMatchObject({ status: "done", output: "still works\n" })
    // Not swallowed: whoever runs the server is told what went wrong.
    expect(world.reports.map(String).join("\n")).toContain(
      "identity files could not be kept in step with its computer: uploads are not supported here",
    )
  })

  it("takes the agent's edits to those files as edits to its memory", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    world.faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("bash", {
            command:
              "echo 'Likes tea' >> USER.md && printf 'name: Wren\\ntagline: Small and sharp\\navatar: comet tide scarf\\n' > IDENTITY.md",
          }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Noted."),
    ])
    await converse(world, chat.id, "remember I like tea, and call yourself Wren")
    const state = await call<{ user: string; agent: Record<string, unknown> }>(world, "/")
    expect(state.user).toBe("Likes tea")
    expect(state.agent).toMatchObject({
      name: "Wren",
      tagline: "Small and sharp",
      avatar: { character: "comet", color: "tide", accessory: "scarf" },
    })
  })

  it("refuses a file edit over the memory limit, says so, and restores the file", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    await call(world, "/", "PATCH", { memory: "Keep this" })
    world.faux.setResponses([
      fauxAssistantMessage([fauxToolCall("bash", { command: `printf '%2500s' x > MEMORY.md` })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage([fauxToolCall("bash", { command: "cat MEMORY.md" })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("It was too long."),
    ])
    const state = await converse(world, chat.id, "write a huge memory")
    const [oversized, check] = tools(state)
    expect(oversized!.output).toContain("the limit is 2200")
    expect(check!.output).toContain("Keep this")
    expect((await call<{ memory: string }>(world, "/")).memory).toBe("Keep this")
  })
})
