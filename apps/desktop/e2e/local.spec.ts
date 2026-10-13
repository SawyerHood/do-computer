import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createServer as createService } from "node:http"
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
 * The app with no server anywhere: it runs Do Computer itself, on this computer. Nothing else
 * is started for these tests, which is the point of them.
 */

const appEntry = fileURLToPath(new URL("../dist/main.cjs", import.meta.url))
/** The packed app to test, where there is one. Otherwise the build in dist/, run by Electron. */
const packed = process.env.DC_DESKTOP_APP
/** Where pictures of each step are kept, when they are asked for. */
const shots = process.env.DC_DESKTOP_SHOTS

const scratch = mkdtempSync(join(tmpdir(), "dc-desktop-local-"))
const home = join(scratch, "home")
const data = join(scratch, "app")
/** A stand-in for Tailscale: it says what it is told to, and writes down what it was asked. */
const tailscale = join(scratch, "tailscale")
const tailscaleStatus = join(scratch, "tailscale-status.json")
const tailscaleLog = join(scratch, "tailscale.log")
const TAILNET_NAME = "box.tail1234.ts.net"
/** Tailscale is a program, and the stand-in for it is a script a Unix system can run. */
const withTailscale = process.platform !== "win32"

let app: ElectronApplication

async function windowAt(part: string | RegExp): Promise<Page> {
  const matches = (page: Page) =>
    typeof part === "string" ? page.url().includes(part) : part.test(page.url())
  await expect.poll(() => app.windows().some(matches), { timeout: 30_000 }).toBe(true)
  return app.windows().find(matches)!
}

/** The card under the egg in the first run, once it has said this and can be answered. */
async function card(window: Page, says: string | RegExp) {
  const asked = window.locator("[data-card]")
  await expect(asked.getByRole("status")).toHaveText(says, { timeout: 30_000 })
  await expect(asked.locator("div[inert]")).toHaveCount(0)
  return asked
}

async function picture(window: Page, name: string): Promise<void> {
  if (shots === undefined) return
  mkdirSync(shots, { recursive: true })
  // A card opens under its words, and is drawn whole a moment after it can be answered.
  await window.waitForTimeout(500)
  await window.screenshot({ path: join(shots, `${name}.png`) })
}

const launch = () =>
  electron.launch({
    ...(packed ? { executablePath: packed } : {}),
    args: [...(packed ? [] : [appEntry]), "--no-sandbox", "--disable-gpu"],
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      DC_DESKTOP_DATA: data,
      DC_DAEMON_POLL_MS: "200",
      DC_DESKTOP_FAKE_SCREEN: "1",
      // An app that knows no deployment asks where Do Computer should run.
      DC_DESKTOP_SERVER: "",
      DC_DESKTOP_TAILSCALE: withTailscale ? tailscale : "",
      DC_FAKE_TAILSCALE_STATUS: tailscaleStatus,
      DC_FAKE_TAILSCALE_LOG: tailscaleLog,
      // No model of anyone's: the one that says back what it was told.
      OPENROUTER_API_KEY: "",
    },
  })

/** Click an item of the app's File menu. */
async function fileMenu(label: string): Promise<void> {
  await expect
    .poll(() =>
      app.evaluate(({ Menu }, wanted) => {
        const file = Menu.getApplicationMenu()?.items.find((item) => item.label === "File")
        const item = file?.submenu?.items.find((item) => item.label === wanted)
        item?.click()
        return item !== undefined
      }, label),
    )
    .toBe(true)
}

/** What the stand-in for Tailscale was asked, a line each. */
const asked = () => (existsSync(tailscaleLog) ? readFileSync(tailscaleLog, "utf8") : "")

test.beforeAll(() => {
  mkdirSync(home, { recursive: true })
  writeFileSync(
    tailscaleStatus,
    JSON.stringify({
      BackendState: "Running",
      Self: { DNSName: `${TAILNET_NAME}.` },
      CertDomains: [TAILNET_NAME],
    }),
  )
  writeFileSync(
    tailscale,
    '#!/bin/sh\necho "$@" >> "$DC_FAKE_TAILSCALE_LOG"\nif [ "$1" = status ]; then cat "$DC_FAKE_TAILSCALE_STATUS"; fi\n',
  )
  chmodSync(tailscale, 0o755)
})

