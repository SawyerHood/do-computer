/**
 * Takes the pictures that `docs/apps.md` shows, from the built app. `README.md` says how to run
 * it, and why it starts the app twice.
 */
import { spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { startStandIn } from "./standin.mjs"

const root = fileURLToPath(new URL("../..", import.meta.url))
const web = join(root, "apps/web")
const { chromium } = createRequire(join(web, "package.json"))("@playwright/test")
const out = resolve(process.argv[2] ?? join(root, "docs/images"))
mkdirSync(out, { recursive: true })

if (!process.env.OPENROUTER_API_KEY) {
  throw new Error("Set OPENROUTER_API_KEY: the pictures of a chat need an agent that answers.")
}

const account = { name: "Sam", email: "sam@example.com", password: "correct horse battery" }
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** The built server on a data directory of its own, with Apps where it is told. */
async function serve(port, appsUrl) {
  const url = `http://127.0.0.1:${port}`
  const data = mkdtempSync(join(tmpdir(), "dc-guide-pictures-"))
  const child = spawn("node", ["server.node.mjs"], {
    cwd: web,
    stdio: ["ignore", "ignore", "inherit"],
    env: {
      ...process.env,
      PORT: String(port),
      DC_BASE_URL: url,
      DC_DATA_DIR: data,
      DC_ALLOW_PRIVATE_HOSTS: "1",
      ...(appsUrl === undefined ? {} : { DC_APPS_URL: appsUrl }),
    },
  })
  const stop = () => {
    child.kill("SIGKILL")
    rmSync(data, { recursive: true, force: true })
  }
  process.once("exit", stop)
  for (let tries = 0; ; tries++) {
    const up = await fetch(`${url}/api/health`).then(
      (response) => response.ok,
      () => false,
    )
    if (up) return { url, stop }
    if (tries > 200) throw new Error(`The server did not come up at ${url}. Is it built?`)
    await pause(100)
  }
}

/** A window on the app, signed in, with an agent called Pip that is out of its egg. */
async function signedIn(browser, base) {
  const context = await browser.newContext({
    baseURL: base,
    viewport: { width: 1280, height: 860 },
    deviceScaleFactor: 2,
    colorScheme: "light",
  })
  const page = await context.newPage()
  await page.request.post("/api/auth/sign-up/email", { data: account })
  const made = await (await page.request.post("/api/agents")).json()
  await page.request.patch(`/api/agents/${made.agent.id}`, { data: { name: "Pip", hatched: true } })
  await page.goto("/")
  await page.waitForURL(/\/a\/[^/]+\/c\/\d+/)
  return page
}

/** The agent's settings, on Connectors. */
async function connectors(page) {
  await page.getByRole("button", { name: /'s settings$/ }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: "Connectors", exact: true }).click()
  await dialog.getByRole("heading", { name: "Connectors", exact: true }).waitFor()
  await pause(1000)
  return dialog
}

/** The top of the settings window, down to under its second card. */
async function top(page, dialog, name) {
  const box = await dialog.boundingBox()
  await page.screenshot({
    path: join(out, name),
    clip: { x: box.x, y: box.y, width: box.width, height: 524 },
  })
}

async function say(page, text) {
  const composer = page.getByRole("textbox", { name: "Message" })
  await composer.fill(text)
  await composer.press("Enter")
}

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
})

// The app as it is, where Apps is Composio's own server: the card that offers it, the agent
// adding it when asked, and the page at Composio that Sign in leads to.
{
  const server = await serve(3251)
  const page = await signedIn(browser, server.url)
  const dialog = await connectors(page)
  await page.getByRole("button", { name: "Connect apps" }).waitFor()
  await top(page, dialog, "apps-connect.png")
  await page.keyboard.press("Escape")

  await say(page, "Connect my apps.")
  await page
    .getByRole("list", { name: "Waiting for your OK" })
    .getByRole("button", { name: "Allow once" })
    .click({ timeout: 90_000 })
  const signIn = page.getByRole("button", { name: "Sign in", exact: true })
  await signIn.waitFor({ timeout: 90_000 })
  // The agent finishes what it is saying.
  await pause(9000)
  await page.screenshot({ path: join(out, "apps-ask-agent.png") })

  await signIn.click()
  await page.waitForURL((url) => url.hostname !== "127.0.0.1", { timeout: 30_000 })
  await page.waitForLoadState("networkidle").catch(() => {})
  await pause(3000)
  await page.screenshot({
    path: join(out, "apps-composio.png"),
    clip: { x: 240, y: 40, width: 800, height: 620 },
  })
  await page.context().close()
  server.stop()
}

// The app with a stand-in for Composio, which can be signed in to: the card once it is
// connected, and the agent asking before it sends an email.
{
  const standIn = await startStandIn(3253)
  const server = await serve(3252, `${standIn.origin}/oauth/mcp`)
  const page = await signedIn(browser, server.url)
  await connectors(page)
  await page.getByRole("button", { name: "Connect apps" }).click()
  await page.getByRole("link", { name: "Allow" }).click()
  await page.getByRole("status").filter({ hasText: "Apps is connected." }).waitFor()
  // Opened again, the page is as it is on any later day, without word of what just happened.
  await page.goto("/")
  await page.waitForURL(/\/a\/[^/]+\/c\/\d+/)
  const dialog = await connectors(page)
  await top(page, dialog, "apps-connected.png")
  await page.keyboard.press("Escape")

  await say(page, "Email dana@example.com to say I'm running ten minutes late for our 3 o'clock.")
  await page.getByRole("list", { name: "Waiting for your OK" }).waitFor({ timeout: 90_000 })
  await pause(4000)
  await page.screenshot({ path: join(out, "apps-ask.png") })
  await page.context().close()
  server.stop()
  await standIn.close()
}

await browser.close()
console.log(`The pictures are in ${out}`)
