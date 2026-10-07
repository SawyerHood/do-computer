import { expect, test } from "./fixtures.ts"
import { asOwner, composer, newChat, openSettings, signIn, tab, tool } from "./helpers.ts"

asOwner()

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

  await tab(page, "Automations").click()
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

  await tab(page, "Automations").click()
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

test("opening the agent lands on a chat of yours, not on a scheduled run", async ({ page }) => {
  await signIn(page)
  await newChat(page)
  await composer(page).fill("Chat to come back to")
  await page.keyboard.press("Enter")
  await expect(page.getByText("You said: Chat to come back to")).toBeVisible()
  const mine = page.url()

  // A run of a schedule whose chat is then put away is the newest chat the agent has.
  await newChat(page)
  await composer(page).fill("Chat to put away")
  await page.keyboard.press("Enter")
  await expect(page.getByText("You said: Chat to put away")).toBeVisible()
  await composer(page).fill(
    '/tool schedule {"action":"create","schedule":"every 6h","prompt":"Look around","title":"Night watch"}',
  )
  await page.keyboard.press("Enter")
  await expect(page.getByText(/Scheduled\./)).toBeVisible()
  await tab(page, "Automations").click()
  const card = page.getByRole("listitem").filter({ hasText: "Night watch" })
  await card.getByRole("button", { name: "Run now" }).click()
  await expect(card.getByText(/Last run/)).toBeVisible({ timeout: 15_000 })
  await card.getByRole("button", { name: "Delete Night watch" }).click()
  await page.getByRole("link", { name: "Chat to put away" }).hover()
  await page.getByRole("button", { name: "Archive Chat to put away" }).click()
  await expect(page.getByRole("link", { name: "Chat to put away" })).toHaveCount(0)

  await page.goto("/")
  await page.waitForURL(/\/c\/\d+$/)
  expect(page.url()).toBe(mine)
})

test("the agent hands work to a sub-agent, whose chat is read and not written in", async ({
  page,
}) => {
  await signIn(page)
  await newChat(page)
  await composer(page).fill(
    '/tool subagent {"action":"start","title":"Flights","task":"Find flights to Lisbon"}',
  )
  await page.keyboard.press("Enter")
  const transcript = page.getByRole("log")
  // The agent is not kept waiting: it answers, and the sub-agent's report arrives by itself.
  await expect(transcript.getByText(/Started sub-agent \d+, "Flights"/)).toBeVisible()
  // Said where it reported and, once that has caught up, where it was started.
  await expect(transcript.getByText("reported back").first()).toBeVisible({ timeout: 15_000 })
  // The report is folded away, and the agent is given a turn to say what came of it.
  await expect(transcript.getByText(/You said: \[Your sub-agent "Flights"/)).toBeVisible()
  await transcript.getByText("What it reported").click()
  await expect(transcript.getByText("You said: Find flights to Lisbon").first()).toBeVisible()
  const mine = page.url()

  // Where it was started leads to its own chat, which says whose it is.
  await transcript.getByRole("link", { name: /Flights reported back/ }).click()
  await page.waitForURL((url) => url.href !== mine)
  await expect(page.getByText("Juniper asked")).toBeVisible()
  await expect(page.getByText("Find flights to Lisbon").first()).toBeVisible()
  await expect(page.getByText("Only Juniper talks to its sub-agents.")).toBeVisible()
  await expect(composer(page)).toHaveCount(0)
  // Nothing can be sent to it around the page either.
  const sent = await page.request.post(
    `${page.url().replace("/a/", "/api/agents/").replace("/c/", "/chats/")}/messages`,
    {
      data: { text: "hello", requestId: "direct" },
    },
  )
  expect(sent.status()).toBe(409)

  // It is not a chat of the user's: it is not listed as one, and opening the agent does not land in it.
  await page.getByRole("link", { name: "Back to Juniper" }).click()
  await page.waitForURL(mine)
  await page.goto("/")
  await page.waitForURL(/\/c\/\d+$/)
  expect(page.url()).toBe(mine)
})

test("a sub-agent at work can be stopped from its chat, and the agent is told", async ({
  page,
}) => {
  await signIn(page)
  await newChat(page)
  await composer(page).fill(
    '/tool subagent {"action":"start","title":"Slow job","task":"/tool bash {\\"command\\":\\"sleep 8\\"}"}',
  )
  await page.keyboard.press("Enter")
  const transcript = page.getByRole("log")
  const chip = transcript.getByRole("link", { name: /Slow job working/ })
  await expect(chip).toBeVisible()
  const mine = page.url()
  await chip.click()
  await page.waitForURL((url) => url.href !== mine)
  await page.getByRole("button", { name: "Stop", exact: true }).click()
  await expect(page.getByText("Stopped", { exact: true }).first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0)

  await page.getByRole("link", { name: "Back to Juniper" }).click()
  await page.waitForURL(mine)
  await expect(page.getByRole("log").getByText("You stopped")).toBeVisible()
  await expect(page.getByRole("log").getByRole("link", { name: /Slow job stopped/ })).toBeVisible()
})

test("the agent saves a skill, and it can be read, switched off and deleted", async ({ page }) => {
  await signIn(page)
  await newChat(page)
  await composer(page).fill(
    '/tool skill {"action":"create","name":"morning-brief","description":"Put together the morning brief.","content":"1. Check the calendar"}',
  )
  await page.keyboard.press("Enter")
  await expect(page.getByText('Saved skill "morning-brief".')).toBeVisible()

  await openSettings(page, "Skills")
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
  await openSettings(page, "Skills")
  await page.getByLabel("Skill URL").fill("https://127.0.0.1:1/not-a-skill/SKILL.md")
  await page.getByRole("button", { name: "Install" }).click()
  await expect(page.getByRole("alert")).toBeVisible({ timeout: 15_000 })
})
