import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type ChatEvent,
  type ChatState,
  type ChatSummary,
  EMPTY_CHAT,
  type LibraryFile,
  type LibraryListing,
  type LibraryVersion,
  readSse,
  reduceChat,
  type ToolPart,
} from "@durable-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@durable-computer/runtime/node"
import type { Sandbox } from "@durable-computer/sandbox"
import { createLocalProcessSandbox } from "@durable-computer/sandbox/testing"
import { createModels } from "@earendil-works/pi-ai/models"
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"
import { afterEach, describe, expect, it } from "vitest"
import { type AgentComputer, createAgentActor, createLibraryActor } from "../src/index.ts"

type Machine = AgentComputer & { id: string }
type World = {
  agents: NodeActorNamespace
  libraries: NodeActorNamespace
  faux: ReturnType<typeof fauxProvider>
  reports: unknown[]
}
const worlds: World[] = []
/** Machines outlive a restart, as a provider's do. Each test has its own. */
const machines = new Map<string, Sandbox>()
let machine = (_key: string): Sandbox => {
  throw new Error("No world is open")
}

/** `shared`: the agents are in one workspace that keeps a library for them all. */
function open(directory: string, shared: boolean): World {
  const faux = fauxProvider({ provider: "test", models: [{ id: "model" }], tokensPerSecond: 5_000 })
  const models = createModels()
  models.setProvider(faux.provider)
  const reports: unknown[] = []
  machine = (key) => {
    const name = `${directory}:${key}`
    if (!machines.has(name)) machines.set(name, createLocalProcessSandbox())
    return machines.get(name)!
  }
  const libraries = new NodeActorNamespace({
    directory: join(directory, "libraries"),
    blobs: (name) => fileBlobs(join(directory, "library-blobs", encodeURIComponent(name))),
    factory: (host) => createLibraryActor(host),
    onError: (error) => reports.push(error),
  })
  const agents = new NodeActorNamespace({
    directory: join(directory, "agents"),
    blobs: (name) => fileBlobs(join(directory, "blobs", encodeURIComponent(name))),
    factory: (host) =>
      createAgentActor(host, {
        models,
        defaultModel: "test/model",
        modelOptions: [
          { id: "test/model", name: "Test", reasoning: false, inputCost: 0, outputCost: 0 },
        ],
        keepAliveMs: 100,
        // Every agent has a machine to itself here, named after it, unless a test gives it more.
        sandbox: (agent) => machine(agent.name),
        computers: {
          kinds: [{ id: "real", label: "Real", description: "" }],
          default: "real",
          create: (_kind, key) => machine(key),
        },
        ...(shared ? { library: async () => libraries.get("workspace-1") } : {}),
        onReport: (error) => reports.push(error),
      }),
    onError: (error) => reports.push(error),
  })
  agents.start()
  const world = { agents, libraries, faux, reports }
  worlds.push(world)
  return world
}

afterEach(async () => {
  for (const world of worlds.splice(0)) {
    await world.agents.close().catch(() => {})
    await world.libraries.close().catch(() => {})
  }
})

const request = (world: World, agent: string, path: string, init?: RequestInit) =>
  world.agents.get(agent).fetch(new Request(`http://actor${path}`, init))

async function call<T>(
  world: World,
  agent: string,
  path: string,
  method = "GET",
  payload?: unknown,
): Promise<T> {
  const text = typeof payload === "string"
  const response = await request(world, agent, path, {
    method,
    body: payload === undefined ? undefined : text ? payload : JSON.stringify(payload),
    headers:
      payload === undefined
        ? undefined
        : { "content-type": text ? "text/plain" : "application/json" },
  })
  const result = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(`${response.status}: ${result.error ?? ""}`)
  return result
}

async function converse(world: World, agent: string, chatId: string, text: string) {
  const response = await request(world, agent, `/chats/${chatId}/events`)
  await call(world, agent, `/chats/${chatId}/messages`, "POST", {
    text,
    requestId: crypto.randomUUID(),
  })
  let state = EMPTY_CHAT
  let started = false
  for await (const event of readSse<ChatEvent>(response.body!)) {
    state = reduceChat(state, event)
    started ||= state.busy
    if (started && !state.busy) break
  }
  return state as ChatState
}

