import { expect, test } from "./fixtures.ts"
import {
  closeSettings,
  composer,
  inOrder,
  openSettings,
  owner,
  signIn,
  signUp,
  tab,
} from "./helpers.ts"

inOrder()

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
  await page.getByRole("button", { name: "New chat", exact: true }).click()
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
  // The tab's icon is the agent's creature, as it looks now.
  const icon = page.locator('link[rel="icon"]')
  await expect(icon).toHaveAttribute("href", /^data:image\//)
  const before = await icon.getAttribute("href")
  await openSettings(page, "Identity")
  await page.getByLabel("Name").fill("Juniper")
  await page.getByLabel("Tagline").fill("Calm and curious")
  // Its color is a choice; what it looks like is a roll of the dice.
  await page.getByRole("button", { name: "Tide" }).click()
  await page.getByRole("button", { name: "Roll a new look" }).click()
  await page.locator("#user").fill("Prefers short answers")
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByText("Saved", { exact: true })).toBeVisible()
  await expect.poll(() => icon.getAttribute("href")).not.toBe(before)
  await expect(icon).toHaveAttribute("href", /^data:image\//)

  await closeSettings(page)
  await expect(page.getByText("Juniper").first()).toBeVisible()
  await expect(composer(page)).toHaveAttribute("placeholder", "Message Juniper")

  await page.reload()
  await openSettings(page, "Identity")
  await expect(page.getByLabel("Name")).toHaveValue("Juniper")
  await expect(page.locator("#user")).toHaveValue("Prefers short answers")
  await expect(page.getByRole("button", { name: "Tide" })).toHaveAttribute("aria-pressed", "true")
  const agentId = page.url().match(/\/a\/([^/]+)/)![1]!
  const saved = (await (await page.request.get(`/api/agents/${agentId}`)).json()) as {
    agent: { avatar: { color: string; seed?: string }; hatched: boolean }
  }
  expect(saved.agent.avatar.color).toBe("tide")
  expect(saved.agent.avatar.seed).toMatch(/^.{6,}$/)
  // It has a name now, so it is out of its egg whether or not anyone watched.
  expect(saved.agent.hatched).toBe(true)
})

test("memory over its limit cannot be saved", async ({ page }) => {
  await signIn(page)
  await openSettings(page, "Identity")
  await page.locator("#user").fill("x".repeat(1400))
  await expect(page.getByText("1400 / 1375")).toBeVisible()
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled()
})

test("signing in works when it is tried before the page's script has loaded", async ({ page }) => {
  // Hold the scripts back, as a slow connection would, so the form is on screen but not yet live.
  await page.route(/\.js(\?.*)?$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    await route.continue()
  })
  await page.goto("/login")
  await page.getByLabel("Email").fill(owner.email)
  await page.getByLabel("Password").fill(owner.password)
  // What was typed early is still there once the script takes over, and the button waited for it.
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForURL(/\/a\/[^/]+\/c\/\d+/)
  expect(page.url()).not.toContain("password")
})

test("the API refuses bodies that are too large and routes that are not a client's", async ({
  page,
}) => {
  await signIn(page)
  const agentId = page.url().match(/\/a\/([^/]+)/)![1]!
  const chatId = page.url().match(/\/c\/(\d+)/)![1]!
  const api = `/api/agents/${agentId}`

  // A megabyte is the most any JSON route reads, whatever the request claims.
  const big = await page.request.post(`${api}/chats/${chatId}/messages`, {
    data: { text: "x".repeat(1_100_000), requestId: "too-big" },
  })
  expect(big.status()).toBe(413)
  const upload = await page.request.post(`${api}/library?name=huge.bin`, {
    headers: { "content-type": "application/octet-stream" },
    data: Buffer.alloc(27 * 1024 * 1024),
  })
  expect(upload.status()).toBe(413)
  // And the app is still there afterwards.
  expect((await page.request.get(`${api}/library`)).ok()).toBe(true)

  // What the gateway keeps for itself is not reachable through it.
  for (const [method, path] of [
    ["delete", "computers/anything"],
    // However the address is dressed up: the actor reads it after it has been parsed.
    ["put", "chats%2F..%2Fcomputers%2Fanything"],
    ["put", "chats/%2e%2e/computers/anything"],
    ["put", "/computers/anything"],
    ["post", "x%5C..%5Cdestroy"],
    ["post", "init"],
    ["post", "destroy"],
    ["patch", "schedules/__proto__"],
    ["patch", "skills/constructor"],
  ] as const) {
    const response = await page.request[method](`${api}/${path}`, { data: { enabled: false } })
    expect(`${method} ${path} ${response.status()}`).toBe(`${method} ${path} 404`)
  }
  expect(({} as Record<string, unknown>).enabled).toBe(undefined)
})

test("signing out ends the session", async ({ page }) => {
  await signIn(page)
  await page.getByRole("button", { name: /settings and signing out$/ }).click()
  await page.getByRole("menuitem", { name: "Sign out" }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.goto("/")
  await expect(page).toHaveURL(/\/login$/)
})
