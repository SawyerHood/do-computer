import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type BrowserIO, createComputerLinkActor, DaemonCore } from "@durable-computer/computers"
import { fakeScreen } from "@durable-computer/computers/fake-screen"
import { nodeDaemonIO } from "@durable-computer/computers/node"
import type {
  ChatState,
  ChatSummary,
  LiveView,
  ToolPart,
  UseDetails,
} from "@durable-computer/protocol"
import { fileBlobs, NodeActorNamespace, type SocketLike } from "@durable-computer/runtime/node"
import { justBashSandbox } from "@durable-computer/sandbox"
import type { Message } from "@earendil-works/pi-ai"
import { createModels } from "@earendil-works/pi-ai/models"
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"
import { afterAll, describe, expect, it } from "vitest"
import { computerActorName, createAgentActor } from "../src/index.ts"
import { dropOldPictures, screenAction } from "../src/uses.ts"

const directory = mkdtempSync(join(tmpdir(), "dc-uses-"))
const links = new NodeActorNamespace({
  directory: join(directory, "links"),
  blobs: () => fileBlobs(join(directory, "link-blobs")),
  factory: (host) => createComputerLinkActor(host),
})
const faux = fauxProvider({
  provider: "test",
  models: [{ id: "model", input: ["text", "image"] }, { id: "blind" }],
  tokensPerSecond: 5_000,
})
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
        {
          id: "test/model",
          name: "Test",
          reasoning: false,
          inputCost: 0,
          outputCost: 0,
          images: true,
        },
        { id: "test/blind", name: "Blind", reasoning: false, inputCost: 0, outputCost: 0 },
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

/** What the pretend browser was asked to run, and what it answers with. */
const browser = {
  scripts: [] as string[],
  shot: fakeScreen(),
}
const pretendBrowser: BrowserIO = {
  run: async (agent, script) => {
    browser.scripts.push(script)
    if (script.includes("throw")) {
      return { output: "", error: "Error: no such element", shots: [], own: false }
    }
    const { shot } = await browser.shot.act(agent, { do: "screenshot" }, undefined)
    return {
      output: "Simple pricing",
      shots: script.includes("shot()") ? [shot] : [],
      url: "https://tidewater.studio/pricing",
      title: "Pricing",
      own: true,
    }
  },
  view: async (after) => ({ active: false, seq: after }),
  hold: async () => {},
  close: async () => {},
}

/** Run a daemon for computer `id`, connected to its link in memory. */
async function startDaemon(id: string, things: { screen: boolean; browser: boolean }) {
  const home = mkdtempSync(join(tmpdir(), "dc-laptop-"))
  const listeners: ((data: unknown, binary: boolean) => void)[] = []
  const toDaemon: ((data: string) => void)[] = []
  const like: SocketLike = {
    readyState: 1,
    send: (data) => queueMicrotask(() => toDaemon.forEach((listener) => listener(data))),
    close: () => {},
    on: (event: string, listener: never) => {
      if (event === "message") listeners.push(listener)
      return like
    },
  }
  const daemon = new DaemonCore(
    {
      ...nodeDaemonIO({ home, audit: () => {}, shell: "sh" }),
      ...(things.screen ? { screen: fakeScreen() } : {}),
      ...(things.browser ? { browser: pretendBrowser } : {}),
    },
    (frame) => {
      queueMicrotask(() => listeners.forEach((listener) => listener(frame, false)))
      return true
    },
  )
  toDaemon.push((data) => daemon.onFrame(data))
  await links.connect(computerActorName(id), like, new Request("http://link/connect"))
  const hello = {
    t: "hello",
    platform: "darwin",
    hostname: id,
    home,
    readOnly: false,
    version: "t",
  }
  listeners.forEach((listener) =>
    listener(JSON.stringify({ ...hello, jobs: true, ...things }), false),
  )
  daemon.onOpen()
  return home
}

const ask = (path: string, method = "GET", payload?: unknown) =>
  agents.get("agent-1").fetch(
    new Request(`http://actor${path}`, {
      method,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      headers: payload === undefined ? undefined : { "content-type": "application/json" },
    }),
  )
