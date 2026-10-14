import { type ChildProcess, execFileSync, spawn } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer as createService } from "node:http"
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
import { startFakeMcp } from "../../web/e2e/fake-mcp-server.ts"

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
      // The service a connector signs in to is on this machine, in these tests.
      DC_ALLOW_PRIVATE_HOSTS: "1",
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
  await expect(welcome.getByLabel("Let my Doods work on this computer")).toBeHidden()

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

  // What it thinks with is the server's own model unless they would rather one of theirs.
  const thinking = await card(main, /What should I think with\?/)
  await thinking.getByRole("button", { name: /^Use Echo/ }).click()

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
  await expect(computer.getByRole("button", { name: "Stop letting Doods use it" })).toBeVisible()
  await expect(computer.getByRole("list", { name: "What the daemon did" })).toContainText(
    "Connected to",
  )
})

test("its first hello offers to draw, and the app asks its owner for the screen first", async () => {
  const main = await windowAt(url)
  const computer = await windowAt("computer.html")
  const computers = () =>
    main.evaluate(async () => JSON.stringify(await (await fetch("/api/computers")).json()))
  /** Answer the app's own question, which no page can, as its owner would: with this button. */
  const answer = (button: number) =>
    app.evaluate(({ dialog }, response) => {
      const asked = ((globalThis as { asked?: string[] }).asked ??= [])
      dialog.showMessageBox = (async (...args: unknown[]) => {
        asked.push((args.at(-1) as { message: string }).message)
        return { response, checkboxChecked: false }
      }) as typeof dialog.showMessageBox
    }, button)
  const asked = () => app.evaluate(() => (globalThis as { asked?: string[] }).asked ?? [])

  for (const offered of [
    "Make me a little game",
    "What’s filling up this computer?",
    "Check in with me every morning",
  ]) {
    await expect(main.getByRole("button", { name: offered })).toBeVisible()
  }
  const draw = main.getByRole("button", { name: "Draw me a picture" })

  // An owner who says no is left where they were: nothing is said for them or switched on.
  await answer(1)
  await draw.click()
  await expect.poll(asked).toEqual(["Let Doods use this computer’s screen?"])
  await expect(draw).toBeEnabled()
  await expect(main.getByRole("heading", { name: "Hi Sawyer, I’m Pip." })).toBeVisible()
  await expect(computer.getByRole("switch", { name: /The screen/ })).not.toBeChecked()
  expect(await computers()).not.toContain('"screen":true')

  // One who says yes has it switched on, and the agent is asked once it can use it.
  await answer(0)
  await draw.click()
  await expect(main.getByText("You said: Open a painting app on this computer")).toBeVisible({
    timeout: 30_000,
  })
  expect(await asked()).toHaveLength(2)
  expect(await computers()).toContain('"screen":true')
  await expect(computer.getByRole("switch", { name: /The screen/ })).toBeChecked()

  // It is theirs to switch off again, where it is always kept.
  await computer.getByRole("switch", { name: /The screen/ }).uncheck()
  await expect.poll(computers, { timeout: 30_000 }).not.toContain('"screen":true')
  await expect(computer.getByRole("status")).toContainText("Connected as", { timeout: 20_000 })
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
  const sending = main.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      /\/chats\/[^/]+\/messages$/.test(new URL(request.url()).pathname),
  )
  await main.keyboard.press("Enter")
  // A message written here says that it was, so that the agent knows which computer its owner
  // is at: this one, by what the server knows it by.
  const { computers } = (await main.evaluate(async () =>
    (await fetch("/api/computers")).json(),
  )) as { computers: { id: string; name: string; kind: string }[] }
  const here = computers.find((computer) => computer.kind === "paired" && computer.name === name)!
  expect(((await sending).postDataJSON() as { from?: unknown }).from).toEqual({
    app: "desktop",
    device: { darwin: "Mac", win32: "Windows" }[process.platform as string] ?? "Linux",
    computerId: here.id,
  })
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
  await expect(main.getByText(/does not let Doods use its screen/)).toBeVisible({
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
  await computer.getByRole("button", { name: "Stop letting Doods use it" }).click()
  await expect(computer.getByRole("status")).toHaveText("Doods cannot use this computer")
  await expect.poll(() => daemons()).toBe(0)

  await computer.getByRole("button", { name: "Let Doods use this computer" }).click()
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
  // Its page opens before it has answered, and it is kept as the one to come back to once it
  // has. A page that is still on its way cannot be asked, and is asked again.
  await expect
    .poll(() => before.evaluate(() => localStorage.getItem("dc-last-agent")).catch(() => null))
    .toBe(agent.id)
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

  // The egg is for someone new. Opened again by someone who has a Dood, the first run sends
  // them straight to where they left off, and nothing comes out of an egg for them.
  await main.reload()
  await main.waitForURL(/\/a\/[^/]+\/c\/\d+$/)
  await expect(main.locator("[data-welcome]")).toHaveCount(0)
  // This computer is not theirs to use yet, and that is asked there, of the workspace's Doods.
  const asking = main
    .getByRole("dialog")
    .filter({ hasText: "Let your Doods work on this computer?" })
  await asking.getByRole("button", { name: "Yes, work here" }).click()
  await expect(asking.getByRole("status")).toContainText("is paired", { timeout: 30_000 })
  await expect(asking).toHaveCount(0)
  const computer = await openComputer()
  await expect(computer.getByRole("status")).toContainText("Connected as", { timeout: 20_000 })
  // Asked once: started again, the app opens on the chat, and the question is not put again.
  await main.reload()
  await main.waitForURL(/\/a\/[^/]+\/c\/\d+$/)
  await expect(main.getByRole("textbox", { name: "Message" })).toBeVisible()
  await expect(asking).toHaveCount(0)
})

test("a sign-in somewhere else is shown in a small window, and the app's own never leaves", async () => {
  const main = await windowAt(url)
  const was = main.url()
  // A service a connector signs in to: its page sends whoever agrees back to the deployment.
  const service = createService((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    response.end(
      `<title>Sign in to the service</title><a href="${url}/api/connectors/callback?state=none">Allow</a>`,
    )
  })
  await new Promise<void>((resolve) => service.listen(0, "127.0.0.1", resolve))
  const { port } = service.address() as { port: number }
  const there = `http://127.0.0.1:${port}/authorize`
  try {
    await app.evaluate(({ BrowserWindow }) => {
      const went: string[] = []
      ;(globalThis as { went?: string[] }).went = went
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.on("did-navigate", (_event, address) => went.push(address))
      }
    })
    // The page sends its owner there, as it does when a connector wants a sign-in.
    await main.evaluate((there) => window.location.assign(there), there)
    const small = await windowAt("/authorize")
    await expect(small.getByRole("link", { name: "Allow" })).toBeVisible()
    expect(main.url()).toBe(was)
    // The small window is named by where it is, whatever the page calls itself.
    const titles = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((window) => window.getTitle()),
    )
    expect(titles).toContain(`127.0.0.1:${port}`)
    // It is no page of the deployment, and is given nothing of the app's.
    expect(await small.evaluate(() => "doComputer" in window || "desktop" in window)).toBe(false)

    // Sent back, the small window is gone and the app's own shows where the service led.
    await small.getByRole("link", { name: "Allow" }).click()
    await expect
      .poll(() => app.evaluate(() => (globalThis as { went?: string[] }).went ?? []))
      .toContainEqual(expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/\?connector_error=/))
    await expect
      .poll(() => app.windows().filter((page) => page.url().includes("/authorize")))
      .toEqual([])
    expect(new URL(main.url()).origin).toBe(url)
  } finally {
    service.close()
  }
})

