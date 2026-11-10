// Pictures of the React app's settings (apps/web) to hold the Exact app's against
// (tools/settings-shots.sh): the same account and Doods, each section, wide and phone, light and dark. It starts its own server on an empty data
// folder, on a port of its own (not 3911, which `./x` keeps), and stops it when done.
//
//   node tools/settings-react-shots.mjs [out dir]     (default .exact/shots/settings-react)
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
const OUT = resolve(process.argv[2] ?? join(here, "../.exact/shots/settings-react"))
const PORT = Number(process.env.DC_REACT_PORT ?? 3995)
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

  const ws = (await (await api.get("/api/workspaces")).json()).workspaces[0].id
  const sections = [
    ["profile", `agent.${id}.profile`], ["memory", `agent.${id}.memory`], ["model", `agent.${id}.model`],
    ["permissions", `agent.${id}.permissions`], ["usage", `agent.${id}.usage`],
    ["general", "general"], ["notifications", "notifications"], ["doods", "agents"], ["workspaces", "workspaces"],
    ["models", `workspace.${ws}.models`], ["passwords", `workspace.${ws}.passwords`], ["agent-list", `agent.${id}`],
  ]
  for (const [name, size] of [["wide", { width: 1280, height: 800 }], ["phone", { width: 390, height: 844 }]]) {
    for (const scheme of ["light", "dark"]) {
      const context = await browser.newContext({ baseURL: ORIGIN, viewport: size, colorScheme: scheme, storageState: state, deviceScaleFactor: 1, hasTouch: name === "phone", isMobile: name === "phone" })
      await context.addInitScript(() => localStorage.setItem("dc-agent-panel", "closed"))
      const page = await context.newPage()
      for (const [what, place] of sections) {
        await page.goto(`/a/${id}?settings=${place}`)
        await page.waitForTimeout(2000)
        await page.mouse.move(2, 400)
        await page.screenshot({ path: join(OUT, `${name}-${what}-${scheme}.png`) })
      }
      await context.close()
    }
  }
  console.log(`settings-react-shots: ${OUT}`)
} finally {
  await browser.close()
  stop()
}
