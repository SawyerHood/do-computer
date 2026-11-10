// Pictures of the React app (apps/web) to hold the Exact app's against: the same account, Doods
// and chat at the same window sizes, light and dark. It starts its own server on an empty data
// folder, on a port of its own (not 3911, which `./x` keeps), and stops it when done.
//
//   node tools/react-shots.mjs [out dir]     (default .exact/shots/react)
//
// apps/web must be built (`pnpm --filter @do-computer/web build:node`).
import { spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const here = new URL(".", import.meta.url).pathname
const web = resolve(here, "../../web")
const { chromium } = createRequire(join(web, "package.json"))("@playwright/test")
const OUT = resolve(process.argv[2] ?? join(here, "../.exact/shots/react"))
const PORT = Number(process.env.DC_REACT_PORT ?? 3990)
const ORIGIN = `http://127.0.0.1:${PORT}`
const CHROME = process.env.CHROME
const ACCOUNT = { name: "Ada", email: "ada@example.com", password: "correct horse" }
const DOODS = [
  { name: "Pico", avatar: { color: "honey", seed: "pico" } },
  { name: "Maple", avatar: { color: "clay", seed: "maple" } },
  { name: "Juniper", avatar: { color: "moss", seed: "juniper" } },
]

mkdirSync(OUT, { recursive: true })
const data = mkdtempSync(join(tmpdir(), "do-exact-react-"))
const server = spawn(process.execPath, ["server.node.mjs"], {
  cwd: web,
  stdio: ["ignore", "ignore", "inherit"],
  env: {
    ...process.env,
    PORT: String(PORT),
    HOST: "127.0.0.1",
    DC_BASE_URL: ORIGIN,
    DC_DATA_DIR: data,
    DC_SIGNUP: "open",
    OPENROUTER_API_KEY: "",
    DC_CHROME_PATH: "none",
  },
})
const stop = () => {
  server.kill("SIGKILL")
  rmSync(data, { recursive: true, force: true })
}
process.on("exit", stop)

const up = () => fetch(`${ORIGIN}/api/health`).then((r) => r.ok, () => false)
const deadline = Date.now() + 30_000
while (!(await up())) {
  if (Date.now() > deadline) throw new Error("The server did not come up. Is apps/web built?")
  await new Promise((r) => setTimeout(r, 100))
}

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {})
try {
  const setup = await browser.newContext({ baseURL: ORIGIN })
  const api = setup.request
  if ((await api.post("/api/auth/sign-up/email", { data: ACCOUNT })).status() !== 200) throw new Error("sign-up failed")
  let id = ""
  for (const dood of DOODS) {
    const made = await (await api.post("/api/agents")).json()
    id = made.agent.id
    await api.patch(`/api/agents/${id}`, { data: dood })
  }
  const chat = await (await api.post(`/api/agents/${id}/chats/main`)).json()
  await api.post(`/api/agents/${id}/chats/${chat.id}/messages`, { data: { text: "Plan a weekend in Lisbon for two, under €900.", requestId: "r1" } })
  await new Promise((r) => setTimeout(r, 3000))
  const state = await setup.storageState()

  const shots = [
    { size: { width: 1280, height: 800 }, name: "wide", pages: [[`/a/${id}/c/${chat.id}`, "chat"], [`/a/${id}/library`, "library"]] },
    { size: { width: 390, height: 844 }, name: "phone", pages: [[`/a/${id}/c/${chat.id}`, "chat"]] },
  ]
  for (const { size, name, pages } of shots) {
    for (const scheme of ["light", "dark"]) {
      const context = await browser.newContext({ baseURL: ORIGIN, viewport: size, colorScheme: scheme, storageState: state, deviceScaleFactor: 1, hasTouch: name === "phone", isMobile: name === "phone" })
      // The sidebar opened out into the whole list, as the Exact app draws it.
      await context.addInitScript(() => {
        localStorage.setItem("dc-agent-panel", "closed")
        localStorage.setItem("dc-chat-list", "open")
      })
      const page = await context.newPage()
      for (const [path, what] of pages) {
        await page.goto(path)
        await page.waitForTimeout(2500)
        await page.mouse.move(2, 400)
        await page.screenshot({ path: join(OUT, `${name}-${what}-${scheme}.png`) })
      }
      if (name === "phone") {
        await page.getByRole("button", { name: /^Show your Doods/ }).click().catch(() => {})
        await page.waitForTimeout(1000)
        await page.screenshot({ path: join(OUT, `${name}-doods-${scheme}.png`) })
      } else {
        await page.getByRole("button", { name: /: pages and settings$/ }).click().catch(() => {})
        await page.waitForTimeout(600)
        await page.screenshot({ path: join(OUT, `${name}-pages-menu-${scheme}.png`) })
        await page.keyboard.press("Escape")
        await page.goto(pages[0][0])
        await page.getByRole("button", { name: /^Show .*'s panel/ }).click().catch(() => {})
        await page.waitForTimeout(1500)
        await page.screenshot({ path: join(OUT, `${name}-panel-${scheme}.png`) })
      }
      await context.close()
    }
  }
  // Signed out: the sign-in page.
  for (const scheme of ["light", "dark"]) {
    for (const [name, size] of [["wide", { width: 1280, height: 800 }], ["phone", { width: 390, height: 844 }]]) {
      const context = await browser.newContext({ baseURL: ORIGIN, viewport: size, colorScheme: scheme })
      const page = await context.newPage()
      await page.goto("/login")
      await page.waitForTimeout(1500)
      await page.screenshot({ path: join(OUT, `${name}-login-${scheme}.png`) })
      await context.close()
    }
  }
  console.log(`react-shots: ${OUT}`)
} finally {
  await browser.close()
  stop()
}
