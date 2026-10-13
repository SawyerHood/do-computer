import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
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

// The app with a screen that is only pretended and a stand-in for its daemon, so that what is
// tried is the app's own part: its switches, what it tells the daemon it starts, and what it
// answers when the daemon asks for the screen. No server is needed, and none is there.
const appEntry = fileURLToPath(new URL("../dist/main.cjs", import.meta.url))
const bundled = fileURLToPath(new URL("../dist/daemon.cjs", import.meta.url))
const scratch = mkdtempSync(join(tmpdir(), "dc-desktop-screen-"))
const data = join(scratch, "app")
const done = join(scratch, "done.log")
const heardFile = join(data, "daemon", "heard.json")

// It asks for a click as soon as it starts, then for what a watcher would be shown, and
// writes down what it was started with and what it was answered.
const STAND_IN = `
const fs = require("node:fs")
const out = process.env.DC_DAEMON_DIR + "/heard.json"
const heard = { screen: process.env.DC_DAEMON_SCREEN, browser: process.env.DC_DAEMON_BROWSER, answers: [] }
const save = () => fs.writeFileSync(out, JSON.stringify(heard))
save()
const agent = { id: "a1", name: "Pip", color: "#0aa" }
console.log("@dc-call " + JSON.stringify({ id: "c1", op: "act", agent, say: "Clicking Save", action: { do: "click", x: 40, y: 30 } }))
let rest = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  const lines = (rest + chunk).split("\\n")
  rest = lines.pop()
  for (const line of lines) {
    heard.answers.push(JSON.parse(line))
    if (heard.answers.length === 1) console.log("@dc-call " + JSON.stringify({ id: "c2", op: "view", waitMs: 1000 }))
  }
  save()
})
process.stdin.on("end", () => process.exit(0))
`

type Heard = {
  screen?: string
  browser?: string
  answers: {
    id: string
    value?: Record<string, any>
    error?: { refused: boolean; message: string }
  }[]
}
const heard = (): Heard | undefined => {
  try {
    return JSON.parse(readFileSync(heardFile, "utf8")) as Heard
  } catch {
    return undefined
  }
}
const settings = () =>
  JSON.parse(readFileSync(join(data, "settings.json"), "utf8")) as Record<string, unknown>

let app: ElectronApplication

async function computer(): Promise<Page> {
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
  await expect
    .poll(() => app.windows().some((page) => page.url().includes("computer.html")))
    .toBe(true)
  return app.windows().find((page) => page.url().includes("computer.html"))!
}

test.beforeAll(async () => {
  // The app leaves a daemon alone that it has already put there, which is how this one stays.
  mkdirSync(join(data, "daemon", "bin"), { recursive: true })
  writeFileSync(join(data, "daemon", "bin", "daemon.cjs"), STAND_IN)
  const sum = createHash("sha256").update(readFileSync(bundled)).digest("hex")
  writeFileSync(join(data, "daemon", "bin", "seeded"), `${sum}\n`)
  writeFileSync(
    join(data, "settings.json"),
    JSON.stringify({ server: "http://127.0.0.1:9", share: true, screen: true }),
  )
  app = await electron.launch({
    args: [appEntry, "--no-sandbox", "--disable-gpu"],
    env: {
      ...process.env,
      HOME: join(scratch, "home"),
      DC_DESKTOP_DATA: data,
      DC_DESKTOP_FAKE_SCREEN: "1",
      DC_DESKTOP_FAKE_SCREEN_LOG: done,
    },
  })
})

test.afterAll(async () => {
  await app?.evaluate(({ app }) => app.quit()).catch(() => {})
})

test.describe.configure({ mode: "serial" })

test("a daemon that asks for the screen has it used, and is given a picture of it", async () => {
  await expect.poll(() => heard()?.answers.length, { timeout: 30_000 }).toBe(2)
  const now = heard()!
  expect(now.screen).toBe("1")
  expect(now.browser).toBeUndefined()
  const [acted, view] = now.answers
  expect(acted!.error).toBeUndefined()
  expect(acted!.value!.shot).toMatchObject({ mimeType: "image/jpeg", width: 640, height: 480 })
  // A JPEG begins with these bytes, whatever it is a picture of.
  expect(Buffer.from(acted!.value!.shot.data, "base64").subarray(0, 3)).toEqual(
    Buffer.from([0xff, 0xd8, 0xff]),
  )
  expect(acted!.value!.pointer).toEqual({ x: 40, y: 30 })
  expect(view!.value).toMatchObject({
    active: true,
    clicks: 1,
    say: "Clicking Save",
    agent: { name: "Pip" },
  })
  expect(readFileSync(done, "utf8")).toBe('{"do":"click","x":40,"y":30}\n')
})

test("what the daemon asks is not among what its owner reads of it", async () => {
  const page = await computer()
  await expect(page.getByRole("heading", { name: "What Doods can use here" })).toBeVisible()
  await expect(page.locator("#log")).not.toContainText("@dc-call")
})

test("switching the screen off is remembered, and the daemon starts again without it", async () => {
  const page = await computer()
  const screen = page.getByRole("switch", { name: /The screen/ })
  const browser = page.getByRole("switch", { name: /A browser/ })
  await expect(screen).toBeChecked()
  await expect(browser).toBeChecked()
  await expect(
    page.getByText("A Dood cannot change these. They are kept on this computer."),
  ).toBeVisible()

  await screen.click()
  await expect(screen).not.toBeChecked()
  await expect.poll(() => settings().screen).toBe(false)
  // Started again, it is told nothing of a screen, and what it asks for is refused.
  await expect
    .poll(() => heard()?.screen === undefined && heard()?.answers[0]?.error?.refused, {
      timeout: 20_000,
    })
    .toBe(true)
  expect(heard()!.answers[0]!.error!.message).toContain("does not let Doods use its screen")
})

test("switching the browser off is remembered, and the daemon is told", async () => {
  const page = await computer()
  await page.getByRole("switch", { name: /A browser/ }).click()
  await expect.poll(() => settings().browser).toBe(false)
  await expect.poll(() => heard()?.browser, { timeout: 20_000 }).toBe("0")
})
