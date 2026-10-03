import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type {
  AgentEvent,
  ApprovalsState,
  ChatState,
  ChatSummary,
  ConnectorResult,
  ToolPart,
} from "@durable-computer/protocol"
import { readSse } from "@durable-computer/protocol"
import { fileBlobs, NodeActorNamespace } from "@durable-computer/runtime/node"
import { createLocalProcessSandbox } from "@durable-computer/sandbox/testing"
import { createModels } from "@earendil-works/pi-ai/models"
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"
import { afterEach, describe, expect, it } from "vitest"
import {
  type AgentNotification,
  CONNECTOR_REDIRECT_HEADER,
  createAgentActor,
} from "../src/index.ts"
import { fakeMcp } from "./fake-mcp.ts"

type World = {
  namespace: NodeActorNamespace
  faux: ReturnType<typeof fauxProvider>
  notifications: AgentNotification[]
  mcp: ReturnType<typeof fakeMcp>
}
const worlds: World[] = []
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.namespace.close().catch(() => {})
})

function open(): World {
  const directory = mkdtempSync(join(tmpdir(), "dc-approvals-"))
  const faux = fauxProvider({
    provider: "test",
    models: [{ id: "model" }],
    tokensPerSecond: 50_000,
  })
  const models = createModels()
  models.setProvider(faux.provider)
  const notifications: AgentNotification[] = []
  const mcp = fakeMcp()
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
        sandbox: () => createLocalProcessSandbox(),
        connectorFetch: mcp.fetch,
        onNotify: (notification) => notifications.push(notification),
      }),
  })
  namespace.start()
  const world = { namespace, faux, notifications, mcp }
  worlds.push(world)
  return world
}

