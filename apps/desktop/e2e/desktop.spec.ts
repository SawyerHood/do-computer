import { type ChildProcess, execFileSync, spawn } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
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

const serverEntry = fileURLToPath(new URL("../../web/server.node.mjs", import.meta.url))
const appEntry = fileURLToPath(new URL("../dist/main.cjs", import.meta.url))

const scratch = mkdtempSync(join(tmpdir(), "dc-desktop-"))
/** The home directory of whoever is using the app, which is where its agents work. */
const home = join(scratch, "home")
const data = join(scratch, "app")

let server: ChildProcess
let url: string
let app: ElectronApplication

async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve))
  const { port } = probe.address() as { port: number }
  await new Promise((resolve) => probe.close(resolve))
  return port
}

/** The app's window that shows a page with this in its address. */
async function windowAt(part: string | RegExp): Promise<Page> {
  const matches = (page: Page) =>
    typeof part === "string" ? page.url().includes(part) : part.test(page.url())
  await expect.poll(() => app.windows().some(matches), { timeout: 20_000 }).toBe(true)
  return app.windows().find(matches)!
}

/** The packed app to test, where there is one. Otherwise the build in dist/, run by Electron. */
const packed = process.env.DC_DESKTOP_APP

const launch = () =>
  electron.launch({
    ...(packed ? { executablePath: packed } : {}),
    // A machine with no graphics card and a build machine's sandbox rules can both run it.
    args: [...(packed ? [] : [appEntry]), "--no-sandbox", "--disable-gpu"],
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      DC_DESKTOP_DATA: data,
      DC_DAEMON_POLL_MS: "200",
      // A screen that is only pretended: nothing on the machine running this is clicked.
      DC_DESKTOP_FAKE_SCREEN: "1",
    },
  })

/** How many daemons of this test's app are running, known by the folder only they run from. */
function daemons(): number {
  const listed =
    process.platform === "win32"
      ? execFileSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-Command",
            "Get-CimInstance Win32_Process | ForEach-Object { $_.CommandLine }",
          ],
          { encoding: "utf8" },
        )
      : execFileSync("ps", ["-eo", "args"], { encoding: "utf8" })
  return listed.split("\n").filter((line) => line.includes(join(data, "daemon"))).length
}

/** Open the app's window about this computer, as its menu does. */
async function openComputer(): Promise<Page> {
  // An app that has only just started has no menu of its own yet.
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
  return windowAt("computer.html")
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
})

test.afterAll(async () => {
  await app?.close().catch(() => {})
  server?.kill()
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5 })
})

test.describe.configure({ mode: "serial" })

test("a first run asks which Do Computer to use, and says so when there is none there", async () => {
  app = await launch()
  const welcome = await windowAt("welcome.html")
  await expect(welcome.getByRole("heading", { name: "Do Computer" })).toBeVisible()
  await expect(welcome.getByLabel("Let my agents work on this computer")).toBeChecked()

  await welcome.getByLabel("Server").fill("http://127.0.0.1:9")
  await welcome.getByRole("button", { name: "Continue" }).click()
  // Windows takes its time over an address nothing listens at, and the app gives it ten seconds.
  await expect(welcome.getByRole("alert")).toContainText("There is no Do Computer at", {
    timeout: 20_000,
  })

  await welcome.getByLabel("Server").fill(url)
  await welcome.getByRole("button", { name: "Continue" }).click()
  // The window that takes its place shows the deployment itself.
  const main = await windowAt(/\/(login|signup)/)
  await expect(main.getByRole("button", { name: "Sign in" })).toBeVisible()
})

test("signing in leads to confirming this computer, and then it is connected", async () => {
  const main = await windowAt(url)
  await main.goto(`${url}/signup`)
  await main.getByLabel("Name").fill("Sawyer")
  await main.getByLabel("Email").fill("owner@example.com")
  await main.getByLabel("Password").fill("correct horse battery")
  await main.getByRole("button", { name: "Create account" }).click()

  // Nobody copied a link or a code: the app knew what its daemon was waiting for.
  await expect(main.getByRole("heading", { name: "Connect this computer?" })).toBeVisible({
    timeout: 30_000,
  })
  // With one agent there is nothing to choose between: it is chosen, once the page knows of it.
  await expect(main.getByRole("checkbox")).toBeChecked()
  await main.getByRole("button", { name: "Connect this computer" }).click()
  await expect(main.getByRole("heading", { name: "Connected" })).toBeVisible()

  // The app's own window about this computer says so too.
  const computer = await openComputer()
  await expect(computer.getByRole("status")).toContainText("Connected as", { timeout: 20_000 })
  await expect(computer.getByRole("button", { name: "Stop letting agents use it" })).toBeVisible()
  await expect(computer.getByRole("list", { name: "What the daemon did" })).toContainText(
    "Connected to",
  )
})

