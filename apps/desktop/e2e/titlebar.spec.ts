import { type ChildProcess, spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer as createService, type Server } from "node:http"
import { type AddressInfo, createServer } from "node:net"
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

/**
 * The deployment's window with no title bar, as it is on a Mac. Whether the window has one is
 * the desktop's to draw and is not looked at here: what is, is that the page is told, makes
 * room and says what the window is dragged by, and that a deployment which does none of that
 * is shown in a window that keeps its title bar.
 */
const serverEntry = fileURLToPath(new URL("../../web/server.node.mjs", import.meta.url))
const appEntry = fileURLToPath(new URL("../dist/main.cjs", import.meta.url))
const packed = process.env.DC_DESKTOP_APP

const scratch = mkdtempSync(join(tmpdir(), "dc-titlebar-"))
let server: ChildProcess
let url: string
let old: Server
let app: ElectronApplication | undefined

async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve))
  const { port } = probe.address() as AddressInfo
  await new Promise((resolve) => probe.close(resolve))
  return port
}

/** The app, set to this deployment already, with a folder of its own. */
async function launch(name: string, to: string) {
  const data = join(scratch, name)
  mkdirSync(data, { recursive: true })
  writeFileSync(join(data, "settings.json"), JSON.stringify({ server: to, welcomed: true }))
  app = await electron.launch({
    ...(packed ? { executablePath: packed } : {}),
    args: [...(packed ? [] : [appEntry]), "--no-sandbox", "--disable-gpu"],
    env: {
      ...process.env,
      HOME: join(scratch, "home"),
      USERPROFILE: join(scratch, "home"),
      DC_DESKTOP_DATA: data,
      DC_DESKTOP_SERVER: "",
      DC_DESKTOP_TITLE_BAR: "inset",
    },
  })
  return { app, settings: () => JSON.parse(readFileSync(join(data, "settings.json"), "utf8")) }
}

/** The app's window on this deployment, whichever window that is by now. */
async function windowAt(to: string, is: (page: Page) => Promise<boolean>): Promise<Page> {
  let found: Page | undefined
  await expect
    .poll(
      async () => {
        for (const page of app!.windows()) {
          if (page.url().startsWith(to) && (await is(page).catch(() => false))) found = page
        }
        return found !== undefined
      },
      { timeout: 30_000 },
    )
    .toBe(true)
  return found!
}

/**
 * A picture of the window for whoever asked for them, with `DC_SHOTS` a folder to put them in.
 * The three buttons are drawn where a Mac puts them, since no other desktop has them.
 */
async function shot(main: Page, name: string): Promise<void> {
  if (!process.env.DC_SHOTS) return
  const drawn = await main.addStyleTag({
    content:
      "html::after{content:'';position:fixed;z-index:2147483647;left:12px;top:20px;width:12px;height:12px;border-radius:50%;background:#ff5f57;box-shadow:20px 0 #febc2e,40px 0 #28c840}",
  })
  await main.screenshot({ path: join(process.env.DC_SHOTS, `${name}.png`) })
  await drawn.evaluate((style) => style.parentNode?.removeChild(style))
}

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
  // A Do Computer from before its pages knew of a window with no title bar.
  old = createService((request, response) => {
    if (request.url?.startsWith("/api/")) {
      response.setHeader("content-type", "application/json")
      return response.end("{}")
    }
    response.setHeader("content-type", "text/html")
    response.end(
      `<!doctype html><html><head><meta name="application-name" content="Do Computer"><title>Do Computer</title></head><body><button>Old</button></body></html>`,
    )
  })
  await new Promise<void>((resolve) => old.listen(0, "127.0.0.1", resolve))
})

test.afterEach(async () => {
  await app?.close().catch(() => {})
  app = undefined
})

test.afterAll(async () => {
  server?.kill()
  old?.close()
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5 })
})