test.afterAll(async () => {
  await app?.close().catch(() => {})
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5 })
})

test.describe.configure({ mode: "serial" })

let server = ""

test("a first run offers to run Do Computer on this computer, and does", async () => {
  app = await launch()
  const welcome = await windowAt("welcome.html")
  const here = welcome.getByRole("radio", { name: "On this computer" })
  // With no deployment to suggest, this computer is what is offered first.
  await expect(here).toBeChecked()
  if (withTailscale) {
    // Tailscale is here, so reaching it from other devices is offered, and is not assumed.
    const reach = welcome.getByLabel("Reach it from my other devices with Tailscale")
    await expect(reach).toBeVisible()
    await expect(reach).not.toBeChecked()
    await expect(welcome.getByText(`As ${TAILNET_NAME}`)).toBeVisible()
  }
  await picture(welcome, "1-where-it-runs")
  await welcome.getByRole("button", { name: "Continue" }).click()

  // The window that takes its place shows the first run, served from this computer.
  const main = await windowAt(/^http:\/\/127\.0\.0\.1:\d+\/welcome$/)
  server = new URL(main.url()).origin
  await card(main, /Is somebody out there\?/)
  await picture(main, "2-first-run")
})

test("its owner says only what they are called, and has no account to make", async () => {
  const main = await windowAt(/\/welcome$/)
  await (
    await card(main, /Is somebody out there\?/)
  )
    .getByRole("button", { name: "Hello!" })
    .click()
  const you = await card(main, /who are you\?/)
  await expect(you.getByLabel("Email")).toHaveCount(0)
  await expect(you.getByLabel("Password")).toHaveCount(0)
  await expect(you.getByText("Everything stays on this computer.")).toBeVisible()
  await you.getByLabel("Your name").fill("Sawyer")
  await picture(main, "3-who-are-you")
  await you.getByRole("button", { name: "That’s me" }).click()

  const naming = await card(main, /Nice to meet you, Sawyer\./)
  await naming.getByLabel("A name for it").fill("Pip")
  await naming.getByRole("button", { name: "That’s your name" }).click()

  const thinking = await card(main, /What should I think with\?/)
  await picture(main, "4-think-with")
  await thinking.getByRole("button", { name: /^Use Echo/ }).click()

  const asking = await card(main, /may I work on this computer\?/)
  await asking.getByRole("button", { name: "Yes, work here" }).click()
  await expect(asking.getByText("is paired")).toBeVisible({ timeout: 30_000 })

  const out = await card(main, /This computer is ours to work on now\./)
  await out.getByRole("button", { name: "Start chatting with Pip" }).click()
  await main.waitForURL(/\/a\/[^/]+\/c\/\d+/)
  await expect(main.getByRole("heading", { name: "Hi Sawyer, I’m Pip." })).toBeVisible()
})

test("the Dood answers, and works on this computer, with nothing but the app running", async () => {
  const main = await windowAt(/\/a\/[^/]+\/c\/\d+/)
  await expect(main.locator("[data-welcome]")).toHaveCount(0)
  const computers = (await main.evaluate(async () => (await fetch("/api/computers")).json())) as {
    computers: { name: string; kind: string }[]
  }
  const name = computers.computers.find((computer) => computer.kind === "paired")?.name
  expect(name).toBeTruthy()
  await main
    .getByRole("textbox", { name: "Message" })
    .fill(`/tool bash {"command":"echo from the Dood > proof.txt","computer":"${name}"}`)
  await main.keyboard.press("Enter")
  await expect
    .poll(
      () => {
        // Its folder on this computer is under its owner's home.
        const found = findFile(home, "proof.txt")
        return found === undefined ? undefined : readFileSync(found, "utf8").trim()
      },
      { timeout: 30_000 },
    )
    .toBe("from the Dood")
  await picture(main, "5-chat")
})

/** A file of this name somewhere under a folder, if there is one. */
function findFile(dir: string, name: string): string | undefined {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isFile() && entry.name === name) return full
    if (entry.isDirectory() && entry.name !== "node_modules") {
      const found = findFile(full, name)
      if (found !== undefined) return found
    }
  }
  return undefined
}

