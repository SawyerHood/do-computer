import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
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
} from "@do-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@do-computer/runtime/node"
import { justBashSandbox, type Sandbox } from "@do-computer/sandbox"
import { createLocalProcessSandbox } from "@do-computer/sandbox/testing"
import { Type } from "@earendil-works/pi-ai"
import { createModels } from "@earendil-works/pi-ai/models"
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"
import { defineExtension, defineTool } from "@earendil-works/pi-durable"
import { afterEach, describe, expect, it } from "vitest"
import { ComputersDoc } from "../src/computers.ts"
import {
  type AgentComputer,
  type ComputerChoices,
  type ComputerDirectory,
  createAgentActor,
  IdentityDoc,
} from "../src/index.ts"
import { quietOnReminder } from "./quiet.ts"

type Machine = AgentComputer & { id: string }

/** What stands in for the app: which machines there are, and which agent may use which. */
type Host = {
  /** The machines each agent can use, as the host would say if asked. */
  machines: Map<string, Machine[]>
  /** Machines the host no longer lets anyone use. */
  denied: Set<string>
  /** What agents handed over from the days when each had a machine to itself. */
  adopted: { agentId: string; machines: { kind: string; home: string; current: boolean }[] }[]
  /** How often an agent asked which folder is its own. */
  folderAsks: number
}

type World = {
  namespace: NodeActorNamespace
  faux: ReturnType<typeof fauxProvider>
  reports: unknown[]
  /** Machines that were deleted, by kind and key, in order. */
  destroyed: string[]
  /** The home directory of a full machine, by kind and key. */
  home: (kind: string, key: string) => string
  host: Host
}
const worlds: World[] = []

/** Full machines live outside any one world, as a provider's would: a restart finds them again. */
const real = new Map<string, Sandbox>()

type Setup = {
  /** Whether a host says which machines there are. Without one, an agent has its own. */
  hosted?: boolean
  kinds?: readonly string[]
  /** Let people's own computers be connected. */
  pairing?: boolean
}

/** Turns an agent into what one was before computers belonged to a workspace. */
const Antique = defineExtension({
  name: "test.antique",
  tools: [
    defineTool({
      name: "become_antique",
      description: "Become an agent from before computers belonged to a workspace.",
      parameters: Type.Object({}),
      execute: async (_args, api, context) => {
        await api.commit(async (tx) => {
          const identity = await tx.doc(IdentityDoc)
          delete identity.adopted
          identity.computer = "real"
          identity.computers = ["small", "real"]
          ;(await tx.doc(ComputersDoc)).computers = {}
        }, context)
        return { output: [{ type: "text", text: "ok" }] }
      },
    }),
  ],
})

