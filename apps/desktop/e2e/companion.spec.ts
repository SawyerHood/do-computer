import { type ChildProcess, spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  _electron as electron,
  type ElectronApplication,
  expect,
  type Page,
  test,
} from "@playwright/test"

const serverEntry = fileURLToPath(new URL("../../web/server.node.mjs", import.meta.url))
const appEntry = fileURLToPath(new URL("../dist/main.cjs", import.meta.url))
const packed = process.env.DC_DESKTOP_APP
const scratch = mkdtempSync(join(tmpdir(), "dc-desktop-companion-"))
const data = join(scratch, "app")
const PET = "/desktop/pet"

let server: ChildProcess
let url: string
let app: ElectronApplication

async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve))
  const { port } = probe.address() as { port: number }
  await new Promise((resolve) => probe.close(resolve))
  return port
}

async function windowAt(part: string): Promise<Page> {
  const matches = (page: Page) => page.url().includes(part)
  await expect.poll(() => app.windows().some(matches), { timeout: 20_000 }).toBe(true)
  return app.windows().find(matches)!
}

/** The creature in the companion's window, once it is there. A slow machine takes a while over a page's first load. */
async function creatureIn(pet: Page) {
  const creature = pet.getByRole("img", { name: "Agent avatar" })
  await expect(creature).toBeVisible({ timeout: 30_000 })
  return creature
}

const settings = () =>
  JSON.parse(readFileSync(join(data, "settings.json"), "utf8")) as {
    companion?: boolean
    companionAt?: { x: number; y: number }
  }

/** The companion's window as the system has it, or nothing where there is none. */
const companionWindow = () =>
  app.evaluate(({ BrowserWindow, screen }, path) => {
    const window = BrowserWindow.getAllWindows().find((entry) =>
      entry.webContents.getURL().includes(path),
    )
    if (window === undefined) return null
    return {
      visible: window.isVisible(),
      onTop: window.isAlwaysOnTop(),
      focusable: window.isFocusable(),
      bounds: window.getBounds(),
      workArea: screen.getPrimaryDisplay().workArea,
    }
  }, PET)

/** Put the pointer somewhere on the screen, as far as the app can tell. */
const pointAt = (at: { x: number; y: number }) =>
  app.evaluate(({ screen }, point) => {
    screen.getCursorScreenPoint = () => point
  }, at)

/** Open the app's window about this computer, as its menu does. */
async function openComputer(): Promise<Page> {
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
  return windowAt("computer.html")
}

/** What the app has printed, for when it goes wrong on a machine nobody is at. */
const printed: string[] = []

async function launch(): Promise<ElectronApplication> {
  const launched = await start()
  const process = launched.process()
  process.stderr?.on("data", (chunk) => printed.push(String(chunk)))
  process.on("exit", (code, signal) => printed.push(`The app ended: ${code} ${signal}\n`))
  // Every window's coming and going is written down where the test can read it.
  await launched.evaluate(({ app, BrowserWindow }) => {
    const seen: string[] = []
    ;(globalThis as { seen?: string[] }).seen = seen
    const note = (what: string) => seen.push(`${Date.now() % 1_000_000} ${what}`)
    const follow = (window: Electron.BrowserWindow) => {
      const name = () => `window ${window.id}`
      note(`${name()} made`)
      window.on("show", () => note(`${name()} shown`))
      window.on("hide", () => note(`${name()} hidden`))
      window.on("closed", () => note(`${name()} closed`))
      window.webContents.on("did-start-navigation", (_event, address, _inPlace, isMainFrame) => {
        if (isMainFrame) note(`${name()} goes to ${address}`)
      })
      window.webContents.on("did-fail-load", (_event, code, text, address) =>
        note(`${name()} could not load ${address}: ${code} ${text}`),
      )
      window.webContents.on("render-process-gone", (_event, details) =>
        note(`${name()} lost its process: ${details.reason} ${details.exitCode}`),
      )
    }
    for (const window of BrowserWindow.getAllWindows()) follow(window)
    app.on("browser-window-created", (_event, window) => follow(window))
    app.on("child-process-gone", (_event, details) =>
      note(`a ${details.type} process went: ${details.reason} ${details.exitCode}`),
    )
  })
  return launched
}

/** Quit the app, and wait until it has gone: a second one started meanwhile would give way to it. */
async function quit(): Promise<void> {
  const ended = new Promise((resolve) => app.process().once("exit", resolve))
  await app.evaluate(({ app }) => app.quit()).catch(() => {})
  await ended
}

