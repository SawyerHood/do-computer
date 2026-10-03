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
  type SkillSummary,
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
import { type ComputerChoices, createAgentActor } from "../src/index.ts"

type World = {
  namespace: NodeActorNamespace
  faux: ReturnType<typeof fauxProvider>
  reports: unknown[]
  /** Kinds whose computer was deleted, in order. */
  destroyed: string[]
}
const worlds: World[] = []

const LABELS: Record<string, string> = {
  small: "Small",
  other: "Other",
  real: "Real",
  none: "No computer",
}

type Setup = {
  /** Kinds on offer. Default: all four. */
  kinds?: readonly string[]
  default?: string
  /** Leave the choice out altogether, as a deployment from before it existed. */
  single?: boolean
  /** Let the user's own computers be paired, which keeps the file tools whatever the kind. */
  pairing?: boolean
  tokensPerSecond?: number
}

function open(directory: string, setup: Setup = {}): World {
  const faux = fauxProvider({
    provider: "test",
    models: [{ id: "model" }],
    tokensPerSecond: setup.tokensPerSecond ?? 5_000,
  })
  const models = createModels()
  models.setProvider(faux.provider)
  const reports: unknown[] = []
  const destroyed: string[] = []
  // Each kind keeps its files in a place of its own in the agent's database.
  const computer = (kind: string, name: string): Sandbox | undefined => {
    if (kind === "none") return undefined
    const sandbox = justBashSandbox({
      id: `${name}:${kind}`,
      database: namespaceSql.get(name)!,
      home: `/${kind}`,
    })
    return {
      ...sandbox,
      capabilities: { ...sandbox.capabilities, realBinaries: kind === "real" },
      destroy: async () => {
        destroyed.push(kind)
      },
    }
  }
  const namespaceSql = new Map<string, Parameters<typeof justBashSandbox>[0]["database"]>()
  const kinds = setup.kinds ?? ["small", "other", "real", "none"]
  const computers: ComputerChoices = {
    kinds: kinds.map((id) => ({ id, label: LABELS[id]!, description: "" })),
    default: setup.default ?? kinds[0]!,
    create: (kind, host) => {
      namespaceSql.set(host.name, host.sql)
      return computer(kind, host.name)
    },
  }
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
        ...(setup.single === true
          ? {
              sandbox: (host) =>
                justBashSandbox({ id: `${host.name}:small`, database: host.sql, home: "/small" }),
            }
          : { computers }),
        ...(setup.pairing === true
          ? {
              computerLinks: {
                get: () => {
                  throw new Error("No computer is paired in these tests")
                },
              },
            }
          : {}),
        onReport: (error) => reports.push(error),
      }),
    onError: (error) => reports.push(error),
  })
  namespace.start()
  const world = { namespace, faux, reports, destroyed }
  worlds.push(world)
  return world
}

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.namespace.close().catch(() => {})
})

class Refused extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

async function call<T>(world: World, path: string, method = "GET", payload?: unknown): Promise<T> {
  const response = await world.namespace.get("agent-1").fetch(
    new Request(`http://actor${path}`, {
      method,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      headers: payload === undefined ? undefined : { "content-type": "application/json" },
    }),
  )
  const result = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Refused(response.status, result.error ?? "")
  return result
}

