import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures.ts"
import { asOwner, composer, signIn, tab } from "./helpers.ts"

asOwner()

/**
 * Hold back everything the page asks the server for, until it is let through. What the page
 * shows meanwhile is what it shows without waiting. Returns what was asked for, by path, and
 * the way to let it all through, after which nothing more is held.
 */
async function holdRequests(page: Page) {
  const asked: string[] = []
  const waiting: (() => void)[] = []
  let held = true
  await page.route("**/api/**", async (route) => {
    asked.push(new URL(route.request().url()).pathname)
    if (held) await new Promise<void>((resolve) => waiting.push(resolve))
    await route.continue()
  })
  return {
    asked,
    release: () => {
      held = false
      for (const resolve of waiting) resolve()
    },
  }
}

const agentRow = (page: Page, name: RegExp) =>
  page.getByRole("navigation", { name: "Agents" }).getByRole("link", { name })

test("the frame of the app is in the page as it is sent", async ({ page }) => {
  await signIn(page)
  // Before any of the app's code has run, and before anything is known of who is asking.
  const sent = await (await page.request.get(page.url())).text()
  expect(sent).toContain("data-loading")
  expect(sent).toContain("What it did here")
})

test("choosing an agent moves the page before the server has answered", async ({ page }) => {
  await signIn(page)
  await composer(page).fill("Said to Juniper")
  await page.keyboard.press("Enter")
  await expect(page.getByText("You said: Said to Juniper")).toBeVisible()
  const juniper = page.url()
  await page.getByRole("button", { name: "New agent", exact: true }).click()
  await page.waitForURL((url) => /\/c\/\d+$/.test(url.pathname) && url.href !== juniper)
  await expect(composer(page)).toBeVisible()

  // Loaded again, so nothing of Juniper is kept in the page but which chat is its main one.
  await page.reload()
  await expect(composer(page)).toBeVisible()
  const server = await holdRequests(page)
  await agentRow(page, /Juniper/).click()
  // The address, the row, the strip and the message box are Juniper's at once.
  await page.waitForURL(juniper)
  await expect(agentRow(page, /Juniper/)).toHaveAttribute("aria-current", "page")
  await expect(page.getByRole("button", { name: "Juniper: another agent" })).toBeVisible()
  await expect(composer(page)).toHaveAttribute("placeholder", "Message Juniper")
  // What was said is on its way, and its place is held. It is not an empty chat.
  await expect(page.locator("main [data-loading]").first()).toBeVisible()
  await expect(page.getByText("What would you like to do?")).toHaveCount(0)
  // Who is signed in was asked when the page loaded, and is not asked again.
  expect(server.asked).not.toContain("/api/me")
  server.release()
  await expect(page.getByText("You said: Said to Juniper")).toBeVisible()
  await expect(page.locator("main [data-loading]")).toHaveCount(0)

  // Going back to an agent that was open: what it last showed is there without asking.
  const again = await holdRequests(page)
  await agentRow(page, /New agent/).click()
  await expect(composer(page)).toHaveAttribute("placeholder", "Say hello")
  await agentRow(page, /Juniper/).click()
  await expect(page.getByText("You said: Said to Juniper")).toBeVisible()
  again.release()
})

test("a tab's page is there at once, and its list when it arrives", async ({ page }) => {
  await signIn(page)
  const server = await holdRequests(page)
  await tab(page, "Automations").click()
  await expect(page.getByRole("heading", { name: "Automations" })).toBeVisible()
  await expect(page.locator("main [data-loading]").first()).toBeVisible()
  // Not yet said to be empty: it is not known to be.
  await expect(page.getByText("Nothing scheduled yet.")).toHaveCount(0)
  server.release()
  await expect(page.getByText("Nothing scheduled yet.")).toBeVisible()

  const again = await holdRequests(page)
  await tab(page, "Library").click()
  await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible()
  await expect(page.locator("[data-loading]").first()).toBeVisible()
  again.release()
  await expect(page.getByText("Nothing here yet.").first()).toBeVisible()
})

test("a session that has ended is found out by the next thing asked for", async ({ page }) => {
  await signIn(page)
  await expect(composer(page)).toBeVisible()
  const automations = (await tab(page, "Automations").boundingBox())!
  await page.context().clearCookies()
  // Who is signed in is not asked again on the way to a page. Whatever the page asks for next
  // is refused, and that sends the visitor to sign in. Pointing at a tab asks for what its page
  // shows, if nothing else has asked first.
  await page.mouse.move(automations.x + automations.width / 2, automations.y + 8)
  await page.waitForURL(/\/login$/)
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible()
})

test("a message is in the chat the moment it is sent", async ({ page }) => {
  await signIn(page)
  await expect(composer(page)).toBeVisible()
  const server = await holdRequests(page)
  await composer(page).fill("Shown as soon as it is sent")
  await page.keyboard.press("Enter")
  // The request to send it has not come back. It is where it will be, and being thought about.
  const mine = page.getByText("Shown as soon as it is sent", { exact: true })
  await expect(mine).toBeVisible()
  await expect(page.getByText("Thinking…")).toBeVisible()
  await expect(composer(page)).toHaveValue("")
  expect(server.asked.some((path) => path.endsWith("/messages"))).toBe(true)
  server.release()
  await expect(page.getByText("You said: Shown as soon as it is sent")).toBeVisible()
  // Once: the chat's own copy has taken the place of the one shown ahead of it.
  await expect(mine).toHaveCount(1)

  // One that does not go is taken back out, and is in the box again to be sent again.
  await page.route("**/chats/*/messages", (route) => route.abort())
  await composer(page).fill("This one does not go")
  await page.keyboard.press("Enter")
  await expect(page.getByRole("alert")).toContainText("That was not sent")
  await expect(composer(page)).toHaveValue("This one does not go")
  await expect(
    page.locator("[data-slot=bubble-content]").filter({ hasText: "This one does not go" }),
  ).toHaveCount(0)
  await expect(page.getByText("Thinking…")).toHaveCount(0)
})
