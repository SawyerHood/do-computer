import type { MadeDood } from "@durable-computer/protocol"
import type { BrowserContext } from "@playwright/test"
import { expect, test } from "./fixtures.ts"
import { card, inOrder, introduce, openOwnSettings, owner, signUp } from "./helpers.ts"

inOrder()

// The deployment has a waiting list: anyone may make an account and hatch a Dood, and the app
// itself is for whoever looks after it, the people they invite, and those they let in.
test.use({
  settings: { DC_SIGNUP: "waitlist", DC_LANDING: "1", DC_ADMIN_EMAILS: owner.email },
})

const ada = { name: "Ada", email: "ada@example.com", password: "correct horse battery" }
const tomas = { name: "Tomás", email: "tomas@example.com", password: "correct horse battery" }
/** Tomás's session, from the test he signs up in to the one he is let in in. */
let asTomas: Awaited<ReturnType<BrowserContext["storageState"]>> | undefined

test("the first account is its owner's, and uses the app", async ({ page }) => {
  await signUp(page)
  await expect(page).toHaveURL(/\/a\/[^/]+\/c\/\d+/)
  // Nobody is waiting yet, and they are who is told.
  await openOwnSettings(page, "Waiting list")
  await expect(page.getByText("Nobody is waiting.")).toBeVisible()
})

test("a stranger is shown the way in, hatches a Dood, and waits", async ({ page, request }) => {
  const sent = await (await request.get("/")).text()
  expect(sent).toContain("Hatch your Dood")
  expect(sent).toContain("The app has a waiting list.")
  expect(sent).not.toContain("Coming soon")

  await page.goto("/")
  await page.getByRole("link", { name: "Hatch your Dood" }).first().click()
  await expect(page).toHaveURL(/\/welcome$/)
  await introduce(page, ada)
  const name = await card(page, /What will you call me\?$/)
  await name.getByLabel("A name for it").fill("Mossy")
  await name.getByRole("radio", { name: "Moss" }).click()
  await name.getByRole("button", { name: "That’s your name" }).click()
  // Nothing is asked about a model or a computer: it is not an agent yet.
  const wait = await card(page, /^You’re on the list, Ada\..*your turn\.$/)
  await expect(wait.getByRole("button", { name: "Share Mossy" })).toBeVisible()

  // Nothing of the app is theirs, whatever they ask for.
  for (const path of ["/api/agents", "/api/workspaces", "/api/settings", "/api/computers"]) {
    const refused = await page.request.get(path)
    expect(refused.status(), path).toBe(403)
    expect((await refused.json()).code).toBe("waitlisted")
  }
  expect((await page.request.post("/api/agents")).status()).toBe(403)
  expect((await page.request.get("/api/waitlist")).status()).toBe(403)
  // Any page of the app leads back to where their Dood is.
  await page.goto("/")
  await card(page, /^You’re on the list, Ada\..*your turn\.$/)
  await page.goto("/a/anything")
  await card(page, /^You’re on the list, Ada\..*your turn\.$/)
})

test("a Dood hatched in a post is claimed by signing up, and waits too", async ({
  browser,
  request,
}) => {
  // Hatched with no account, as its own page does it.
  const made = (await (
    await request.post("/api/doods", { data: { name: "Gerald", color: "rose", seed: "post-1234" } })
  ).json()) as MadeDood
  expect(made.dood.claimed).toBe(false)

  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`/welcome?dood=${made.dood.id}&key=${made.key}`)
  // It is out already, and it is the one asking.
  const you = await card(page, /^I’m Gerald! I hatched in a post.* Who are you\?$/)
  await you.getByLabel("Your name").fill(tomas.name)
  await you.getByLabel("Email").fill(tomas.email)
  await you.getByLabel("Password").fill(tomas.password)
  await you.getByRole("button", { name: "That’s me" }).click()
  await card(page, /^You’re on the list, Tomás\..*your turn\.$/)
  expect((await (await request.get(`/api/doods/${made.dood.id}`)).json()).dood.claimed).toBe(true)

  // Nobody else can claim it, with the key or without.
  const other = await browser.newContext()
  await other.request.post("/api/auth/sign-up/email", {
    data: { name: "Eve", email: "eve@example.com", password: "correct horse battery" },
  })
  const taken = await other.request.post(`/api/doods/${made.dood.id}/claim`, {
    data: { key: made.key },
  })
  expect(taken.status()).toBe(409)
  await other.close()

  // A treat from someone else is kept for the day it is an agent.
  const treated = await request.post(`/api/doods/${made.dood.id}/treat`)
  expect((await treated.json()).dood).toMatchObject({ treats: 1, joy: 1 })
  expect((await request.post(`/api/doods/${made.dood.id}/treat`)).status()).toBe(409)
  asTomas = await context.storageState()
  await context.close()
})

test("whoever looks after the deployment lets someone in, and their Dood is their agent", async ({
  page,
  browser,
}) => {
  await page.request.post("/api/auth/sign-in/email", { data: owner })
  await page.goto("/")
  await openOwnSettings(page, "Waiting list")
  const list = page.getByRole("dialog")
  await expect(list.getByText("3 people are waiting.")).toBeVisible()
  const row = list.getByRole("listitem").filter({ hasText: "tomas@example.com" })
  await expect(row).toContainText("Tomás with Gerald")
  await row.getByRole("button", { name: "Let in" }).click()
  await expect(list.getByText("2 people are waiting.")).toBeVisible()
  await expect(list.getByText("tomas@example.com")).toHaveCount(0)

  // They come back, and the one that waited with them is who they talk to.
  const context = await browser.newContext({ storageState: asTomas })
  const theirs = await context.newPage()
  await theirs.goto("/")
  const out = await card(theirs, /^There you are, Tomás! Shall we get started\?$/)
  await out.getByRole("button", { name: "Start chatting with Gerald" }).click()
  await expect(theirs).toHaveURL(/\/a\/[^/]+\/c\/\d+/)
  await expect(theirs.getByRole("heading", { name: "Gerald" }).first()).toBeVisible()
  // It ate what it was given while it waited.
  const agentId = /\/a\/([^/]+)\//.exec(theirs.url())![1]
  const creature = await (await theirs.request.get(`/api/agents/${agentId}/creature`)).json()
  expect(creature).toMatchObject({ fed: 1, joy: 1 })
  // Going home again is going to it, not to the first run.
  await theirs.goto("/")
  await expect(theirs).toHaveURL(/\/a\/[^/]+\/c\/\d+/)
  await context.close()
})
