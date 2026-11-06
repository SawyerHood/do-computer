// The pictures a design council judges Do Computer by (scripts/council): the same views every
// time, with a written-out chat (`council-script.ts`), in the light and the dark theme and at a
// phone's width. It is not a test of anything and the suite does not run it. `pnpm build:node`
// first, then from apps/web:
//   PLAYWRIGHT_CHROMIUM_PATH=… pnpm exec playwright test --config e2e/council-shots.config.ts
// The pictures are written to `DC_COUNCIL_OUT` (default /tmp/do-computer-shots/council), which is
// emptied first. The server listens on `DC_COUNCIL_PORT` (default 47110).
import { type ChildProcess, spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, type Page, test } from "@playwright/test"
import { ASK_BOOK, ASK_DINNER, ASK_TRIP, OTHER_DOODS, REPLIES } from "./council-script.ts"

const OUT = process.env.DC_COUNCIL_OUT ?? "/tmp/do-computer-shots/council"
const PORT = Number(process.env.DC_COUNCIL_PORT ?? 47110)
const ORIGIN = `http://127.0.0.1:${PORT}`
const DESKTOP = { width: 1440, height: 900 }
const PHONE = { width: 390, height: 844 }
const ENTRY = fileURLToPath(new URL("../server.node.mjs", import.meta.url))
/** Each Dood's creature, the same every time: grown from a seed of its own, in a color of its own. */
const LOOKS: Record<string, { color: string; seed: string }> = {
  Juniper: { color: "moss", seed: "juniper-council" },
  Pico: { color: "honey", seed: "pico-council" },
  Maple: { color: "clay", seed: "maple-council" },
  Otto: { color: "tide", seed: "otto-council" },
}
const ACCOUNT = { name: "Sawyer", email: "owner@example.com", password: "correct horse battery" }

let server: ChildProcess | undefined
let data = ""

test.beforeAll(async () => {
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
  if (await fetch(`${ORIGIN}/api/health`).then((r) => r.ok, () => false)) {
    throw new Error(`Something is already listening on ${ORIGIN}: stop it, or set DC_COUNCIL_PORT.`)
  }
  data = mkdtempSync(join(tmpdir(), "dc-council-"))
  server = spawn("node", [ENTRY], {
    stdio: ["ignore", "ignore", "inherit"],
    env: {
      ...process.env,
      PORT: String(PORT),
      DC_BASE_URL: ORIGIN,
      DC_DATA_DIR: data,
      OPENROUTER_API_KEY: "",
      DC_CHROME_PATH: "none",
      DC_ECHO_REPLIES: JSON.stringify(REPLIES),
    },
  })
  const deadline = Date.now() + 30_000
  while (!(await fetch(`${ORIGIN}/api/health`).then((r) => r.ok, () => false))) {
    if (Date.now() > deadline) throw new Error("The server did not come up. Is it built?")
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
})
test.afterAll(async () => {
  server?.kill("SIGKILL")
  if (data !== "") rmSync(data, { recursive: true, force: true })
})

test.use({ baseURL: ORIGIN, viewport: DESKTOP, colorScheme: "light" })

const composer = (page: Page) => page.getByRole("textbox", { name: "Message" })
const stop = (page: Page) => page.getByRole("button", { name: "Stop", exact: true })

/** Both themes of whatever is in view, once the screen has rested. */
async function shoot(page: Page, name: string, settle = 900) {
  console.log(new Date().toISOString(), name)
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    // The app reads the system's theme as it opens; following it after is what this does.
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), scheme === "dark")
    await page.mouse.move(2, 450)
    await page.waitForTimeout(settle)
    await page.screenshot({ path: join(OUT, `${name}-${scheme}.png`) })
  }
  await page.emulateMedia({ colorScheme: "light" })
  await page.evaluate(() => document.documentElement.classList.remove("dark"))
}

/** Say this in the main chat and wait for the answer to be shown. */
async function say(page: Page, text: string, sees: string | RegExp) {
  await composer(page).fill(text)
  await page.keyboard.press("Enter")
  await expect(page.getByRole("log").getByText(sees).last()).toBeVisible({ timeout: 60_000 })
  await expect(stop(page)).toBeHidden({ timeout: 60_000 })
}

