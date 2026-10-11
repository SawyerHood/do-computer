import { type ChildProcess, execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { _electron as electron, type ElectronApplication, expect, test } from "@playwright/test"

const appEntry = fileURLToPath(new URL("../dist/main.cjs", import.meta.url))
const packed = process.env.DC_DESKTOP_APP
const scratch = mkdtempSync(join(tmpdir(), "dc-desktop-update-"))
const home = join(scratch, "home")
const data = join(scratch, "app")
/** Where the newer app writes what it was started as and with: here that is a script. */
const started = join(scratch, "started")
/** The AppImage the app is told it was started from, on Linux, which a newer one replaces. */
const appImage = join(scratch, "Do-Computer-0.0.1-linux-x86_64.AppImage")

// A release as the app finds one: a file that names the newest version and what to fetch for
// it, one for each system, and the thing to fetch. What is fetched here is no app. On Linux
// it is a script, since there the newer app is a file that is put in place and started.
const system = {
  linux: { list: "latest-linux.yml", file: "Do-Computer-99.0.0-linux-x86_64.AppImage" },
  win32: { list: "latest.yml", file: "Do-Computer-99.0.0-win-x64.exe" },
  darwin: { list: "latest-mac.yml", file: "Do-Computer-99.0.0-mac-universal.zip" },
}[process.platform as "linux" | "win32" | "darwin"]
const newer = Buffer.from(`#!/bin/sh\necho "$0 $*" >> "${started}"\n`)
const sum = createHash("sha512").update(newer).digest("base64")
const list = `version: 99.0.0
files:
  - url: ${system.file}
    sha512: ${sum}
    size: ${newer.length}
path: ${system.file}
sha512: ${sum}
releaseDate: '2026-10-11T00:00:00.000Z'
`

let feed: Server
let app: ElectronApplication
/** The app's process, kept from when it started: it cannot be asked for once the app has gone. */
let running: ChildProcess

test.beforeAll(async () => {
  feed = createServer((request, response) => {
    // The list is asked for with something after its name, so that nothing in between keeps it.
    const asked = new URL(request.url ?? "/", "http://feed").pathname
    if (asked === `/${system.list}`) return response.end(list)
    if (asked === `/${system.file}`) return response.end(newer)
    response.statusCode = 404
    response.end()
  })
  await new Promise<void>((resolve) => feed.listen(0, "127.0.0.1", resolve))
  mkdirSync(data, { recursive: true })
  // An app that opens at sign-in, to see that what opens it keeps up with the file it is.
  writeFileSync(
    join(data, "settings.json"),
    JSON.stringify({ share: false, openAtLogin: process.platform === "linux" }),
  )
  writeFileSync(appImage, "")
  app = await electron.launch({
    ...(packed ? { executablePath: packed } : {}),
    args: [...(packed ? [] : [appEntry]), "--no-sandbox", "--disable-gpu"],
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      XDG_CACHE_HOME: join(home, ".cache"),
      DC_DESKTOP_DATA: data,
      DC_DESKTOP_SERVER: "",
      DC_DESKTOP_AUTOSTART: "1",
      DC_DESKTOP_UPDATES: `http://127.0.0.1:${(feed.address() as AddressInfo).port}`,
      ...(process.platform === "linux" ? { APPIMAGE: appImage } : {}),
    },
  })
  running = app.process()
})

test.afterAll(async () => {
  // An app that quits with a newer one fetched starts what it fetched, to take its place. On
  // Windows that is an installer, which what was fetched here is not: the app is ended instead.
  // Windows lets go of the app's folder only once every process of it has gone.
  if (process.platform !== "win32") await app?.close().catch(() => {})
  else if (running?.pid !== undefined && running.exitCode === null) {
    const gone = new Promise((resolve) => running.once("exit", resolve))
    try {
      execFileSync("taskkill", ["/pid", String(running.pid), "/T", "/F"], { stdio: "ignore" })
      await gone
    } catch {
      // It had gone already.
    }
  }
  feed?.close()
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

test.describe.configure({ mode: "serial" })

test("the app finds a newer one of itself, fetches it, and offers to restart as it", async () => {
  await expect
    .poll(() =>
      app.evaluate(({ Menu }) => {
        const file = Menu.getApplicationMenu()?.items.find((item) => item.label === "File")
        const item = file?.submenu?.items.find((item) => item.label === "This Computer…")
        item?.click()
        return item !== undefined
      }),
    )
    .toBe(true)
  await expect
    .poll(() => app.windows().some((page) => page.url().includes("computer.html")))
    .toBe(true)
  const computer = app.windows().find((page) => page.url().includes("computer.html"))!
  const version = await app.evaluate(({ app }) => app.getVersion())
  await expect(computer.locator("#version")).toHaveText(version)
  // A Mac hands what was fetched to macOS, which will have none of a file that is no app,
  // and says so. That it was found and fetched is what there is to see there.
  if (process.platform === "darwin") {
    await expect(computer.locator("#update-words")).toContainText("99.0.0", { timeout: 30_000 })
    return
  }
  await expect(computer.locator("#update-words")).toHaveText("99.0.0 is ready", {
    timeout: 30_000,
  })
  await expect(computer.getByRole("button", { name: "Restart to update" })).toBeVisible()
})

test("restarting puts the newer app where the old one was, and starts it", async () => {
  // Only on Linux is the newer app a file that anything at all can stand in for.
  test.skip(process.platform !== "linux", "The newer app is an installer, which this is not")
  const computer = app.windows().find((page) => page.url().includes("computer.html"))!
  const closed = app.waitForEvent("close")
  await computer.getByRole("button", { name: "Restart to update" }).click()
  await closed
  // The file is named for its version, so the newer one is beside where the old one was.
  const now = join(scratch, system.file)
  // It is started with what the old one was started with, once that one has gone.
  await expect
    .poll(() => (existsSync(started) ? readFileSync(started, "utf8") : ""))
    .toMatch(new RegExp(`^${now} .*--no-sandbox --disable-gpu$`, "m"))
  expect(existsSync(appImage)).toBe(false)
  expect(readFileSync(now, "utf8")).toBe(newer.toString())
  // What starts the app at sign-in names the file that is there now.
  const autostart = readFileSync(join(home, ".config", "autostart", "do-computer.desktop"), "utf8")
  expect(autostart).toContain(`Exec="${now}" --hidden`)
})
