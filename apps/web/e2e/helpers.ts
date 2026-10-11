import { expect, type Page } from "@playwright/test"
import { test } from "./fixtures.ts"

export const owner = {
  name: "Sawyer",
  email: "owner@example.com",
  password: "correct horse battery",
}

/**
 * Make an account, and give it a first agent. Someone new makes theirs in the first run, where
 * they meet their agent, which `welcome.spec.ts` is about. For every other file both are made
 * the plain way: the account with what the first run would send, the agent with no name and
 * still in its egg, and its chat is opened.
 */
export async function signUp(page: Page, account = owner) {
  expect((await page.request.post("/api/auth/sign-up/email", { data: account })).status()).toBe(200)
  expect((await page.request.post("/api/agents")).status()).toBe(201)
  await page.goto("/")
}

/**
 * The card under the egg in the first run, once it has said its piece and what it asks for can
 * be answered. Until then what is in it cannot be typed in or pressed.
 */
export async function card(page: Page, says: string | RegExp) {
  const asked = page.locator("[data-card]")
  await expect(asked.getByRole("status")).toHaveText(says)
  return asked
}

/** Say hello to the egg, and tell it who they are: that is making an account. */
export async function introduce(page: Page, account = owner) {
  await (
    await card(page, /Is somebody out there\?/)
  )
    .getByRole("button", { name: "Hello!" })
    .click()
  const you = await card(page, /who are you\?/)
  await you.getByLabel("Your name").fill(account.name)
  await you.getByLabel("Email").fill(account.email)
  await you.getByLabel("Password").fill(account.password)
  await you.getByRole("button", { name: "That’s me" }).click()
  return you
}

export async function signIn(page: Page) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(owner.email)
  await page.getByLabel("Password").fill(owner.password)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForURL(/\/a\/[^/]+\/c\/\d+/)
}

export const composer = (page: Page) => page.getByRole("textbox", { name: "Message" })

/**
 * Open a section of the agent's settings. They are a window over whichever of its pages is
 * showing, opened from the end of the strip above them.
 */
export async function openSettings(page: Page, section: string) {
  const dialog = page.getByRole("dialog")
  if ((await dialog.count()) === 0) await page.getByRole("button", { name: /'s settings$/ }).click()
  await dialog.getByRole("button", { name: section, exact: true }).click()
}

/** Open a section of the workspace's settings, from the menu on the user's name. */
export async function openWorkspaceSettings(page: Page, section: string) {
  await page.getByRole("button", { name: /settings and signing out$/ }).click()
  await page.getByRole("menuitem", { name: /Workspace settings/ }).click()
  await page.getByRole("dialog").getByRole("button", { name: section, exact: true }).click()
}

/** Close whichever settings window is open, leaving the page that was under it. */
export async function closeSettings(page: Page) {
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
}

/** One of the agent's tabs, in the strip above its pages. */
export const tab = (page: Page, name: "Chat" | "Library" | "Automations") =>
  page.getByRole("link", { name, exact: true })

/** The way to the agent's side chats, at the end of its strip. */
export const sideChats = (page: Page) => page.getByRole("button", { name: /'s side chats$/ })

/**
 * Start a side chat and give it the middle of the page, so that it is the only chat on screen
 * and typing lands in it. Started from the main chat on a wide screen it opens beside it, where
 * there would be two boxes to write in.
 */
export async function newChat(page: Page) {
  // A settings window is over the page, and in the way, until it is closed.
  if ((await page.getByRole("dialog").count()) > 0) await closeSettings(page)
  const before = page.url()
  // The address changes a moment before the page does. Until the page is listening to the new
  // chat, the message box is still the old one's, and what is typed there stays behind with it.
  // It says so on the socket it follows the agent over, which is already open: so what it
  // says there is listened to from inside the page.
  const listening = page.evaluate(
    (before) =>
      new Promise<void>((resolve) => {
        const send = WebSocket.prototype.send
        WebSocket.prototype.send = function (data) {
          send.call(this, data)
          try {
            const said = JSON.parse(String(data)) as { type?: string; chat?: string }
            if (said.type !== "follow" || before.endsWith(`/c/${said.chat}`)) return
            WebSocket.prototype.send = send
            resolve()
          } catch {
            // Not something said to an agent.
          }
        }
      }),
    before,
  )
  await sideChats(page).click()
  await page.getByRole("menuitem", { name: "New side chat" }).click()
  await page.waitForURL((url) => /\/c\/\d+$/.test(url.pathname) && url.href !== before)
  await listening
  if (new URL(page.url()).searchParams.has("side")) {
    await page.getByRole("link", { name: "Give it the whole chat" }).click()
    await page.waitForURL((url) => !url.searchParams.has("side"))
  }
  // Here too the address changes before the page does: wait until the one chat is all there is.
  await expect(page.getByRole("complementary", { name: /^Side chat:/ })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Main chat", exact: true })).toBeVisible()
  await expect(composer(page)).toHaveValue("")
}

/** Have the agent call a tool, and wait for what the tool says it did. */
export async function tool(
  page: Page,
  name: string,
  args: Record<string, unknown>,
  said: string | RegExp,
) {
  await composer(page).fill(`/tool ${name} ${JSON.stringify(args)}`)
  await page.keyboard.press("Enter")
  await expect(page.getByText(said).last()).toBeVisible()
}

/**
 * How a file of the web app's tests begins. Its tests run in order, on a server of their own.
 *
 * On a wide screen the sidebar starts closed and the panel about the agent starts open. Most of
 * these tests work in the sidebar's list and read the transcript, so they have the sidebar open
 * and the panel put away, the way someone might have left them. The tests of those two say so.
 */
export function inOrder() {
  test.describe.configure({ mode: "serial" })
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("dc-chat-list", "open")
      localStorage.setItem("dc-agent-panel", "closed")
    })
  })
}

/**
 * The same, for a file that is not about signing up: the owner's account is there before its
 * first test, with the agent named Juniper and so out of its egg. Or with no name yet, when
 * giving it one is what the file's first test is about.
 */
export function asOwner({ agent = "Juniper" }: { agent?: string | null } = {}) {
  inOrder()
  test.beforeAll(async ({ browser, baseURL }) => {
    const page = await browser.newPage({ baseURL })
    await signUp(page)
    await page.waitForURL(/\/a\/[^/]+\/c\/\d+/)
    if (agent !== null) {
      const agentId = page.url().match(/\/a\/([^/]+)/)![1]!
      const named = await page.request.patch(`/api/agents/${agentId}`, { data: { name: agent } })
      expect(named.status()).toBe(200)
    }
    await page.close()
  })
}