test("an agent works on this computer, and still can with the window closed", async () => {
  const main = await windowAt(url)
  // Closing the window leaves the app, and the daemon in it, running.
  await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.webContents.getURL().startsWith("http")) window.close()
    }
  })
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .filter((window) => window.webContents.getURL().startsWith("http"))
          .map((window) => window.isVisible()),
      ),
    )
    .toEqual([false])

  // The page is still there behind the hidden window, which is all the test needs to write in.
  await main.goto(url)
  await main.waitForURL(/\/a\/[^/]+\/c\/\d+/)
  const name = /“(.+)”/.exec(
    (await (await windowAt("computer.html")).getByRole("status").textContent()) ?? "",
  )![1]
  await main
    .getByRole("textbox", { name: "Message" })
    .fill(
      `/tool bash {"command":"echo from the agent > proof.txt && env > env.txt","computer":"${name}"}`,
    )
  await main.keyboard.press("Enter")
  await expect.poll(() => existsSync(join(home, "proof.txt")), { timeout: 30_000 }).toBe(true)
  expect(readFileSync(join(home, "proof.txt"), "utf8").trim()).toBe("from the agent")
  // What the agent runs is not told that it is inside the app: an Electron app it started
  // would otherwise run as Node, and not as itself.
  // The file is there, and empty, before `env` has written to it.
  const written = () =>
    existsSync(join(home, "env.txt")) ? readFileSync(join(home, "env.txt"), "utf8") : ""
  await expect.poll(written).toContain("PATH=")
  const env = written()
  expect(env).not.toContain("ELECTRON_RUN_AS_NODE")
  expect(env).not.toContain("DC_DAEMON_EMBEDDED")
  expect(env).not.toContain("DC_DAEMON_WORKER")
  // What it did is on record on the machine, and in the app's window about it.
  const computer = await windowAt("computer.html")
  await expect(computer.getByRole("list", { name: "What the daemon did" })).toContainText(
    "echo from the agent",
  )
})

test("an agent uses the screen once its owner switches that on here, and not before", async () => {
  const main = await windowAt(url)
  const computer = await windowAt("computer.html")
  const name = /“(.+)”/.exec((await computer.getByRole("status").textContent()) ?? "")![1]
  const ask = async (message: string) => {
    await main.getByRole("textbox", { name: "Message" }).fill(message)
    await main.keyboard.press("Enter")
  }
  const computers = () =>
    main.evaluate(async () => JSON.stringify(await (await fetch("/api/computers")).json()))

  // Off until its owner says otherwise, and the agent is told whose it is to switch on.
  await expect(computer.getByRole("switch", { name: /The screen/ })).not.toBeChecked()
  await ask(`/tool screen {"computer":"${name}","action":"screenshot"}`)
  await expect(main.getByText(/does not let agents use its screen/)).toBeVisible({
    timeout: 30_000,
  })
  // A browser is theirs to use from the start.
  expect(await computers()).toContain('"browser":true')
  expect(await computers()).not.toContain('"screen":true')

  await computer.getByRole("switch", { name: /The screen/ }).check()
  // The daemon starts again, and says what it may now do.
  await expect.poll(computers, { timeout: 30_000 }).toContain('"screen":true')
  await ask(
    `/tool screen {"computer":"${name}","action":"click","x":40,"y":30,"note":"Clicking Save"}`,
  )
  await expect(main.getByText(/Done\. The screen now, \d+ by \d+/)).toBeVisible({
    timeout: 30_000,
  })
  // On the computer itself, it says who is using it and what they are doing.
  const overlay = await windowAt("overlay.html")
  await expect(overlay.getByText(/is using this computer/)).toBeVisible()
  await expect(overlay.getByText("Clicking Save")).toBeVisible()
})

test("it can be switched off and on again without pairing again", async () => {
  const computer = await windowAt("computer.html")
  await computer.getByRole("button", { name: "Stop letting agents use it" }).click()
  await expect(computer.getByRole("status")).toHaveText("Agents cannot use this computer")
  await expect.poll(() => daemons()).toBe(0)

  await computer.getByRole("button", { name: "Let agents use this computer" }).click()
  await expect(computer.getByRole("status")).toContainText("Connected as", { timeout: 20_000 })
})

test("quitting the app ends its daemon, and starting it again connects without asking", async () => {
  expect(daemons()).toBeGreaterThan(0)
  await app.evaluate(({ app }) => app.quit()).catch(() => {})
  await expect.poll(() => daemons(), { timeout: 15_000 }).toBe(0)

  app = await launch()
  // It goes straight to the deployment, signed in as before.
  const main = await windowAt(/\/a\/[^/]+\/c\/\d+/)
  await expect(main.getByRole("textbox", { name: "Message" })).toBeVisible()
  const computer = await openComputer()
  await expect(computer.getByRole("status")).toContainText("Connected as", { timeout: 20_000 })
})

test("its daemon replaces itself with the server's newer one, and comes back connected", async () => {
  await app.evaluate(({ app }) => app.quit()).catch(() => {})
  await expect.poll(() => daemons(), { timeout: 15_000 }).toBe(0)
  // The daemon on this computer is the one the server serves. Make it an older one.
  const { version } = (await (await fetch(`${url}/api/daemon-version`)).json()) as {
    version: string
  }
  const script = join(data, "daemon", "bin", "daemon.cjs")
  const current = readFileSync(script, "utf8")
  expect(current).toContain(version)
  writeFileSync(script, current.replaceAll(version, "000000000000"))

  app = await launch()
  const computer = await openComputer()
  const log = computer.getByRole("list", { name: "What the daemon did" })
  // It tried the new one before trusting it, which here means running the app itself as Node.
  await expect(log).toContainText(`Downloaded daemon ${version}, to replace 000000000000`, {
    timeout: 30_000,
  })
  await expect(log).toContainText(/Updated\. Starting the new daemon\.[\s\S]*Connected to/, {
    timeout: 30_000,
  })
  await expect(computer.getByRole("status")).toContainText("Connected as")
  expect(readFileSync(script, "utf8")).toContain(version)
  expect(daemons()).toBeGreaterThan(0)
})