async function refusal(attempt: Promise<unknown>): Promise<Refused> {
  const error = await attempt.then(
    () => undefined,
    (error: unknown) => error,
  )
  if (!(error instanceof Refused)) throw new Error("Expected the request to be refused")
  return error
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

/** What a shell command printed, run by the agent in a chat. */
async function run(world: World, chatId: string, command: string): Promise<string> {
  world.faux.setResponses(bash(command))
  const state = await converse(world, chatId, command)
  return tools(state).at(-1)?.output ?? ""
}

/**
 * What the model is told at its next request about its instructions and tools. A chat is told
 * once, and after that only what changed.
 */
async function told(world: World, chatId: string): Promise<string> {
  let sent = ""
  world.faux.setResponses([
    (context) => {
      const system = context.messages.filter((message) => (message.role as string) === "system")
      sent = JSON.stringify(system.at(-1))
      return fauxAssistantMessage("ok")
    },
  ])
  await converse(world, chatId, "hi")
  return sent
}

type State = { computer: string | null }
const computerOf = async (world: World) => (await call<State>(world, "/")).computer
const move = (world: World, computer: string) => call<State>(world, "/", "PATCH", { computer })

async function setup(world: World, computer?: string): Promise<ChatSummary> {
  await call(world, "/init", "POST", { ownerId: "user-1", computer })
  return call<ChatSummary>(world, "/chats", "POST", {})
}

const temporary = () => mkdtempSync(join(tmpdir(), "dc-kinds-"))

describe("an agent's kind of computer", () => {
  it("is the deployment's default unless another is asked for", async () => {
    const usual = open(temporary())
    await setup(usual)
    expect(await computerOf(usual)).toBe("small")

    const asked = open(temporary())
    await setup(asked, "other")
    expect(await computerOf(asked)).toBe("other")
  })

  it("has to be one the deployment offers", async () => {
    const world = open(temporary(), { kinds: ["small", "other"] })
    const atStart = await refusal(
      call(world, "/init", "POST", { ownerId: "user-1", computer: "real" }),
    )
    expect(atStart.status).toBe(400)

    await setup(world)
    const later = await refusal(move(world, "real"))
    expect(later.status).toBe(400)
    expect(later.message).toContain('"real"')
    expect(await computerOf(world)).toBe("small")
  })

  it("moves the agent to an empty computer, and finds its files again on the way back", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    await run(world, chat.id, "echo first > made-here.txt")
    expect(await run(world, chat.id, "ls")).toContain("made-here.txt")

    expect((await move(world, "other")).computer).toBe("other")
    expect(await run(world, chat.id, "ls")).not.toContain("made-here.txt")
    await run(world, chat.id, "echo second > made-there.txt")

    await move(world, "small")
    const listing = await run(world, chat.id, "ls")
    expect(listing).toContain("made-here.txt")
    expect(listing).not.toContain("made-there.txt")
    expect(world.reports).toEqual([])
  })

  it("tells the agent it was moved, so it does not look for files that stayed behind", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    expect(await told(world, chat.id)).not.toContain("moved you to this computer")
    await move(world, "other")
    expect(await told(world, chat.id)).toContain("moved you to this computer")
  })

  it("says why, right where a file from the other computer turns out to be missing", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    const read = (path: string) => [
      fauxAssistantMessage([fauxToolCall("read", { path })], { stopReason: "toolUse" }),
      fauxAssistantMessage("done"),
    ]
    // Before any move, a missing file is only a missing file.
    world.faux.setResponses(read("nowhere.txt"))
    const before = tools(await converse(world, chat.id, "read it")).at(-1)!
    expect(before.status).toBe("error")
    expect(before.output).not.toContain("moved you to this computer")

    await run(world, chat.id, "echo here > report.txt")
    await move(world, "other")
    world.faux.setResponses(read("report.txt"))
    const after = tools(await converse(world, chat.id, "read it")).at(-1)!
    expect(after.status).toBe("error")
    expect(after.output).toContain("moved you to this computer")
    expect(await run(world, chat.id, "cat report.txt")).toContain("moved you to this computer")
    // A command that worked is left alone, whatever it printed.
    expect(await run(world, chat.id, "echo file not found")).not.toContain("moved you")
  })

  it("keeps the agent's memory and identity files on whichever computer it is on", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    await call(world, "/", "PATCH", { memory: "The user likes tea." })
    await move(world, "other")
    expect(await run(world, chat.id, "cat MEMORY.md")).toContain("likes tea")
  })

  it("takes the file and shell tools away with the computer, and gives them back", async () => {
    const world = open(temporary())
    const chat = await setup(world)
    const first = JSON.parse(await told(world, chat.id))
    expect(first.toolsAdded.map((tool: { name: string }) => tool.name)).toContain("bash")
    expect(first.sections.computer).toContain("You have your own computer")

    await move(world, "none")
    const without = JSON.parse(await told(world, chat.id))
    expect(without.toolsRemoved).toEqual(
      ["read", "write", "edit", "bash"].map((name) => ({ name })),
    )
    expect(without.sections.computer).toBeNull()
    // A chat that starts now never hears of them.
    const fresh = await call<ChatSummary>(world, "/chats", "POST", {})
    const start = await told(world, fresh.id)
    expect(start).not.toContain('"name":"bash"')
    expect(start).not.toContain("You have your own computer")

    await move(world, "small")
    const again = JSON.parse(await told(world, chat.id))
    expect(again.toolsAdded.map((tool: { name: string }) => tool.name)).toContain("bash")
    expect(again.sections.computer).toContain("You have your own computer")
  })

  it("says so when the tools are only there for the user's own computers", async () => {
    const world = open(temporary(), { pairing: true })
    const chat = await setup(world, "none")
    const start = JSON.parse(await told(world, chat.id))
    expect(start.toolsAdded.map((tool: { name: string }) => tool.name)).toContain("bash")
    expect(start.sections.computer).toContain("You have no computer of your own")

    await move(world, "small")
    const moved = JSON.parse(await told(world, chat.id))
    expect(moved.sections.computer).toContain("You have your own computer")
    expect(moved.toolsRemoved).toBeUndefined()
  })

  it("is not changed while the agent is working", async () => {
    const world = open(temporary(), { tokensPerSecond: 20 })
    const chat = await setup(world)
    world.faux.setResponses([fauxAssistantMessage("word ".repeat(400))])
    await call(world, `/chats/${chat.id}/messages`, "POST", {
      text: "go on",
      requestId: crypto.randomUUID(),
    })
    const busy = await refusal(move(world, "other"))
    expect(busy.status).toBe(409)
    expect(busy.message).toContain("in the middle of something")
    expect(await computerOf(world)).toBe("small")

    await call(world, `/chats/${chat.id}/abort`, "POST")
    await expect
      .poll(() =>
        move(world, "other").then(
          (state) => state.computer,
          () => "busy",
        ),
      )
      .toBe("other")
  })

  it("stays where it was put across a restart", async () => {
    const directory = temporary()
    const before = open(directory)
    const chat = await setup(before)
    await move(before, "other")
    await run(before, chat.id, "echo kept > kept.txt")
    await before.namespace.close()

    const after = open(directory)
    expect(await computerOf(after)).toBe("other")
    expect(await run(after, chat.id, "cat kept.txt")).toContain("kept")
  })

  it("leaves an agent from before there was a choice on the computer it has", async () => {
    const directory = temporary()
    const before = open(directory, { single: true })
    const chat = await setup(before)
    expect(await computerOf(before)).toBeNull()
    await run(before, chat.id, "echo old > old.txt")
    await before.namespace.close()

    // The choice arrives, with the kind it already had as the default.
    const arrived = open(directory, { default: "small" })
    expect(await computerOf(arrived)).toBe("small")
    expect(await run(arrived, chat.id, "cat old.txt")).toContain("old")
    await arrived.namespace.close()

    // A later change of the default is for new agents, not for this one.
    const changed = open(directory, { default: "other" })
    expect(await computerOf(changed)).toBe("small")
    expect(await run(changed, chat.id, "cat old.txt")).toContain("old")
  })

  it("falls back to the default while its kind is not offered, and returns to it after", async () => {
    const directory = temporary()
    const before = open(directory)
    const chat = await setup(before, "other")
    await run(before, chat.id, "echo mine > mine.txt")
    await before.namespace.close()

    const without = open(directory, { kinds: ["small", "none"] })
    expect(await computerOf(without)).toBe("small")
    expect(await run(without, chat.id, "ls")).not.toContain("mine.txt")
    await without.namespace.close()

    const back = open(directory)
    expect(await computerOf(back)).toBe("other")
    expect(await run(back, chat.id, "cat mine.txt")).toContain("mine")
  })

  it("adds a skill that needs real programs when the agent first gets a computer with them", async () => {
    const world = open(temporary())
    await setup(world)
    const names = async () =>
      (await call<{ skills: SkillSummary[] }>(world, "/skills")).skills.map((skill) => skill.name)
    expect(await names()).not.toContain("browsing-the-web")
    await move(world, "real")
    expect(await names()).toContain("browsing-the-web")
  })

  it("deletes every computer the agent has had when the agent is deleted", async () => {
    const world = open(temporary())
    await setup(world)
    await move(world, "other")
    await move(world, "none")
    await move(world, "real")
    await call(world, "/destroy", "POST")
    expect([...world.destroyed].sort()).toEqual(["other", "real", "small"])
  })

  it("deletes what it can reach when a kind the agent had is gone, and says what was left", async () => {
    const directory = temporary()
    const before = open(directory)
    await setup(before)
    await move(before, "other")
    await move(before, "small")
    await before.namespace.close()

    const after = open(directory, { kinds: ["small", "none"] })
    await call(after, "/destroy", "POST")
    expect(after.destroyed).toEqual(["small"])
    expect(String(after.reports[0])).toContain('"other"')
  })
})