/** Have an agent run a shell command, perhaps on a named computer, and return what it printed. */
async function run(
  world: World,
  agent: string,
  chatId: string,
  command: string,
  computer?: string,
): Promise<string> {
  world.faux.setResponses([
    fauxAssistantMessage(
      [fauxToolCall("bash", { command, ...(computer === undefined ? {} : { computer }) })],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("done"),
  ])
  const state = await converse(world, agent, chatId, command)
  const tool = state.messages
    .flatMap((message) => message.parts)
    .findLast((part): part is ToolPart => part.type === "tool")
  return tool?.output ?? ""
}

async function setup(world: World, agent: string, name: string): Promise<ChatSummary> {
  await call(world, agent, "/init", "POST", { ownerId: "user-1" })
  await call(world, agent, "/", "PATCH", { name })
  return call<ChatSummary>(world, agent, "/chats", "POST", {})
}

const listing = (world: World, agent: string) => call<LibraryListing>(world, agent, "/library")
const paths = async (world: World, agent: string) =>
  (await listing(world, agent)).files.map((file) => file.path).sort()
const text = async (world: World, agent: string, file: LibraryFile, rev?: number) =>
  (
    await request(world, agent, `/library/${file.id}${rev === undefined ? "" : `?rev=${rev}`}`)
  ).text()

const temporary = () => mkdtempSync(join(tmpdir(), "dc-shared-library-"))

describe("a workspace's library", () => {
  it("is one for all its agents, on whichever machine each works", async () => {
    const world = open(temporary(), true)
    const one = await setup(world, "agent-1", "Scout")
    const two = await setup(world, "agent-2", "Mira")

    await run(world, "agent-1", one.id, "mkdir -p library && echo '# Plan' > library/plan.md")
    // It is in the library, put down to the agent that made it, for every agent to see.
    const [file] = (await listing(world, "agent-2")).files
    expect(file).toMatchObject({ path: "plan.md", source: "agent", agentId: "agent-1" })
    // And it arrives on the other agent's machine before that agent next reads anything there.
    expect(await run(world, "agent-2", two.id, "cat library/plan.md")).toContain("# Plan")
    expect(readFileSync(join(machine("agent-2").home, "library", "plan.md"), "utf8")).toContain(
      "# Plan",
    )

    // What a person writes in the app reaches both.
    await call(world, "agent-2", "/library?path=from-me.md", "POST", "hello both")
    expect(await run(world, "agent-1", one.id, "cat library/from-me.md")).toContain("hello both")
    expect(await run(world, "agent-2", two.id, "cat library/from-me.md")).toContain("hello both")
    expect(world.reports).toEqual([])
  })

  it("has one folder on a machine that two agents share, and takes a file in once", async () => {
    const world = open(temporary(), true)
    const one = await setup(world, "agent-1", "Scout")
    const two = await setup(world, "agent-2", "Mira")
    // Both are given the same machine besides their own, and work there.
    const shared: Machine = {
      id: "shared-1",
      name: "bench",
      kind: "real",
      machineKey: "bench",
      platform: "linux",
      hostname: "",
      home: machine("bench").home,
      folder: machine("bench").home,
      readOnly: false,
      pairedAt: 1,
    }
    for (const agent of ["agent-1", "agent-2"]) {
      const { computers } = await call<{ computers: Machine[] }>(world, agent, "/computers")
      await call(world, agent, "/computers", "PUT", { machines: [...computers, shared] })
    }
    await run(world, "agent-1", one.id, "mkdir -p library && echo a > library/both.md", "bench")
    // The other agent finds the file in the folder too, and knows the library has it already.
    expect(await run(world, "agent-2", two.id, "cat library/both.md", "bench")).toContain("a")
    await run(world, "agent-2", two.id, "echo b > library/other.md", "bench")
    expect(await paths(world, "agent-1")).toEqual(["both.md", "other.md"])
    // Neither agent's own machine is the shared one, and each gets the files all the same.
    expect(await run(world, "agent-1", one.id, "ls library", "computer")).toContain("other.md")
  })

  it("lets one agent at a time bring a machine's folder into step", async () => {
    const world = open(temporary(), true)
    const library = (path: string, body?: unknown) =>
      world.libraries
        .get("workspace-1")
        .fetch(
          new Request(`http://library/rpc/${path}`, {
            method: "POST",
            body: JSON.stringify(body ?? {}),
          }),
        )
        .then((response) => response.json() as Promise<Record<string, unknown>>)
    const first = await library("pass/bench")
    expect(first).toMatchObject({ base: {} })
    // Another agent that wants the same machine's folder waits. Another machine's is free.
    expect(await library("pass/bench")).toEqual({ busy: true })
    expect(await library("pass/desk")).toMatchObject({ base: {} })
    // Something else changes the library meanwhile, so the pass cannot say it saw everything.
    await call(world, "agent-1", "/init", "POST", { ownerId: "user-1" })
    await call(world, "agent-1", "/library?path=late.md", "POST", "arrived during the pass")
    const base = { "a.md": { id: "f1", rev: 0, size: 1, mtimeMs: 1 } }
    expect(await library(`pass/bench/${first.pass}/end`, { base })).toMatchObject({ clean: false })
    // What it agreed on is where the next pass starts.
    expect(await library("pass/bench")).toMatchObject({ base })
    expect(world.reports).toEqual([])
  })

  it("names a file's chat only to the agent whose chat it is", async () => {
    const world = open(temporary(), true)
    const one = await setup(world, "agent-1", "Scout")
    await setup(world, "agent-2", "Mira")
    await call(world, "agent-1", `/library?name=photo.txt&chat=${one.id}`, "POST", "cheese")
    expect((await listing(world, "agent-1")).files[0]).toMatchObject({ chatId: one.id })
    // Chats are numbered agent by agent, so the other agent's chat of that number is another.
    expect((await listing(world, "agent-2")).files[0]).toMatchObject({
      path: "uploads/photo.txt",
      chatId: null,
    })
  })

  it("tells whoever is watching an agent when another agent changes it", async () => {
    const world = open(temporary(), true)
    await setup(world, "agent-1", "Scout")
    await setup(world, "agent-2", "Mira")
    const events = await request(world, "agent-2", "/events")
    const seen: string[] = []
    const reading = (async () => {
      for await (const event of readSse<{ type: string; what?: string }>(events.body!)) {
        if (event.type === "changed" && event.what === "library") {
          seen.push("library")
          return
        }
      }
    })()
    // The stream to the library takes a moment to open after the agent's own.
    await new Promise((resolve) => setTimeout(resolve, 100))
    await call(world, "agent-1", "/library?path=news.md", "POST", "something new")
    await Promise.race([reading, new Promise((resolve) => setTimeout(resolve, 3_000))])
    expect(seen).toEqual(["library"])
  })
})

describe("an agent that kept a library for itself", () => {
  it("moves it into its workspace's, history and all, when the workspace keeps one", async () => {
    const directory = temporary()
    const before = open(directory, false)
    const one = await setup(before, "agent-1", "Scout")
    await setup(before, "agent-2", "Mira")
    const mine = await call<LibraryFile>(before, "agent-1", "/library?path=notes.md", "POST", "one")
    await call(before, "agent-1", `/library/${mine.id}`, "PUT", "one, again")
    const gone = await call<LibraryFile>(before, "agent-1", "/library?path=old.md", "POST", "x")
    await call(before, "agent-1", `/library/${gone.id}`, "DELETE")
    const theirs = await call<LibraryFile>(
      before,
      "agent-2",
      "/library?path=notes.md",
      "POST",
      "two",
    )
    // Its machine has the folder, in step with what it kept.
    expect(await run(before, "agent-1", one.id, "cat library/notes.md")).toContain("one, again")
    await before.agents.close()
    await before.libraries.close()

    const world = open(directory, true)
    // Each moves in when it is next opened. The first is where it was; the second finds its
    // place taken, and goes under a folder named for its agent.
    const first = await listing(world, "agent-1")
    expect(first.files.map((file) => file.path)).toEqual(["notes.md"])
    expect(await paths(world, "agent-2")).toEqual(["Mira/notes.md", "notes.md"])
    const all = (await listing(world, "agent-1")).files
    // The same files, by the ids that the cards in old chats name.
    expect(all.find((file) => file.path === "notes.md")).toMatchObject({
      id: mine.id,
      rev: 1,
      agentId: "agent-1",
    })
    expect(all.find((file) => file.path === "Mira/notes.md")).toMatchObject({
      id: theirs.id,
      agentId: "agent-2",
    })
    expect(await text(world, "agent-2", mine)).toBe("one, again")
    expect(await text(world, "agent-1", theirs)).toBe("two")
    // Earlier contents and deleted files came along.
    const { versions } = await call<{ versions: LibraryVersion[] }>(
      world,
      "agent-1",
      `/library/${mine.id}/versions`,
    )
    expect(versions.map((version) => version.rev)).toEqual([0])
    expect(await text(world, "agent-1", mine, 0)).toBe("one")
    expect(first.deleted.map((file) => file.path)).toEqual(["old.md"])

    // Its machine's folder is still in step: nothing is taken for new, and nothing is lost.
    expect(await run(world, "agent-1", one.id, "cat library/notes.md")).toContain("one, again")
    expect(await run(world, "agent-1", one.id, "cat library/Mira/notes.md")).toContain("two")
    expect(await paths(world, "agent-1")).toEqual(["Mira/notes.md", "notes.md"])
    expect((await listing(world, "agent-1")).files.map((file) => file.rev).sort()).toEqual([0, 1])
    expect(world.reports).toEqual([])
  })
})