function open(directory: string, setup: Setup = {}): World {
  const faux = quietOnReminder(
    fauxProvider({ provider: "test", models: [{ id: "model" }], tokensPerSecond: 5_000 }),
  )
  const models = createModels()
  models.setProvider(faux.provider)
  const reports: unknown[] = []
  const destroyed: string[] = []
  const machine = (kind: string, key: string) => {
    const name = `${kind}:${key}`
    if (!real.has(name)) real.set(name, createLocalProcessSandbox())
    return real.get(name)!
  }
  const kinds = setup.kinds ?? ["small", "real", "none"]
  const computers: ComputerChoices = {
    kinds: kinds.map((id) => ({ id, label: id, description: "" })),
    default: kinds[0]!,
    create: (kind, key, host) => {
      if (kind === "none" || !kinds.includes(kind)) return undefined
      // The small kind keeps its files with one agent, as the built-in shell does.
      const sandbox =
        kind === "small"
          ? host === undefined
            ? undefined
            : justBashSandbox({ id: `${key}:small`, database: host.sql, home: "/small" })
          : machine(kind, key)
      if (sandbox === undefined) return undefined
      return {
        ...sandbox,
        destroy: async () => {
          destroyed.push(`${kind}:${key}`)
        },
      }
    },
  }
  const host: Host = { machines: new Map(), denied: new Set(), adopted: [], folderAsks: 0 }
  const directory_: ComputerDirectory = {
    allowed: async (_agentId, computerId) => !host.denied.has(computerId),
    list: async () => [],
    request: async () => undefined,
    ...(setup.hosted === true
      ? {
          machines: async (agentId) => host.machines.get(agentId) ?? [],
          folder: async (agentId, computerId, name) => {
            host.folderAsks++
            const found = host.machines.get(agentId)?.find((one) => one.id === computerId)
            if (found === undefined) return undefined
            return {
              folder: `${found.home}/${(name ?? agentId).toLowerCase()}`,
              neighbors: [`${found.home}/someone-else`],
            }
          },
          adopt: async (agentId, machines) => {
            host.adopted.push({ agentId, machines: [...machines] })
            const mine = machines
              .filter((one) => one.current)
              .map((one): Machine => ({
                id: `adopted-${one.kind}`,
                name: "old-faithful",
                kind: one.kind,
                machineKey: agentId,
                platform: "linux",
                hostname: "",
                home: one.home,
                folder: one.home,
                readOnly: false,
                pairedAt: 1,
              }))
            host.machines.set(agentId, mine)
            return mine
          },
        }
      : {}),
  }
  const namespace = new NodeActorNamespace({
    directory: join(directory, "actors"),
    blobs: (name) => fileBlobs(join(directory, "blobs", encodeURIComponent(name))),
    factory: (actorHost) =>
      createAgentActor(actorHost, {
        models,
        defaultModel: "test/model",
        modelOptions: [
          { id: "test/model", name: "Test", reasoning: false, inputCost: 0, outputCost: 0 },
        ],
        keepAliveMs: 100,
        computers,
        extensions: [Antique],
        computerDirectory: directory_,
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
  const world: World = {
    namespace,
    faux,
    reports,
    destroyed,
    home: (kind, key) => machine(kind, key).home,
    host,
  }
  worlds.push(world)
  return world
}

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.namespace.close().catch(() => {})
})

async function call<T>(
  world: World,
  path: string,
  method = "GET",
  payload?: unknown,
  agent = "agent-1",
): Promise<T> {
  const response = await world.namespace.get(agent).fetch(
    new Request(`http://actor${path}`, {
      method,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      headers: payload === undefined ? undefined : { "content-type": "application/json" },
    }),
  )
  const result = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(`${response.status}: ${result.error ?? ""}`)
  return result
}

/** Send a message and return the chat once the run has finished. */
async function converse(
  world: World,
  chatId: string,
  text: string,
  agent = "agent-1",
): Promise<ChatState> {
  const response = await world.namespace
    .get(agent)
    .fetch(new Request(`http://actor/chats/${chatId}/events`))
  await call(
    world,
    `/chats/${chatId}/messages`,
    "POST",
    { text, requestId: crypto.randomUUID() },
    agent,
  )
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

/** Have the agent run a shell command, perhaps on a named computer, and return the tool call. */
async function run(
  world: World,
  chatId: string,
  command: string,
  options: { computer?: string; agent?: string } = {},
): Promise<ToolPart> {
  world.faux.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall("bash", {
          command,
          ...(options.computer === undefined ? {} : { computer: options.computer }),
        }),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("done"),
  ])
  return tools(await converse(world, chatId, command, options.agent)).at(-1)!
}

/** What the model is told at its next request about its instructions and tools. */
async function told(world: World, chatId: string, agent = "agent-1"): Promise<string> {
  let sent = ""
  world.faux.setResponses([
    (context) => {
      sent = JSON.stringify(context)
      return fauxAssistantMessage("ok")
    },
  ])
  await converse(world, chatId, "hi", agent)
  return sent
}

async function setup(world: World, agent = "agent-1"): Promise<ChatSummary> {
  await call(world, "/init", "POST", { ownerId: "user-1" }, agent)
  return call<ChatSummary>(world, "/chats/main", "POST", {}, agent)
}

const names = async (world: World, agent = "agent-1") =>
  (await call<{ computers: Machine[] }>(world, "/computers", "GET", undefined, agent)).computers
    .map((computer) => computer.name)
    .sort()

const temporary = () => mkdtempSync(join(tmpdir(), "dc-machines-"))

/** A full machine of the workspace, as the host tells an agent of it. */
const box = (world: World, id: string, name: string): Machine => ({
  id,
  name,
  kind: "real",
  machineKey: id,
  platform: "linux",
  hostname: "",
  home: world.home("real", id),
  readOnly: false,
  pairedAt: 1,
})

/** The host lets these agents use these machines, and tells them so. */
async function give(world: World, machines: Machine[], agents = ["agent-1"]): Promise<void> {
  for (const agent of agents) {
    world.host.machines.set(agent, machines)
    await call(world, "/computers", "PUT", { machines }, agent)
  }
}

describe("an agent with nobody to say which machines there are", () => {
  it("gets one to itself, where its work starts and stays", async () => {
    const directory = temporary()
    const world = open(directory)
    const chat = await setup(world)
    expect(await names(world)).toEqual(["computer"])
    expect((await run(world, chat.id, "pwd")).output?.trim()).toBe("/small")
    await run(world, chat.id, "echo kept > made.txt")

    await world.namespace.close()
    const again = open(directory)
    expect((await run(again, chat.id, "cat made.txt")).output?.trim()).toBe("kept")
    expect(again.reports).toEqual([])
  })

  it("has none where the kind it would get means none, and is told so", async () => {
    const world = open(temporary(), { kinds: ["none", "real"] })
    const chat = await setup(world)
    expect(await names(world)).toEqual([])
    expect(await told(world, chat.id)).toContain("no machine in your workspace that you can use")
    const refused = await run(world, chat.id, "ls")
    expect(refused.status).toBe("error")
    expect(refused.output).toContain("There is no computer for you to work on")
  })

  it("deletes its machine when it is deleted", async () => {
    const world = open(temporary(), { kinds: ["real"] })
    await setup(world)
    await call(world, "/destroy", "POST")
    expect(world.destroyed).toEqual(["real:agent-1"])
  })
})

describe("the machines of a workspace", () => {
  it("are where an agent works without having to say so, when there is one", async () => {
    const world = open(temporary(), { hosted: true })
    const chat = await setup(world)
    // Nobody gave it a machine: it has none of its own.
    expect(await names(world)).toEqual([])
    await call(world, "/", "PATCH", { name: "Scout" })
    await give(world, [box(world, "m1", "box")])

    const home = world.home("real", "m1")
    expect(await told(world, chat.id)).toContain("You get a folder of your own under")
    // Its calls start in a folder of its own, made for it, named after it.
    expect((await run(world, chat.id, "pwd")).output?.trim()).toBe(`${home}/scout`)
    expect((await run(world, chat.id, "echo ~")).output?.trim()).toBe(home)
    const prompt = await told(world, chat.id)
    expect(prompt).toContain(`Your folder there is ${home}/scout`)
    expect(prompt).toContain(`${home}/someone-else`)
    // The folder is asked for once, and is the same from then on.
    await run(world, chat.id, "true")
    expect(world.host.folderAsks).toBe(1)
    expect(world.reports).toEqual([])
  })

  it("are shared: each agent in its own folder, with the same disk under them", async () => {
    const world = open(temporary(), { hosted: true })
    const one = await setup(world)
    const two = await setup(world, "agent-2")
    await call(world, "/", "PATCH", { name: "Scout" })
    await call(world, "/", "PATCH", { name: "Mira" }, "agent-2")
    await give(world, [box(world, "m2", "box")], ["agent-1", "agent-2"])

    const home = world.home("real", "m2")
    await run(world, one.id, "echo mine > notes.txt && echo for-everyone > ~/shared.txt")
    expect(readFileSync(join(home, "scout", "notes.txt"), "utf8").trim()).toBe("mine")
    const seen = await run(world, two.id, "pwd && cat ~/shared.txt && ls", { agent: "agent-2" })
    expect(seen.output).toContain(`${home}/mira`)
    expect(seen.output).toContain("for-everyone")
    expect(seen.output).not.toContain("notes.txt")
  })

  it("have to be named when there are several", async () => {
    const world = open(temporary(), { hosted: true })
    const chat = await setup(world)
    await give(world, [box(world, "m3", "box"), box(world, "m4", "bench")])

    const unsaid = await run(world, chat.id, "pwd")
    expect(unsaid.status).toBe("error")
    expect(unsaid.output).toContain("say which in `computer`: box, bench")
    expect(await told(world, chat.id)).toContain("There is more than one")
    const said = await run(world, chat.id, "pwd", { computer: "bench" })
    expect(said.output?.trim()).toBe(`${world.home("real", "m4")}/agent-1`)
  })

  it("are found by asking the host, when the agent was not told of one", async () => {
    const world = open(temporary(), { hosted: true })
    const chat = await setup(world)
    world.host.machines.set("agent-1", [box(world, "m5", "box")])
    expect(await names(world)).toEqual([])
    expect((await run(world, chat.id, "echo found")).output?.trim()).toBe("found")
    expect(await names(world)).toEqual(["box"])
  })

  it("stop being used the moment the host says so", async () => {
    const world = open(temporary(), { hosted: true })
    const chat = await setup(world)
    await give(world, [box(world, "m6", "box")])
    expect((await run(world, chat.id, "echo fine")).status).toBe("done")

    world.host.denied.add("m6")
    world.host.machines.set("agent-1", [])
    const refused = await run(world, chat.id, "echo still")
    expect(refused.status).toBe("error")
    expect(refused.output).toContain('The computer "box" is no longer connected to you')
    expect(await names(world)).toEqual([])
  })

  it("are not deleted with an agent, which they do not belong to", async () => {
    const world = open(temporary(), { hosted: true })
    await setup(world)
    await give(world, [box(world, "m7", "box")])
    await call(world, "/destroy", "POST")
    expect(world.destroyed).toEqual([])
  })

  it("never stand in for a person's own computer, which has to be named", async () => {
    const world = open(temporary(), { hosted: true, pairing: true })
    const chat = await setup(world)
    await call(world, "/computers/laptop-1", "PUT", {
      name: "laptop",
      platform: "darwin",
      hostname: "mac",
      home: "/Users/x",
      readOnly: false,
      pairedAt: 1,
    })
    const unsaid = await run(world, chat.id, "ls")
    expect(unsaid.status).toBe("error")
    expect(unsaid.output).toContain("name the computer to do this on in `computer`: laptop")
  })
})

describe("an agent from before computers belonged to a workspace", () => {
  it("hands its machines to its host, and goes on working where it was", async () => {
    const directory = temporary()
    const before = open(directory, { kinds: ["real", "small", "none"] })
    const chat = await setup(before)
    const home = before.home("real", "agent-1")
    await run(before, chat.id, "echo old work > report.txt")
    // Its memory used to be mirrored as files in its home directory.
    writeFileSync(join(home, "MEMORY.md"), "stale\n")
    before.faux.setResponses([
      fauxAssistantMessage([fauxToolCall("become_antique", {})], { stopReason: "toolUse" }),
      fauxAssistantMessage("done"),
    ])
    await converse(before, chat.id, "go back in time")
    await before.namespace.close()

    const world = open(directory, { hosted: true, kinds: ["real", "small", "none"] })
    expect(await names(world)).toEqual(["old-faithful"])
    // Both machines it ever had are handed over, and the one it was on is the one it keeps.
    expect(world.host.adopted).toEqual([
      {
        agentId: "agent-1",
        machines: [
          { kind: "real", home, current: true },
          { kind: "small", home: "/small", current: false },
        ],
      },
    ])
    const found = await run(world, chat.id, "pwd && cat report.txt")
    expect(found.output).toContain(home)
    expect(found.output).toContain("old work")
    // The files its memory was mirrored into are gone: its memory is not kept in files.
    expect(existsSync(join(home, "MEMORY.md"))).toBe(false)
    expect(existsSync(join(home, "report.txt"))).toBe(true)

    // That happens once.
    await world.namespace.close()
    const again = open(directory, { hosted: true, kinds: ["real", "small", "none"] })
    await names(again)
    expect(again.host.adopted).toEqual([])
    expect(again.reports).toEqual([])
  })
})
