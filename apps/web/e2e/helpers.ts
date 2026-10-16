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

/** The heading of a section of the agent's panel, which folds it and opens it. */
export const sectionHeading = (page: Page, section: string) =>
  page
    .getByRole("complementary", { name: /^About / })
    .getByRole("region", { name: section, exact: true })
    .getByRole("heading")
    .getByRole("button")

/**
 * Open a section of the agent's panel that is folded under its heading, as the ones that are
 * seldom wanted are until they are asked for. One that is open already is left as it is.
 */
export async function unfold(page: Page, section: string) {
  const heading = sectionHeading(page, section)
  await expect(heading).toBeVisible()
  if ((await heading.getAttribute("aria-expanded")) === "false") await heading.click()
  await expect(heading).toHaveAttribute("aria-expanded", "true")
}

/**
 * Open a section of the open agent's settings, from the menu on its name above its pages. They
 * are one part of the settings window, which is over whichever page is showing. Slack is set
 * up from the agent's connectors.
 */
export async function openSettings(page: Page, section: string) {
  const dialog = page.getByRole("dialog")
  // Settings that are open somewhere else, at their top or on a workspace, are shut first.
  if (
    (await dialog.count()) > 0 &&
    (await dialog.getByRole("button", { name: "Back to Doods" }).count()) === 0
  ) {
    await closeSettings(page)
  }
  if ((await dialog.count()) === 0) await fromNameMenu(page, /'s settings$/)
  await dialog
    .getByRole("button", { name: section === "Slack" ? "Connectors" : section, exact: true })
    .click()
  if (section === "Slack")
    await dialog.getByRole("button", { name: /^(Set up|Manage) Slack$/ }).click()
}

/** The menu of the workspace the open page is in, on the heading over its agents in the sidebar. */
export const workspaceMenu = (page: Page) =>
  page.locator("section[data-current]").getByRole("button", { name: /workspace menu$/ })

/** Open a section of the open workspace's settings, from the workspace's menu. */
export async function openWorkspaceSettings(page: Page, section: string) {
  if ((await page.getByRole("dialog").count()) > 0) await closeSettings(page)
  await workspaceMenu(page).click()
  await page.getByRole("menuitem", { name: /Workspace settings/ }).click()
  await page.getByRole("dialog").getByRole("button", { name: section, exact: true }).click()
}

/**
 * Open one of the settings that are the user's own, or the deployment's, from the menu on the
 * user's name: General, Notifications, Agents, Workspaces, and for those who look after the
 * deployment its Models and Waiting list.
 */
export async function openOwnSettings(page: Page, section: string) {
  if ((await page.getByRole("dialog").count()) > 0) await closeSettings(page)
  await page.getByRole("button", { name: /settings and signing out$/ }).click()
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click()
  await page.getByRole("dialog").getByRole("button", { name: section, exact: true }).click()
}

/** Close whichever settings window is open, leaving the page that was under it. */
export async function closeSettings(page: Page) {
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
}

/**
 * Open a file of the library from the list of all its files, which is on the library's front
 * page. From a file that is open, the way back there is the name over the list beside it.
 */
export async function openFile(page: Page, name: string | RegExp) {
  const files = page.getByRole("navigation", { name: "Files" })
  if ((await files.count()) === 0) {
    await page.getByRole("heading", { name: "Library", exact: true }).getByRole("link").click()
  }
  await files.getByRole("link", { name }).click()
}

/** The agent's name above its pages, which opens the menu of everything else of the agent's. */
export const nameMenu = (page: Page) =>
  page.getByRole("button", { name: /: pages, side chats and settings$/ })

/** Choose something from the menu on the agent's name, opening the menu if it is shut. */
export async function fromNameMenu(page: Page, name: string | RegExp) {
  // A menu that has just been chosen from is still on the page for a moment, on its way out.
  const menu = nameMenu(page)
  if ((await menu.getAttribute("aria-expanded")) !== "true") await menu.click()
  await page.getByRole("menuitem", { name, exact: true }).click()
}

/** One of the agent's pages, in the menu on its name. Pressing it opens the menu first. */
export const tab = (page: Page, name: "Chat" | "Library" | "Automations") => ({
  click: () => fromNameMenu(page, name),
})

/**
 * The way to the agent's side chats: a row of the menu on its name, which opens into them.
 * Pressing it opens the menu first.
 */
export const sideChats = (page: Page) => ({
  click: () => fromNameMenu(page, /'s side chats$/),
})

/** Show the agent's panel beside its pages, or put it away, from the menu on its name. */
export const panelSwitch = (page: Page, to: "Show" | "Hide", name = "Juniper") =>
  fromNameMenu(page, `${to} ${name}'s panel`)

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
 * On a wide screen the sidebar starts as a column of faces and the panel about the agent starts
 * put away. Most of these tests work in the sidebar's list and read the transcript, so they have
 * the sidebar open, the way someone might have left it. The tests of those two say so.
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