async function call<T>(
  world: World,
  path: string,
  method = "GET",
  payload?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await world.namespace.get("agent-1").fetch(
    new Request(`http://actor${path}`, {
      method,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      headers: {
        ...(payload === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
    }),
  )
  const result = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(`${response.status}: ${result.error}`)
  return result
}

async function settled(world: World, chatId: string): Promise<ChatState> {
  for (let attempt = 0; attempt < 500; attempt++) {
    const state = await call<ChatState>(world, `/chats/${chatId}`)
    if (!state.busy && state.queued.length === 0 && state.messages.at(-1)?.role === "assistant")
      return state
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("The chat did not settle")
}

async function say(world: World, chatId: string, text: string): Promise<ChatState> {
  await call(world, `/chats/${chatId}/messages`, "POST", { text, requestId: crypto.randomUUID() })
  return settled(world, chatId)
}

async function setup(world: World): Promise<ChatSummary> {
  await call(world, "/init", "POST", { ownerId: "user-1" })
  return call<ChatSummary>(world, "/chats", "POST", { title: "Chores" })
}

type ToolArguments = Record<string, string | number | { oldText: string; newText: string }[]>
const useTool = (name: string, args: ToolArguments, then = "Done.") => [
  fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" }),
  fauxAssistantMessage(then),
]
const tools = (state: ChatState) =>
  state.messages.flatMap((m) => m.parts).filter((p): p is ToolPart => p.type === "tool")
const said = (state: ChatState) =>
  state.messages.map((m) => m.parts.map((p) => (p.type === "text" ? p.text : "")).join(""))

describe("approval rules", () => {
  it("are empty by default, and then nothing is asked", async () => {
    const world = open()
    const chat = await setup(world)
    const initial = await call<ApprovalsState>(world, "/approvals")
    expect(initial.rules).toEqual({})
    expect(initial.pending).toEqual([])
    expect(initial.subjects.map((subject) => subject.id)).toContain("tool:bash")

    world.faux.setResponses(useTool("bash", { command: "echo trusted" }))
    const state = await say(world, chat.id, "go")
    expect(tools(state)[0]).toMatchObject({ status: "done", output: "trusted\n" })
    expect((await call<ApprovalsState>(world, "/approvals")).pending).toEqual([])
  })

  it("refuse a denied tool outright, and say why", async () => {
    const world = open()
    const chat = await setup(world)
    await call(world, "/approvals/rules", "PATCH", { "tool:bash": "deny" })
    world.faux.setResponses(useTool("bash", { command: "echo nope > made.txt" }, "I cannot."))
    const state = await say(world, chat.id, "go")
    expect(tools(state)[0]!.status).toBe("error")
    expect(tools(state)[0]!.output).toContain("switched this off (Run commands)")
    // Nothing ran, and nothing is waiting on the user.
    world.faux.setResponses(useTool("read", { path: "made.txt" }, "No file."))
    expect(tools(await say(world, chat.id, "check")).at(-1)!.status).toBe("error")
    expect((await call<ApprovalsState>(world, "/approvals")).pending).toEqual([])
    expect(world.notifications.filter((n) => n.kind === "approval")).toEqual([])
  })

  it("hold an asked-about call until the user allows it once", async () => {
    const world = open()
    const chat = await setup(world)
    await call(world, "/approvals/rules", "PATCH", { "tool:bash": "ask" })

    world.faux.setResponses(
      useTool("bash", { command: "echo held > held.txt" }, "I would like to write a file. May I?"),
    )
    const asked = await say(world, chat.id, "write the file")
    expect(tools(asked)[0]!.status).toBe("error")
    expect(tools(asked)[0]!.output).toContain("needs the user's approval first (Run commands)")

    const { pending } = await call<ApprovalsState>(world, "/approvals")
    expect(pending).toMatchObject([
      {
        chatId: chat.id,
        chatTitle: "Chores",
        title: "Run commands",
        detail: "echo held > held.txt",
      },
    ])
    expect(world.notifications.filter((n) => n.kind === "approval")).toMatchObject([
      { heading: "Needs your OK", text: "Run commands: echo held > held.txt", chatId: chat.id },
    ])

    // The answer goes to the chat, and the agent's next attempt is let through.
    world.faux.setResponses(useTool("bash", { command: "echo held > held.txt && cat held.txt" }))
    await call(world, `/approvals/${pending[0]!.id}`, "POST", { decision: "once" })
    const after = await settled(world, chat.id)
    expect(said(after)).toContain("Approved: Run commands: echo held > held.txt")
    expect(tools(after).at(-1)).toMatchObject({ status: "done", output: "held\n" })
    expect((await call<ApprovalsState>(world, "/approvals")).pending).toEqual([])

    // Once means once: the rule still stands for the call after that.
    world.faux.setResponses(useTool("bash", { command: "echo again" }, "May I?"))
    const again = await say(world, chat.id, "and again")
    expect(tools(again).at(-1)!.status).toBe("error")
    expect((await call<ApprovalsState>(world, "/approvals")).pending.length).toBe(1)
  })

  it("lift the rule when the user says always", async () => {
    const world = open()
    const chat = await setup(world)
    await call(world, "/approvals/rules", "PATCH", { "tool:bash": "ask", "tool:schedule": "ask" })
    world.faux.setResponses(useTool("bash", { command: "echo one" }, "May I?"))
    await say(world, chat.id, "go")
    const { pending } = await call<ApprovalsState>(world, "/approvals")

    world.faux.setResponses(useTool("bash", { command: "echo one" }))
    await call(world, `/approvals/${pending[0]!.id}`, "POST", { decision: "always" })
    await settled(world, chat.id)
    // Only the rule that asked is lifted.
    expect((await call<ApprovalsState>(world, "/approvals")).rules).toEqual({
      "tool:schedule": "ask",
    })

    world.faux.setResponses(useTool("bash", { command: "echo two" }))
    expect(tools(await say(world, chat.id, "more")).at(-1)).toMatchObject({
      status: "done",
      output: "two\n",
    })
  })

  it("tell the agent when the user says no", async () => {
    const world = open()
    const chat = await setup(world)
    await call(world, "/approvals/rules", "PATCH", { "tool:bash": "ask" })
    world.faux.setResponses(useTool("bash", { command: "rm -rf build" }, "May I?"))
    await say(world, chat.id, "clean up")
    const { pending } = await call<ApprovalsState>(world, "/approvals")

    world.faux.setResponses([fauxAssistantMessage("Understood, I will leave it.")])
    await call(world, `/approvals/${pending[0]!.id}`, "POST", { decision: "deny" })
    const after = await settled(world, chat.id)
    expect(said(after)).toContain("Not allowed: Run commands: rm -rf build")
    expect(said(after).at(-1)).toBe("Understood, I will leave it.")
    // The instruction the model got is not shown to the user, and no pass was left behind.
    expect(said(after).join("\n")).not.toContain("<meta")
    world.faux.setResponses(useTool("bash", { command: "rm -rf build" }, "May I?"))
    expect(tools(await say(world, chat.id, "do it anyway")).at(-1)!.status).toBe("error")

    await expect(
      call(world, `/approvals/${pending[0]!.id}`, "POST", { decision: "once" }),
    ).rejects.toThrow(/already been answered/)
  })

  it("ask once for the same call, however often it is tried", async () => {
    const world = open()
    const chat = await setup(world)
    await call(world, "/approvals/rules", "PATCH", { "tool:bash": "ask" })
    world.faux.setResponses(useTool("bash", { command: "echo same" }, "May I?"))
    await say(world, chat.id, "go")
    world.faux.setResponses(useTool("bash", { command: "echo same" }, "Still waiting."))
    await say(world, chat.id, "well?")
    expect((await call<ApprovalsState>(world, "/approvals")).pending.length).toBe(1)
    expect(world.notifications.filter((n) => n.kind === "approval").length).toBe(1)
  })

  it("apply to a connector as a whole", async () => {
    const world = open()
    const chat = await setup(world)
    const added = await call<ConnectorResult>(
      world,
      "/connectors",
      "POST",
      { name: "Calculator", url: world.mcp.url },
      { [CONNECTOR_REDIRECT_HEADER]: "https://app.example/api/connectors/callback" },
    )
    const subject = `connector:${added.connector.id}`
    const { subjects } = await call<ApprovalsState>(world, "/approvals")
    expect(subjects).toContainEqual({ id: subject, label: "Use Calculator", kind: "connector" })

    await call(world, "/approvals/rules", "PATCH", { [subject]: "ask" })
    world.faux.setResponses(useTool("calculator__add", { a: 1, b: 2 }, "May I?"))
    const asked = await say(world, chat.id, "add")
    expect(tools(asked)[0]!.output).toContain("(Use Calculator)")
    expect(world.mcp.calls).toEqual([])
    // Tools that are not the connector's are untouched.
    world.faux.setResponses(useTool("bash", { command: "echo free" }))
    expect(tools(await say(world, chat.id, "shell")).at(-1)).toMatchObject({ status: "done" })
  })

  it("cover every tool that can do the same thing, not one tool by name", async () => {
    const world = open()
    const chat = await setup(world)
    await call(world, "/library?name=notes.txt", "POST", "from the library")
    await call(world, "/approvals/rules", "PATCH", { "tool:files": "deny" })

    // Writing, editing, a shell redirect and a copy out of the library all change files.
    for (const [tool, args] of [
      ["write", { path: "a.txt", content: "x" }],
      ["edit", { path: "a.txt", edits: [{ oldText: "x", newText: "y" }] }],
      ["bash", { command: "echo sneaky > a.txt" }],
      ["library", { action: "get", file: "notes.txt" }],
    ] as [string, ToolArguments][]) {
      world.faux.setResponses(useTool(tool, args, "I cannot."))
      const refused = tools(await say(world, chat.id, `try ${tool}`)).at(-1)!
      expect(`${tool}: ${refused.status}`).toBe(`${tool}: error`)
      expect(refused.output).toContain("switched this off")
    }
    // Looking is not changing: listing the library and reading are untouched.
    world.faux.setResponses(useTool("library", { action: "list" }))
    expect(tools(await say(world, chat.id, "list")).at(-1)).toMatchObject({ status: "done" })
    world.faux.setResponses(useTool("read", { path: "IDENTITY.md" }))
    expect(tools(await say(world, chat.id, "read")).at(-1)).toMatchObject({ status: "done" })
    // Nothing was written by any of them.
    await call(world, "/approvals/rules", "PATCH", { "tool:files": "allow" })
    world.faux.setResponses(
      useTool("bash", { command: "ls a.txt uploads 2>&1 | grep -c 'No such file'" }),
    )
    // Both are missing: nothing was written by any of the four.
    expect(
      tools(await say(world, chat.id, "check"))
        .at(-1)!
        .output?.trim(),
    ).toBe("2")
  })

  it("names a request by what would happen, and asks about a command under the files rule", async () => {
    const world = open()
    const chat = await setup(world)
    await call(world, "/approvals/rules", "PATCH", { "tool:files": "ask" })
    world.faux.setResponses(useTool("bash", { command: "touch made.txt" }, "May I?"))
    await say(world, chat.id, "go")
    const state = await call<ApprovalsState>(world, "/approvals")
    expect(state.pending).toMatchObject([{ title: "Run commands", detail: "touch made.txt" }])
    expect(state.subjects.find((subject) => subject.id === "tool:files")).toMatchObject({
      label: "Create and change files",
      hint: expect.stringContaining("running commands"),
    })
    // Always allowing it lifts the rule that asked, which was the one on files.
    world.faux.setResponses(useTool("bash", { command: "touch made.txt" }))
    await call(world, `/approvals/${state.pending[0]!.id}`, "POST", { decision: "always" })
    await settled(world, chat.id)
    expect((await call<ApprovalsState>(world, "/approvals")).rules).toEqual({})
  })

  it("keep memory and identity from being changed through their files", async () => {
    const world = open()
    const chat = await setup(world)
    world.faux.setResponses(
      useTool("bash", { command: "cat MEMORY.md; echo first note > MEMORY.md" }),
    )
    await say(world, chat.id, "note something")
    expect((await call<{ memory: string }>(world, "/")).memory).toBe("first note")

    await call(world, "/approvals/rules", "PATCH", { "tool:memory": "ask" })
    // The tools ask...
    world.faux.setResponses(
      useTool("memory", { action: "add", target: "memory", content: "second note" }, "May I?"),
    )
    expect(tools(await say(world, chat.id, "remember more")).at(-1)!.status).toBe("error")
    world.faux.setResponses(useTool("set_identity", { name: "Mallory" }, "May I?"))
    expect(tools(await say(world, chat.id, "rename yourself")).at(-1)!.status).toBe("error")
    // ...and the file, which is the same memory, cannot be used to go around them.
    world.faux.setResponses(useTool("bash", { command: "echo injected > MEMORY.md" }))
    const edited = tools(await say(world, chat.id, "edit the file")).at(-1)!
    expect(JSON.stringify(edited)).toContain("put back as they were")
    const after = await call<{ memory: string; agent: { name: string | null } }>(world, "/")
    expect(after.memory).toBe("first note")
    expect(after.agent.name).toBe(null)
    world.faux.setResponses(useTool("bash", { command: "cat MEMORY.md" }))
    expect(tools(await say(world, chat.id, "show it")).at(-1)!.output).toBe("first note\n")
  })

  it("reject rules for things that cannot have one", async () => {
    const world = open()
    await setup(world)
    await expect(call(world, "/approvals/rules", "PATCH", { bash: "ask" })).rejects.toThrow("400")
    await expect(
      call(world, "/approvals/rules", "PATCH", { "tool:bash": "sometimes" }),
    ).rejects.toThrow("400")
    // Allowing is the default, so it leaves no rule behind.
    await call(world, "/approvals/rules", "PATCH", { "tool:bash": "ask" })
    expect(
      (await call<ApprovalsState>(world, "/approvals/rules", "PATCH", { "tool:bash": "allow" }))
        .rules,
    ).toEqual({})
  })

  it("tell open clients when a request appears", async () => {
    const world = open()
    const chat = await setup(world)
    await call(world, "/approvals/rules", "PATCH", { "tool:bash": "ask" })
    const events = await world.namespace.get("agent-1").fetch(new Request("http://actor/events"))
    const seen: string[] = []
    const reading = (async () => {
      for await (const event of readSse<AgentEvent>(events.body!)) {
        if (event.type === "changed") seen.push(event.what)
        if (seen.includes("approvals")) break
      }
    })()
    world.faux.setResponses(useTool("bash", { command: "echo hi" }, "May I?"))
    await say(world, chat.id, "go")
    await reading
    expect(seen).toContain("approvals")
  })
})
