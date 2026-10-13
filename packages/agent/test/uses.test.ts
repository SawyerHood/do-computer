import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type BrowserIO,
  createComputerLinkActor,
  DaemonCore,
  type ScreenIO,
} from "@do-computer/computers"
import { fakeScreen } from "@do-computer/computers/fake-screen"
import { nodeDaemonIO } from "@do-computer/computers/node"
import type {
  ChatState,
  ChatSummary,
  LiveView,
  ToolPart,
  UseDetails,
} from "@do-computer/protocol"
import { fileBlobs, NodeActorNamespace, type SocketLike } from "@do-computer/runtime/node"
import { justBashSandbox } from "@do-computer/sandbox"
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
      showsBrowser: async () => workspace.showsBrowser,
    }),
})
afterAll(async () => {
  await agents.close()
  await links.close()
})

/** What the agents' workspace has chosen, as their host would answer. */
const workspace = { showsBrowser: undefined as boolean | undefined }

/** What the pretend browser was asked to run, and what it answers with. */
const browser = {
  scripts: [] as string[],
  /** Whether each script was to run in a browser that is shown, where the call said. */
  shown: [] as (boolean | undefined)[],
  shot: fakeScreen(),
}
const pretendBrowser: BrowserIO = {
  run: async (agent, script, options) => {
    browser.scripts.push(script)
    browser.shown.push(options.shown)
    if (script.includes("throw")) {
      return { output: "", error: "Error: no such element", shots: [], own: false }
    }
    const { shot } = await browser.shot.act(agent, { do: "screenshot" }, undefined)
    return {
      output: "Simple pricing",
      shots: script.includes("shot()") && shot !== undefined ? [shot] : [],
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
async function startDaemon(
  id: string,
  things: { screen: boolean; browser: boolean },
  screen: ScreenIO = fakeScreen(),
) {
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
      ...(things.screen ? { screen } : {}),
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
    expect(screen!.output).toMatch(/does not let Doods use its screen/)
    expect(browse!.output).toMatch(/does not let Doods use a browser/)
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

describe("a window on somebody's own computer", () => {
  let chat: ChatSummary
  /** One call of the screen tool, and what the model was then shown for it. */
  const screen = async (computer: string, args: Record<string, unknown>) => {
    let shown = ""
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("screen", { computer, ...args })], {
        stopReason: "toolUse",
      }),
      (context) => {
        shown = JSON.stringify(context.messages.at(-1))
        return fauxAssistantMessage("done")
      },
    ])
    const part = tools(await say(chat.id, "go on")).at(-1)!
    return { part, shown }
  }

  it("is found in a list of them, which comes in words and with no picture", async () => {
    chat = await call<ChatSummary>("/chats", "POST", {})
    const { part, shown } = await screen("MacBook", { action: "windows" })
    expect(part.status).toBe("done")
    // A title that says no more than the app is left out, and one that cannot be seen is said to be.
    expect(part.output).toBe(
      [
        "The windows on MacBook, the nearest the front first (id · app · title · size):",
        "11 · Notes · Shopping · 400×300",
        "12 · Calculator · 230×408 · not showing",
        "Give an id as `window` to look at one and work in it. `open` starts an app that has no window here.",
      ].join("\n"),
    )
    expect(shown).toContain("The windows on MacBook")
    expect(shown).not.toContain('"type":"image"')
    expect(useOf(part)).toEqual({
      what: "screen",
      computer: { id: "mac", name: "MacBook" },
      say: "Looking at what is open",
    })
  })

  it("is worked in by its id, and the answer and the chat both name it", async () => {
    const { part, shown } = await screen("MacBook", { action: "click", window: 11, x: 120, y: 80 })
    expect(part.status).toBe("done")
    expect(part.output).toContain("Done. Window 11 (Notes: Shopping) now, 400 by 300:")
    expect(shown.match(/"type":"image"/g)).toHaveLength(1)
    // The picture is the window's, and the place is a place in it.
    expect(useOf(part)).toMatchObject({
      what: "screen",
      say: "Clicking",
      title: "Notes: Shopping",
      width: 400,
      height: 300,
      pointer: { x: 120, y: 80 },
    })
    expect(typeof useOf(part).shot).toBe("string")
    // Whoever watches is told which window too.
    const view = await call<LiveView>("/use/view?computer=mac&what=screen&after=0")
    expect(view).toMatchObject({
      active: true,
      title: "Notes: Shopping",
      pointer: { x: 120, y: 80 },
    })

    // Only looking at one is not something done to it.
    const looked = await screen("MacBook", { action: "screenshot", window: 12 })
    expect(looked.part.output).toContain("Window 12 (Calculator), 230 by 408:")
    expect(looked.part.output).not.toContain("Done.")
    expect(useOf(looked.part)).toMatchObject({ say: "Looking at a window", title: "Calculator" })

    // The whole screen has no window's name.
    const whole = await screen("MacBook", { action: "screenshot" })
    expect(whole.part.output).toContain("The screen, 640 by 400:")
    expect(useOf(whole.part)).not.toHaveProperty("title")
  })

  it("is told what cannot be done behind what is in front, and how to have it done", async () => {
    const drag = { action: "drag", window: 11, x: 10, y: 20, to_x: 200, to_y: 150 }
    const { part } = await screen("MacBook", drag)
    expect(part.status).toBe("error")
    expect(part.output).toMatch(/could not be done behind what is in front/)
    expect(part.output).toMatch(/Do it again with `in_front: true`/)
    expect(useOf(part).shot).toBeUndefined()

    const forward = await screen("MacBook", { ...drag, in_front: true })
    expect(forward.part.status).toBe("done")
    expect(forward.part.output).toContain("Done. Window 11 (Notes: Shopping) now, 400 by 300:")
    expect(useOf(forward.part)).toMatchObject({ say: "Dragging", pointer: { x: 200, y: 150 } })
  })

  it("is told of a window that is not there, and of what is only for the whole screen", async () => {
    const gone = await screen("MacBook", { action: "click", window: 99, x: 1, y: 1 })
    expect(gone.part.status).toBe("error")
    expect(gone.part.output).toMatch(/There is no window 99 on this computer now/)
    const moved = await screen("MacBook", { action: "move", window: 11, x: 1, y: 1 })
    expect(moved.part.status).toBe("error")
    expect(moved.part.output).toMatch(/move is for the whole screen/)
  })

  it("gets one for an app it opens, with a picture of it", async () => {
    const { part, shown } = await screen("MacBook", { action: "open", app: "Safari" })
    expect(part.status).toBe("done")
    expect(part.output).toContain(
      "Opened Safari, behind what is in front. Its windows:\n22 · Safari · 320×240\nWindow 22 (Safari), 320 by 240:",
    )
    expect(shown.match(/"type":"image"/g)).toHaveLength(1)
    expect(useOf(part)).toMatchObject({ say: "Opening Safari", title: "Safari", width: 320 })
  })

  it("is not to be had from an app from before there were windows, and the agent is told so", async () => {
    // Such an app knows nothing of windows: whatever it is asked, it answers with the screen alone.
    const whole = fakeScreen()
    const old: ScreenIO = {
      ...whole,
      act: async (agent, _action, said) => {
        const { shot } = await whole.act(agent, { do: "screenshot" }, said)
        return { shot }
      },
    }
    const home = await startDaemon("old", { screen: true, browser: false }, old)
    await call("/computers/old", "PUT", {
      name: "Old Mac",
      platform: "darwin",
      hostname: "old",
      home,
      readOnly: false,
      pairedAt: 3,
    })
    for (const args of [
      { action: "windows" },
      { action: "open", app: "Notes" },
      { action: "click", window: 11, x: 120, y: 80 },
    ]) {
      const { part, shown } = await screen("Old Mac", args)
      expect(part.status).toBe("error")
      expect(part.output).toMatch(
        /^The Do Computer app on Old Mac is from before agents could work in a window, so nothing was done\./,
      )
      expect(part.output).toMatch(/leave out `window` and use the whole screen/)
      expect(shown).toContain("The Do Computer app on Old Mac")
      expect(shown).not.toContain('"type":"image"')
      expect(useOf(part).shot).toBeUndefined()
    }
    // The whole screen is used there as it always was.
    const still = await screen("Old Mac", { action: "screenshot" })
    expect(still.part.status).toBe("done")
    expect(still.part.output).toContain("The screen, 640 by 400:")
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

  it("is asked for a browser that is shown or not, as the agent's workspace has it then", async () => {
    const chat = await call<ChatSummary>("/chats", "POST", {})
    const browse = async () => {
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("browser", { computer: "MacBook", script: "1" })], {
          stopReason: "toolUse",
        }),
        fauxAssistantMessage("done"),
      ])
      expect(tools(await say(chat.id, "look again")).at(-1)!.status).toBe("done")
      return browser.shown.at(-1)
    }
    // A host that does not know says nothing, and the computer is then not told either.
    expect(await browse()).toBeUndefined()
    workspace.showsBrowser = true
    expect(await browse()).toBe(true)
    // Changed while the agent is running: its next script is asked for the other way.
    workspace.showsBrowser = false
    expect(await browse()).toBe(false)
    workspace.showsBrowser = undefined
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

  it("is the same in a window, with the window's id and whether to bring it forward", () => {
    expect(screenAction({ action: "click", window: 11, x: 10.4, y: 20.6 })).toEqual({
      do: "in_window",
      window: 11,
      act: { do: "click", x: 10, y: 21 },
    })
    expect(
      screenAction({ action: "drag", window: 11, in_front: true, x: 1, y: 2, to_x: 30, to_y: 40 }),
    ).toEqual({
      do: "in_window",
      window: 11,
      inFront: true,
      act: { do: "drag", x: 1, y: 2, toX: 30, toY: 40 },
    })
    // Only asked for: a window is not brought forward by saying that it need not be.
    expect(
      screenAction({ action: "key", window: 11, in_front: false, keys: "enter" }),
    ).not.toHaveProperty("inFront")
    // Looking and waiting are in the window too, and not on the whole screen.
    expect(screenAction({ action: "screenshot", window: 12 })).toEqual({
      do: "in_window",
      window: 12,
      act: { do: "screenshot" },
    })
    expect(screenAction({ action: "wait", window: 12, seconds: 2 })).toEqual({
      do: "in_window",
      window: 12,
      act: { do: "wait", seconds: 2 },
    })
    // Bringing forward means nothing without a window.
    expect(screenAction({ action: "click", in_front: true, x: 1, y: 2 })).toEqual({
      do: "click",
      x: 1,
      y: 2,
    })
  })

  it("keeps the place given with text for a window, and not for the whole screen", () => {
    expect(screenAction({ action: "type", window: 11, text: "milk", x: 30.2, y: 59.7 })).toEqual({
      do: "in_window",
      window: 11,
      act: { do: "type", text: "milk", x: 30, y: 60 },
    })
    expect(screenAction({ action: "type", window: 11, text: "milk" })).toEqual({
      do: "in_window",
      window: 11,
      act: { do: "type", text: "milk" },
    })
    // Half a place is no place.
    expect(screenAction({ action: "type", window: 11, text: "milk", x: 30 })).toEqual({
      do: "in_window",
      window: 11,
      act: { do: "type", text: "milk" },
    })
    expect(screenAction({ action: "type", text: "milk", x: 30, y: 60 })).toEqual({
      do: "type",
      text: "milk",
    })
  })

  it("lists the windows and opens an app whatever else it is given", () => {
    expect(screenAction({ action: "windows" })).toEqual({ do: "windows" })
    expect(screenAction({ action: "windows", window: 11 })).toEqual({ do: "windows" })
    expect(screenAction({ action: "open", app: " Notes " })).toEqual({ do: "open", app: "Notes" })
    expect(screenAction({ action: "open", app: "Notes", window: 11 })).toEqual({
      do: "open",
      app: "Notes",
    })
  })

  it("is refused in words where a window is asked for that cannot be, or for what has none", () => {
    expect(screenAction({ action: "open" })).toMatch(/open needs app/)
    expect(screenAction({ action: "open", app: "  " })).toMatch(/open needs app/)
    expect(screenAction({ action: "move", window: 11, x: 1, y: 2 })).toMatch(
      /move is for the whole screen/,
    )
    for (const window of [0, -3, 1.5, Number.NaN]) {
      expect(screenAction({ action: "click", window, x: 1, y: 2 })).toMatch(
        /window is the id of a window, a whole number/,
      )
    }
    // What the action needs is still asked for.
    expect(screenAction({ action: "click", window: 11 })).toMatch(/click needs x and y/)
    expect(screenAction({ action: "swipe", window: 11 })).toMatch(/There is no action "swipe"/)
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
