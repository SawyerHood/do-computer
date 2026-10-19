import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type AgentEvent,
  type ApprovalsState,
  type ChatEvent,
  type ChatState,
  type ChatSummary,
  EMPTY_CHAT,
  isPinning,
  isShownPart,
  type LibraryFile,
  MAX_PINS,
  type Pin,
  pinned,
  pinnedFile,
  readSse,
  reduceChat,
  type ToolPart,
  toolSummary,
} from "@do-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@do-computer/runtime/node"
import { createModels } from "@earendil-works/pi-ai/models"
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"
import { afterEach, describe, expect, it } from "vitest"
import { createAgentActor, createLibraryActor } from "../src/index.ts"

type World = {
  agents: NodeActorNamespace
  libraries: NodeActorNamespace
  faux: ReturnType<typeof fauxProvider>
  reports: unknown[]
}
const worlds: World[] = []

/** Agents of one workspace, which keeps a library for them and has no machine at all. */
function open(): World {
  const root = mkdtempSync(join(tmpdir(), "dc-pins-"))
  const faux = fauxProvider({ provider: "test", models: [{ id: "model" }], tokensPerSecond: 5_000 })
  const models = createModels()
  models.setProvider(faux.provider)
  const reports: unknown[] = []
  const libraries = new NodeActorNamespace({
    directory: join(root, "libraries"),
    blobs: (name) => fileBlobs(join(root, "library-blobs", encodeURIComponent(name))),
    factory: (host) => createLibraryActor(host),
    onError: (error) => reports.push(error),
  })
  const agents = new NodeActorNamespace({
    directory: join(root, "agents"),
    blobs: (name) => fileBlobs(join(root, "blobs", encodeURIComponent(name))),
    factory: (host) =>
      createAgentActor(host, {
        models,
        defaultModel: "test/model",
        modelOptions: [
          { id: "test/model", name: "Test", reasoning: false, inputCost: 0, outputCost: 0 },
        ],
        keepAliveMs: 100,
        computers: { kinds: [], default: "", create: () => undefined },
        library: async () => libraries.get("workspace-1"),
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

const request = (world: World, path: string, init?: RequestInit, agent = "agent-1") =>
  world.agents.get(agent).fetch(new Request(`http://actor${path}`, init))

async function call<T>(
  world: World,
  path: string,
  method = "GET",
  payload?: unknown,
  agent = "agent-1",
): Promise<T> {
  const text = typeof payload === "string"
  const response = await request(
    world,
    path,
    {
      method,
      body: payload === undefined ? undefined : text ? payload : JSON.stringify(payload),
      headers:
        payload === undefined
          ? undefined
          : { "content-type": text ? "text/plain" : "application/json" },
    },
    agent,
  )
  const result = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(`${response.status}: ${result.error ?? ""}`)
  return result
}

async function converse(world: World, chatId: string, text: string): Promise<ChatState> {
  const response = await request(world, `/chats/${chatId}/events`)
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

/** Have the agent call one tool, and return the call as the chat then shows it. */
async function use(
  world: World,
  chatId: string,
  name: string,
  args: Record<string, string>,
): Promise<ToolPart> {
  world.faux.setResponses([
    fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ])
  const state = await converse(world, chatId, `${name} ${JSON.stringify(args).slice(0, 40)}`)
  return state.messages
    .flatMap((message) => message.parts)
    .findLast((part): part is ToolPart => part.type === "tool")!
}

async function setup(world: World, agent = "agent-1"): Promise<ChatSummary> {
  await call(world, "/init", "POST", { ownerId: "user-1" }, agent)
  await call(world, "/", "PATCH", { name: "Scout" }, agent)
  return call<ChatSummary>(world, "/chats", "POST", {}, agent)
}

const put = (world: World, path: string, content: string) =>
  call<LibraryFile>(world, `/library?path=${encodeURIComponent(path)}`, "POST", content)

const pins = async (world: World, agent = "agent-1") =>
  (await call<{ pins: Pin[] }>(world, "/pins", "GET", undefined, agent)).pins

describe("pinning", () => {
  it("a person pins a file of the library to the agent, and takes the pin off", async () => {
    const world = open()
    await setup(world)
    expect(await pins(world)).toEqual([])
    const board = await put(world, "boards/relaunch.html", "<h1>Relaunch</h1>")
    const plan = await put(world, "plan.md", "# Plan")
    // Under a title, as one that the agent pinned is put back.
    await call(world, `/pins/${board.id}`, "PUT", { title: "Launch board" })
    const both = (await call<{ pins: Pin[] }>(world, `/pins/${plan.id}`, "PUT")).pins
    // In the order they were pinned: the first is the one drawn large.
    expect(both).toMatchObject([
      { fileId: board.id, path: "boards/relaunch.html", title: "Launch board", by: "user" },
      { fileId: plan.id, path: "plan.md", by: "user" },
    ])
    expect(both[1]).not.toHaveProperty("title")
    // Pinned again, it is pinned once.
    expect((await call<{ pins: Pin[] }>(world, `/pins/${board.id}`, "PUT")).pins).toHaveLength(2)
    const left = (await call<{ pins: Pin[] }>(world, `/pins/${board.id}`, "DELETE")).pins
    expect(left.map((pin) => pin.fileId)).toEqual([plan.id])
    // A pin is of a file that is there.
    await expect(call(world, "/pins/nothing", "PUT")).rejects.toThrow("404")
    expect(world.reports).toEqual([])
  })

  it("the agent pins with its tool, by where the file is in the library", async () => {
    const world = open()
    const chat = await setup(world)
    const board = await put(world, "boards/relaunch.html", "<h1>Relaunch</h1>")
    const part = await use(world, chat.id, "pin", {
      action: "pin",
      // As it is on a machine, which is how the agent often knows it.
      path: "~/library/boards/relaunch.html",
      title: "  Launch   board ",
    })
    expect(part.status).toBe("done")
    // The chat shows it, as what was pinned.
    expect(isPinning(part)).toBe(true)
    expect(isShownPart(part)).toBe(true)
    expect(pinned(part)).toMatchObject({
      pin: { fileId: board.id, path: "boards/relaunch.html", title: "Launch board", by: "agent" },
      file: { id: board.id, name: "relaunch.html" },
    })
    expect(toolSummary(part)).toMatch(/^Pinned: Launch\s+board$/)
    expect(part.output).toContain("Pinned boards/relaunch.html as “Launch board”")
    expect(await pins(world)).toMatchObject([{ fileId: board.id, title: "Launch board" }])

    const listed = await use(world, chat.id, "pin", { action: "list" })
    expect(listed.output).toBe("Launch board: boards/relaunch.html (pinned by you)")
    // Not shown as a card: nothing was pinned by looking.
    expect(isPinning(listed)).toBe(false)

    // Taken off by the title it was given.
    const off = await use(world, chat.id, "pin", { action: "unpin", path: "launch board" })
    expect(off.status).toBe("done")
    expect(off.output).toContain("no longer pinned")
    expect(await pins(world)).toEqual([])

    const missing = await use(world, chat.id, "pin", { action: "pin", path: "boards/nope.html" })
    expect(missing.status).toBe("error")
    expect(missing.output).toContain('There is no file "boards/nope.html" in the library')
    const unpinned = await use(world, chat.id, "pin", { action: "unpin", path: "plan.md" })
    expect(unpinned.status).toBe("error")

    // It is among what a rule can be set for, and is not asked about.
    const { pending, subjects } = await call<ApprovalsState>(world, "/approvals")
    expect(pending).toEqual([])
    expect(subjects.map((subject) => subject.id)).toContain("tool:pin")
    expect(world.reports).toEqual([])
  })

  it("a pin follows its file when it is moved, and says so when it is gone", async () => {
    const world = open()
    const chat = await setup(world)
    const board = await put(world, "boards/relaunch.html", "<h1>Relaunch</h1>")
    await call(world, `/pins/${board.id}`, "PUT")
    await call(world, `/library/${board.id}`, "PATCH", { path: "launch/board.html" })
    const { files } = await call<{ files: LibraryFile[] }>(world, "/library")
    const [pin] = await pins(world)
    expect(pinnedFile(pin!, files)).toMatchObject({ id: board.id, path: "launch/board.html" })
    // Pinned again where it now is, the pin says where that is.
    await use(world, chat.id, "pin", { action: "pin", path: "launch/board.html" })
    expect(await pins(world)).toMatchObject([
      { fileId: board.id, path: "launch/board.html", by: "user" },
    ])

    await call(world, `/library/${board.id}`, "DELETE")
    const gone = await use(world, chat.id, "pin", { action: "list" })
    expect(gone.output).toContain("launch/board.html, which is no longer in the library")
    // A file made again at the same place is what the pin is then of.
    const again = await put(world, "launch/board.html", "<h1>Again</h1>")
    expect(again.id).not.toBe(board.id)
    const now = await call<{ files: LibraryFile[] }>(world, "/library")
    expect(pinnedFile((await pins(world))[0]!, now.files)).toMatchObject({ id: again.id })
    // And taking the pin off by that file takes it off.
    expect((await call<{ pins: Pin[] }>(world, `/pins/${board.id}`, "DELETE")).pins).toEqual([])
  })

  it("there is room for only so many, and each agent has its own", async () => {
    const world = open()
    const chat = await setup(world)
    await setup(world, "agent-2")
    const files: LibraryFile[] = []
    for (let index = 0; index <= MAX_PINS; index++) {
      files.push(await put(world, `notes/${index}.md`, `# ${index}`))
    }
    for (const file of files.slice(0, MAX_PINS)) await call(world, `/pins/${file.id}`, "PUT")
    await expect(call(world, `/pins/${files[MAX_PINS]!.id}`, "PUT")).rejects.toThrow(
      /400: 8 things are pinned already/,
    )
    const full = await use(world, chat.id, "pin", { action: "pin", path: `notes/${MAX_PINS}.md` })
    expect(full.status).toBe("error")
    expect(full.output).toContain("Unpin one first")
    expect(await pins(world)).toHaveLength(MAX_PINS)
    // The other agent shares the library and none of the pins.
    expect(await pins(world, "agent-2")).toEqual([])
  })

  it("everyone following the agent is told when what is pinned changes", async () => {
    const world = open()
    await setup(world)
    const board = await put(world, "boards/relaunch.html", "<h1>Relaunch</h1>")
    const response = await request(world, "/events")
    const told: string[] = []
    const reading = (async () => {
      for await (const event of readSse<AgentEvent>(response.body!)) {
        if (event.type === "ready") void call(world, `/pins/${board.id}`, "PUT")
        if (event.type === "changed") told.push(event.what)
        if (told.includes("pins")) break
      }
    })()
    await reading
    expect(told).toContain("pins")
  })
})