const start = () =>
  electron.launch({
    ...(packed ? { executablePath: packed } : {}),
    // The creature is drawn in 3D. A Mac has a graphics card to do it with; elsewhere it is
    // done in software, so that a machine with no graphics card can run this too.
    args: [
      ...(packed ? [] : [appEntry]),
      "--no-sandbox",
      ...(process.platform === "darwin"
        ? []
        : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]),
    ],
    env: {
      ...process.env,
      HOME: join(scratch, "home"),
      USERPROFILE: join(scratch, "home"),
      DC_DESKTOP_DATA: data,
      ELECTRON_ENABLE_LOGGING: "1",
    },
  })

test.beforeAll(async () => {
  url = `http://127.0.0.1:${await freePort()}`
  server = spawn(process.execPath, [serverEntry], {
    stdio: "ignore",
    env: {
      ...process.env,
      PORT: new URL(url).port,
      DC_BASE_URL: url,
      DC_DATA_DIR: join(scratch, "server"),
      OPENROUTER_API_KEY: "",
    },
  })
  await expect
    .poll(
      () =>
        fetch(`${url}/api/health`).then(
          (response) => response.ok,
          () => false,
        ),
      { timeout: 30_000 },
    )
    .toBe(true)
  // An app whose first run is over, and whose owner has not asked for a companion.
  mkdirSync(data, { recursive: true })
  writeFileSync(
    join(data, "settings.json"),
    JSON.stringify({ server: url, share: false, openAtLogin: false, welcomed: true }),
  )
  app = await launch()
})

test.afterAll(async () => {
  await app?.close().catch(() => {})
  server?.kill()
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5 })
})

test.describe.configure({ mode: "serial" })

// A test that fails on a machine nobody is at says what the app was doing.
test.afterEach(async ({}, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return
  const seen = await app
    .evaluate(({ BrowserWindow }) => ({
      seen: (globalThis as { seen?: string[] }).seen,
      windows: BrowserWindow.getAllWindows().map((window) => ({
        id: window.id,
        at: window.webContents.getURL(),
        visible: window.isVisible(),
      })),
    }))
    .catch(String)
  console.log("What the app's windows did:", JSON.stringify(seen, null, 1))
  console.log("What it keeps:", JSON.stringify(settings()))
  console.log("What it printed:", printed.join("").slice(-6_000))
})

test("there is no companion until its owner asks for one", async () => {
  const main = await windowAt(url)
  // Its owner signs in, and has an agent.
  const made = await main.evaluate(async () => {
    const signedUp = await fetch("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Sawyer",
        email: "owner@example.com",
        password: "correct horse battery",
      }),
    })
    const agent = await fetch("/api/agents", { method: "POST" })
    return [signedUp.status, agent.status]
  })
  expect(made).toEqual([200, 201])
  await main.goto(url)
  await main.waitForURL(/\/a\/[^/]+\/c\/\d+/)
  expect(await companionWindow()).toBeNull()
})

test("switched on, the agent's creature is on the desktop, over the other windows", async () => {
  const computer = await openComputer()
  const companion = computer.getByLabel("Keep my agent on the desktop")
  await expect(companion).not.toBeChecked()
  await companion.check()

  const pet = await windowAt(PET)
  await creatureIn(pet)
  // The agent it shows is the one the app was left on.
  const main = await windowAt(`${url}/a/`)
  const agentId = /\/a\/([^/]+)/.exec(main.url())![1]!
  await expect(pet.locator("[data-pet]")).toHaveAttribute("data-pet", agentId)
  // It has nothing to say while the agent has nothing to do.
  await expect(pet.locator("[data-saying]")).toHaveCount(0)

  await expect.poll(async () => (await companionWindow())?.visible).toBe(true)
  const window = (await companionWindow())!
  expect(window.onTop).toBe(true)
  // It is never the window being typed into.
  expect(window.focusable).toBe(false)
  // In the bottom right of the screen, a little way in from its corner. A screen that is
  // scaled may put it a point to either side.
  const { bounds, workArea } = window
  expect(Math.abs(bounds.x + bounds.width - (workArea.x + workArea.width - 24))).toBeLessThan(3)
  expect(Math.abs(bounds.y + bounds.height - (workArea.y + workArea.height - 24))).toBeLessThan(3)
  expect(settings().companion).toBe(true)
})