test("with no title bar the page makes room for the window's buttons and is what it is dragged by", async () => {
  const { settings } = await launch("new", url)
  const main = await windowAt(url, async (page) => (await page.title()) !== "")
  expect(await main.evaluate(() => window.doComputer?.titleBar)).toBe("inset")
  await expect(main.locator("html")).toHaveAttribute("data-title-bar", "inset")
  await shot(main, "signed-out")

  expect(
    (
      await main.request.post(`${url}/api/auth/sign-up/email`, {
        data: { name: "Sawyer", email: "owner@example.com", password: "correct horse battery" },
      })
    ).status(),
  ).toBe(200)
  expect((await main.request.post(`${url}/api/agents`)).status()).toBe(201)
  await main.goto(url)
  await main.waitForURL(/\/a\/[^/]+\/c\/\d+/)

  // As a column of faces the sidebar is wide enough for the three buttons, with room above
  // the faces for them.
  // Its edge opens it and shuts it.
  const edge = main.getByRole("separator", { name: "Resize the sidebar" })
  const top = async () => (await main.locator("aside a").first().boundingBox())!.y
  await edge.focus()
  if ((await edge.getAttribute("aria-valuenow")) !== "60") await edge.press("Home")
  if (process.env.DC_SHOTS) {
    for (const name of ["Bakery", "Atlas"]) {
      const made = await main.request.post(`${url}/api/workspaces`, { data: { name } })
      const id = ((await made.json()) as { workspace: { id: string } }).workspace.id
      await main.request.post(`${url}/api/agents`, { data: { workspaceId: id } })
    }
    await main.request.post(`${url}/api/agents`)
    await main.reload()
    await shot(main, "workspaces")
  }
  const column = main.locator("aside").first()
  await expect.poll(async () => (await column.boundingBox())?.width).toBe(80)
  expect(await top()).toBeGreaterThanOrEqual(40)
  // The page under its name is where it was: nothing is pushed down by a bar of the page's own.
  expect((await main.locator("main > header").boundingBox())!.y).toBe(0)

  // The window is dragged by the top of the page and by the bar the Dood's name is in, and
  // what can be pressed there is still pressed.
  const region = (selector: string) =>
    main
      .locator(selector)
      .first()
      .evaluate(
        (element) =>
          getComputedStyle(element).getPropertyValue("-webkit-app-region") ||
          (getComputedStyle(element) as unknown as Record<string, string>).webkitAppRegion,
      )
  expect(await region("body > [data-title-drag]")).toBe("drag")
  expect(await region("main > header")).toBe("drag")
  expect(await region("main > header button")).toBe("no-drag")
  await shot(main, "faces")

  // The chat runs under the Dood's name, to the top of the window.
  expect((await main.locator("main .overflow-y-auto").first().boundingBox())!.y).toBe(0)
  if (process.env.DC_SHOTS) {
    const box = main.getByRole("textbox", { name: "Message" })
    for (let said = 1; said <= 9; said++) {
      await box.fill(
        `Message ${said}: what is said goes under the name as it is scrolled, and is read around it.`,
      )
      await box.press("Enter")
      await main.waitForTimeout(300)
    }
    await main.waitForTimeout(1500)
    await shot(main, "chat-end")
    await main
      .locator("main .overflow-y-auto")
      .first()
      .evaluate((el) => el.scrollTo(0, 150))
    await main.waitForTimeout(500)
    await shot(main, "chat-middle")
    await main
      .locator("main .overflow-y-auto")
      .first()
      .evaluate((el) => el.scrollTo(0, 0))
    await main.waitForTimeout(500)
    await shot(main, "chat-top")
  }

  await edge.press("ArrowRight")
  await expect(edge).not.toHaveAttribute("aria-valuenow", "60")
  expect(await top()).toBeGreaterThanOrEqual(40)
  await shot(main, "open")

  // Where the sidebar is out of sight, the bar starts past the window's buttons.
  await app!.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.setSize(420, 700)
  })
  await expect.poll(async () => (await main.locator("main").boundingBox())?.x).toBe(0)
  const doods = main.locator("main > header button").first()
  await expect.poll(async () => (await doods.boundingBox())?.x ?? 0).toBeGreaterThanOrEqual(76)
  await shot(main, "narrow")

  expect(settings().titleBarFor).toBeUndefined()
})

test("a deployment whose pages make no room is shown in a window that keeps its title bar", async () => {
  const at = `http://127.0.0.1:${(old.address() as AddressInfo).port}`
  const { settings } = await launch("old", at)
  // The window it was first shown in is made again, with a title bar, and the page is told so.
  const main = await windowAt(at, (page) =>
    page.evaluate(
      () => window.doComputer !== undefined && window.doComputer.titleBar === undefined,
    ),
  )
  await expect(main.getByRole("button", { name: "Old" })).toBeVisible()
  expect(settings().titleBarFor).toBe(at)
  expect(app!.windows().filter((page) => page.url().startsWith(at))).toHaveLength(1)
})

declare global {
  interface Window {
    doComputer?: { titleBar?: "inset" }
  }
}