test("a Dood made later is given this computer too", async () => {
  const main = await windowAt(/\/a\/[^/]+\/c\/\d+/)
  const { made, here } = await main.evaluate(async () => {
    const { agent } = (await (
      await fetch("/api/agents", { method: "POST", body: "{}" })
    ).json()) as {
      agent: { id: string }
    }
    const { computers } = (await (await fetch("/api/computers")).json()) as {
      computers: { kind: string; agentIds: string[] }[]
    }
    return { made: agent.id, here: computers.find((computer) => computer.kind === "paired") }
  })
  // Nobody connected it: the computer the app is on is where such a server's Doods work.
  expect(here?.agentIds).toContain(made)
})

test("it is served to its owner's other devices when they ask, and signs one in", async () => {
  test.skip(!withTailscale, "The stand-in for Tailscale is a script a Unix system can run.")
  await fileMenu("Other Devices…")
  const devices = await windowAt("devices.html")
  await expect(devices.getByRole("status").first()).toHaveText("Only this computer can reach it")
  await picture(devices, "6-other-devices-off")
  expect(asked()).not.toContain("serve")

  await devices.getByRole("switch", { name: /Reach it from your other devices/ }).click()
  await expect(devices.getByRole("status").first()).toHaveText("Your other devices can reach it", {
    timeout: 60_000,
  })
  const port = new URL(server).port
  const address = `https://${TAILNET_NAME}:${port}`
  await expect(devices.getByText(address, { exact: true })).toBeVisible()
  // Only its own port is asked for: whatever else Tailscale serves here is not its to touch.
  expect(asked()).toContain(`serve --bg --yes --https=${port} http://127.0.0.1:${port}`)
  expect(asked()).not.toContain("reset")

  // The window on this computer is still signed in, though the server now goes by another name.
  const main = await windowAt(/\/a\/[^/]+\/c\/\d+/)
  await expect(main.getByRole("textbox", { name: "Message" })).toBeVisible({ timeout: 30_000 })
  expect(await main.evaluate(async () => (await fetch("/api/me")).status)).toBe(200)

  // A code is on show, and the link it says signs a device in once.
  await expect(devices.locator("svg.qr path")).toHaveCount(1, { timeout: 20_000 })
  await expect(devices.getByText(/Works once, for the next 10 minutes\./)).toBeVisible()
  await picture(devices, "7-other-devices-on")
  await devices.getByRole("button", { name: "Copy the link" }).click()
  const link = await app.evaluate(({ clipboard }) => clipboard.readText())
  expect(link.startsWith(`${address}/local/sign-in#`)).toBe(true)
  const token = link.split("#")[1]!
  // Another device of theirs, which has never been here: a browser with nothing kept in it.
  // It reaches the server at this computer's own address, standing in for Tailscale's.
  await app.evaluate(({ BrowserWindow }, address) => {
    const phone = new BrowserWindow({
      width: 420,
      height: 780,
      webPreferences: { partition: "another-device" },
    })
    void phone.loadURL(address)
  }, `${server}/login`)
  const phone = await windowAt(/\/login$/)
  // The page that asks for a password says where its owner's way in is.
  await expect(phone.getByText("Is this your Do Computer?")).toBeVisible()
  await picture(phone, "8-a-device-before")
  await phone.goto(`${server}/local/sign-in#${token}`)
  await phone.waitForURL(/\/a\/[^/]+/, { timeout: 30_000 })
  await expect(phone.getByRole("textbox", { name: "Message" })).toBeVisible({ timeout: 30_000 })
  const me = (await phone.evaluate(async () => (await fetch("/api/me")).json())) as {
    user: { name: string }
  }
  expect(me.user.name).toBe("Sawyer")
  await picture(phone, "9-a-device-signed-in")
  // The link is spent: whoever finds it later is signed in to nothing.
  const again = await fetch(`${server}/api/auth/desktop/session`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: address },
    body: JSON.stringify({ token }),
  })
  expect(again.status).toBe(400)
  await phone.close()

  // The server now sends whoever it answers to its other address. This computer's window is
  // signed in at its own, and that is where it is shown the page: here, what follows a
  // connector's sign-in that the app brought back from its owner's browser.
  await app.evaluate(({ BrowserWindow }) => {
    const went: string[] = []
    ;(globalThis as { went?: string[] }).went = went
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.on("did-navigate", (_event, address) => went.push(address))
    }
  })
  const went = () => app.evaluate(() => (globalThis as { went?: string[] }).went ?? [])
  const answered = /^http:\/\/127\.0\.0\.1:\d+\/\?connector_error=/
  await main.evaluate(() => window.location.assign("/api/connectors/callback?state=none"))
  await expect.poll(went).toContainEqual(expect.stringMatching(answered))
  await expect(main.getByRole("textbox", { name: "Message" })).toBeVisible({ timeout: 30_000 })
  expect(app.windows().filter((page) => page.url().includes(TAILNET_NAME))).toEqual([])

  // A sign-in somewhere else, in its small window, comes back by that other address as well:
  // the service's answer is taken where the app is signed in, and the small window goes.
  const service = createService((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    response.end(`<a href="${address}/api/connectors/callback?state=none">Allow</a>`)
  })
  await new Promise<void>((resolve) => service.listen(0, "127.0.0.1", resolve))
  try {
    await app.evaluate(() => void ((globalThis as { went?: string[] }).went!.length = 0))
    const there = `http://127.0.0.1:${(service.address() as { port: number }).port}/authorize`
    await main.evaluate((there) => window.location.assign(there), there)
    const small = await windowAt("/authorize")
    await small.getByRole("link", { name: "Allow" }).click()
    await expect.poll(went).toContainEqual(expect.stringMatching(answered))
    await expect
      .poll(() => app.windows().filter((page) => page.url().includes("/authorize")))
      .toEqual([])
    expect(new URL(main.url()).origin).toBe(server)
    await expect(main.getByRole("textbox", { name: "Message" })).toBeVisible({ timeout: 30_000 })
  } finally {
    service.close()
  }

  // A link to the server by its other address opens in the app, signed in, and not in a browser.
  await main.evaluate((link) => void window.open(link), `${address}/docs`)
  const beside = await windowAt(`${server}/docs`)
  expect(await beside.evaluate(async () => (await fetch("/api/me")).status)).toBe(200)
  await beside.close()

  // Switched off, it is taken down again, and this computer's window goes on as before.
  await devices.getByRole("switch", { name: /Reach it from your other devices/ }).click()
  await expect(devices.getByRole("status").first()).toHaveText("Only this computer can reach it", {
    timeout: 60_000,
  })
  expect(asked()).toContain(`serve --yes --https=${port} off`)
  await expect(main.getByRole("textbox", { name: "Message" })).toBeVisible({ timeout: 30_000 })
  expect(await main.evaluate(async () => (await fetch("/api/me")).status)).toBe(200)
  await devices.close()
})