test("a connector's sign-in is done in the owner's browser, which brings the answer back to the app", async () => {
  const main = await windowAt(url)
  // Where the test before left it is on its way to a chat. Nothing is asked of it until then.
  await main.waitForURL(/\/a\/[^/]+\/c\/\d+$/)
  await main.waitForLoadState("load")
  // A service with a sign-in of its own, as a connector's is.
  const service = await startFakeMcp()
  try {
    // The browser is the owner's own. Here the test is the browser: it sees where it was sent.
    await app.evaluate(({ shell }) => {
      const opened: string[] = []
      ;(globalThis as { opened?: string[] }).opened = opened
      shell.openExternal = async (address: string) => {
        opened.push(address)
      }
    })
    const opened = () => app.evaluate(() => (globalThis as { opened?: string[] }).opened ?? [])
    // Asked through the app's page. While that is on its way somewhere it cannot be asked, and
    // says nothing: whoever is waiting asks again.
    const connector = (agentId: string) =>
      main
        .evaluate(async (agentId) => {
          const { connectors } = (await (
            await fetch(`/api/agents/${agentId}/connectors`)
          ).json()) as {
            connectors: { name: string; status: string }[]
          }
          return connectors.find((connector) => connector.name === "Calendar")?.status
        }, agentId)
        .catch(() => undefined)

    // The page adds the connector, is told where its owner has to sign in, and goes there.
    const started = await main.evaluate(async (address) => {
      const { agents } = (await (await fetch("/api/agents")).json()) as { agents: { id: string }[] }
      const agentId = agents[0]!.id
      const added = await fetch(`/api/agents/${agentId}/connectors`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Calendar", url: address }),
      })
      const { authorizationUrl } = (await added.json()) as { authorizationUrl: string }
      return { agentId, to: authorizationUrl }
    }, `${service.origin}/oauth/mcp`)
    expect(await connector(started.agentId)).toBe("needs_auth")
    await main.evaluate((to) => window.location.assign(to), started.to)

    // The app's own window stays, no other is made, and the browser is sent to the service.
    await expect.poll(opened).toEqual([started.to])
    expect(new URL(main.url()).origin).toBe(url)
    expect(app.windows().filter((page) => page.url().startsWith(service.origin))).toEqual([])

    // In the browser nobody is signed in to the deployment. The owner agrees at the service,
    // which sends the browser to the deployment, which sends it on to the app on this computer.
    const asked = await (await fetch(started.to)).text()
    const allow = /<a href="([^"]+)">Allow<\/a>/.exec(asked)![1]!.replaceAll("&amp;", "&")
    expect(new URL(allow).origin).toBe(url)
    const sent = await fetch(allow, { redirect: "manual" })
    expect(sent.status).toBe(302)
    const here = new URL(sent.headers.get("location")!)
    expect(here.hostname).toBe("127.0.0.1")
    expect(here.origin).not.toBe(url)
    expect(here.pathname).toBe("/connector")
    expect(here.searchParams.get("code")).toBe(new URL(allow).searchParams.get("code"))
    // Nothing is connected by the browser having been there.
    expect(await connector(started.agentId)).toBe("needs_auth")

    const back = await fetch(here)
    expect(back.status).toBe(200)
    expect(await back.text()).toContain("Back to Do Computer.")

    // The app takes the answer to the deployment itself, signed in as whoever asked.
    await expect.poll(() => connector(started.agentId), { timeout: 20_000 }).toBe("connected")
    await expect.poll(() => main.url()).toContain(`/a/${started.agentId}`)
    await expect(
      main.getByRole("status").filter({ hasText: "Calendar is connected." }),
    ).toBeVisible()

    // Only whoever started a sign-in may have its answer sent to a computer.
    const nobody = await fetch(`${url}/api/connectors/browser`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: new URL(started.to).searchParams.get("state"), port: 4000 }),
    })
    expect(nobody.status).toBe(401)
    const unknown = await main.evaluate(async () => {
      const response = await fetch("/api/connectors/browser", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: "nobody-started-this", port: 4000 }),
      })
      return response.status
    })
    expect(unknown).toBe(404)
  } finally {
    await service.close()
  }
})
