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
  request as playwrightRequest,
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

/** The card under the egg in the first run, once it has said this and can be answered. */
async function card(window: Page, says: string | RegExp) {
  const asked = window.locator("[data-card]")
  // The egg comes down first, and each thing it says is written out as it says it.
  await expect(asked.getByRole("status")).toHaveText(says, { timeout: 30_000 })
  await expect(asked.locator("div[inert]")).toHaveCount(0)
  return asked
}

const launch = (env: Record<string, string> = {}) =>
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
      // An app that knows no deployment asks for one, whatever it was built for.
      DC_DESKTOP_SERVER: "",
      ...env,
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
  // Whether agents may work here is not asked on this form: the first run asks it.
  await expect(welcome.getByLabel("Let my agents work on this computer")).toBeHidden()

  await welcome.getByLabel("Server").fill("http://127.0.0.1:9")
  await welcome.getByRole("button", { name: "Continue" }).click()
  // Windows takes its time over an address nothing listens at, and the app gives it ten seconds.
  await expect(welcome.getByRole("alert")).toContainText("There is no Do Computer at", {
    timeout: 20_000,
  })

  await welcome.getByLabel("Server").fill(url)
  await welcome.getByRole("button", { name: "Continue" }).click()
  // The window that takes its place shows the deployment's first run.
  const main = await windowAt(/\/welcome$/)
  await card(main, /Is somebody out there\?/)
  // Nothing is shared until its owner has been asked.
  expect(daemons()).toBe(0)
})

test("the first run asks who its owner is, a name for the agent, and for this computer", async () => {
  const main = await windowAt(/\/welcome$/)
  await (
    await card(main, /Is somebody out there\?/)
  )
    .getByRole("button", { name: "Hello!" })
    .click()
  const you = await card(main, /who are you\?/)
  await you.getByLabel("Your name").fill("Sawyer")
  await you.getByLabel("Email").fill("owner@example.com")
  await you.getByLabel("Password").fill("correct horse battery")
  await you.getByRole("button", { name: "That’s me" }).click()

  const naming = await card(main, /What will you call me\?/)
  await naming.getByLabel("A name for it").fill("Pip")
  await naming.getByRole("button", { name: "That’s your name" }).click()

  // Nobody copies a link or a code, or is sent to another page: the app pairs itself.
  const asking = await card(main, /may I work on this computer\?/)
  await asking.getByRole("button", { name: "Yes, work here" }).click()
  await expect(asking.getByText("is paired")).toBeVisible({ timeout: 30_000 })

  // Then it hatches, and its chat is where the first run ends.
  const out = await card(main, /This computer is ours to work on now\./)
  await out.getByRole("button", { name: "Start chatting with Pip" }).click()
  await main.waitForURL(/\/a\/[^/]+\/c\/\d+/)
  await expect(main.getByRole("heading", { name: "Hi Sawyer, I’m Pip." })).toBeVisible()
  await expect(main.locator("[data-welcome]")).toHaveCount(0)

  // The app's own window about this computer says that it is connected.
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
  // A second agent is open when the app is quit, so that where it starts again can be told
  // from where it would start with nothing remembered.
  const before = await windowAt(url)
  const { agent } = await before.evaluate(
    async () =>
      (await (await fetch("/api/agents", { method: "POST" })).json()) as { agent: { id: string } },
  )
  await before.goto(`${url}/a/${agent.id}`)
  await before.waitForURL(new RegExp(`/a/${agent.id}/c/\\d+`))
  await app.evaluate(({ app }) => app.quit()).catch(() => {})
  await expect.poll(() => daemons(), { timeout: 15_000 }).toBe(0)

  app = await launch()
  // It goes straight to the deployment, signed in as before, and to the agent it was left on.
  const main = await windowAt(new RegExp(`/a/${agent.id}/c/\\d+`))
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

test("an app that knows its deployment opens on the first run, and signs in through the browser", async () => {
  await app.evaluate(({ app }) => app.quit()).catch(() => {})
  await expect.poll(() => daemons(), { timeout: 15_000 }).toBe(0)
  // Another computer's app: nothing kept, and told which deployment is its own.
  const fresh = join(scratch, "second")
  app = await launch({ DC_DESKTOP_DATA: fresh, DC_DESKTOP_SERVER: url })
  const main = await windowAt(/\/welcome$/)
  await card(main, /Is somebody out there\?/)

  // The browser is the owner's own. Here the test is the browser: it sees where it was sent.
  await app.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as { opened?: string[] }).opened = opened
    shell.openExternal = async (address: string) => {
      opened.push(address)
    }
  })
  const waiting = main.evaluate(() =>
    (
      window as unknown as { doComputer: { signIn(): Promise<{ token?: string; error?: string }> } }
    ).doComputer.signIn(),
  )
  await expect
    .poll(() => app.evaluate(() => (globalThis as { opened?: string[] }).opened?.length ?? 0))
    .toBe(1)
  const sent = new URL(
    (await app.evaluate(() => (globalThis as { opened?: string[] }).opened![0]))!,
  )
  expect(sent.origin + sent.pathname).toBe(`${url}/desktop/sign-in`)
  const port = sent.searchParams.get("port")
  const state = sent.searchParams.get("state")!

  // In the browser the owner is signed in, and agrees: the deployment gives a token for the app.
  const browser = await playwrightRequest.newContext({ extraHTTPHeaders: { origin: url } })
  const signedIn = await browser.post(`${url}/api/auth/sign-in/email`, {
    data: { email: "owner@example.com", password: "correct horse battery" },
  })
  expect(signedIn.status()).toBe(200)
  const asked = await browser.post(`${url}/api/auth/desktop/token`, { data: {} })
  expect(asked.status()).toBe(200)
  const { token } = (await asked.json()) as { token: string }
  // A visit that does not know the app's word for this sign-in is not it.
  expect((await fetch(`http://127.0.0.1:${port}/done?token=${token}&state=wrong`)).status).toBe(404)
  const done = await fetch(
    `http://127.0.0.1:${port}/done?token=${encodeURIComponent(token)}&state=${state}`,
  )
  expect(done.status).toBe(200)
  expect(await done.text()).toContain("You are signed in")
  await browser.dispose()

  // The app hands the token to its window, which is then signed in by itself.
  expect(await waiting).toEqual({ token })
  const me = await main.evaluate(async (token) => {
    const exchanged = await fetch("/api/auth/desktop/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    })
    const me = await fetch("/api/me")
    return { exchanged: exchanged.status, email: (await me.json())?.user?.email as unknown }
  }, token)
  expect(me).toEqual({ exchanged: 200, email: "owner@example.com" })

  // The egg knows them when the first run is opened again: their own agent comes out of it, and
  // asks about this computer, which is not theirs to use yet.
  await main.reload()
  await card(main, /Sawyer, it’s you! I haven’t worked on this computer before\. May I\?/)
})
