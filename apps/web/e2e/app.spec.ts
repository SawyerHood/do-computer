import { expect, type Page, test } from "@playwright/test"

const owner = { name: "Sawyer", email: "owner@example.com", password: "correct horse battery" }

async function signUp(page: Page, account = owner) {
  await page.goto("/signup")
  await page.getByLabel("Name").fill(account.name)
  await page.getByLabel("Email").fill(account.email)
  await page.getByLabel("Password").fill(account.password)
  await page.getByRole("button", { name: "Create account" }).click()
}

async function signIn(page: Page) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(owner.email)
  await page.getByLabel("Password").fill(owner.password)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForURL(/\/a\/[^/]+\/c\/\d+/)
}

const composer = (page: Page) => page.getByRole("textbox", { name: "Message" })

/** Start a chat and wait until it is the one on screen, so typing lands in it. */
async function newChat(page: Page) {
  const before = page.url()
  await page.getByRole("button", { name: "New chat" }).click()
  await expect(page).not.toHaveURL(before)
  await expect(composer(page)).toHaveValue("")
}

// The tests share one server and run in order: the first creates the account the rest use.
test.describe.configure({ mode: "serial" })

test("a visitor is sent to sign in", async ({ page }) => {
  await page.goto("/")
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible()
})

test("signing up creates an agent and opens its first chat", async ({ page }) => {
  await signUp(page)
  await page.waitForURL(/\/a\/[^/]+\/c\/\d+/)
  await expect(page.getByRole("heading", { name: "Say hello" })).toBeVisible()
  await expect(page.getByText("It has no name yet")).toBeVisible()
})

test("a second account is refused on an invite-only deployment", async ({ page }) => {
  await signUp(page, { name: "Other", email: "other@example.com", password: owner.password })
  await expect(page.getByRole("alert")).toContainText("invitation")
  await expect(page).toHaveURL(/\/signup$/)
})

test("a message is answered, streamed into the transcript, and titles the chat", async ({
  page,
}) => {
  await signIn(page)
  await composer(page).fill("What can you do?")
  await page.keyboard.press("Enter")
  await expect(composer(page)).toHaveValue("")
  await expect(page.getByText("You said: What can you do?")).toBeVisible()
  await expect(page.getByRole("link", { name: "What can you do?" })).toBeVisible()

  // The transcript is the agent's, not the tab's: it is still there after a reload.
  await page.reload()
  await expect(page.getByText("You said: What can you do?")).toBeVisible()
})

test("assistant text is rendered as Markdown", async ({ page }) => {
  await signIn(page)
  await composer(page).fill("a list:\n\n- one\n- two")
  await page.keyboard.press("Enter")
  await expect(page.locator(".prose-chat li")).toHaveText(["one", "two"])
})

test("chats are separate, and an archived chat leaves the list", async ({ page }) => {
  await signIn(page)
  await page.getByRole("button", { name: "New chat" }).click()
  await expect(page.getByRole("heading", { name: "Say hello" })).toBeVisible()
  await composer(page).fill("second chat here")
  await page.keyboard.press("Enter")
  await expect(page.getByText("You said: second chat here")).toBeVisible()
  await expect(page.getByText("You said: What can you do?")).toHaveCount(0)

  await page.getByRole("link", { name: "second chat here" }).hover()
  await page.getByRole("button", { name: "Archive second chat here" }).click()
  await expect(page.getByRole("link", { name: "second chat here" })).toHaveCount(0)
  await expect(page.getByText("You said: What can you do?")).toBeVisible()
})

test("identity edits are saved and show up across the app", async ({ page }) => {
  await signIn(page)
  await page.getByRole("button", { name: "Identity and memory" }).click()
  await page.getByLabel("Name").fill("Juniper")
  await page.getByLabel("Tagline").fill("Calm and curious")
  await page.getByRole("button", { name: "Ember" }).click()
  await page.getByRole("button", { name: "Glasses" }).click()
  await page.locator("#user").fill("Prefers short answers")
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByText("Saved", { exact: true })).toBeVisible()

  await page.getByRole("link", { name: "Back to chat" }).click()
  await expect(page.getByText("Juniper").first()).toBeVisible()
  await expect(composer(page)).toHaveAttribute("placeholder", "Message Juniper")

  await page.reload()
  await page.getByRole("button", { name: "Identity and memory" }).click()
  await expect(page.getByLabel("Name")).toHaveValue("Juniper")
  await expect(page.locator("#user")).toHaveValue("Prefers short answers")
  await expect(page.getByRole("button", { name: "Ember" })).toHaveAttribute("aria-pressed", "true")
})

test("memory over its limit cannot be saved", async ({ page }) => {
  await signIn(page)
  await page.getByRole("button", { name: "Identity and memory" }).click()
  await page.locator("#user").fill("x".repeat(1400))
  await expect(page.getByText("1400 / 1375")).toBeVisible()
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled()
})

