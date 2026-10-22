import { existsSync, mkdtempSync } from "node:fs"
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises"
import { connect } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { nodeBrowserIO } from "../src/browser/index.ts"
import { DEV_BROWSER, assetName, assetUrl } from "../src/browser/binary.ts"
import {
  hasDisplay,
  keptChromeArgs,
  ownBrowserAccess,
  ownDataDirs,
  readDevToolsActivePort,
} from "../src/browser/chrome.ts"
import jpeg from "jpeg-js"
import { isJpeg, keepEnd, readFrames, shotOf } from "../src/browser/frames.ts"
import {
  POINTER_BINDING,
  createPreview,
  readPointer,
  type PreviewSocket,
} from "../src/browser/preview.ts"
import { createRelay } from "../src/browser/relay.ts"

const line = (frame: unknown) => `${JSON.stringify(frame)}\n`

describe("what dev-browser printed", () => {
  it("is read into what the script said, the value it ended with, and its pictures", () => {
    const ran = readFrames(
      line({ type: "hello", protocol: 1, version: "1.0.0-rc.3", pid: 7 }) +
        line({ type: "stdout", data: "one\n" }) +
        line({ type: "stderr", data: "careful" }) +
        line({ type: "image", path: "/h/tmp/shot-1.jpg", width: 1280, height: 800 }) +
        line({ type: "result", value: '{"ok":true}' }) +
        line({ type: "done", exitCode: 0, durationMs: 12 }),
    )
    expect(ran.output).toBe('one\ncareful\n{"ok":true}')
    expect(ran.error).toBeUndefined()
    expect(ran.images).toEqual([{ path: "/h/tmp/shot-1.jpg", width: 1280, height: 800 }])
    expect(ran.exitCode).toBe(0)
  })

  it("says why a script failed, and keeps what it printed before it did", () => {
    const ran = readFrames(
      line({ type: "stdout", data: "so far\n" }) +
        line({ type: "error", kind: "script", name: "TypeError", message: "x is not a function" }) +
        line({ type: "done", exitCode: 1, durationMs: 3 }),
    )
    expect(ran.output).toBe("so far")
    expect(ran.error).toBe("TypeError: x is not a function")
    expect(ran.exitCode).toBe(1)
  })

  it("has no exit code where dev-browser never finished, and keeps a line that is not a frame", () => {
    const ran = readFrames(`${line({ type: "stdout", data: "a\n" })}panic: out of memory\n`)
    expect(ran.exitCode).toBeUndefined()
    expect(ran.output).toBe("a\npanic: out of memory")
  })

  it("is cut to its end where it is long, since that is where a script fails", () => {
    const kept = keepEnd(`${"a".repeat(100)}the end`, 20)
    expect(kept.endsWith("the end")).toBe(true)
    expect(kept).toContain("87 characters were left out")
    expect(keepEnd("short", 20)).toBe("short")
  })

  it("knows a JPEG by how it starts", () => {
    expect(isJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true)
    expect(isJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false)
  })

  it("hands back a picture no larger than a model is shown", () => {
    /** A page's picture of `width` by `height`, as a JPEG: noise, which does not squeeze. */
    const page = (width: number, height: number) => {
      const data = new Uint8Array(width * height * 4)
      let seed = 5
      for (let index = 0; index < data.length; index++) {
        seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff
        data[index] = index % 4 === 3 ? 255 : (seed >>> 16) % 256
      }
      return jpeg.encode({ width, height, data }, 90).data
    }
    // A page drawn at twice its size on a sharp screen is scaled down to what a model keeps.
    const sharp = page(2560, 1600)
    const shot = shotOf(sharp, { width: 2560, height: 1600 })!
    expect(shot).toMatchObject({ mimeType: "image/jpeg", width: 1356, height: 847 })
    expect(Buffer.from(shot.data, "base64").length).toBeLessThan(sharp.length / 2)
    // One that fits goes as it is, with the size dev-browser said.
    const small = page(400, 300)
    expect(shotOf(small, { width: 400, height: 300 })).toEqual({
      mimeType: "image/jpeg",
      data: Buffer.from(small).toString("base64"),
      width: 400,
      height: 300,
    })
    // What is not a JPEG is not handed back.
    expect(
      shotOf(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { width: 1, height: 1 }),
    ).toBeUndefined()
  })
})

