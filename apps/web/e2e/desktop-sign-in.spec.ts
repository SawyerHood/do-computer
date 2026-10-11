import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures.ts"
import { inOrder, owner, signUp } from "./helpers.ts"

inOrder()

/** The word the app sends the browser with, and expects back. */
const STATE = "st4te_of-the-desktop-app-0123456"

/**
 * What the desktop app has listening on this computer while its owner is in the browser: it
 * answers `/done` and keeps what the browser came back with.
 */
async function app(): Promise<{ port: number; came: Promise<URLSearchParams>; close: () => void }> {
  let arrived: (search: URLSearchParams) => void
  const came = new Promise<URLSearchParams>((resolve) => {
    arrived = resolve
  })
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    if (url.pathname !== "/done") {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { "content-type": "text/html" })
    response.end("<!doctype html><title>Done</title><h1>Back to the app</h1>")
    arrived(url.searchParams)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  return { port: (server.address() as AddressInfo).port, came, close: () => server.close() }
}

/** Give the server a token from a page, the way the app's window does. */
const exchange = (page: Page, token: string) =>
  page.evaluate(async (token) => {
    const response = await fetch("/api/auth/desktop/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    })
    return { status: response.status, said: (await response.json()) as { message?: string } }
  }, token)

const me = async (page: Page) => {
  const response = await page.request.get("/api/me")
  return { status: response.status(), email: (await response.json())?.user?.email as unknown }
}

test("the browser's sign-in is handed to the desktop app, which gets a session of its own", async ({
  page,
  browser,
  baseURL,
}) => {
  await signUp(page)
  // Wherever signing up lands, it is over once there is a session.
  await expect.poll(async () => (await me(page)).status).toBe(200)

  const desktop = await app()
  try {
    await page.goto(`/desktop/sign-in?port=${desktop.port}&state=${STATE}`)
    await expect(
      page.getByText(`Sign in to the Do Computer app as ${owner.name} (${owner.email})?`),
    ).toBeVisible()
    await page.getByRole("button", { name: "Continue" }).click()

    const came = await desktop.came
    expect(came.get("state")).toBe(STATE)
    const token = came.get("token") ?? ""
    expect(token).not.toBe("")
    await expect(page).toHaveURL(new RegExp(`^http://127\\.0\\.0\\.1:${desktop.port}/done\\?`))

    // The app's window: a browser of its own, with no cookies of this one's.
    const context = await browser.newContext({ baseURL })
    const window = await context.newPage()
    await window.goto("/login")
    expect((await me(window)).status).toBe(401)
    expect((await exchange(window, token)).status).toBe(200)
    expect(await me(window)).toEqual({ status: 200, email: owner.email })

    // A token is good once.
    const again = await exchange(window, token)
    expect(again.status).toBe(400)
    expect(again.said.message).toContain("Start again from the Do Computer app")

    // Each is signed in by itself: signing out of the app leaves the browser as it was.
    // Asked from the page, as the app's window does: a request that says where it is from.
    const signedOut = await window.evaluate(async () => {
      const response = await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
      return response.status
    })
    expect(signedOut).toBe(200)
    expect((await me(window)).status).toBe(401)
    expect(await me(page)).toEqual({ status: 200, email: owner.email })
    await context.close()
  } finally {
    desktop.close()
  }
})

test("someone who is not signed in signs in first, and is then asked", async ({ page }) => {
  const address = `/desktop/sign-in?port=45678&state=${STATE}`
  await page.goto(address)
  await expect(page.getByText("Sign in to continue to the Do Computer app.")).toBeVisible()
  await page.getByRole("link", { name: "Sign in" }).click()
  await expect(page).toHaveURL(`/login?next=${encodeURIComponent(address)}`)
  await page.getByLabel("Email").fill(owner.email)
  await page.getByLabel("Password").fill(owner.password)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForURL((url) => url.pathname === "/desktop/sign-in")
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Use another account" })).toBeVisible()
})

test("someone new who the app sent here makes their account on the plain form", async ({
  page,
}) => {
  // The app's own window is showing the first run. Its owner's browser is only where they
  // sign in, so it is the one place that `/signup` is still a form.
  const address = `/desktop/sign-in?port=45678&state=${STATE}`
  await page.goto(`/login?next=${encodeURIComponent(address)}`)
  await page.getByRole("link", { name: "Create an account" }).click()
  await expect(page).toHaveURL(`/signup?next=${encodeURIComponent(address)}`)
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Create account" })).toBeVisible()
})

test("a link the app did not make goes nowhere", async ({ page }) => {
  for (const search of [
    "",
    `?port=80&state=${STATE}`,
    `?port=45678&state=short`,
    `?port=45678@example.com&state=${STATE}`,
    `?port=45678&state=${STATE}&provider=elsewhere`,
  ]) {
    await page.goto(`/desktop/sign-in${search}`)
    await expect(
      page.getByText("This link is not complete. Start again from the Do Computer app."),
    ).toBeVisible()
    await expect(page.getByRole("button")).toHaveCount(0)
    await expect(page.getByRole("link")).toHaveCount(0)
  }
})
