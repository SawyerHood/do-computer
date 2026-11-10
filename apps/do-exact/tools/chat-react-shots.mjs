// The React app's pictures of the chat in tools/chat-scenario.mjs, to hold this app's against
// (tools/chat-shots.mjs): the same messages, sizes and schemes, into .exact/shots/react/chat-*.
// It starts its own server on an empty data folder, on a port of its own, and stops it after.
//   node tools/chat-react-shots.mjs [out dir]
import { spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { REPLIES, STEPS } from "./chat-scenario.mjs"

const here = new URL(".", import.meta.url).pathname
const web = resolve(here, "../../web")
const { chromium } = createRequire(join(web, "package.json"))("@playwright/test")
const OUT = resolve(process.argv[2] ?? join(here, "../.exact/shots/react"))
const PORT = Number(process.env.DC_REACT_PORT ?? 3991)
const ORIGIN = `http://127.0.0.1:${PORT}`
const CHROME = process.env.CHROME

mkdirSync(OUT, { recursive: true })
const data = mkdtempSync(join(tmpdir(), "do-exact-react-chat-"))
const server = spawn(process.execPath, ["server.node.mjs"], {
  cwd: web,
  stdio: ["ignore", "ignore", "inherit"],
  env: {
    ...process.env, PORT: String(PORT), HOST: "127.0.0.1", DC_BASE_URL: ORIGIN, DC_DATA_DIR: data,
    DC_SIGNUP: "open", OPENROUTER_API_KEY: "", DC_CHROME_PATH: "none", DC_ECHO_REPLIES: JSON.stringify(REPLIES),
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
  for (const [name, size] of [["wide", { width: 1280, height: 800 }], ["phone", { width: 390, height: 844 }]]) {
    const setup = await browser.newContext({ baseURL: ORIGIN })
    const email = `ada-${name}@example.com`
    if ((await setup.request.post("/api/auth/sign-up/email", { data: { name: "Ada", email, password: "correct horse" } })).status() !== 200) throw new Error("sign-up failed")
    const { agent } = await (await setup.request.post("/api/agents")).json()
    const chat = await (await setup.request.post(`/api/agents/${agent.id}/chats/main`)).json()
    const state = await setup.storageState()
    const contexts = {}
    for (const scheme of ["light", "dark"]) {
      const context = await browser.newContext({ baseURL: ORIGIN, viewport: size, colorScheme: scheme, storageState: state, deviceScaleFactor: 1, hasTouch: name === "phone", isMobile: name === "phone" })
      await context.addInitScript(() => {
        localStorage.setItem("dc-agent-panel", "closed")
        localStorage.setItem("dc-chat-list", "open")
      })
      const page = await context.newPage()
      await page.goto(`/a/${agent.id}/c/${chat.id}`)
      contexts[scheme] = page
    }
    const shoot = async (what) => {
      for (const [scheme, page] of Object.entries(contexts)) {
        await page.waitForTimeout(1200)
        await page.mouse.move(2, 400)
        await page.screenshot({ path: join(OUT, `${name}-chat-${what}-${scheme}.png`) })
      }
    }
    await new Promise((r) => setTimeout(r, 2500))
    await shoot("empty")
    for (const [index, step] of STEPS.entries()) {
      await setup.request.post(`/api/agents/${agent.id}/chats/${chat.id}/messages`, { data: { text: step.say, requestId: `r${index}` } })
      await new Promise((r) => setTimeout(r, step.wait ?? 3500))
      if (step.shot !== undefined) await shoot(step.shot)
    }
    for (const page of Object.values(contexts)) await page.context().close()
    await setup.close()
  }
  console.log(`chat-react-shots: ${OUT}`)
} finally {
  await browser.close()
  stop()
}
