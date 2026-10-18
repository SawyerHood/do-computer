import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { crc32, deflateSync } from "node:zlib"
import { createComputerLinkActor, DaemonCore } from "@do-computer/computers"
import { nodeDaemonIO } from "@do-computer/computers/node"
import type {
  ApprovalsState,
  ChatState,
  ChatSummary,
  MessageOrigin,
  ToolPart,
} from "@do-computer/protocol"
import { fileBlobs, NodeActorNamespace, type SocketLike } from "@do-computer/runtime/node"
import { justBashSandbox } from "@do-computer/sandbox"
import { createModels } from "@earendil-works/pi-ai/models"
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"
import { afterAll, describe, expect, it } from "vitest"
import { computerActorName, createAgentActor, type NearbyComputer } from "../src/index.ts"
import { quietOnReminder } from "./quiet.ts"
import { newest } from "./newest.ts"

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
/** The asks the agent took back. */
const withdrawn: { agentId: string; computerId: string; chatId: string }[] = []
const faux = quietOnReminder(
  fauxProvider({ provider: "test", models: [{ id: "model" }], tokensPerSecond: 5_000 }),
)
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
      // One agent gives up on an unanswered ask quickly, to see what a late answer does.
      ...(host.name === "agent-expiry" ? { subagentAskTtlMs: 400 } : {}),
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
        withdraw: async (agentId, ask) => {
          withdrawn.push({ agentId, ...ask })
          const computer = nearby.find((one) => one.id === ask.computerId)
          if (computer !== undefined) computer.asked = false
        },
      },
    }),
})
afterAll(async () => {
  await agents.close()
  await links.close()
})

