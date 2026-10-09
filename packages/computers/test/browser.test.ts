import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { nodeBrowserIO } from "../src/browser/index.ts"
import { DEV_BROWSER, assetName, assetUrl } from "../src/browser/binary.ts"
import { keptChromeArgs, ownDataDirs, readDevToolsActivePort } from "../src/browser/chrome.ts"
import { isJpeg, keepEnd, readFrames } from "../src/browser/frames.ts"
import {
  POINTER_BINDING,
  createPreview,
  readPointer,
  type PreviewSocket,
} from "../src/browser/preview.ts"

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

  it("reads what the page says of the mouse, and nothing else", () => {
    expect(readPointer("m,10,20")).toEqual({ kind: "m", x: 10, y: 20 })
    expect(readPointer("d,0,0")).toEqual({ kind: "d", x: 0, y: 0 })
    expect(readPointer("x,1,2")).toBeNull()
    expect(readPointer("m,1")).toBeNull()
    expect(readPointer({ x: 1 })).toBeNull()
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
