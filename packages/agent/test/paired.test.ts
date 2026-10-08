import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createComputerLinkActor, DaemonCore } from "@durable-computer/computers"
import { nodeDaemonIO } from "@durable-computer/computers/node"
import type { ApprovalsState, ChatState, ChatSummary, ToolPart } from "@durable-computer/protocol"
import { fileBlobs, NodeActorNamespace, type SocketLike } from "@durable-computer/runtime/node"
import { justBashSandbox } from "@durable-computer/sandbox"
import { createModels } from "@earendil-works/pi-ai/models"
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"
import { afterAll, describe, expect, it } from "vitest"
import { computerActorName, createAgentActor, type NearbyComputer } from "../src/index.ts"

const directory = mkdtempSync(join(tmpdir(), "dc-paired-"))
const links = new NodeActorNamespace({
  directory: join(directory, "links"),
  blobs: () => fileBlobs(join(directory, "link-blobs")),
  factory: (host) => createComputerLinkActor(host),
})
/** What the host says is out there, and what it was asked. Set by the tests that use them. */
let nearby: NearbyComputer[] = []
/** Computers the host no longer lets the agent use, whatever the agent was told. */
const takenAway = new Set<string>()
const asks: { agentId: string; computerId: string; chatId: string; reason: string }[] = []
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
      computerDirectory: {
        allowed: async (_agentId, computerId) => !takenAway.has(computerId),
        list: async () => nearby,
        request: async (agentId, ask) => {
          const computer = nearby.find((one) => one.id === ask.computerId)
          if (computer === undefined) return undefined
          const fresh = !computer.asked
          if (fresh) asks.push({ agentId, ...ask })
          computer.asked = true
          return { asked: computer.team ? `anyone in ${computer.owner}` : computer.owner, fresh }
        },
      },
    }),
})
afterAll(async () => {
  await agents.close()
  await links.close()
})

/** Run a daemon for computer `id` on a fresh home directory, connected to its link in memory. */
async function startDaemon(id: string, readOnly = false, current = false): Promise<string> {
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
  // A daemon of today says what it is, and that it can keep a command running.
  if (current) {
    const hello = { t: "hello", platform: "linux", hostname: id, home, readOnly, version: "test" }
    listeners.message.forEach((listener) =>
      listener(JSON.stringify({ ...hello, jobs: true }), false),
    )
  }
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
    expect(prompt).toContain("Name of the computer to do this on")
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

  it("can be put behind an approval, even for reading, without limiting the agent's own computer", async () => {
    const approvals = await call<ApprovalsState>("/approvals")
    expect(approvals.subjects).toContainEqual({
      id: "computer:c1",
      label: "Work on laptop",
      kind: "computer",
    })
    await call("/approvals/rules", "PATCH", { "computer:c1": "ask" })

    // Reading is asked about too: the rule is about the machine, not the tool.
    faux.setResponses(useTool("read", { path: "notes/from-agent.md", computer: "laptop" }))
    const held = lastTool(await say(chat.id, "read my notes"))
    expect(held.status).toBe("error")
    expect(held.output).toContain("needs the user's approval first (Read files on laptop)")
    const { pending } = await call<ApprovalsState>("/approvals")
    expect(pending).toMatchObject([
      { title: "Read files on laptop", detail: "notes/from-agent.md" },
    ])

    // The same tool on the agent's own computer is not the laptop.
    faux.setResponses(useTool("bash", { command: "echo mine" }))
    expect(lastTool(await say(chat.id, "your own shell"))).toMatchObject({
      status: "done",
      output: "mine\n",
    })

    faux.setResponses(useTool("read", { path: "notes/from-agent.md", computer: "laptop" }))
    const before = (await call<ChatState>(`/chats/${chat.id}`)).messages.length
    await call(`/approvals/${pending[0]!.id}`, "POST", { decision: "always" })
    for (;;) {
      const state = await call<ChatState>(`/chats/${chat.id}`)
      if (!state.busy && state.messages.length > before + 1) break
      await new Promise((resolve) => setTimeout(resolve, 30))
    }
    expect(lastTool(await call<ChatState>(`/chats/${chat.id}`)).output).toContain("second draft")
    expect(
      Object.keys((await call<ApprovalsState>("/approvals")).rules).filter((id) =>
        id.startsWith("computer:"),
      ),
    ).toEqual([])
  })

  it("explain an unknown, offline or removed computer instead of failing obscurely", async () => {
    faux.setResponses(useTool("bash", { command: "ls", computer: "desktop" }))
    expect(lastTool(await say(chat.id, "try the desktop"))).toMatchObject({
      status: "error",
      output:
        'There is no computer named "desktop". The computers you can use: computer, laptop, laptop-2.',
    })

    // laptop-2 was registered but its daemon never connected.
    faux.setResponses(useTool("bash", { command: "ls", computer: "laptop-2" }))
    const offline = lastTool(await say(chat.id, "try the other one"))
    expect(offline.status).toBe("error")
    expect(offline.output).toContain("The computer is offline.")

    await call("/computers/c2", "DELETE")
    expect(
      (await call<{ computers: { name: string }[] }>("/computers")).computers.map((c) => c.name),
    ).toEqual(["computer", "laptop"])
  })
})

