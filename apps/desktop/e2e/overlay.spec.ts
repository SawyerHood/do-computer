import { mkdtempSync, rmSync } from "node:fs"
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
import { build } from "esbuild"

// The overlay as it really is: Electron's window and the built page, driven as the app drives
// it. Build the app first (`pnpm build`), as for desktop.spec.ts. What is checked is what the
// page shows and when the window is there. Whether the window is see-through, lets clicks
// through and stays out of pictures is the system's doing, and is not checked here.

const dist = fileURLToPath(new URL("../dist", import.meta.url))
const scratch = mkdtempSync(join(tmpdir(), "dc-overlay-"))
/** Where to leave pictures of the page, for someone to look at. */
const shots = process.env.DC_OVERLAY_SHOTS

test.describe.configure({ mode: "serial" })

let app: ElectronApplication
let page: Page

const pip = { id: "a1", name: "Pip", color: "#5f8a4e" }

/** Whether the overlay's window is on the screen. */
const visible = () =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)

/** Where the tip of the agent's pointer is on the page. */
const pointerAt = () =>
  page.evaluate(() => {
    const m = new DOMMatrix(getComputedStyle(document.getElementById("pointer")!).transform)
    return { x: Math.round(m.e), y: Math.round(m.f) }
  })

/**
 * Linux hides the bar's buttons, and hides them again whenever the page is told something new.
 * They are shown here so that what they do can be checked, and so that the pictures are of the
 * bar as macOS and Windows have it.
 */
const showButtons = () =>
  page.evaluate(() => document.documentElement.classList.remove("no-buttons"))

async function press(id: "hold" | "stop"): Promise<void> {
  await showButtons()
  await page.locator(`#${id}`).click()
}

test.beforeAll(async () => {
  const harness = join(scratch, "harness.cjs")
  await build({
    entryPoints: [fileURLToPath(new URL("./overlay-harness.ts", import.meta.url))],
    outfile: harness,
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
    logLevel: "warning",
  })
  app = await electron.launch({
    args: [harness, "--no-sandbox", "--disable-gpu"],
    env: { ...process.env, DC_OVERLAY_DIST: dist },
  })
  await expect.poll(() => app.evaluate(() => globalThis.harness !== undefined)).toBe(true)
})

test.afterAll(async () => {
  await app?.close()
  rmSync(scratch, { recursive: true, force: true })
})

test("there is no window until an agent uses the screen", async () => {
  expect(app.windows()).toHaveLength(0)
})

test("it says who is using the computer, and shows no pointer yet", async () => {
  const opened = app.waitForEvent("window")
  await app.evaluate(
    (_electron, agent) => globalThis.harness!.state.enter(agent, "Opening the launch budget"),
    pip,
  )
  page = await opened
  await expect(page.locator("#title")).toHaveText("Pip is using this computer")
  await expect(page.locator("#detail")).toHaveText("Opening the launch budget")
  await expect(page.locator("#esc")).toBeVisible()
  await expect(page.locator("#pointer")).toBeHidden()
  expect(await visible()).toBe(true)
  // The window is never the one being typed into.
  expect(
    await app.evaluate(({ BrowserWindow }) => {
      const [window] = BrowserWindow.getAllWindows()
      return { focused: window!.isFocused(), focusable: window!.isFocusable() }
    }),
  ).toEqual({ focused: false, focusable: false })
  // The page keeps to the rules of the app's other pages: nothing was refused by them.
  expect(
    await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--c")),
  ).toBe(pip.color)
})

test("on Linux the bar has no buttons, since it cannot be clicked there", async () => {
  test.skip(process.platform !== "linux", "The bar is clicked on macOS and Windows.")
  await expect(page.locator("#hold")).toBeHidden()
  await expect(page.locator("#stop")).toBeHidden()
})

test("the agent's pointer turns up where it is put, then glides to the next place and ripples", async () => {
  await app.evaluate(() => globalThis.harness!.overlay.point({ x: 420, y: 300 }, false))
  await expect(page.locator("#pointer")).toBeVisible()
  await expect(page.locator("#tag")).toHaveText("Pip")
  // The first place is simply where it is: it does not come from the corner.
  expect(await pointerAt()).toEqual({ x: 420, y: 300 })

  await app.evaluate(() => globalThis.harness!.overlay.point({ x: 700, y: 380 }, true))
  await expect(page.locator("#pointer")).toHaveClass(/click/)
  // Part of the way there a moment later, and there in the end.
  const onTheWay = await pointerAt()
  expect(onTheWay.x).toBeLessThan(700)
  await expect.poll(pointerAt).toEqual({ x: 700, y: 380 })
  if (shots) {
    await showButtons()
    await page.screenshot({ path: join(shots, "overlay-working.png") })
  }
})

test("Pause on the bar pauses the agent, and the bar and the pointer say so", async () => {
  await showButtons()
  await expect(page.locator("#hold")).toHaveText("Pause")
  await press("hold")
  await expect(page.locator("#title")).toHaveText("Pip is paused")
  expect(await app.evaluate(() => globalThis.harness!.state.held)).toBe(true)
  await showButtons()
  await expect(page.locator("#detail")).toHaveText("It carries on when you say.")
  await expect(page.locator("#hold")).toHaveText("Carry on")
  await expect(page.locator("#esc")).toBeHidden()
  await expect(page.locator("#tag")).toHaveText("Pip · waiting")
  await expect(page.locator("html")).toHaveClass(/held/)
  await expect(page.locator("#pointer")).toHaveCSS("opacity", "0.55")
  if (shots) await page.screenshot({ path: join(shots, "overlay-paused.png") })
})

test("it stays while paused, and Carry on lets an agent that was waiting carry on", async () => {
  // The agent goes to do the next thing and is made to wait, as it is while paused.
  await app.evaluate((_electron, agent) => {
    void globalThis.harness!.state.enter(agent, "Typing the total")
    // Longer than the screen counts as in use after the last thing done there.
    globalThis.harness!.later += 2 * 60_000
  }, pip)
  await page.waitForTimeout(1_500)
  expect(await visible()).toBe(true)
  await expect(page.locator("#title")).toHaveText("Pip is paused")
  await press("hold")
  await expect(page.locator("#title")).toHaveText("Pip is using this computer")
  await expect(page.locator("#detail")).toHaveText("Typing the total")
  await expect(page.locator("#esc")).toBeVisible()
  expect(await visible()).toBe(true)
  expect(await app.evaluate(() => globalThis.harness!.state.held)).toBe(false)
})

test("it goes a while after the last thing the agent did, and comes back with no pointer", async () => {
  await app.evaluate(() => globalThis.harness!.state.touch("Done"))
  await expect(page.locator("#detail")).toHaveText("Done")
  expect(await visible()).toBe(true)
  await app.evaluate(() => {
    globalThis.harness!.later += 10 * 60_000
  })
  await expect.poll(visible).toBe(false)

  await app.evaluate(
    (_electron, agent) => globalThis.harness!.state.enter(agent, "Back again"),
    pip,
  )
  await expect.poll(visible).toBe(true)
  await expect(page.locator("#detail")).toHaveText("Back again")
  await expect(page.locator("#pointer")).toBeHidden()
})

test("Stop on the bar stops the agent, and the window goes at once", async () => {
  await press("stop")
  await expect.poll(visible).toBe(false)
  expect(await app.evaluate(() => globalThis.harness!.state.stopped)).toBe(true)
})
