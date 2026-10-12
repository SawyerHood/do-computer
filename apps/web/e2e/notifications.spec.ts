import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import type { Page } from "@playwright/test"
import { type FakeBrowser, fakeBrowser, readVapid } from "../src/server/web-push-testing.ts"
import { expect, test } from "./fixtures.ts"
import { inOrder, signIn, signUp } from "./helpers.ts"

inOrder()

type Pushed = { authorization: string; body: Uint8Array }

/** A push service on this machine, which keeps what the server sends it. */
async function pushService(): Promise<{ endpoint: string; pushed: Pushed[]; stop: () => void }> {
  const pushed: Pushed[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk: Buffer) => chunks.push(chunk))
    request.on("end", () => {
      pushed.push({
        authorization: request.headers.authorization ?? "",
        body: new Uint8Array(Buffer.concat(chunks)),
      })
      response.writeHead(201).end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  return { endpoint: `http://127.0.0.1:${port}/push/e2e`, pushed, stop: () => server.close() }
}

/**
 * A browser driven by tests has no push service of its own to subscribe to, and one without a
 * screen refuses notifications whatever it is told. So the browser's leave is given here, and
 * subscribing is answered with a subscription whose keys the test holds, at an address the test
 * listens on.
 */
async function subscribesTo(page: Page, browser: FakeBrowser, endpoint: string) {
  await page.addInitScript((given) => {
    const KEPT = "e2e-push-key"
    Object.defineProperty(Notification, "permission", { get: () => "granted" })
    Notification.requestPermission = async () => "granted"
    const subscription = (key: string) =>
      ({
        endpoint: given.endpoint,
        options: {
          applicationServerKey: Uint8Array.from(atob(key), (c) => c.charCodeAt(0)).buffer,
        },
        toJSON: () => given,
        unsubscribe: async () => {
          localStorage.removeItem(KEPT)
          return true
        },
      }) as unknown as PushSubscription
    PushManager.prototype.getSubscription = async () => {
      const key = localStorage.getItem(KEPT)
      return key === null ? null : subscription(key)
    }
    PushManager.prototype.subscribe = async (options) => {
      const bytes = new Uint8Array(options!.applicationServerKey as ArrayBuffer)
      localStorage.setItem(KEPT, btoa(String.fromCharCode(...bytes)))
      return subscription(localStorage.getItem(KEPT)!)
    }
  }, browser.subscription(endpoint))
}

const openNotifications = async (page: Page) => {
  await page.getByRole("button", { name: /settings and signing out$/ }).click()
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: "Notifications", exact: true }).click()
  return dialog
}

test("the app can be put on a phone's home screen", async ({ page, request }) => {
  await page.goto("/login")
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest",
  )
  const manifest = await (await request.get("/manifest.webmanifest")).json()
  expect(manifest).toMatchObject({
    name: "Do Computer",
    start_url: "/",
    display: "standalone",
  })
  const touch = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href")
  for (const icon of [touch, ...manifest.icons.map((icon: { src: string }) => icon.src)]) {
    const response = await request.get(icon)
    expect(response.status(), icon).toBe(200)
    expect(response.headers()["content-type"]).toBe("image/png")
  }
  expect((await request.get("/sw.js")).headers()["content-type"]).toContain("javascript")
})

test("notifications are turned on, tried and turned off again", async ({ page }) => {
  const service = await pushService()
  const browser = await fakeBrowser()
  await subscribesTo(page, browser, service.endpoint)
  await signUp(page)
  await page.waitForURL(/\/a\/[^/]+\/c\/\d+/)

  const dialog = await openNotifications(page)
  await expect(dialog.getByText("Off for this browser.")).toBeVisible()
  await dialog.getByRole("button", { name: "Turn on notifications" }).click()
  await expect(dialog.getByText("On for this browser.")).toBeVisible()

  await dialog.getByRole("button", { name: "Send a test" }).click()
  await expect(dialog.getByText("Sent. It should arrive in a moment.")).toBeVisible()
  // What the push service was sent is signed by this server and readable only by the browser.
  expect(service.pushed).toHaveLength(1)
  const key = await page.evaluate(() => fetch("/api/push/key").then((response) => response.json()))
  expect(await readVapid(service.pushed[0]!.authorization)).toMatchObject({ valid: true, ...key })
  expect(JSON.parse(await browser.read(service.pushed[0]!.body))).toMatchObject({
    title: "Do Computer",
    url: "/",
  })

  // It is still on after the page is loaded again.
  await page.reload()
  await expect(dialog.getByText("On for this browser.")).toBeVisible()
  await dialog.getByRole("button", { name: "Turn off" }).click()
  await expect(dialog.getByText("Off for this browser.")).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Turn on notifications" })).toBeVisible()
  service.stop()
})

test("a pushed notification is shown, and opens the page it is about", async ({
  page,
  context,
}) => {
  await signIn(page)
  const agentId = /\/a\/([^/]+)\//.exec(page.url())![1]!
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"))
  await page.evaluate(() => navigator.serviceWorker.ready)
  // A browser without a screen shows nothing. What the service worker asks to have shown is
  // kept, so that it can be looked at and tapped.
  await worker.evaluate(() => {
    type Shown = { title: string; body?: string; data?: unknown; close: () => void }
    const shown: Shown[] = []
    const registration = (self as unknown as ServiceWorkerGlobalScope).registration
    registration.showNotification = async (title, options) => {
      const one = { title, ...options, close: () => void shown.splice(shown.indexOf(one), 1) }
      shown.push(one)
    }
    registration.getNotifications = async () => shown as unknown as Notification[]
  })
  const shown = () =>
    worker.evaluate(async () => {
      const registration = (self as unknown as ServiceWorkerGlobalScope).registration
      return (await registration.getNotifications()).map(({ title, body }) => ({ title, body }))
    })

  // The push service's part is played here: the service worker is handed a message.
  await worker.evaluate(
    (message) => {
      self.dispatchEvent(new PushEvent("push", { data: JSON.stringify(message) }))
    },
    { title: "Juniper", body: "Two meetings today.", url: `/a/${agentId}/library` },
  )
  await expect.poll(shown).toEqual([{ title: "Juniper", body: "Two meetings today." }])

  // Tapping it takes the open app to that page, and puts the notification away.
  await worker.evaluate(async () => {
    const registration = (self as unknown as ServiceWorkerGlobalScope).registration
    const [notification] = await registration.getNotifications()
    const tap = new Event("notificationclick") as Event & { notification?: unknown }
    tap.notification = notification
    Object.assign(tap, { waitUntil: (work: Promise<unknown>) => void work.catch(() => undefined) })
    self.dispatchEvent(tap)
  })
  await expect(page).toHaveURL(new RegExp(`/a/${agentId}/library$`))
  expect(await shown()).toEqual([])
})