describe("computers the agent was not given", () => {
  let chat: ChatSummary
  const there = (computer: Partial<NearbyComputer> & { id: string; name: string }) => ({
    owner: "Sawyer",
    team: false,
    platform: "linux",
    readOnly: false,
    online: true,
    connected: false,
    asked: false,
    ...computer,
  })
  /** Wait for the agent to come to rest with an answer about `name` in the chat. */
  async function answerShown(name: string): Promise<ChatState> {
    const deadline = Date.now() + 8_000
    for (;;) {
      const state = await call<ChatState>(`/chats/${chat.id}`)
      const shown = state.messages.some((message) =>
        message.parts.some(
          (part) => part.type === "notice" && part.kind === "computer" && part.text === name,
        ),
      )
      if (!state.busy && shown && state.messages.at(-1)?.role === "assistant") return state
      if (Date.now() > deadline) throw new Error("the answer did not arrive")
      await new Promise((resolve) => setTimeout(resolve, 30))
    }
  }
  const notices = (state: ChatState) =>
    state.messages.flatMap((message) =>
      message.parts.filter((part) => part.type === "notice" && part.kind === "computer"),
    )

  it("are listed with whose they are and whether it can use them", async () => {
    chat = await call<ChatSummary>("/chats", "POST", {})
    nearby = [
      there({ id: "c1", name: "laptop", connected: true }),
      there({ id: "c8", name: "studio", owner: "Maya", platform: "darwin", online: false }),
      there({ id: "c9", name: "build-box", owner: "Tidewater", team: true, readOnly: true }),
    ]
    let prompt = ""
    faux.setResponses([
      (context) => {
        prompt = JSON.stringify(context)
        return fauxAssistantMessage([fauxToolCall("computers", { action: "list" })], {
          stopReason: "toolUse",
        })
      },
      fauxAssistantMessage("done"),
    ])
    const listed = lastTool(await say(chat.id, "which computers are there?"))
    expect(prompt).toContain("There may be others you are not connected to")
    expect(listed.status).toBe("done")
    expect(listed.output).toBe(
      [
        "- laptop: Sawyer's, linux, online. You can use it.",
        '- studio: Maya\'s, darwin, offline. You cannot use it yet; "request" asks for it.',
        '- build-box: belongs to the team Tidewater, linux, online, read-only. You cannot use it yet; "request" asks for it.',
      ].join("\n"),
    )
  })

  it("are asked for once, from the chat the answer should come back to", async () => {
    faux.setResponses(
      useTool("computers", { action: "request", name: "Studio", reason: "to read the designs" }),
    )
    expect(lastTool(await say(chat.id, "ask maya for her studio machine")).output).toContain(
      'Asked Maya whether you may use "studio".',
    )
    expect(asks).toEqual([
      {
        agentId: "agent-1",
        computerId: "c8",
        chatId: chat.id,
        reason: "to read the designs",
        agentName: null,
      },
    ])

    // Asking again tells nobody again, and from then on its prompt says it is waiting.
    let prompt = ""
    faux.setResponses([
      (context) => {
        prompt = JSON.stringify(context)
        return fauxAssistantMessage(
          [fauxToolCall("computers", { action: "request", name: "studio" })],
          { stopReason: "toolUse" },
        )
      },
      fauxAssistantMessage("done"),
    ])
    expect(lastTool(await say(chat.id, "ask again")).output).toContain(
      'You have already asked to use "studio", and Maya has not answered yet.',
    )
    expect(asks.length).toBe(1)
    expect(prompt).toContain("You have asked to use studio and have not been answered yet")

    faux.setResponses(useTool("computers", { action: "request", name: "laptop" }))
    expect(lastTool(await say(chat.id, "and the laptop")).output).toContain(
      'You can already use "laptop"',
    )
    faux.setResponses(useTool("computers", { action: "request", name: "mainframe" }))
    expect(lastTool(await say(chat.id, "and the mainframe"))).toMatchObject({
      status: "error",
      output: 'There is no computer named "mainframe". There are: laptop, studio, build-box.',
    })
  })

  it("are told apart by id when two share a name", async () => {
    nearby.push(there({ id: "c10", name: "studio", owner: "Jon" }))
    faux.setResponses(useTool("computers", { action: "request", name: "studio" }))
    const unclear = lastTool(await say(chat.id, "the studio"))
    expect(unclear.status).toBe("error")
    expect(unclear.output).toContain("c8 (Maya's), c10 (Jon's)")
    nearby.pop()
  })

  it("can be used once someone says yes, which the agent is told in the chat it asked from", async () => {
    const studioHome = await startDaemon("c8")
    writeFileSync(join(studioHome, "designs.txt"), "the designs\n")
    // As the gateway does when someone approves: the agent is given the computer, then told.
    await call("/computers/c8", "PUT", {
      name: "studio",
      platform: "darwin",
      hostname: "mayas-studio",
      home: studioHome,
      readOnly: false,
      pairedAt: 3,
    })
    nearby[1]!.connected = true
    let told = ""
    faux.setResponses([
      (context) => {
        told = JSON.stringify(context)
        return fauxAssistantMessage(
          [fauxToolCall("read", { path: "designs.txt", computer: "studio" })],
          { stopReason: "toolUse" },
        )
      },
      fauxAssistantMessage("I have the designs now."),
    ])
    const answer = { requestId: "r1", chatId: chat.id, approved: true, by: "Maya", name: "studio" }
    await call("/computers/c8/answer", "POST", answer)
    const state = await answerShown("studio")
    expect(notices(state)).toEqual([
      { type: "notice", kind: "computer", text: "studio", approved: true, by: "Maya" },
    ])
    expect(told).toContain('[Maya said yes: you can now use the computer \\"studio\\".')
    // What it is told about its computers now no longer says it is waiting.
    const sections = (
      JSON.parse(told) as { messages: { role: string; sections?: Record<string, string> }[] }
    ).messages.findLast((message) => message.role === "system")!.sections!
    expect(sections.computers).toContain("- studio: darwin")
    expect(sections.computers).not.toContain("You have asked to use")
    expect(lastTool(state).output).toContain("the designs")
    expect(state.messages.at(-1)!.parts).toContainEqual({
      type: "text",
      text: "I have the designs now.",
    })

    // Being told twice says nothing twice.
    await call("/computers/c8/answer", "POST", answer)
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(notices(await call<ChatState>(`/chats/${chat.id}`)).length).toBe(1)
  })

  it("cannot be used once the host says no, even if the agent was never told", async () => {
    // The connection ended, and the word that it did never reached the agent.
    takenAway.add("c8")
    faux.setResponses(useTool("read", { path: "designs.txt", computer: "studio" }))
    expect(lastTool(await say(chat.id, "read the designs again"))).toMatchObject({
      status: "error",
      output:
        'The computer "studio" is no longer connected to you. If you still need it, the `computers` tool can ask for it again.',
    })
    // It knows now, and its own computers are untouched.
    expect(
      (await call<{ computers: { name: string }[] }>("/computers")).computers.map((c) => c.name),
    ).toEqual(["computer", "laptop"])
    faux.setResponses(useTool("bash", { command: "echo mine" }))
    expect(lastTool(await say(chat.id, "your own shell")).output).toBe("mine\n")
    takenAway.delete("c8")
  })

  it("is told when the answer is no", async () => {
    let told = ""
    faux.setResponses([
      (context) => {
        told = JSON.stringify(context)
        return fauxAssistantMessage("Jon said no, so I will leave the build box alone.")
      },
    ])
    await call("/computers/c9/answer", "POST", {
      requestId: "r2",
      chatId: chat.id,
      approved: false,
      by: "Jon",
      name: "build-box",
    })
    const state = await answerShown("build-box")
    expect(notices(state).at(-1)).toEqual({
      type: "notice",
      kind: "computer",
      text: "build-box",
      approved: false,
      by: "Jon",
    })
    expect(told).toContain('[Jon said no to your request to use the computer \\"build-box\\".')
  })
})

