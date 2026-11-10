// Pictures of the React app's Dood screens to hold the Exact app's against (tools/dood-shots.sh):
// the first run (the egg's hello, naming, what it thinks with, out, the chat it flies to), a Dood
// hatched from the sidebar's +, its panel with treats and box, a box opened, and the wardrobe;
// at 1280x800 and 390x844, light and dark. It starts its own server on an empty data folder, on
// a port of its own (DC_REACT_PORT, default 3998), and stops it when done.
//
//   node tools/react-dood-shots.mjs [out dir]     (default .exact/shots/react-dood)
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
const OUT = resolve(process.argv[2] ?? join(here, "../.exact/shots/react-dood"))
const PORT = Number(process.env.DC_REACT_PORT ?? 3998)
const ORIGIN = `http://127.0.0.1:${PORT}`
const CHROME = process.env.CHROME
const ONLY = process.env.ONLY ?? ""

mkdirSync(OUT, { recursive: true })
const data = mkdtempSync(join(tmpdir(), "do-exact-react-dood-"))
const server = spawn(process.execPath, ["server.node.mjs"], {
  cwd: web,
  stdio: ["ignore", "ignore", "inherit"],
  env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", DC_BASE_URL: ORIGIN, DC_DATA_DIR: data, DC_SIGNUP: "open", OPENROUTER_API_KEY: "", DC_CHROME_PATH: "none" },
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
let n = 0
const account = async () => {
  const setup = await browser.newContext({ baseURL: ORIGIN })
  const who = { name: "Ada", email: `ada-${n++}@example.com`, password: "correct horse" }
  if ((await setup.request.post("/api/auth/sign-up/email", { data: who })).status() !== 200) throw new Error("sign-up failed")
  return { setup, state: await setup.storageState() }
}
const sizes = [["wide", { width: 1280, height: 800 }], ["phone", { width: 390, height: 844 }]]
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) })

try {
  for (const scheme of ["light", "dark"]) {
    for (const [size, viewport] of sizes) {
      const tag = `${size}-${scheme}`
      const phone = size === "phone"
      const open = (state, panel) =>
        browser.newContext({ baseURL: ORIGIN, viewport, colorScheme: scheme, storageState: state, deviceScaleFactor: 1, hasTouch: phone, isMobile: phone }).then(async (context) => {
          await context.addInitScript((panel) => localStorage.setItem("dc-agent-panel", panel ? "open" : "closed"), panel)
          return context
        })
      if (ONLY === "" || ONLY === "welcome") {
        // Signed out at /welcome: the egg falls and says hello.
        const out = await browser.newContext({ baseURL: ORIGIN, viewport, colorScheme: scheme })
        const first = await out.newPage()
        await first.goto("/welcome")
        await first.waitForTimeout(9000)
        await shot(first, `${tag}-welcome-hello`)
        await out.close()
        // Signed in with no Dood: named, coloured, thinks, hatches, and is met in its chat.
        const { state } = await account()
        const context = await open(state, false)
        const page = await context.newPage()
        await page.goto("/welcome")
        await page.waitForTimeout(5000)
        await shot(page, `${tag}-welcome-name`)
        await page.getByPlaceholder("A name for it").fill("Pip")
        await page.getByRole("radio", { name: "Moss" }).click()
        await page.waitForTimeout(600)
        await shot(page, `${tag}-welcome-named`)
        await page.getByRole("button", { name: "That’s your name" }).click()
        await page.waitForTimeout(5000)
        await shot(page, `${tag}-welcome-model`)
        await page.getByRole("button", { name: /^Use / }).click()
        await page.waitForTimeout(9000)
        await shot(page, `${tag}-welcome-out`)
        await page.getByRole("button", { name: /^Start chatting/ }).click()
        await page.waitForTimeout(400)
        await shot(page, `${tag}-welcome-flying`)
        await page.waitForTimeout(4000)
        await shot(page, `${tag}-welcome-chat`)
        await context.close()
      }
      if (ONLY === "" || ONLY === "panel") {
        // A Dood hatched from the +, met as an egg; then its panel, a treat, its box, the wardrobe.
        const { setup, state } = await account()
        const made = await (await setup.request.post("/api/agents", { data: {} })).json()
        const id = made.agent.id
        const context = await open(state, !phone)
        const page = await context.newPage()
        await page.goto(`/a/${id}`)
        await page.waitForTimeout(1200)
        await shot(page, `${tag}-egg`)
        await page.waitForTimeout(9000)
        await page.mouse.move(2, 400)
        await shot(page, `${tag}-hatched`)
        if (!phone) {
          await page.getByRole("button", { name: /^Give .* a treat/ }).click()
          await page.waitForTimeout(450)
          await shot(page, `${tag}-eating`)
          await page.waitForTimeout(1500)
          await page.getByRole("button", { name: /box$/ }).click()
          await page.waitForTimeout(1200)
          await shot(page, `${tag}-box`)
          await page.getByRole("button", { name: "Open the box" }).click()
          await page.waitForTimeout(8000)
          await shot(page, `${tag}-box-shown`)
          await page.getByRole("button", { name: "Wear it" }).click()
          await page.waitForTimeout(1500)
          await shot(page, `${tag}-worn`)
          await page.getByRole("button", { name: /wardrobe$/ }).first().click()
        } else {
          await page.getByRole("button", { name: /wardrobe/ }).first().click()
        }
        await page.waitForTimeout(2000)
        await shot(page, `${tag}-wardrobe`)
        await context.close()
      }
    }
  }
  console.log(`react-dood-shots: ${OUT}`)
} finally {
  await browser.close()
  stop()
}
