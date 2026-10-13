import { type ChildProcess, spawn } from "node:child_process"
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "./fixtures.ts"
import { asOwner, composer, openWorkspaceSettings, owner, signIn } from "./helpers.ts"

/**
 * A Dood signing in to a website with a saved login, all the way through: the app, the real
 * daemon, the real dev-browser, a real Chromium and a page that asks for a password. It needs
 * a dev-browser to run, which CI does not fetch, so it runs where one is named:
 *
 *   DC_E2E_DEV_BROWSER=/path/to/dev-browser PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome \
 *     pnpm exec playwright test sign-in.spec.ts
 */
const devBrowser = process.env.DC_E2E_DEV_BROWSER
const chrome = process.env.PLAYWRIGHT_CHROMIUM_PATH

// Saved logins are for the deployment's admins unless it says otherwise: the owner is one here.
test.use({ settings: { DC_ADMIN_EMAILS: owner.email } })
asOwner()

const USERNAME = "sawyer"
const PASSWORD = "p4ssw0rd-nobody-may-see"
const COMPUTER = "sign-in-laptop"

/**
 * Every file under a folder, as one piece of text, but for what is under `except`: the browser's
 * own profile, which is the browser's to keep and not something the daemon wrote.
 */
function everythingIn(folder: string, except: string): string {
  if (!existsSync(folder)) return ""
  return readdirSync(folder)
    .map((name) => {
      const path = join(folder, name)
      if (path === except) return ""
      const stat = lstatSync(path)
      if (stat.isDirectory()) return everythingIn(path, except)
      return stat.isFile() ? readFileSync(path, "latin1") : ""
    })
    .join("\n")
}