test("the council's pictures", async ({ page, browser }) => {
  test.setTimeout(600_000)
  await page.addInitScript(() => {
    if (localStorage.getItem("dc-chat-list") === null) localStorage.setItem("dc-chat-list", "open")
    if (localStorage.getItem("dc-agent-panel") === null) localStorage.setItem("dc-agent-panel", "closed")
  })
  expect((await page.request.post("/api/auth/sign-up/email", { data: ACCOUNT })).status()).toBe(200)
  // The other Doods first, so that Juniper, made last, is the one that opens.
  for (const name of OTHER_DOODS) {
    const made = await page.request.post("/api/agents")
    const { agent } = (await made.json()) as { agent: { id: string } }
    await page.request.patch(`/api/agents/${agent.id}`, { data: { name, avatar: LOOKS[name] } })
  }
  const made = await page.request.post("/api/agents")
  const { id } = ((await made.json()) as { agent: { id: string } }).agent
  await page.request.patch(`/api/agents/${id}`, { data: { name: "Juniper", avatar: LOOKS.Juniper } })
  await page.goto(`/a/${id}`)
  await expect(composer(page)).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(1_500)

  // 01: a Dood with nothing said yet.
  await shoot(page, "01-home")

  // 02: the chat, with work done in it.
  await say(page, ASK_TRIP, "Shall I hold it?")
  await say(page, ASK_BOOK, "drops below")
  await shoot(page, "02-chat")

  // 03: further up, the chart and the file it wrote.
  // By the wheel, as a person scrolls, until the chart is clear of the name above the chat.
  const chart = page.getByRole("figure").first()
  await page.mouse.move(720, 450)
  for (let i = 0; i < 30; i++) {
    const box = await chart.boundingBox()
    if (box !== null && box.y > 110 && box.y < 200) break
    await page.mouse.wheel(0, box !== null && box.y >= 200 ? 80 : -80)
    await page.waitForTimeout(120)
  }
  await shoot(page, "03-chat-earlier")

  // 04: a helper and a command at work, with the panel about the Dood open beside the chat.
  await say(page, ASK_DINNER, "three to choose from")
  await page.getByRole("button", { name: /^Show Juniper's panel/ }).click()
  await page.waitForTimeout(1_500)
  await shoot(page, "04-working")
  await page.getByRole("button", { name: /^Hide Juniper's panel/ }).click()

  // What the chat holds, to see what the pictures should show.
  const chatId = /\/c\/(\d+)/.exec(page.url())?.[1]
  if (chatId !== undefined) {
    const chat = await page.request.get(`/api/agents/${id}/chats/${chatId}`)
    writeFileSync(join(OUT, "chat.json"), await chat.text())
  }

  // 05: the library, with the plan open.
  await page.goto(`/a/${id}/library`)
  await page.waitForTimeout(1_500)
  const plan = page.getByRole("link", { name: /Lisbon weekend/ }).first()
  if (await plan.isVisible().catch(() => false)) await plan.click()
  await page.waitForTimeout(1_500)
  await shoot(page, "05-library")

  // 06: the Dood's settings, at its connectors.
  await page.goto(`/a/${id}`)
  await expect(composer(page)).toBeVisible({ timeout: 20_000 })
  await page.getByRole("button", { name: /: pages and settings$/ }).click()
  await page.getByRole("menuitem", { name: /'s settings$/ }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Connectors", exact: true }).click()
  await page.waitForTimeout(1_000)
  await shoot(page, "06-settings")
  await page.keyboard.press("Escape")

  // 07, 08: a phone, in the chat and in the list of Doods.
  const phone = await browser.newContext({
    baseURL: ORIGIN,
    viewport: PHONE,
    colorScheme: "light",
    storageState: await page.context().storageState(),
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  })
  const small = await phone.newPage()
  await small.goto(`/a/${id}`)
  await expect(composer(small)).toBeVisible({ timeout: 20_000 })
  await small.waitForTimeout(1_500)
  await shoot(small, "07-phone-chat")
  await small.getByRole("button", { name: /^Show your Doods/ }).click()
  await small.waitForTimeout(1_000)
  await shoot(small, "08-phone-home")
  await phone.close()
})