describe("a command left running on a paired computer", () => {
  it("is refused with the reason where the daemon is too old, and still runs when waited for", async () => {
    const chat = await call<ChatSummary>("/chats", "POST", {})
    faux.setResponses(
      useTool("bash", { command: "echo hi", computer: "laptop", run_in_background: true } as never),
    )
    const refused = lastTool(await say(chat.id, "start it on my laptop"))
    expect(refused.status).toBe("error")
    expect(refused.output).toContain("is too old")
    faux.setResponses(useTool("bash", { command: "echo hi", computer: "laptop" }))
    expect(lastTool(await say(chat.id, "then wait for it")).output).toBe("hi\n")
  })

  it("carries on there, and the agent is told when it ends", async () => {
    const chat = await call<ChatSummary>("/chats", "POST", {})
    const home = await startDaemon("c20", false, true)
    await call("/computers/c20", "PUT", {
      name: "desk",
      platform: "linux",
      hostname: "desk",
      home,
      readOnly: false,
      pairedAt: 3,
    })
    let told = ""
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("bash", {
            command: "echo begun; sleep 2.5; echo built",
            computer: "desk",
            run_in_background: true,
          }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Started."),
      (context) => {
        told = JSON.stringify(context)
        return fauxAssistantMessage("It built.")
      },
    ])
    const started = lastTool(await say(chat.id, "build it on my desk"))
    expect(started.output).toContain('Started in the background as b1 on "desk"')
    expect(started.output).toContain(join(home, ".do-computer/jobs/agent-1"))

    const deadline = Date.now() + 10_000
    let state = await call<ChatState>(`/chats/${chat.id}`)
    while (state.busy || state.messages.at(-1)?.role !== "assistant" || told === "") {
      if (Date.now() > deadline) throw new Error("the command's end was never told")
      await new Promise((resolve) => setTimeout(resolve, 40))
      state = await call<ChatState>(`/chats/${chat.id}`)
    }
    expect(told).toContain("Your background command b1")
    expect(told).toContain("finished with exit code 0")
    expect(state.messages.flatMap((message) => message.parts)).toContainEqual(
      expect.objectContaining({
        type: "notice",
        kind: "command",
        detail: "begun\nbuilt",
        job: expect.objectContaining({ id: "b1", computer: "desk", status: "done" }),
      }),
    )
  })
})
