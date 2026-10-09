import { spawn, type ChildProcess } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { createServer, type Server } from "node:http"
import { createServer as createTcpServer, type AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { nodeBrowserIO } from "../src/browser/index.ts"
import { OWN_PORTS, findChrome } from "../src/browser/chrome.ts"

/**
 * The browser for real: dev-browser downloaded from its release, a Chromium started without a
 * window, and a second one standing in for the owner's own. It needs the network and a Chrome
 * on the machine, so it is run only when asked for:
 *
 *   DC_BROWSER_LIVE=1 pnpm exec vitest run test/browser.live.test.ts
 */
const live = process.env.DC_BROWSER_LIVE === "1"
const agent = { id: "a1", name: "Ada", color: "#14b8a6" }
const dir = mkdtempSync(join(tmpdir(), "dc-browser-"))
const io = nodeBrowserIO({ dir, log: (line) => console.log(line) })

// The button is at a known place, so that where the pointer was last seen can be checked.
const html = `<!doctype html><title>before</title><body style="margin:0">
<button id="go" style="position:fixed;left:300px;top:200px;width:100px;height:40px"
  onclick="document.title='clicked'">go</button>`

let server: Server
let pageUrl = ""
let ownChrome: ChildProcess | undefined

const isJpeg = (data: string) =>
  Buffer.from(data, "base64").subarray(0, 3).toString("hex") === "ffd8ff"

/** Whether nothing is listening on a port, found by listening on it for a moment. */
const free = (port: number) =>
  new Promise<boolean>((resolve) => {
    const probe = createTcpServer()
    probe.once("error", () => resolve(false))
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)))
  })

describe.skipIf(!live)("the browser, for real", () => {
  beforeAll(async () => {
    // Whatever Chrome happens to be open on this machine is not part of the first tests.
    process.env.DC_BROWSER_OWN = "0"
    server = createServer((_request, response) => {
      response.setHeader("content-type", "text/html")
      response.end(html)
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    pageUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
  })

  afterAll(async () => {
    await io.close()
    ownChrome?.kill("SIGKILL")
    server?.close()
    delete process.env.DC_BROWSER_OWN
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
  })

  it("shows nothing before any agent has used it", async () => {
    const view = await io.view(0, 100)
    expect(view.active).toBe(false)
    expect(view.shot).toBeUndefined()
  })

  it("runs a script in a browser kept for agents, and gives back what it printed and a picture", async () => {
    const ran = await io.run(
      agent,
      `const page = await browser.getPage("main");
       await page.goto(${JSON.stringify(pageUrl)});
       await page.click("#go");
       console.log("the title is", await page.title());
       await page.shot();`,
      { timeoutMs: 60_000, say: "Pressing the button" },
    )
    console.log({
      ...ran,
      shots: ran.shots.map((shot) => ({ ...shot, data: `${shot.data.length} chars` })),
    })
    expect(ran.error).toBeUndefined()
    expect(ran.output).toContain("the title is clicked")
    expect(ran.shots).toHaveLength(1)
    expect(ran.shots[0]?.mimeType).toBe("image/jpeg")
    expect(isJpeg(ran.shots[0]?.data ?? "")).toBe(true)
    expect(ran.shots[0]?.width).toBeGreaterThan(100)
    expect(ran.url).toBe(pageUrl)
    expect(ran.title).toBe("clicked")
    expect(ran.own).toBe(false)
  }, 180_000)

  it("shows whoever watches the page, and where the agent's pointer was when it clicked", async () => {
    const view = await io.view(0, 5_000)
    console.log({
      ...view,
      shot: view.shot && { ...view.shot, data: `${view.shot.data.length} chars` },
    })
    expect(view.active).toBe(true)
    expect(view.seq).toBeGreaterThan(0)
    expect(view.shot?.mimeType).toBe("image/jpeg")
    expect(isJpeg(view.shot?.data ?? "")).toBe(true)
    expect(view.url).toBe(pageUrl)
    expect(view.own).toBe(false)
    expect(view.say).toBe("Pressing the button")
    expect(view.agent).toEqual(agent)
    expect(view.held).toBe(false)
    expect(view.clicks).toBe(1)
    // The button is 100 by 40 at 300, 200, and is clicked in its middle.
    expect(Math.abs((view.pointer?.x ?? 0) - 350)).toBeLessThanOrEqual(5)
    expect(Math.abs((view.pointer?.y ?? 0) - 220)).toBeLessThanOrEqual(5)
    // The pointer and the picture are in the same pixels: those of the page.
    expect(view.shot?.width).toBeGreaterThan(350)
  }, 30_000)

  it("says why a script failed, without failing itself", async () => {
    const ran = await io.run(agent, `console.log("before"); throw new Error("no such thing")`, {
      timeoutMs: 30_000,
    })
    console.log(ran)
    expect(ran.output).toContain("before")
    expect(ran.error).toContain("no such thing")
    expect(ran.own).toBe(false)
  }, 60_000)

  it("uses the owner's own browser once that is open and lets itself be used", async () => {
    let port = 0
    for (const candidate of OWN_PORTS) {
      if (await free(candidate)) {
        port = candidate
        break
      }
    }
    expect(port).not.toBe(0)
    const chrome = findChrome(join(dir, "none"))
    expect(chrome).not.toBeNull()
    ownChrome = spawn(
      chrome as string,
      [
        "--headless=new",
        "--no-sandbox",
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${join(dir, "own-profile")}`,
        "--no-first-run",
        "about:blank",
      ],
      { stdio: "ignore" },
    )
    for (let tries = 0; tries < 100; tries++) {
      const up = await fetch(`http://127.0.0.1:${port}/json/version`).then(
        (response) => response.ok,
        () => false,
      )
      if (up) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    delete process.env.DC_BROWSER_OWN
    const ran = await io.run(
      agent,
      `const page = await browser.getPage("mine"); await page.goto(${JSON.stringify(pageUrl)}); console.log(await page.title());`,
      { timeoutMs: 60_000 },
    )
    console.log(ran)
    expect(ran.error).toBeUndefined()
    expect(ran.output).toContain("before")
    expect(ran.own).toBe(true)
    const view = await io.view(0, 5_000)
    expect(view.active).toBe(true)
    expect(view.own).toBe(true)
    expect(isJpeg(view.shot?.data ?? "")).toBe(true)
  }, 120_000)
})
