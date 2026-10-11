import type { Browser, Page } from "@playwright/test"
import { expect, test } from "./fixtures.ts"
import { asOwner, closeSettings, composer, newChat, openSettings, signIn } from "./helpers.ts"

asOwner()

/** The socket a page follows an agent over. */
const AGENT_SOCKET = /\/api\/agents\/[^/]+\/socket$/

/**
 * The same person in a second browser, on the page the first one is on. It is listening to the
 * agent before anything is asked of it, which is when what it is told later is decided.
 */
async function second(browser: Browser, baseURL: string | undefined, first: Page): Promise<Page> {
  const context = await browser.newContext({ baseURL })
  await context.addInitScript(severable)
  const page = await context.newPage()
  await signIn(page)
  // Signing in opens the app, which may only now be starting to follow the agent. That page's
  // socket ends with the page, so the page is left before the next one's socket is listened for.
  await page.goto("about:blank")
  const listening = page
    .waitForEvent("websocket", (socket) => AGENT_SOCKET.test(new URL(socket.url()).pathname))
    .then((socket) =>
      socket.waitForEvent("framereceived", (frame) => String(frame.payload).includes('"ready"')),
    )
  await page.goto(first.url())
  await listening
  await expect(composer(page)).toBeEnabled()
  return page
}

/**
 * Lets a test cut a page off from what the server sends it as it happens, the way a laptop that
 * slept or a network that changed does: the sockets and streams it was following end, and no
 * new one is answered until it is mended.
 */
function severable() {
  const fetch = window.fetch.bind(window)
  const streams = new Set<AbortController>()
  const sockets = new Set<WebSocket>()
  let down = false
  const Real = window.WebSocket
  window.WebSocket = class extends Real {
    constructor(url: string | URL, protocols?: string | string[]) {
      const followed = /\/api\/agents\/[^/]+\/(library\/)?socket$/.test(
        new URL(url, location.href).pathname,
      )
      // Cut off, it is asked of an address nothing answers at, and fails as a lost network does.
      super(followed && down ? "ws://127.0.0.1:9/" : url, protocols)
      if (!followed) return
      sockets.add(this)
      this.addEventListener("close", () => sockets.delete(this))
    }
  }
  window.fetch = async (input, init) => {
    const url = typeof input === "string" || input instanceof URL ? String(input) : input.url
    if (!/\/events$/.test(new URL(url, location.href).pathname)) return fetch(input, init)
    if (down) throw new TypeError("Failed to fetch")
    const controller = new AbortController()
    init?.signal?.addEventListener("abort", () => controller.abort())
    streams.add(controller)
    return fetch(input, { ...init, signal: controller.signal })
  }
  Object.assign(window, {
    sever: () => {
      down = true
      for (const stream of streams) stream.abort()
      streams.clear()
      for (const socket of [...sockets]) socket.close()
    },
    mend: () => {
      down = false
    },
  })
}

async function say(page: Page, text: string) {
  await expect(composer(page)).toBeEnabled()
  await composer(page).fill(text)
  await composer(page).press("Enter")
}