test.describe("a Dood signing in with a saved login", () => {
  test.skip(
    !devBrowser || !chrome,
    "Needs a real dev-browser (DC_E2E_DEV_BROWSER) and a Chromium (PLAYWRIGHT_CHROMIUM_PATH).",
  )

  let daemon: ChildProcess | undefined
  let site: Server | undefined
  test.afterAll(() => {
    daemon?.kill()
    site?.close()
  })

  test("asks for one, types it where the Dood cannot see, and asks before it is used again", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(180_000)

    // A site that asks for a password, and writes down what it is sent.
    const posted: string[] = []
    const form = `<!doctype html><title>Sign in</title><form method="post" action="/session">
      <input name="user" autocomplete="username"><input name="pass" type="password" autocomplete="current-password">
      <button>Sign in</button></form>`
    site = createServer((request, response) => {
      response.setHeader("content-type", "text/html")
      if (request.method !== "POST") return void response.end(form)
      let body = ""
      request.on("data", (chunk) => (body += String(chunk)))
      request.on("end", () => {
        posted.push(body)
        const sent = new URLSearchParams(body)
        response.end(
          sent.get("user") === USERNAME && sent.get("pass") === PASSWORD
            ? "<!doctype html><title>Welcome</title><h1>Welcome back</h1>"
            : form,
        )
      })
    })
    await new Promise<void>((resolve) => site!.listen(0, "127.0.0.1", resolve))
    const port = (site.address() as AddressInfo).port

    const home = mkdtempSync(join(tmpdir(), "dc-sign-in-"))
    const dir = join(home, ".dc")
    daemon = spawn(
      "node",
      [
        fileURLToPath(new URL("../../daemon/dist/daemon.cjs", import.meta.url)),
        baseURL!,
        "--name",
        COMPUTER,
      ],
      {
        env: {
          ...process.env,
          HOME: home,
          DC_DAEMON_DIR: dir,
          DC_DAEMON_POLL_MS: "200",
          DC_DEV_BROWSER: devBrowser!,
          DEV_BROWSER_CHROME: chrome!,
          // Only the browser kept for agents, not one the person running this has open, and
          // with no window.
          DC_BROWSER_OWN: "0",
          DISPLAY: "",
          WAYLAND_DISPLAY: "",
        },
      },
    )
    let output = ""
    daemon.stdout!.on("data", (chunk) => (output += String(chunk)))
    daemon.stderr!.on("data", (chunk) => (output += String(chunk)))
    await expect
      .poll(() => /http\S+\/pair\?code=[A-Z0-9-]+/.exec(output)?.[0], { timeout: 10_000 })
      .toBeTruthy()
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page)
    await page.goto(/http\S+\/pair\?code=[A-Z0-9-]+/.exec(output)![0])
    await page.getByRole("button", { name: "Connect this computer" }).click()
    await expect(page.getByRole("heading", { name: "Connected" })).toBeVisible()
    await expect.poll(() => output, { timeout: 15_000 }).toContain("Connected to")
    await page.goto("/")

    const browse = async (address: string) => {
      await composer(page).fill(
        `/tool browser ${JSON.stringify({
          computer: COMPUTER,
          script: `const page = await browser.getPage("main"); await page.goto(${JSON.stringify(address)}); await page.title();`,
        })}`,
      )
      await page.keyboard.press("Enter")
    }
    const signInWith = async (args: Record<string, unknown> = {}) => {
      await composer(page).fill(`/tool sign_in ${JSON.stringify({ computer: COMPUTER, ...args })}`)
      await page.keyboard.press("Enter")
    }
    const lines = (outcome: string) => page.locator(`[data-sign-in="${outcome}"]`)

    // The Dood opens the page that asks, in the real browser. The first time a browser has to
    // be started, which takes a while.
    await browse(`http://127.0.0.1:${port}/login`)
    await expect.poll(() => output, { timeout: 60_000 }).toContain("ran in a browser")

    // No login is saved for the site, so the person is asked for one.
    await signInWith({ purpose: "To look at the account." })
    const asks = page.getByRole("list", { name: "Secrets it asked for" })
    await expect(asks).toContainText("Juniper needs a login for 127.0.0.1", { timeout: 30_000 })
    await expect(asks).toContainText("To look at the account.")
    await asks.getByLabel("Username or email").fill(USERNAME)
    await asks.getByLabel("Password", { exact: true }).fill(PASSWORD)
    await asks.getByRole("button", { name: "Save" }).click()
    await expect(asks).toHaveCount(0)
    await expect(page.getByText("gave a login for")).toBeVisible()
    expect(posted).toEqual([])

    // Having typed it for this, they are not asked whether it may be used: the Dood signs in.
    await signInWith()
    await expect(lines("signed_in")).toHaveText(`Signed in to 127.0.0.1 as ${USERNAME}`, {
      timeout: 60_000,
    })
    expect(posted).toEqual([`user=${USERNAME}&pass=${PASSWORD}`])
    await expect(page.getByText("Juniper wants to:")).toHaveCount(0)

    // The next time, they are asked, with the site as the browser has it.
    await browse(`http://127.0.0.1:${port}/login`)
    await expect.poll(() => output.split("ran in a browser").length, { timeout: 30_000 }).toBe(3)
    await signInWith()
    const request = page.getByText("Juniper wants to:").locator("xpath=ancestor::li[1]")
    await expect(request).toContainText(`Sign in to 127.0.0.1 as ${USERNAME}`, { timeout: 30_000 })
    await expect(request).toContainText("Saved login: 127.0.0.1")
    await expect(request).toContainText(`Page: http://127.0.0.1:${port}/login`)
    expect(posted).toHaveLength(1)
    await request.getByRole("button", { name: "Allow once" }).click()
    await expect(request).toHaveCount(0)
    await signInWith()
    await expect(lines("signed_in")).toHaveCount(2, { timeout: 60_000 })
    expect(posted).toHaveLength(2)

    // A page at another address gets nothing typed into it, however alike it looks.
    await browse(`http://localhost:${port}/login`)
    await expect.poll(() => output.split("ran in a browser").length, { timeout: 30_000 }).toBe(4)
    await signInWith({ login: "127.0.0.1" })
    await expect(lines("wrong_site")).toContainText("Did not sign in: this page is localhost", {
      timeout: 30_000,
    })
    expect(posted).toHaveLength(2)

    // Nothing the app shows or sends a person has the password in it.
    expect(await page.content()).not.toContain(PASSWORD)
    const [, agentId, chatId] = /\/a\/([^/]+)\/c\/(\d+)/.exec(page.url())!
    const chat = await page.request.get(`/api/agents/${agentId}/chats/${chatId}`)
    expect(chat.status()).toBe(200)
    const kept = await chat.text()
    expect(kept).toContain("sign_in")
    expect(kept).not.toContain(PASSWORD)
    // Nor has anything the daemon wrote down: its record of what was done, and its log.
    const written = everythingIn(dir, join(dir, "browser", "browser-profile"))
    expect(written).toContain("browser_sign_in")
    expect(written).not.toContain(PASSWORD)
    expect(readFileSync(join(dir, "audit.log"), "utf8")).toContain("browser_sign_in")
    expect(output).not.toContain(PASSWORD)

    // The workspace's settings say it was used, and by whom.
    await openWorkspaceSettings(page, "Passwords")
    const saved = page.getByRole("list", { name: "Saved logins" })
    await expect(saved.getByRole("listitem")).toHaveCount(1)
    await expect(saved).toContainText(USERNAME)
    await expect(saved).toContainText(/Used .* by Juniper/)
  })
})