describe("the dev-browser that is downloaded", () => {
  it("is the release's file for the machine", () => {
    expect(assetName("linux", "x64")).toBe("dev-browser-linux-x64")
    expect(assetName("darwin", "arm64")).toBe("dev-browser-darwin-arm64")
    expect(assetUrl("dev-browser-linux-x64")).toBe(
      `https://github.com/SawyerHood/dev-browser/releases/download/v${DEV_BROWSER.version}/dev-browser-linux-x64`,
    )
  })

  it("has a hash written down for every file there is", () => {
    for (const platform of ["linux", "darwin"]) {
      for (const arch of ["x64", "arm64"]) {
        expect(DEV_BROWSER.sha256[assetName(platform, arch) as string]).toMatch(/^[0-9a-f]{64}$/)
      }
    }
  })

  it("is not there for Windows, which dev-browser does not build for yet", () => {
    expect(assetName("win32", "x64")).toBeNull()
    expect(assetName("linux", "ia32")).toBeNull()
  })
})

describe("the owner's own Chrome", () => {
  it("says where it can be reached in two lines: its port, and its socket's path", () => {
    expect(readDevToolsActivePort("9222\n/devtools/browser/0f3a-11\n")).toEqual({
      ws: "ws://127.0.0.1:9222/devtools/browser/0f3a-11",
      port: 9222,
    })
    expect(readDevToolsActivePort("45123\r\n/devtools/browser/abc\r\n")?.port).toBe(45123)
  })

  it("is not believed where the file is half written or says something else", () => {
    expect(readDevToolsActivePort("")).toBeNull()
    expect(readDevToolsActivePort("9222\n")).toBeNull()
    expect(readDevToolsActivePort("0\n/devtools/browser/abc")).toBeNull()
    expect(readDevToolsActivePort("9222\n/devtools/page/abc")).toBeNull()
    expect(readDevToolsActivePort("9222\n/devtools/browser/abc?x=http://evil")).toBeNull()
  })

  it("is looked for where each browser keeps its things", () => {
    expect(ownDataDirs("darwin", "/Users/ada", {})).toContain(
      "/Users/ada/Library/Application Support/Google/Chrome",
    )
    expect(ownDataDirs("darwin", "/Users/ada", {})).toContain(
      "/Users/ada/Library/Application Support/Microsoft Edge",
    )
    expect(ownDataDirs("linux", "/home/ada", {})).toContain("/home/ada/.config/google-chrome")
    expect(ownDataDirs("linux", "/home/ada", { XDG_CONFIG_HOME: "/cfg" })).toContain(
      "/cfg/chromium",
    )
    expect(
      ownDataDirs("win32", "C:\\Users\\ada", { LOCALAPPDATA: "C:\\Users\\ada\\AppData\\Local" }),
    ).toContain("C:\\Users\\ada\\AppData\\Local\\Google\\Chrome\\User Data")
    expect(ownDataDirs("win32", "C:\\Users\\ada", {})).toContain(
      "C:\\Users\\ada\\AppData\\Local\\BraveSoftware\\Brave-Browser\\User Data",
    )
  })

  it("is said to be kept from this program where its folder may not be read", async () => {
    const root = await mkdtemp(join(tmpdir(), "dc-own-"))
    const open = join(root, "chrome")
    const shut = join(root, "brave")
    await mkdir(open)
    await mkdir(shut)
    try {
      expect(ownBrowserAccess([join(root, "none")])).toBe("none")
      expect(ownBrowserAccess([join(root, "none"), open])).toBe("allowed")
      await chmod(shut, 0o000)
      // Whoever may read everything is refused nothing, and Windows has no such switch.
      const refused = process.platform !== "win32" && process.getuid?.() !== 0
      expect(ownBrowserAccess([open, shut])).toBe(refused ? "blocked" : "allowed")
    } finally {
      await chmod(shut, 0o700)
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe("the browser kept for agents", () => {
  it("has no window, a profile of its own, and a port that Chrome picks", () => {
    const args = keptChromeArgs("/d/browser-profile", true)
    expect(args).toContain("--headless=new")
    expect(args).toContain("--remote-debugging-port=0")
    expect(args).toContain("--user-data-dir=/d/browser-profile")
    expect(args).toContain("--window-size=1280,800")
    expect(args).not.toContain("--no-sandbox")
    expect(keptChromeArgs("/d/p", false)).toContain("--no-sandbox")
  })

  it("has a window where it is shown, and is otherwise the same", () => {
    const hidden = keptChromeArgs("/d/p", true, false)
    const shown = keptChromeArgs("/d/p", true, true)
    expect(hidden).toContain("--headless=new")
    expect(shown).not.toContain("--headless=new")
    expect(shown).toEqual(hidden.filter((arg) => arg !== "--headless=new"))
    expect(shown).toContain("--window-size=1280,800")
    expect(keptChromeArgs("/d/p", false, true)).toContain("--no-sandbox")
    expect(keptChromeArgs("/d/p", false, true)).not.toContain("--headless=new")
  })

  it("can be shown wherever there is a screen, which on Linux is where a display is named", () => {
    expect(hasDisplay("linux", {})).toBe(false)
    expect(hasDisplay("linux", { DISPLAY: "" })).toBe(false)
    expect(hasDisplay("linux", { DISPLAY: ":0" })).toBe(true)
    expect(hasDisplay("linux", { WAYLAND_DISPLAY: "wayland-0" })).toBe(true)
    expect(hasDisplay("darwin", {})).toBe(true)
    expect(hasDisplay("win32", {})).toBe(true)
  })
})

/** A DevTools socket that answers what the live view asks, and can be made to say things. */
function fakeChrome() {
  const sent: {
    id: number
    method: string
    params: Record<string, unknown>
    sessionId?: string
  }[] = []
  const listeners: Record<string, ((event: { data: unknown }) => void)[]> = {}
  const say = (message: unknown) => {
    for (const listener of listeners.message ?? []) listener({ data: JSON.stringify(message) })
  }
  const socket: PreviewSocket = {
    readyState: 1,
    send(data) {
      const call = JSON.parse(data)
      sent.push(call)
      queueMicrotask(() => {
        say({
          id: call.id,
          result: call.method === "Target.attachToTarget" ? { sessionId: "s1" } : {},
        })
        if (call.method === "Target.setDiscoverTargets") {
          say({
            method: "Target.targetCreated",
            params: {
              targetInfo: {
                targetId: "t1",
                type: "page",
                url: "https://example.com/",
                title: "Example",
              },
            },
          })
        }
      })
    },
    close() {},
    addEventListener(type: string, listener: (event: { data: unknown }) => void) {
      ;(listeners[type] ??= []).push(listener)
      if (type === "open") queueMicrotask(() => listener({ data: undefined }))
    },
  }
  return { socket, sent, say }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

describe("the live view of a browser", () => {
  it("shows the page's frames in the page's own pixels, with its address and title", async () => {
    const chrome = fakeChrome()
    const seq = { n: 0 }
    const preview = createPreview("ws://x", { seq, openSocket: () => chrome.socket })
    const waiting = preview.next(0, 2_000)
    await settle()
    expect(chrome.sent.map((call) => call.method)).toContain("Page.startScreencast")
    chrome.say({
      method: "Page.screencastFrame",
      sessionId: "s1",
      params: {
        data: "anBlZw==",
        sessionId: 1,
        metadata: { deviceWidth: 1280, deviceHeight: 720 },
      },
    })
    await waiting
    expect(seq.n).toBeGreaterThan(0)
    expect(preview.latest()).toEqual({
      shot: { mimeType: "image/jpeg", data: "anBlZw==", width: 1280, height: 720 },
      url: "https://example.com/",
      title: "Example",
    })
    preview.close()
  })

  it("shows the mouse only while a script runs, and counts its presses", async () => {
    const chrome = fakeChrome()
    let clicks = 0
    const preview = createPreview("ws://x", {
      seq: { n: 0 },
      onClick: () => clicks++,
      openSocket: () => chrome.socket,
    })
    preview.wake()
    await settle()
    expect(chrome.sent.find((call) => call.method === "Runtime.addBinding")?.params).toEqual({
      name: POINTER_BINDING,
    })
    const press = {
      method: "Runtime.bindingCalled",
      sessionId: "s1",
      params: { name: POINTER_BINDING, payload: "d,350,220" },
    }
    // The owner's own mouse, between scripts, is not the agent's.
    chrome.say(press)
    expect(preview.latest().pointer).toBeUndefined()
    expect(clicks).toBe(0)
    preview.running(true)
    chrome.say(press)
    chrome.say({ ...press, params: { name: POINTER_BINDING, payload: "m,360,230" } })
    expect(preview.latest().pointer).toEqual({ x: 360, y: 230 })
    expect(clicks).toBe(1)
    preview.close()
  })

  it("follows the page the agent used, whichever page was gone to since", async () => {
    const chrome = fakeChrome()
    const preview = createPreview("ws://x", { seq: { n: 0 }, openSocket: () => chrome.socket })
    const attachedTo = () =>
      chrome.sent.filter((call) => call.method === "Target.attachToTarget").at(-1)?.params.targetId
    const page = (targetId: string, url: string) => ({
      method: "Target.targetInfoChanged",
      params: { targetInfo: { targetId, type: "page", url, title: url } },
    })
    preview.wake()
    await settle()
    expect(attachedTo()).toBe("t1")
    // Without word of the agent, the page most lately gone to.
    chrome.say(page("t2", "https://x.com/"))
    await settle()
    expect(attachedTo()).toBe("t2")
    preview.follow("t1")
    await settle()
    expect(attachedTo()).toBe("t1")
    // The owner going somewhere in a tab of theirs does not take the view from the agent's page.
    chrome.say(page("t2", "https://x.com/home"))
    await settle()
    expect(attachedTo()).toBe("t1")
    expect(preview.target()).toBe("t1")
    // Once the agent's page is gone, the view goes back to the page most lately gone to.
    chrome.say({ method: "Target.targetDestroyed", params: { targetId: "t1" } })
    await settle()
    expect(attachedTo()).toBe("t2")
    preview.close()
  })

  it("reads what the page says of the mouse, and nothing else", () => {
    expect(readPointer("m,10,20")).toEqual({ kind: "m", x: 10, y: 20 })
    expect(readPointer("d,0,0")).toEqual({ kind: "d", x: 0, y: 0 })
    expect(readPointer("x,1,2")).toBeNull()
    expect(readPointer("m,1")).toBeNull()
    expect(readPointer({ x: 1 })).toBeNull()
  })
})

/**
 * The owner's own Chrome, as one that asks them: its socket opens only when `allow` is called,
 * and it gives each `Target.attachToBrowserTarget` a session of the browser, b1, b2 and so on.
 */
function fakeOwnChrome() {
  const sent: { id: number; method: string; params: unknown; sessionId?: string }[] = []
  const listeners: Record<string, ((event: { data: unknown }) => void)[]> = {}
  const tell = (type: string, data?: unknown) => {
    for (const listener of listeners[type] ?? []) listener({ data })
  }
  let opened = 0
  let sessions = 0
  const state = { readyState: 0 }
  const socket: PreviewSocket = {
    get readyState() {
      return state.readyState
    },
    send(data) {
      const call = JSON.parse(data)
      sent.push(call)
      if (call.method === "Target.attachToBrowserTarget" && call.sessionId === undefined) {
        const sessionId = `b${++sessions}`
        queueMicrotask(() =>
          tell("message", JSON.stringify({ id: call.id, result: { sessionId } })),
        )
      }
    },
    close() {
      state.readyState = 3
    },
    addEventListener(type: string, listener: (event: { data: unknown }) => void) {
      ;(listeners[type] ??= []).push(listener)
    },
  }
  return {
    sent,
    opens: () => opened,
    openSocket: () => {
      opened += 1
      return socket
    },
    allow() {
      state.readyState = 1
      tell("open")
    },
    refuse() {
      state.readyState = 3
      tell("close")
    },
    say: (message: unknown) => tell("message", JSON.stringify(message)),
    /** What was last asked of the browser with this method. */
    last: (method: string) => sent.findLast((call) => call.method === method),
  }
}

/** What a socket on the relay heard, as it came. */
function listen(socket: PreviewSocket) {
  const heard: unknown[] = []
  const events: string[] = []
  socket.addEventListener("open", () => events.push("open"))
  socket.addEventListener("close", () => events.push("close"))
  socket.addEventListener("message", (event) => heard.push(JSON.parse(String(event.data))))
  return { heard, events }
}

// It listens on a Unix socket, which Windows has none of: there the daemon does without it.
describe.skipIf(process.platform === "win32")("the one socket to the owner's own Chrome", () => {
  it("is opened once, however many use it, and gives each what looks like its own", async () => {
    const chrome = fakeOwnChrome()
    const relay = await createRelay("ws://x", { openSocket: chrome.openSocket })
    const one = relay.open()
    const two = relay.open()
    const first = listen(one)
    const second = listen(two)
    expect(await relay.answer(10)).toBe("asking")
    // Said before the owner answered: kept, and passed on once they have.
    one.send(JSON.stringify({ id: 1, method: "Target.setDiscoverTargets", params: {} }))
    expect(chrome.sent).toEqual([])
    chrome.allow()
    expect(await relay.answer(10)).toBe("open")
    await settle()
    expect(chrome.opens()).toBe(1)
    expect(first.events).toEqual(["open"])
    expect(second.events).toEqual(["open"])
    expect(one.readyState).toBe(1)

    // Each numbers its calls from one. The browser is asked with numbers of the relay's, in
    // the session that stands for whoever asked.
    two.send(JSON.stringify({ id: 1, method: "Browser.getVersion" }))
    const discover = chrome.last("Target.setDiscoverTargets")
    const version = chrome.last("Browser.getVersion")
    expect(discover?.sessionId).toBe("b1")
    expect(version?.sessionId).toBe("b2")
    expect(discover?.id).not.toBe(version?.id)
    chrome.say({ id: version?.id, result: { product: "Chrome" }, sessionId: "b2" })
    chrome.say({ id: discover?.id, result: {}, sessionId: "b1" })
    expect(first.heard).toEqual([{ id: 1, result: {} }])
    expect(second.heard).toEqual([{ id: 1, result: { product: "Chrome" } }])
    await relay.close()
  })

  it("tells each only of its own sessions, and lets none into another's", async () => {
    const chrome = fakeOwnChrome()
    const relay = await createRelay("ws://x", { openSocket: chrome.openSocket })
    const one = relay.open()
    const two = relay.open()
    const first = listen(one)
    const second = listen(two)
    chrome.allow()
    await settle()
    // A page attached under the first one's session is the first one's.
    const attached = {
      method: "Target.attachedToTarget",
      params: { sessionId: "p1", targetInfo: { targetId: "t1", type: "page" } },
    }
    chrome.say({ ...attached, sessionId: "b1" })
    chrome.say({ method: "Page.frameNavigated", params: { frame: {} }, sessionId: "p1" })
    expect(first.heard).toEqual([
      attached,
      { method: "Page.frameNavigated", params: { frame: {} }, sessionId: "p1" },
    ])
    expect(second.heard).toEqual([])

    one.send(JSON.stringify({ id: 7, method: "Page.enable", sessionId: "p1" }))
    expect(chrome.last("Page.enable")?.sessionId).toBe("p1")
    two.send(JSON.stringify({ id: 7, method: "Page.enable", sessionId: "p1" }))
    expect(chrome.sent.filter((call) => call.method === "Page.enable")).toHaveLength(1)
    expect(second.heard).toEqual([
      {
        id: 7,
        error: { code: -32001, message: "Session with given id not found." },
        sessionId: "p1",
      },
    ])

    // One it attached itself is its own from the answer on.
    two.send(JSON.stringify({ id: 8, method: "Target.attachToTarget", params: { targetId: "t1" } }))
    chrome.say({
      id: chrome.last("Target.attachToTarget")?.id,
      result: { sessionId: "p2" },
      sessionId: "b2",
    })
    chrome.say({ method: "Page.screencastFrame", params: {}, sessionId: "p2" })
    expect(second.heard.slice(1)).toEqual([
      { id: 8, result: { sessionId: "p2" } },
      { method: "Page.screencastFrame", params: {}, sessionId: "p2" },
    ])
    expect(first.heard).toHaveLength(2)

    // Leaving lets go of its session on the browser, and of everything under it.
    two.close()
    expect(chrome.last("Target.detachFromTarget")).toMatchObject({ params: { sessionId: "b2" } })
    chrome.say({ method: "Page.screencastFrame", params: {}, sessionId: "p2" })
    expect(second.heard).toHaveLength(3)
    await relay.close()
  })

  it("speaks to dev-browser over a socket of this machine, one message to a line", async () => {
    const chrome = fakeOwnChrome()
    const relay = await createRelay("ws://x", { openSocket: chrome.openSocket })
    chrome.allow()
    expect(relay.address).toMatch(/^unix:/)
    const socket = connect(relay.address.slice(5))
    socket.setEncoding("utf8")
    let read = ""
    socket.on("data", (chunk: string) => (read += chunk))
    await new Promise((resolve) => socket.once("connect", resolve))
    // Two messages in one write, and the second in two.
    socket.write(`${JSON.stringify({ id: 1, method: "Browser.getVersion" })}\n{"id":2,`)
    socket.write(`"method":"Target.getTargets"}\n`)
    await settle()
    const version = chrome.last("Browser.getVersion")
    expect(version?.sessionId).toBe("b1")
    expect(chrome.last("Target.getTargets")?.sessionId).toBe("b1")
    chrome.say({ id: version?.id, result: { product: "Chrome" }, sessionId: "b1" })
    chrome.say({ method: "Target.targetCreated", params: { targetInfo: {} }, sessionId: "b1" })
    await settle()
    expect(read.split("\n")).toEqual([
      JSON.stringify({ id: 1, result: { product: "Chrome" } }),
      JSON.stringify({ method: "Target.targetCreated", params: { targetInfo: {} } }),
      "",
    ])
    const closed = new Promise((resolve) => socket.once("close", resolve))
    await relay.close()
    await closed
    expect(existsSync(relay.address.slice(5))).toBe(false)
  })

  it("says which page dev-browser acts on, and not what else looks at pages", async () => {
    const chrome = fakeOwnChrome()
    const relay = await createRelay("ws://x", { openSocket: chrome.openSocket })
    const used: string[] = []
    relay.onUse((targetId) => used.push(targetId))
    // Something in this process first, so that dev-browser's session on the browser is b2.
    const live = relay.open()
    chrome.allow()
    const socket = connect(relay.address.slice(5))
    await new Promise((resolve) => socket.once("connect", resolve))
    await settle()
    const write = (message: unknown) => socket.write(`${JSON.stringify(message)}\n`)
    // Pages dev-browser was attached to: the owner's tab and the agent's.
    for (const [sessionId, targetId] of [
      ["p1", "owner-tab"],
      ["p2", "agent-tab"],
    ]) {
      chrome.say({
        method: "Target.attachedToTarget",
        params: { sessionId, targetInfo: { targetId, type: "page" } },
        sessionId: "b2",
      })
    }
    // Setting up every page it is attached to is not using it.
    write({ id: 1, method: "Runtime.enable", sessionId: "p1" })
    write({ id: 2, method: "Page.bringToFront", sessionId: "p2" })
    write({ id: 3, method: "Input.dispatchMouseEvent", params: {}, sessionId: "p2" })
    await settle()
    expect(used).toEqual(["agent-tab", "agent-tab"])
    // A page it opens is one it is about to use.
    write({ id: 4, method: "Target.createTarget", params: { url: "about:blank" } })
    await settle()
    chrome.say({
      id: chrome.last("Target.createTarget")?.id,
      result: { targetId: "new-tab" },
      sessionId: "b2",
    })
    await settle()
    expect(used.at(-1)).toBe("new-tab")
    // What the live view or a sign-in does is not the agent's script.
    live.send(JSON.stringify({ id: 1, method: "Target.activateTarget", params: { targetId: "x" } }))
    expect(used).not.toContain("x")
    socket.destroy()
    await relay.close()
  })

  it("is of no more use once the owner has said no, or the browser has gone", async () => {
    const chrome = fakeOwnChrome()
    const relay = await createRelay("ws://x", { openSocket: chrome.openSocket })
    const waiting = listen(relay.open())
    const answer = relay.answer(2_000)
    expect(relay.alive()).toBe(true)
    chrome.refuse()
    expect(await answer).toBe("closed")
    expect(relay.alive()).toBe(false)
    expect(waiting.events).toEqual(["close"])
    // Whatever opens it afterwards is told at once.
    const late = listen(relay.open())
    await settle()
    expect(late.events).toEqual(["close"])
    await relay.close()
  })
})

describe("a browser that cannot be set up", () => {
  it("says so in the answer to the script, in words for the agent, and shows nothing", async () => {
    const before = process.env.DC_DEV_BROWSER
    process.env.DC_DEV_BROWSER = "/no/such/dev-browser"
    try {
      const io = nodeBrowserIO({ dir: mkdtempSync(join(tmpdir(), "dc-browser-none-")) })
      expect((await io.view(0, 10)).active).toBe(false)
      const ran = await io.run({ id: "a", name: "Ada", color: "#000" }, "1 + 1", {
        timeoutMs: 1_000,
      })
      expect(ran.error).toContain("DC_DEV_BROWSER names /no/such/dev-browser")
      expect(ran).toMatchObject({ output: "", shots: [], own: false })
      await io.close()
      expect((await io.view(0, 10)).active).toBe(false)
    } finally {
      if (before === undefined) delete process.env.DC_DEV_BROWSER
      else process.env.DC_DEV_BROWSER = before
    }
  })
})