async function call<T>(path: string, method = "GET", payload?: unknown): Promise<T> {
  const response = await ask(path, method, payload)
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

const tools = (state: ChatState) =>
  state.messages.flatMap((m) => m.parts).filter((part): part is ToolPart => part.type === "tool")
const useOf = (part: ToolPart) => (part.details as unknown as UseDetails).use

describe("the screen of somebody's own computer", () => {
  let chat: ChatSummary

  it("is used one thing at a time, in the order asked, with a picture after each", async () => {
    await call("/init", "POST", { ownerId: "user-1" })
    chat = await call<ChatSummary>("/chats", "POST", {})
    const home = await startDaemon("mac", { screen: true, browser: true })
    await call("/computers/mac", "PUT", {
      name: "MacBook",
      platform: "darwin",
      hostname: "mac",
      home,
      readOnly: false,
      pairedAt: 1,
    })

    let second = ""
    faux.setResponses([
      // Two things in one round: they start together, and must not be done together.
      fauxAssistantMessage(
        [
          fauxToolCall("screen", {
            computer: "MacBook",
            action: "click",
            x: 40,
            y: 30,
            note: "Clicking Mail in the Dock",
          }),
          fauxToolCall("screen", { computer: "MacBook", action: "click", x: 300, y: 200 }),
        ],
        { stopReason: "toolUse" },
      ),
      (context) => {
        second = JSON.stringify(context.messages)
        return fauxAssistantMessage("done")
      },
    ])
    const [first, last] = tools(await say(chat.id, "open Mail on my MacBook"))
    expect(first!.status).toBe("done")
    expect(useOf(first!)).toMatchObject({
      what: "screen",
      computer: { id: "mac", name: "MacBook" },
      say: "Clicking Mail in the Dock",
      pointer: { x: 40, y: 30 },
      width: 640,
      height: 400,
    })
    // Where it did not say what it was doing, the action says.
    expect(useOf(last!)).toMatchObject({ say: "Clicking", pointer: { x: 300, y: 200 } })
    // The model was shown the screen after each.
    expect(second.match(/"type":"image"/g)).toHaveLength(2)
    expect(second).toContain("Done. The screen now, 640 by 400:")

    // The picture each step ended with is kept, for the chat to show afterwards.
    const kept = await ask(`/shots/${useOf(last!).shot}`)
    expect(kept.headers.get("content-type")).toBe("image/png")
    expect(
      Buffer.from(await kept.arrayBuffer())
        .subarray(1, 4)
        .toString(),
    ).toBe("PNG")
    expect((await ask("/shots/nothing.png")).status).toBe(404)
  })

  it("can be watched while it is in use, and paused", async () => {
    const view = await call<LiveView>("/use/view?computer=mac&what=screen&after=0")
    expect(view).toMatchObject({
      active: true,
      pointer: { x: 300, y: 200 },
      clicks: 2,
      agent: { id: "agent-1" },
    })
    expect(view.shot?.mimeType).toBe("image/png")

    await call("/use/hold?computer=mac&what=screen", "POST", { held: true })
    expect((await call<LiveView>("/use/view?computer=mac&what=screen&after=0")).held).toBe(true)
    await call("/use/hold?computer=mac&what=screen", "POST", { held: false })
    // A computer the agent has not got shows nothing, and is not an error to ask about.
    expect(await call<LiveView>("/use/view?computer=nope&what=screen&after=3")).toEqual({
      active: false,
      seq: 3,
    })
  })

  it("says why not where the computer does not allow it, or is not somebody's own", async () => {
    const home = await startDaemon("pc", { screen: false, browser: false })
    await call("/computers/pc", "PUT", {
      name: "Tower",
      platform: "win32",
      hostname: "pc",
      home,
      readOnly: false,
      pairedAt: 2,
    })
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("screen", { computer: "Tower", action: "screenshot" }),
          fauxToolCall("browser", { computer: "Tower", script: "1" }),
          fauxToolCall("screen", { action: "click", computer: "MacBook" }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("done"),
    ])
    const [screen, browse, vague] = tools(await say(chat.id, "and on the tower?")).slice(-3)
    expect(screen!.status).toBe("error")
    expect(screen!.output).toMatch(/does not let agents use its screen/)
    expect(browse!.output).toMatch(/does not let agents use a browser/)
    expect(vague!.output).toMatch(/click needs x and y/)
  })

  it("is not for a model that cannot see pictures", async () => {
    await call("", "PATCH", { model: "test/blind" })
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("screen", { computer: "MacBook", action: "screenshot" })],
        {
          stopReason: "toolUse",
        },
      ),
      fauxAssistantMessage("done"),
    ])
    const blind = tools(await say(chat.id, "look at my screen")).at(-1)!
    expect(blind.status).toBe("error")
    expect(blind.output).toMatch(/cannot see pictures/)
    await call("", "PATCH", { model: "test/model" })
  })
})