test.describe("two clients on one chat", () => {
  test("a secret given on one closes the form on the other", async ({ page, browser, baseURL }) => {
    await signIn(page)
    await newChat(page)
    const other = await second(browser, baseURL, page)
    const forms = (on: Page) => on.getByRole("list", { name: "Secrets it asked for" })

    await say(page, `/tool request_secret ${JSON.stringify({ secrets: [{ name: "FIRST_KEY" }] })}`)
    await expect(forms(page).getByText("Juniper asks for a secret")).toBeVisible()
    await expect(forms(other).getByText("Juniper asks for a secret")).toBeVisible()

    await forms(page).getByLabel("FIRST_KEY", { exact: true }).fill("one-1")
    await forms(page).getByRole("button", { name: "Save secret" }).click()
    await expect(forms(page)).toHaveCount(0)
    await expect(forms(other)).toHaveCount(0)

    // And the other way about: asked on the second, and given there.
    await say(other, `/tool request_secret ${JSON.stringify({ secrets: [{ name: "NEXT_KEY" }] })}`)
    await expect(forms(page).getByText("Juniper asks for a secret")).toBeVisible()
    await expect(forms(other).getByText("Juniper asks for a secret")).toBeVisible()
    await forms(other).getByLabel("NEXT_KEY", { exact: true }).fill("two-2")
    await forms(other).getByRole("button", { name: "Save secret" }).click()
    await expect(forms(other)).toHaveCount(0)
    await expect(forms(page)).toHaveCount(0)
    await other.context().close()
  })

  test("a rule set on one is the rule on the other, and so is an answer", async ({
    page,
    browser,
    baseURL,
  }) => {
    await signIn(page)
    await newChat(page)
    const other = await second(browser, baseURL, page)
    const commands = (on: Page) => on.getByRole("group", { name: "Run commands" })
    const waiting = (on: Page) => on.getByRole("list", { name: "Waiting for your OK" })

    await openSettings(other, "Permissions")
    await expect(
      commands(other).getByRole("button", { name: "Allow", pressed: true }),
    ).toBeVisible()
    await openSettings(page, "Permissions")
    await commands(page).getByRole("button", { name: "Ask first" }).click()
    await expect(
      commands(other).getByRole("button", { name: "Ask first", pressed: true }),
    ).toBeVisible()

    await closeSettings(other)
    await newChat(page)
    await other.goto(page.url())
    await say(page, '/tool bash {"command":"echo seen-by-both"}')
    await expect(waiting(page).getByText("echo seen-by-both")).toBeVisible()
    await expect(waiting(other).getByText("echo seen-by-both")).toBeVisible()
    await waiting(other).getByRole("button", { name: "Allow once" }).click()
    await expect(waiting(other)).toHaveCount(0)
    await expect(waiting(page)).toHaveCount(0)

    // Back to trusting it.
    await openSettings(page, "Permissions")
    await commands(page).getByRole("button", { name: "Allow" }).click()
    await openSettings(other, "Permissions")
    await expect(
      commands(other).getByRole("button", { name: "Allow", pressed: true }),
    ).toBeVisible()
    await other.context().close()
  })

  test("one that opens just as something changes is shown it", async ({
    page,
    browser,
    baseURL,
  }) => {
    await signIn(page)
    await newChat(page)
    const forms = (on: Page) => on.getByRole("list", { name: "Secrets it asked for" })
    const context = await browser.newContext({ baseURL })
    const other = await context.newPage()
    await signIn(other)
    // The second one's socket to the agent is slow to be answered. It has asked for what
    // there is, and is not yet being told of what changes.
    let answer = () => {}
    const held = new Promise<void>((resolve) => {
      answer = resolve
    })
    await other.routeWebSocket(AGENT_SOCKET, async (socket) => {
      await held
      socket.connectToServer()
    })
    await other.goto(page.url())
    await expect(composer(other)).toBeEnabled()

    await say(page, `/tool request_secret ${JSON.stringify({ secrets: [{ name: "SOON_KEY" }] })}`)
    await expect(forms(page).getByText("Juniper asks for a secret")).toBeVisible()
    await expect(forms(other)).toHaveCount(0)

    // Once it is listening it asks again for what it has, which is how it comes to see this.
    answer()
    await expect(forms(other).getByText("Juniper asks for a secret")).toBeVisible()
    await forms(other).getByLabel("SOON_KEY", { exact: true }).fill("soon-1")
    await forms(other).getByRole("button", { name: "Save secret" }).click()
    await expect(forms(other)).toHaveCount(0)
    await expect(forms(page)).toHaveCount(0)
    await context.close()
  })

  test("one that lost the server for a while is shown what changed meanwhile", async ({
    page,
    browser,
    baseURL,
  }) => {
    await signIn(page)
    await newChat(page)
    const other = await second(browser, baseURL, page)
    const forms = (on: Page) => on.getByRole("list", { name: "Secrets it asked for" })

    await say(page, `/tool request_secret ${JSON.stringify({ secrets: [{ name: "AWAY_KEY" }] })}`)
    await expect(forms(page).getByText("Juniper asks for a secret")).toBeVisible()
    await expect(forms(other).getByText("Juniper asks for a secret")).toBeVisible()

    // Nothing reaches the second one while the first answers.
    await other.evaluate("window.sever()")
    await forms(page).getByLabel("AWAY_KEY", { exact: true }).fill("three-3")
    await forms(page).getByRole("button", { name: "Save secret" }).click()
    await expect(forms(page)).toHaveCount(0)
    await expect(forms(other).getByText("Juniper asks for a secret")).toBeVisible()

    await other.evaluate("window.mend()")
    await expect(forms(other)).toHaveCount(0, { timeout: 15_000 })
    await other.context().close()
  })

  test("a rule set while one was cut off is the rule there once it is back", async ({
    page,
    browser,
    baseURL,
  }) => {
    await signIn(page)
    const other = await second(browser, baseURL, page)
    const commands = (on: Page) => on.getByRole("group", { name: "Run commands" })
    await openSettings(other, "Permissions")
    await expect(
      commands(other).getByRole("button", { name: "Allow", pressed: true }),
    ).toBeVisible()

    await other.evaluate("window.sever()")
    await openSettings(page, "Permissions")
    await commands(page).getByRole("button", { name: "Ask first" }).click()
    await expect(
      commands(page).getByRole("button", { name: "Ask first", pressed: true }),
    ).toBeVisible()
    await expect(
      commands(other).getByRole("button", { name: "Allow", pressed: true }),
    ).toBeVisible()

    await other.evaluate("window.mend()")
    await expect(
      commands(other).getByRole("button", { name: "Ask first", pressed: true }),
    ).toBeVisible({ timeout: 15_000 })

    // Back to trusting it.
    await commands(other).getByRole("button", { name: "Allow" }).click()
    await expect(commands(page).getByRole("button", { name: "Allow", pressed: true })).toBeVisible()
    await other.context().close()
  })
})