test("started again, it is all still there, and nobody is asked to sign in", async () => {
  await app.close()
  app = await launch()
  const main = await windowAt(new RegExp(`^${server.replaceAll(".", "\\.")}/`))
  await expect(main.getByRole("textbox", { name: "Message" })).toBeVisible({ timeout: 45_000 })
  expect(new URL(main.url()).pathname).not.toMatch(/^\/(login|welcome)/)
  const agents = (await main.evaluate(async () => (await fetch("/api/agents")).json())) as {
    agents: { name: string | null }[]
  }
  expect(agents.agents.map((agent) => agent.name)).toContain("Pip")
})

test("another server can be chosen instead, and this computer's is kept to come back to", async () => {
  await fileMenu("Change Server…")
  const welcome = await windowAt("welcome.html")
  await expect(welcome.getByRole("radio", { name: "On this computer" })).toBeChecked()
  // Writing an address is choosing a server somewhere else.
  await welcome.getByLabel("Server").fill("http://127.0.0.1:9")
  await expect(welcome.getByRole("radio", { name: "Somewhere else" })).toBeChecked()
  await expect(welcome.getByText(/What you have on this computer is kept/)).toBeVisible()
  await picture(welcome, "10-change-server")
  await welcome.getByRole("button", { name: "Continue" }).click()
  await expect(welcome.getByRole("alert")).toContainText("There is no Do Computer at", {
    timeout: 20_000,
  })
  // Nothing was left behind for an address that did not answer.
  expect((await fetch(`${server}/api/health`)).ok).toBe(true)
  await welcome.close()
})