describe("a browser on somebody's own computer", () => {
  it("runs a script there, and shows the model the pictures it took", async () => {
    const chat = await call<ChatSummary>("/chats", "POST", {})
    let second = ""
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("browser", {
            computer: "MacBook",
            script: 'const page = await browser.getPage("main"); await page.shot(); page.title()',
            note: "Opening the pricing page",
          }),
        ],
        { stopReason: "toolUse" },
      ),
      (context) => {
        second = JSON.stringify(context.messages)
        return fauxAssistantMessage("done")
      },
    ])
    const ran = tools(await say(chat.id, "are the yearly prices live?")).at(-1)!
    expect(ran.status).toBe("done")
    expect(ran.output).toContain("Simple pricing")
    expect(ran.output).toContain("[page] https://tidewater.studio/pricing “Pricing”")
    expect(useOf(ran)).toMatchObject({
      what: "browser",
      say: "Opening the pricing page",
      url: "https://tidewater.studio/pricing",
      own: true,
      width: 640,
    })
    expect(typeof useOf(ran).shot).toBe("string")
    expect(second.match(/"type":"image"/g)).toHaveLength(1)
    expect(browser.scripts.at(-1)).toContain("page.shot()")
  })

  it("tells the agent how a script failed, as a failure", async () => {
    const chat = await call<ChatSummary>("/chats", "POST", {})
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("browser", { computer: "MacBook", script: 'throw new Error("no")' })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("done"),
    ])
    const failed = tools(await say(chat.id, "click the thing")).at(-1)!
    expect(failed.status).toBe("error")
    expect(failed.output).toContain("The script failed: Error: no such element")
    expect(useOf(failed).shot).toBeUndefined()
  })
})

describe("what a call of the screen tool asks for", () => {
  it("is read from its arguments, with places as whole pixels", () => {
    expect(screenAction({ action: "click", x: 10.4, y: 20.6 })).toEqual({
      do: "click",
      x: 10,
      y: 21,
    })
    expect(screenAction({ action: "drag", x: 1, y: 2, to_x: 30, to_y: 40 })).toEqual({
      do: "drag",
      x: 1,
      y: 2,
      toX: 30,
      toY: 40,
    })
    expect(screenAction({ action: "scroll", x: 5, y: 5, direction: "down" })).toEqual({
      do: "scroll",
      x: 5,
      y: 5,
      direction: "down",
      amount: 3,
    })
    expect(screenAction({ action: "key", keys: " cmd+s " })).toEqual({ do: "key", keys: "cmd+s" })
    expect(screenAction({ action: "wait", seconds: 600 })).toEqual({ do: "wait", seconds: 10 })
  })

  it("is refused in words where something it needs is missing", () => {
    expect(screenAction({ action: "click" })).toMatch(/needs x and y/)
    expect(screenAction({ action: "type" })).toMatch(/needs the text/)
    expect(screenAction({ action: "scroll", x: 1, y: 1, direction: "sideways" })).toMatch(
      /direction/,
    )
    expect(screenAction({ action: "swipe" })).toMatch(/There is no action "swipe"/)
  })
})

describe("the pictures in front of the model", () => {
  const picture = { type: "image" as const, data: "AAAA", mimeType: "image/jpeg" }
  const result = (toolName: string, pictures: number): Message => ({
    role: "toolResult",
    toolCallId: crypto.randomUUID(),
    toolName,
    content: [{ type: "text", text: "Done." }, ...Array.from({ length: pictures }, () => picture)],
    isError: false,
    timestamp: 0,
  })
  const count = (messages: readonly Message[]) =>
    messages.map((message) =>
      message.role === "toolResult"
        ? message.content.filter((part) => part.type === "image").length
        : -1,
    )

  it("are the newest few: an older one is taken out, and said to have been", () => {
    const messages = [
      result("screen", 1),
      result("screen", 1),
      result("browser", 3),
      result("screen", 1),
    ]
    const trimmed = dropOldPictures(messages, 3)
    expect(count(trimmed)).toEqual([0, 0, 2, 1])
    expect(JSON.stringify(trimmed[0])).toContain("A picture was here")
    // The script's last picture is kept, not its first.
    expect(trimmed[2]!.role === "toolResult" && trimmed[2]!.content.at(-1)).toEqual(picture)
    // What it was given is left as it was.
    expect(count(messages)).toEqual([1, 1, 3, 1])
  })

  it("leaves pictures alone that are not of a screen or a page", () => {
    const messages = [result("read", 1), result("screen", 1), result("screen", 1)]
    expect(count(dropOldPictures(messages, 1))).toEqual([1, 0, 1])
  })
})