/** Run a daemon for computer `id` on a fresh home directory, connected to its link in memory. */
async function startDaemon(
  id: string,
  readOnly = false,
  current = false,
  /** What its hello says besides, where it is a daemon of today. */
  said: Record<string, unknown> = {},
): Promise<string> {
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
      listener(JSON.stringify({ ...hello, jobs: true, ...said }), false),
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

/** Say something in a chat and wait for the answer. `from` is where the sender's app says it is. */
async function say(chatId: string, text: string, from?: MessageOrigin): Promise<ChatState> {
  const before = (await call<ChatState>(`/chats/${chatId}`)).messages.length
  await call(`/chats/${chatId}/messages`, "POST", {
    text,
    requestId: crypto.randomUUID(),
    ...(from === undefined ? {} : { from }),
  })
  const deadline = Date.now() + 8_000
  for (;;) {
    const state = await call<ChatState>(`/chats/${chatId}`)
    if (!state.busy && state.messages.length > before + 1) return state
    if (Date.now() > deadline) throw new Error("run did not finish")
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
}

/** An RGB PNG of noise, which does not compress: a rendered scene or a photo, as a PNG. */
function noisyPng(width: number, height: number): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const out = Buffer.alloc(12 + data.length)
    out.writeUInt32BE(data.length, 0)
    out.write(type, 4, "latin1")
    out.set(data, 8)
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
    return out
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  const rows = Buffer.alloc((width * 3 + 1) * height)
  let seed = 3
  for (let index = 0; index < rows.length; index++) {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff
    // Each row starts with its filter, none.
    rows[index] = index % (width * 3 + 1) === 0 ? 0 : 100 + ((seed >>> 16) % 64)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", new Uint8Array()),
  ])
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
    chat = await call<ChatSummary>("/chats/main", "POST", {})
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

  it("are named in the note on a message written on one, which says where the person is", async () => {
    const seen: string[] = []
    const reply = (context: unknown) => {
      seen.push(JSON.stringify(context))
      return fauxAssistantMessage("ok")
    }
    faux.setResponses([reply, reply, reply, reply])
    // Written in the desktop app on the second computer, which is named as the agent calls it.
    await say(chat.id, "what is on my screen?", {
      app: "desktop",
      device: "Mac",
      computerId: "c2",
    })
    expect(seen[0]).toContain('via=\\"desktop app\\" device=\\"Mac\\" computer=\\"laptop-2\\"/>')
    // What a note that names a computer means is said with the computers.
    expect(seen[0]).toContain("are sitting at it")

    // A browser cannot say which computer it is on, and a phone is on none.
    await say(chat.id, "and now?", { app: "browser", device: "Linux" })
    expect(seen[1]).toContain('via=\\"web browser\\" device=\\"Linux\\"/>')
    // The earlier message keeps the note it was sent with.
    expect(seen[1]).toContain('computer=\\"laptop-2\\"')

    // A computer the agent does not have is not named. Neither is a machine of the workspace,
    // which nobody sits at.
    await say(chat.id, "and here?", { app: "desktop", device: "Mac", computerId: "c9" })
    expect(seen[2]).toContain('via=\\"desktop app\\" device=\\"Mac\\"/>')
    const { computers } = await call<{ computers: { id: string; kind?: string }[] }>("/computers")
    const machine = computers.find((one) => one.kind !== undefined && one.kind !== "paired")!
    await say(chat.id, "or here?", { app: "desktop", device: "Linux", computerId: machine.id })
    expect(seen[3]).toContain('via=\\"desktop app\\" device=\\"Linux\\"/>')
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
    await call(`/approvals/${pending[0]!.id}`, "POST", { decision: "always" })
    // The answer is an event in the main chat, which sets the agent going again.
    for (;;) {
      const state = await call<ChatState>(`/chats/${chat.id}`)
      const done = lastTool(state).output?.includes("second draft") === true
      if (!state.busy && state.queued.length === 0 && done) break
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

  it("have a picture read there made smaller there, where the daemon can", async () => {
    const easelHome = await startDaemon("c-easel", false, true, { images: true })
    await call("/computers/c-easel", "PUT", {
      name: "easel",
      platform: "linux",
      hostname: "easel",
      home: easelHome,
      readOnly: false,
      pairedAt: 3,
    })
    const shot = noisyPng(2000, 1000)
    writeFileSync(join(easelHome, "shot.png"), shot)
    writeFileSync(join(laptopHome, "shot.png"), noisyPng(40, 30))
    /** What the model is sent of the picture `read` gave it, and what it is told of it. */
    const readOn = async (computer: string) => {
      let sent: { image?: { mimeType: string; data: string }; said: string } = { said: "" }
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("read", { path: "shot.png", computer })], {
          stopReason: "toolUse",
        }),
        (context) => {
          const result = context.messages.findLast((message) => message.role === "toolResult")!
          const content = result.content as {
            type: string
            text?: string
            mimeType?: string
            data?: string
          }[]
          const image = content.find((part) => part.type === "image")
          sent = {
            ...(image === undefined
              ? {}
              : { image: { mimeType: image.mimeType!, data: image.data! } }),
            said: content
              .flatMap((part) => (part.text === undefined ? [] : [part.text]))
              .join("\n"),
          }
          return fauxAssistantMessage("done")
        },
      ])
      await say(chat.id, `look at the picture on ${computer}`)
      return sent
    }
    const easel = await readOn("easel")
    expect(easel.image?.mimeType).toBe("image/jpeg")
    expect(Buffer.from(easel.image!.data, "base64").length * 4).toBeLessThan(shot.length)
    expect(easel.said).toContain(
      "Read image file [image/jpeg]. Converted from image/png to image/jpeg. Resized from 2000x1000 to 1516x758. Multiply coordinates by 1.32 to map them to the original.",
    )
    // The laptop's daemon is from before it could, so the picture is read as it is.
    const laptop = await readOn("laptop")
    expect(laptop.image?.mimeType).toBe("image/png")
    expect(laptop.said).toContain("Read image file [image/png].")
    expect(laptop.said).not.toContain("Converted")
    await call("/computers/c-easel", "DELETE")
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
    chat = await call<ChatSummary>("/chats/main", "POST", {})
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

  it("report adapter diagnostics before the agent tries to use a screen", async () => {
    const before = nearby
    nearby = nearby.map((computer) =>
      computer.id === "c1"
        ? {
            ...computer,
            screenAdapter: {
              name: "hyprland",
              state: "blocked",
              tools: ["grim", "wtype", "hyprctl"],
              reason: "The graphical session is locked.",
            },
            browserAdapter: { name: "dev-browser", state: "ready", tools: ["CDP"] },
          }
        : computer,
    )
    try {
      faux.setResponses(useTool("computers", { action: "list" }))
      const listed = lastTool(await say(chat.id, "what screen adapters are available?"))
      expect(listed.output).toContain(
        "screen: hyprland (grim/wtype/hyprctl) [blocked]: The graphical session is locked.",
      )
      expect(listed.output).toContain("browser: dev-browser (CDP) [ready]")
    } finally {
      nearby = before
    }
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
      type: "thinking",
      text: "I have the designs now.",
      written: true,
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
    const chat = await call<ChatSummary>("/chats/main", "POST", {})
    faux.setResponses(
      useTool("bash", { command: "echo hi", computer: "laptop", run_in_background: true } as never),
    )
    const refused = lastTool(await say(chat.id, "start it on my laptop"))
    expect(refused.status).toBe("error")
    expect(refused.output).toContain("cannot run commands in the background yet")
    expect(refused.output).toContain("does not update itself")
    faux.setResponses(useTool("bash", { command: "echo hi", computer: "laptop" }))
    expect(lastTool(await say(chat.id, "then wait for it")).output).toBe("hi\n")
  })

  it("carries on there, and the agent is told when it ends", async () => {
    const chat = await call<ChatSummary>("/chats/main", "POST", {})
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

describe("a computer asked for by a sub-agent through the main chat", () => {
  let AGENT = "agent-bus"
  async function at<T>(path: string, method = "GET", payload?: unknown): Promise<T> {
    const response = await agents.get(AGENT).fetch(
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
  const computer = (id: string, name: string): NearbyComputer => ({
    id,
    name,
    owner: "Maya",
    team: false,
    platform: "linux",
    readOnly: false,
    online: true,
    connected: false,
    asked: false,
  })
  async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
    const deadline = Date.now() + 8_000
    for (;;) {
      const value = await read()
      if (done(value)) return value
      if (Date.now() > deadline) throw new Error(`Timed out: ${JSON.stringify(value)}`)
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
  }
  const subagents = async () =>
    (await at<{ chats: ChatSummary[] }>("/")).chats.filter((one) => one.kind === "subagent")
  /** The main chat starts a sub-agent that asks for `name`, after asking itself if `first`. */
  function script(name: string, first: boolean) {
    const tool = (tool: string, args: Record<string, string>) =>
      fauxAssistantMessage([fauxToolCall(tool, args)], { stopReason: "toolUse" })
    // The main chat's steps, in order; what comes after them is quiet.
    const steps = [
      ...(first ? [tool("computers", { action: "request", name })] : []),
      tool("subagent", { action: "start", title: "Box helper", task: `Get ${name}.` }),
      tool("send", { text: "On it." }),
    ]
    faux.setResponses(
      Array.from({ length: 12 }, () => (context: { messages: unknown[] }) => {
        const seen = JSON.stringify(context.messages)
        if (seen.includes("You are working as a sub-agent")) {
          if (seen.includes("toolResult")) return fauxAssistantMessage(`Asked for ${name}.`)
          return tool("computers", { action: "request", name })
        }
        return steps.shift() ?? fauxAssistantMessage("quiet")
      }),
    )
  }

  it("waits for the answer where it asked first, which comes back to it", async () => {
    await at("/init", "POST", { ownerId: "user-1" })
    const main = await at<ChatSummary>("/chats/main", "POST")
    nearby.push(computer("c30", "vault-box"))
    script("vault-box", false)
    await at(`/chats/${main.id}/messages`, "POST", { text: "go", requestId: "bus-1" })
    const [sub] = await until(subagents, (found) => found[0]?.status === "waiting")
    expect(asks.at(-1)).toMatchObject({ agentId: AGENT, computerId: "c30", chatId: sub!.id })
    // The answer goes to it, and it carries on and reports.
    await at("/computers/c30/answer", "POST", {
      requestId: "r30",
      chatId: sub!.id,
      approved: false,
      by: "Maya",
      name: "vault-box",
    })
    await until(subagents, (found) => found[0]?.status === "done")
  })

  it("does not wait where the main chat asked for the same computer first", async () => {
    const main = await at<ChatSummary>("/chats/main", "POST")
    nearby.push(computer("c31", "film-box"))
    script("film-box", true)
    await at(`/chats/${main.id}/messages`, "POST", { text: "go again", requestId: "bus-2" })
    const found = await until(subagents, (all) => all.length === 2 && all[1]!.status !== "working")
    // The answer will go to the main chat, which asked first: the sub-agent reports at once.
    expect(found[1]!.status).toBe("done")
    expect(asks.at(-1)).toMatchObject({ computerId: "c31", chatId: main.id })
  })

  /** Every request the model was sent from a chat, by what it was last shown. */
  function watch(name: string) {
    const turns: { sub: boolean; last: string }[] = []
    const tool = (tool: string, args: Record<string, string>) =>
      fauxAssistantMessage([fauxToolCall(tool, args)], { stopReason: "toolUse" })
    const steps = [
      tool("subagent", { action: "start", title: "Box helper", task: `Get ${name}.` }),
      tool("send", { text: "On it." }),
    ]
    faux.setResponses(
      Array.from({ length: 16 }, () => (context: { messages: unknown[] }) => {
        const seen = JSON.stringify(context.messages)
        const sub = seen.includes("You are working as a sub-agent")
        turns.push({ sub, last: JSON.stringify(newest(context.messages)) })
        if (sub) {
          if (seen.includes("toolResult")) return fauxAssistantMessage(`Asked for ${name}.`)
          return tool("computers", { action: "request", name })
        }
        return steps.shift() ?? fauxAssistantMessage("quiet")
      }),
    )
    return turns
  }
  const mainChat = () =>
    until(
      () => at<ChatState>(`/chats/${main.id}`),
      (state) =>
        !state.busy &&
        state.messages.some((one) =>
          one.parts.some((part) => part.type === "notice" && part.kind === "computer"),
        ),
    )
  let main: ChatSummary

  it("does not set a stopped sub-agent going when its computer is answered late", async () => {
    main = await at<ChatSummary>("/chats/main", "POST")
    nearby.push(computer("c32", "late-box"))
    const turns = watch("late-box")
    await at(`/chats/${main.id}/messages`, "POST", { text: "go once more", requestId: "bus-3" })
    const waiting = await until(subagents, (all) => all.some((one) => one.status === "waiting"))
    const sub = waiting.find((one) => one.status === "waiting")
    const status = async () => (await subagents()).find((one) => one.id === sub!.id)!.status
    await at(`/chats/${sub!.id}/abort`, "POST")
    await until(status, (now) => now === "stopped")
    // Taken back where it was asked, so that nobody is shown it to answer.
    expect(withdrawn.at(-1)).toEqual({ agentId: AGENT, computerId: "c32", chatId: sub!.id })
    const before = turns.filter((turn) => turn.sub).length
    await at("/computers/c32/answer", "POST", {
      requestId: "r32",
      chatId: sub!.id,
      approved: true,
      by: "Maya",
      name: "late-box",
    })
    // The main chat is told, and decides; the sub-agent is not set going.
    const state = await mainChat()
    const told = turns.find((turn) => !turn.sub && turn.last.includes("computer-answered"))
    expect(told!.last).toContain("It has stopped, and was not told.")
    expect(
      state.messages
        .flatMap((one) => one.parts)
        .find((part) => part.type === "notice" && part.kind === "computer"),
    ).toMatchObject({ detail: "asked for by the sub-agent Box helper, which had stopped" })
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(turns.filter((turn) => turn.sub).length).toBe(before)
    expect(await status()).toBe("stopped")
  })

  it("does not set going a sub-agent that gave up waiting, when the answer comes after", async () => {
    AGENT = "agent-expiry"
    await at("/init", "POST", { ownerId: "user-1" })
    main = await at<ChatSummary>("/chats/main", "POST")
    nearby.push(computer("c33", "slow-box"))
    const turns = watch("slow-box")
    await at(`/chats/${main.id}/messages`, "POST", { text: "go", requestId: "exp-1" })
    await until(subagents, (all) => all[0]?.status === "waiting")
    // Nobody answers in time: it is taken back, and the sub-agent reports.
    const [sub] = await until(subagents, (all) => all[0]?.status === "done")
    expect(withdrawn.at(-1)).toEqual({ agentId: AGENT, computerId: "c33", chatId: sub!.id })
    const before = turns.filter((turn) => turn.sub).length
    await at("/computers/c33/answer", "POST", {
      requestId: "r33",
      chatId: sub!.id,
      approved: true,
      by: "Maya",
      name: "slow-box",
    })
    await mainChat()
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(turns.filter((turn) => turn.sub).length).toBe(before)
    expect((await subagents())[0]!.status).toBe("done")
  })
})
