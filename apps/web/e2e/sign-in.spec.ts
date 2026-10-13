import { type ChildProcess, spawn } from "node:child_process"
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures.ts"
import { asOwner, composer, openWorkspaceSettings, owner, signIn } from "./helpers.ts"

/**
 * A Dood signing in to a website with a saved login, and paying with a saved card, all the way
 * through: the app, the real daemon, the real dev-browser, a real Chromium and pages that ask
 * for a password and for a card. It needs a dev-browser to run, which CI does not fetch, so it
 * runs where one is named:
 *
 *   DC_E2E_DEV_BROWSER=/path/to/dev-browser PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome \
 *     pnpm exec playwright test sign-in.spec.ts
 */
const devBrowser = process.env.DC_E2E_DEV_BROWSER
const chrome = process.env.PLAYWRIGHT_CHROMIUM_PATH

// Saved logins are for the deployment's admins unless it says otherwise, and cards are kept
// only where it names them: the owner is an admin here, and it does.
test.use({ settings: { DC_ADMIN_EMAILS: owner.email, DC_SECRET_KINDS: "passwords,cards" } })
asOwner()

const USERNAME = "sawyer"
const PASSWORD = "p4ssw0rd-nobody-may-see"
const NUMBER = "4242424242424242"
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

test.describe("a Dood with what its workspace saved", () => {
  test.skip(
    !devBrowser || !chrome,
    "Needs a real dev-browser (DC_E2E_DEV_BROWSER) and a Chromium (PLAYWRIGHT_CHROMIUM_PATH).",
  )

  let daemon: ChildProcess | undefined
  /** Where the daemon keeps its things, and what it has printed. */
  let dir = ""
  let output = ""
  const sites: Server[] = []
  test.afterAll(() => {
    daemon?.kill()
    for (const site of sites) site.close()
  })

  /** A site of the test's own, on this computer. Resolves with its port. */
  const serve = async (handler: Parameters<typeof createServer>[1]): Promise<number> => {
    const site = createServer(handler)
    sites.push(site)
    await new Promise<void>((resolve) => site.listen(0, resolve))
    return (site.address() as AddressInfo).port
  }

  /** How many scripts the daemon says it has run in a browser. */
  const scripts = () => output.split("ran in a browser").length - 1

  /** Have the Dood open an address in the real browser, and wait until it has. */
  const browse = async (page: Page, address: string) => {
    const before = scripts()
    await composer(page).fill(
      `/tool browser ${JSON.stringify({
        computer: COMPUTER,
        script: `const page = await browser.getPage("main"); await page.goto(${JSON.stringify(address)}); await page.title();`,
      })}`,
    )
    await page.keyboard.press("Enter")
    // The first time a browser has to be started, which takes a while.
    await expect.poll(scripts, { timeout: 60_000 }).toBe(before + 1)
  }

  const callTool = async (page: Page, name: string, args: Record<string, unknown> = {}) => {
    await composer(page).fill(`/tool ${name} ${JSON.stringify({ computer: COMPUTER, ...args })}`)
    await page.keyboard.press("Enter")
  }

  /** The request above the message box that the Dood is waiting on. */
  const request = (page: Page) =>
    page.getByText("Juniper wants to:").locator("xpath=ancestor::li[1]")

  test("asks for a login, types it where the Dood cannot see, and asks before it is used again", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(180_000)

    // A site that asks for a password, and writes down what it is sent.
    const posted: string[] = []
    const form = `<!doctype html><title>Sign in</title><form method="post" action="/session">
      <input name="user" autocomplete="username"><input name="pass" type="password" autocomplete="current-password">
      <button>Sign in</button></form>`
    const port = await serve((incoming, response) => {
      response.setHeader("content-type", "text/html")
      if (incoming.method !== "POST") return void response.end(form)
      let body = ""
      incoming.on("data", (chunk) => (body += String(chunk)))
      incoming.on("end", () => {
        posted.push(body)
        const sent = new URLSearchParams(body)
        response.end(
          sent.get("user") === USERNAME && sent.get("pass") === PASSWORD
            ? "<!doctype html><title>Welcome</title><h1>Welcome back</h1>"
            : form,
        )
      })
    })

    const home = mkdtempSync(join(tmpdir(), "dc-sign-in-"))
    dir = join(home, ".dc")
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

    const lines = (outcome: string) => page.locator(`[data-sign-in="${outcome}"]`)

    // The Dood opens the page that asks, in the real browser.
    await browse(page, `http://127.0.0.1:${port}/login`)

    // No login is saved for the site, so the person is asked for one.
    await callTool(page, "sign_in", { purpose: "To look at the account." })
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
    await callTool(page, "sign_in")
    await expect(lines("signed_in")).toHaveText(`Signed in to 127.0.0.1 as ${USERNAME}`, {
      timeout: 60_000,
    })
    expect(posted).toEqual([`user=${USERNAME}&pass=${PASSWORD}`])
    await expect(page.getByText("Juniper wants to:")).toHaveCount(0)

    // The next time, they are asked, with the site as the browser has it.
    await browse(page, `http://127.0.0.1:${port}/login`)
    await callTool(page, "sign_in")
    await expect(request(page)).toContainText(`Sign in to 127.0.0.1 as ${USERNAME}`, {
      timeout: 30_000,
    })
    await expect(request(page)).toContainText("Saved login: 127.0.0.1")
    await expect(request(page)).toContainText(`Page: http://127.0.0.1:${port}/login`)
    expect(posted).toHaveLength(1)
    await request(page).getByRole("button", { name: "Allow once" }).click()
    await expect(request(page)).toHaveCount(0)
    await callTool(page, "sign_in")
    await expect(lines("signed_in")).toHaveCount(2, { timeout: 60_000 })
    expect(posted).toHaveLength(2)

    // A page at another address gets nothing typed into it, however alike it looks.
    await browse(page, `http://localhost:${port}/login`)
    await callTool(page, "sign_in", { login: "127.0.0.1" })
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
    expect(output).not.toContain(PASSWORD)

    // The workspace's settings say it was used, and by whom.
    await openWorkspaceSettings(page, "Passwords")
    const saved = page.getByRole("list", { name: "Saved logins" })
    await expect(saved.getByRole("listitem")).toHaveCount(1)
    await expect(saved).toContainText(USERNAME)
    await expect(saved).toContainText(/Used .* by Juniper/)
  })

  test("pays with a saved card, whose number it is not shown and whose code is typed with the yes", async ({
    page,
  }) => {
    test.setTimeout(180_000)

    // A shop whose card boxes are in a frame from another site, as a payment company's are.
    // The shop's button has the frame send what it holds to its own server, and then orders.
    const charged: string[] = []
    const ordered: string[] = []
    const port = await serve((incoming, response) => {
      const path = new URL(incoming.url ?? "/", "http://shop").pathname
      response.setHeader("content-type", "text/html")
      if (incoming.method === "POST") {
        let body = ""
        incoming.on("data", (chunk) => (body += String(chunk)))
        incoming.on("end", () => {
          ;(path === "/charge" ? charged : ordered).push(body)
          response.end("ok")
        })
        return
      }
      if (path === "/card") {
        return void response.end(`<!doctype html><title>Card</title>
          <input name="number" autocomplete="cc-number"><input name="exp" autocomplete="cc-exp">
          <input name="cvc" autocomplete="cc-csc"><input name="zip" autocomplete="billing postal-code">
          <script>
            addEventListener("message", async (event) => {
              if (event.data !== "charge") return
              const held = Object.fromEntries([...document.querySelectorAll("input")].map((box) => [box.name, box.value]))
              await fetch("/charge", { method: "POST", body: JSON.stringify(held) })
              parent.postMessage("charged", "*")
            })
          </script>`)
      }
      if (path === "/thanks") return void response.end("<!doctype html><title>Thank you</title>")
      response.end(`<!doctype html><title>Checkout</title><h1>Total $12.98</h1>
        <label>Email <input id="email" name="email"></label>
        <iframe id="card" src="http://localhost:${port}/card" style="width:420px;height:80px;border:0"></iframe>
        <button id="pay">Pay $12.98</button>
        <script>
          addEventListener("message", async (event) => {
            if (event.data !== "charged") return
            await fetch("/order", { method: "POST", body: document.getElementById("email").value })
            location.href = "/thanks"
          })
          document.getElementById("pay").onclick = () =>
            document.getElementById("card").contentWindow.postMessage("charge", "*")
        </script>`)
    })

    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page)
    await page.goto("/")

    // A card is saved for the workspace. Its number is not in what the server answers with.
    const { workspaces } = (await (await page.request.get("/api/workspaces")).json()) as {
      workspaces: { id: string; savedCards?: boolean }[]
    }
    expect(workspaces[0]!.savedCards).toBe(true)
    const made = await page.request.post(`/api/workspaces/${workspaces[0]!.id}/cards`, {
      data: {
        number: "4242 4242 4242 4242",
        expMonth: 8,
        expYear: 2040,
        holder: "Sawyer Hood",
        postalCode: "94107",
      },
    })
    expect(made.status()).toBe(201)
    expect(await made.text()).not.toContain(NUMBER)

    const pay = () =>
      callTool(page, "pay", {
        button: "Pay $12.98",
        purpose: "A domain for a year, $12.98",
        fields: [{ box: "Email", text: "sawyer@example.com" }],
      })
    await browse(page, `http://127.0.0.1:${port}/checkout`)
    await pay()

    // They are asked, with the site as the browser has it and the Dood's own words for it.
    await expect(request(page)).toContainText("Pay on 127.0.0.1 with Visa ending 4242", {
      timeout: 30_000,
    })
    await expect(request(page)).toContainText(`Page: http://127.0.0.1:${port}/checkout`)
    await expect(request(page)).toContainText("It will press: “Pay $12.98”")
    await expect(request(page)).toContainText("It says: “A domain for a year, $12.98”")
    // A yes comes with the card's security code, and with nothing else: not for good.
    const allow = request(page).getByRole("button", { name: "Allow once" })
    await expect(allow).toBeDisabled()
    await expect(request(page).getByRole("button", { name: "Always allow" })).toHaveCount(0)
    await request(page).getByLabel("Security code").fill("9173")
    await allow.click()
    await expect(request(page)).toHaveCount(0)
    expect(charged).toEqual([])

    // The Dood pays: the card is typed into the other site's frame and the button pressed.
    await pay()
    await expect(page.locator('[data-pay="sent"]')).toBeVisible({ timeout: 60_000 })
    expect(charged.map((body) => JSON.parse(body))).toEqual([
      { number: NUMBER, exp: "0840", cvc: "9173", zip: "94107" },
    ])
    expect(ordered).toEqual(["sawyer@example.com"])

    // Nothing the app shows or keeps has the card's number in it, and nor has the daemon.
    expect(await page.content()).not.toContain(NUMBER)
    const [, agentId, chatId] = /\/a\/([^/]+)\/c\/(\d+)/.exec(page.url())!
    const kept = await (await page.request.get(`/api/agents/${agentId}/chats/${chatId}`)).text()
    expect(kept).toContain('"pay"')
    expect(kept).not.toContain(NUMBER)
    const written = everythingIn(dir, join(dir, "browser", "browser-profile"))
    expect(written).toContain("browser_pay")
    expect(written).not.toContain(NUMBER)
    expect(output).not.toContain(NUMBER)

    // The next payment asks again, code and all.
    await browse(page, `http://127.0.0.1:${port}/checkout`)
    await pay()
    await expect(request(page)).toContainText("Pay on 127.0.0.1 with Visa ending 4242", {
      timeout: 30_000,
    })
    await expect(request(page).getByLabel("Security code")).toHaveValue("")
    await request(page).getByRole("button", { name: "Don’t allow" }).click()
    await expect(request(page)).toHaveCount(0)
    expect(charged).toHaveLength(1)
  })
})
