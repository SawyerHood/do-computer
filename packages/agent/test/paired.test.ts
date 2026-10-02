import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createComputerLinkActor, DaemonCore } from "@durable-computer/computers"
import { nodeDaemonIO } from "@durable-computer/computers/node"
import type { ChatState, ChatSummary, ToolPart } from "@durable-computer/protocol"
import { fileBlobs, NodeActorNamespace, type SocketLike } from "@durable-computer/runtime/node"
import { justBashSandbox } from "@durable-computer/sandbox"
import { createModels } from "@earendil-works/pi-ai/models"
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"
import { afterAll, describe, expect, it } from "vitest"
import { computerActorName, createAgentActor } from "../src/index.ts"

const directory = mkdtempSync(join(tmpdir(), "dc-paired-"))
const links = new NodeActorNamespace({
  directory: join(directory, "links"),
  blobs: () => fileBlobs(join(directory, "link-blobs")),
  factory: (host) => createComputerLinkActor(host),
})
const faux = fauxProvider({ provider: "test", models: [{ id: "model" }], tokensPerSecond: 5_000 })
const models = createModels()
models.setProvider(faux.provider)
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
      sandbox: (host) => justBashSandbox({ id: host.name, database: host.sql }),
      computerLinks: links,
    }),
})
afterAll(async () => {
  await agents.close()
  await links.close()
})

/** Run a daemon for computer `id` on a fresh home directory, connected to its link in memory. */
async function startDaemon(id: string, readOnly = false): Promise<string> {
  const home = mkdtempSync(join(tmpdir(), "dc-laptop-"))
  const listeners = {
    message: [] as ((data: unknown, binary: boolean) => void)[],
    close: [] as never[],
  }
  const toDaemon: ((data: string) => void)[] = []
  const like: SocketLike = {
    readyState: 1,
    send: (data) => queueMicrotask(() => toDaemon.forEach((listener) => listener(data))),
    close: () => {},
    on: (event: string, listener: never) => {
      if (event === "message") listeners.message.push(listener)
      return like
    },
  }
  const daemon = new DaemonCore(
    nodeDaemonIO({ home, audit: () => {}, shell: "sh" }),
    (frame) => {
      queueMicrotask(() => listeners.message.forEach((listener) => listener(frame, false)))
      return true
    },
    { readOnly },
  )
  toDaemon.push((data) => daemon.onFrame(data))
  await links.connect(computerActorName(id), like, new Request("http://link/connect"))
  daemon.onOpen()
  return home
}

async function call<T>(path: string, method = "GET", payload?: unknown): Promise<T> {
  const response = await agents.get("agent-1").fetch(
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

async function say(chatId: string, text: string): Promise<ChatState> {
  const before = (await call<ChatState>(`/chats/${chatId}`)).messages.length
  await call(`/chats/${chatId}/messages`, "POST", { text, requestId: crypto.randomUUID() })
  const deadline = Date.now() + 8_000
  for (;;) {
    const state = await call<ChatState>(`/chats/${chatId}`)
    if (!state.busy && state.messages.length > before + 1) return state
    if (Date.now() > deadline) throw new Error("run did not finish")
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
}

const lastTool = (state: ChatState) =>
  state.messages.flatMap((m) => m.parts).findLast((part): part is ToolPart => part.type === "tool")!
const useTool = (name: string, args: Record<string, string>) => [
  fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" }),
  fauxAssistantMessage("done"),
]

describe("paired computers", () => {
  let chat: ChatSummary
  let laptopHome: string

  it("are listed for the agent once paired", async () => {
    await call("/init", "POST", { ownerId: "user-1" })
    chat = await call<ChatSummary>("/chats", "POST", {})
    laptopHome = await startDaemon("c1")
    await call("/computers/c1", "PUT", {
      name: "laptop",
      platform: "linux",
      hostname: "sawyers-laptop",
      home: laptopHome,
      readOnly: false,
      pairedAt: 1,
    })
    // A second computer with the same name is told apart.
    const second = await call<{ name: string }>("/computers/c2", "PUT", {
      name: "laptop",
      platform: "darwin",
      hostname: "other",
      home: "/Users/x",
      readOnly: true,
      pairedAt: 2,
    })
    expect(second.name).toBe("laptop-2")

    let prompt = ""
    faux.setResponses([
      (context) => {
        prompt = JSON.stringify(context)
        return fauxAssistantMessage("ok")
      },
    ])
    await say(chat.id, "what computers do I have?")
    expect(prompt).toContain(`- laptop: linux, home ${laptopHome}`)
    expect(prompt).toContain("- laptop-2: darwin, home /Users/x, read-only")
    // The tools advertise the argument that selects a computer.
    expect(prompt).toContain("Name of one of the user's own computers")
  })

  it("run a command there when asked to, and on the agent's own computer otherwise", async () => {
    writeFileSync(join(laptopHome, "on-laptop.txt"), "only on the laptop\n")
    faux.setResponses(useTool("bash", { command: "cat on-laptop.txt && pwd", computer: "laptop" }))
    const remote = lastTool(await say(chat.id, "read the file on my laptop"))
    expect(remote.status).toBe("done")
    expect(remote.output).toContain("only on the laptop")
    expect(remote.output).toContain(laptopHome)

    faux.setResponses(useTool("bash", { command: "pwd; ls on-laptop.txt" }))
    const own = lastTool(await say(chat.id, "and on yours?"))
    expect(own.output).toContain("/workspace")
    expect(own.output).not.toContain("only on the laptop")
  })

  it("read, write and edit files there", async () => {
    faux.setResponses(
      useTool("write", {
        path: "notes/from-agent.md",
        content: "first draft\n",
        computer: "Laptop",
      }),
    )
    expect(lastTool(await say(chat.id, "write a note on my laptop")).status).toBe("done")
    expect(readFileSync(join(laptopHome, "notes/from-agent.md"), "utf8")).toBe("first draft\n")

    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("edit", {
            path: "notes/from-agent.md",
            edits: [{ oldText: "first", newText: "second" }],
            computer: "laptop",
          }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("done"),
    ])
    expect(lastTool(await say(chat.id, "revise it")).status).toBe("done")
    expect(readFileSync(join(laptopHome, "notes/from-agent.md"), "utf8")).toBe("second draft\n")

    faux.setResponses(useTool("read", { path: "notes/from-agent.md", computer: "laptop" }))
    expect(lastTool(await say(chat.id, "read it back")).output).toContain("second draft")
  })

  it("explain an unknown, offline or removed computer instead of failing obscurely", async () => {
    faux.setResponses(useTool("bash", { command: "ls", computer: "desktop" }))
    expect(lastTool(await say(chat.id, "try the desktop"))).toMatchObject({
      status: "error",
      output: 'There is no computer named "desktop". Connected computers: laptop, laptop-2.',
    })

    // laptop-2 was registered but its daemon never connected.
    faux.setResponses(useTool("bash", { command: "ls", computer: "laptop-2" }))
    const offline = lastTool(await say(chat.id, "try the other one"))
    expect(offline.status).toBe("error")
    expect(offline.output).toContain("The computer is offline.")

    await call("/computers/c2", "DELETE")
    expect(
      (await call<{ computers: { name: string }[] }>("/computers")).computers.map((c) => c.name),
    ).toEqual(["laptop"])
  })
})