test("it says how what the agent was doing went, and clicking that opens the chat", async () => {
  const main = await windowAt(`${url}/a/`)
  const pet = await windowAt(PET)
  await main.getByRole("textbox", { name: "Message" }).fill("Are you there?")
  await main.keyboard.press("Enter")
  const saying = pet.locator("[data-saying]")
  await expect(saying).toHaveAttribute("data-saying", "done", { timeout: 30_000 })
  await expect(saying.getByRole("status")).toHaveText("Done")
  // What it says is the start of the agent's answer.
  await expect(saying).toContainText("You said: Are you there?")

  // Typed to in the app's window, the creature on the desktop leans in to listen.
  const creature = pet.getByRole("img", { name: "Agent avatar" })
  await expect(creature).not.toHaveAttribute("data-mood", "egg")
  await main
    .getByRole("textbox", { name: "Message" })
    .pressSequentially("/fail 429 rate limit exceeded")
  await expect(creature).toHaveAttribute("data-mood", "listening")
  // A reply that fails is said too.
  await main.keyboard.press("Enter")
  await expect(saying).toHaveAttribute("data-saying", "error", { timeout: 30_000 })
  await expect(saying).toContainText("Too many requests to the model.")

  // The app's window is closed, which hides it. What the companion says brings it back.
  await app.evaluate(({ BrowserWindow }, path) => {
    for (const window of BrowserWindow.getAllWindows()) {
      const at = window.webContents.getURL()
      if (at.startsWith("http") && !at.includes(path)) window.close()
    }
  }, PET)
  const shown = () =>
    app.evaluate(
      ({ BrowserWindow }, path) =>
        BrowserWindow.getAllWindows()
          .filter((window) => {
            const at = window.webContents.getURL()
            return at.startsWith("http") && !at.includes(path)
          })
          .map((window) => window.isVisible()),
      PET,
    )
  await expect.poll(shown).toEqual([false])
  await saying.click()
  await expect.poll(shown).toEqual([true])
  await expect(saying).toHaveCount(0)
})

test("carried to another corner, it stays there and says what it says on the other side", async () => {
  const pet = await windowAt(PET)
  await expect(pet.locator("[data-pet]")).toHaveAttribute("data-place", "bottom right")
  const { bounds, workArea } = (await companionWindow())!
  // Picked up by the middle of the creature, and carried to the top left of the screen.
  const held = { x: bounds.x + bounds.width - 100, y: bounds.y + bounds.height - 100 }
  await pointAt(held)
  await pet.evaluate(() =>
    (window as unknown as { doComputerPet: { drag(on: boolean): void } }).doComputerPet.drag(true),
  )
  await pointAt({ x: workArea.x + 10, y: workArea.y + 10 })
  await expect.poll(async () => (await companionWindow())!.bounds.x).toBeLessThan(workArea.x)
  await pet.evaluate(() =>
    (window as unknown as { doComputerPet: { drag(on: boolean): void } }).doComputerPet.drag(false),
  )
  // Put down, it is wholly on the screen, with room for what it says below it and to its right.
  const corner = async () => {
    const { bounds } = (await companionWindow())!
    return Math.abs(bounds.x - workArea.x) + Math.abs(bounds.y - workArea.y)
  }
  await expect.poll(corner).toBeLessThan(3)
  await expect(pet.locator("[data-pet]")).toHaveAttribute("data-place", "top left")
  expect(settings().companionAt).toEqual({ x: workArea.x, y: workArea.y })
})

test("it is where it was left when the app is started again, and goes when switched off", async () => {
  // Who is signed in is written down now and then. An app quit this soon after may not have.
  await app.evaluate(({ session }) => session.defaultSession.cookies.flushStore())
  await quit()
  app = await launch()
  const pet = await windowAt(PET)
  await creatureIn(pet)
  await expect(pet.locator("[data-pet]")).toHaveAttribute("data-place", "top left")
  await expect.poll(async () => (await companionWindow())?.visible).toBe(true)
  const { bounds, workArea } = (await companionWindow())!
  expect(Math.abs(bounds.x - workArea.x) + Math.abs(bounds.y - workArea.y)).toBeLessThan(3)

  const computer = await openComputer()
  const companion = computer.getByLabel("Keep my agent on the desktop")
  await expect(companion).toBeChecked()
  await companion.uncheck()
  await expect.poll(companionWindow).toBeNull()
  expect(settings().companion).toBe(false)
})