test("the agent uses its computer, and the transcript shows what it ran", async ({ page }) => {
  await signIn(page)
  await newChat(page)
  await composer(page).fill(
    '/tool bash {"command":"echo from the shell > note.txt && cat note.txt && ls"}',
  )
  await page.keyboard.press("Enter")
  await expect(page.getByText("The tool returned:")).toBeVisible()
  const row = page.getByRole("main").getByRole("button", { name: /echo from the shell/ })
  await row.click()
  await expect(page.locator("pre").filter({ hasText: "from the shell" }).last()).toContainText(
    "note.txt",
  )
  // The identity files are part of the workspace.
  await expect(page.locator("pre").last()).toContainText("MEMORY.md")
})

test("a scheduled task runs on its own and reports back to the chat it was asked in", async ({
  page,
}) => {
  await signIn(page)
  await newChat(page)
  const soon = new Date(Date.now() + 2_500).toISOString()
  await composer(page).fill(
    `/tool schedule {"action":"create","schedule":"${soon}","prompt":"Say the magic words","title":"Magic words"}`,
  )
  await page.keyboard.press("Enter")
  await expect(page.getByText(/Scheduled\. \w+: "Magic words"/)).toBeVisible()

  // Nothing else is sent: the report arrives by itself, live.
  await expect(page.getByText("Scheduled: Magic words")).toBeVisible({ timeout: 15_000 })
  await expect(
    page.getByText(/You said: \[You are running the scheduled task "Magic words"/),
  ).toBeVisible()

  await page.getByRole("button", { name: "Automations" }).click()
  const card = page.getByRole("listitem").filter({ hasText: "Magic words" })
  await expect(card.getByText("Done", { exact: true })).toBeVisible()
  await expect(card.getByText(/reported back/)).toBeVisible()
  await card.getByRole("link", { name: "View run" }).click()
  await expect(page.getByText("Say the magic words").first()).toBeVisible()
})

test("automations can be paused, run on demand and deleted", async ({ page }) => {
  await signIn(page)
  await newChat(page)
  await composer(page).fill(
    '/tool schedule {"action":"create","schedule":"every 6h","prompt":"Stretch","title":"Stretch break"}',
  )
  await page.keyboard.press("Enter")
  await expect(page.getByText(/Scheduled\./)).toBeVisible()

  await page.getByRole("button", { name: "Automations" }).click()
  const card = page.getByRole("listitem").filter({ hasText: "Stretch break" })
  await expect(card.getByText("Active", { exact: true })).toBeVisible()
  await card.getByRole("button", { name: "Pause" }).click()
  await expect(card.getByText("Paused", { exact: true })).toBeVisible()
  await card.getByRole("button", { name: "Run now" }).click()
  await expect(card.getByText(/Last run/)).toBeVisible({ timeout: 15_000 })
  await card.getByRole("button", { name: "Delete Stretch break" }).click()
  await expect(page.getByRole("listitem").filter({ hasText: "Stretch break" })).toHaveCount(0)
})

test("scheduled runs do not clutter the chat list", async ({ page }) => {
  await signIn(page)
  await expect(page.getByRole("link", { name: "Magic words", exact: true })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Stretch break", exact: true })).toHaveCount(0)
})

test("the agent saves a skill, and it can be read, switched off and deleted", async ({ page }) => {
  await signIn(page)
  await newChat(page)
  await composer(page).fill(
    '/tool skill {"action":"create","name":"morning-brief","description":"Put together the morning brief.","content":"1. Check the calendar"}',
  )
  await page.keyboard.press("Enter")
  await expect(page.getByText('Saved skill "morning-brief".')).toBeVisible()

  await page.getByRole("button", { name: "Skills" }).click()
  const card = page.getByRole("listitem").filter({ hasText: "morning-brief" })
  await expect(card.getByText("Written by the agent")).toBeVisible()
  await expect(page.getByRole("listitem").filter({ hasText: "writing-skills" })).toContainText(
    "Built in",
  )
  await card.getByRole("button", { name: "Read" }).click()
  await expect(card.locator("pre")).toContainText("1. Check the calendar")
  await card.getByRole("checkbox", { name: "Use morning-brief" }).uncheck()
  await expect(card.getByRole("checkbox", { name: "Use morning-brief" })).not.toBeChecked()
  await card.getByRole("button", { name: "Delete morning-brief" }).click()
  await expect(page.getByRole("listitem").filter({ hasText: "morning-brief" })).toHaveCount(0)
})

test("installing a skill from a bad URL explains what went wrong", async ({ page }) => {
  await signIn(page)
  await page.getByRole("button", { name: "Skills" }).click()
  await page.getByLabel("Skill URL").fill("https://127.0.0.1:1/not-a-skill/SKILL.md")
  await page.getByRole("button", { name: "Install" }).click()
  await expect(page.getByRole("alert")).toBeVisible({ timeout: 15_000 })
})

test("signing out ends the session", async ({ page }) => {
  await signIn(page)
  await page.getByRole("button", { name: "Sign out" }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.goto("/")
  await expect(page).toHaveURL(/\/login$/)
})

test("the layout works at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 800 })
  await signIn(page)
  await page.getByRole("button", { name: "Chats" }).click()
  await expect(page.getByRole("link", { name: "What can you do?" })).toBeVisible()
  await page.getByRole("link", { name: "What can you do?" }).click()
  await expect(page.getByText("You said: What can you do?")).toBeVisible()
  // Nothing is wider than the screen.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})
