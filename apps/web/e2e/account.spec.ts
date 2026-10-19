import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures.ts"
import {
  card,
  composer,
  inOrder,
  introduce,
  openSettings,
  owner,
  nameMenu,
  signIn,
  signUp,
  tab,
} from "./helpers.ts"

inOrder()

// A side chat as there were before can be made here, to see that one is kept and read.
test.use({ settings: { DC_TEST_OLD_SIDE_CHATS: "1" } })

// The look the pictures are taken in, where a run asks for them (`DC_SHOTS`).
const scheme = process.env.DC_SHOTS_SCHEME === "dark" ? "dark" : "light"
test.use({ colorScheme: scheme })
async function shot(page: Page, name: string) {
  const folder = process.env.DC_SHOTS
  if (folder) await page.screenshot({ path: `${folder}/${name}-${scheme}.png` })
}

test("a visitor is sent to sign in", async ({ page }) => {
  await page.goto("/")
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible()
})

test("a new account's first agent opens in its first chat", async ({ page }) => {
  await signUp(page)
  await page.waitForURL(/\/a\/[^/]+\/c\/\d+/)
  await expect(page.getByRole("heading", { name: "Say hello" })).toBeVisible()
  await expect(page.getByText("It has no name yet")).toBeVisible()
})

test("a second account is refused on an invite-only deployment", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  // There is no form to sign up on: its address leads to the first run, where an account is
  // made by telling the egg who they are.
  await page.goto("/signup")
  await expect(page).toHaveURL(/\/welcome$/)
  const you = await introduce(page, {
    name: "Other",
    email: "other@example.com",
    password: owner.password,
  })
  await expect(you.getByRole("alert")).toContainText("invitation")
  // The egg is still asking, and nobody is signed in.
  await card(page, /who are you\?/)
  expect((await page.request.get("/api/me")).status()).toBe(401)
})

test("a message is answered and streamed into the transcript", async ({ page }) => {
  await signIn(page)
  await composer(page).fill("What can you do?")
  await page.keyboard.press("Enter")
  await expect(composer(page)).toHaveValue("")
  await expect(page.getByRole("main").getByText("You said: What can you do?")).toBeVisible()
  // The agent's row in the sidebar is the way to this chat: it has no chats listed under it.
  const agents = page.getByRole("navigation", { name: "Doods" })
  await expect(agents.getByRole("link")).toHaveCount(1)
  await expect(agents.getByRole("link")).toHaveAttribute("aria-current", "page")

  // The transcript is the agent's, not the tab's: it is still there after a reload.
  await page.reload()
  await expect(page.getByRole("main").getByText("You said: What can you do?")).toBeVisible()
})

test("assistant text is rendered as Markdown", async ({ page }) => {
  await signIn(page)
  await composer(page).fill("a list:\n\n- one\n- two")
  await page.keyboard.press("Enter")
  await expect(page.locator(".prose-chat li")).toHaveText(["one", "two"])
})

test("a Dood is talked to in its main chat alone, and an old side chat is kept to read", async ({
  page,
}) => {
  await signIn(page)
  const main = page.url()
  const agentId = /\/a\/([^/]+)/.exec(main)![1]!
  // There is no way to start another chat: none in the menu on the name, and none on the server.
  await nameMenu(page).click()
  await expect(page.getByRole("menuitem", { name: /side chat/i })).toHaveCount(0)
  await page.keyboard.press("Escape")
  expect((await page.request.post(`/api/agents/${agentId}/chats`, { data: {} })).status()).toBe(410)

  // A side chat from before there were none, as a Dood that had one keeps it: archived.
  const made = await page.request.post(`/api/agents/${agentId}/chats/old`, {
    data: { text: "an aside from before", requestId: crypto.randomUUID() },
  })
  expect(made.status()).toBe(201)
  const old = (await made.json()) as { id: string; archived: boolean }
  expect(old.archived).toBe(true)

  // It is reached from the menu on the name, where it is listed to read.
  await nameMenu(page).click()
  await page.getByRole("menuitem", { name: /'s old side chats$/ }).click()
  await expect(page.getByText(/Kept to read\.$/)).toBeVisible()
  await shot(page, "old-side-chats-menu")
  await page.getByRole("menuitem", { name: /^an aside from before/ }).click()
  await expect(page).toHaveURL(new RegExp(`/c/${old.id}$`))
  const transcript = page.getByRole("log")
  await expect(transcript.getByText("You said: an aside from before")).toBeVisible()
  // It is read, and not written in: there is no message box, and the server says no too.
  await expect(page.getByText("An old side chat, kept to read.")).toBeVisible()
  await expect(composer(page)).toHaveCount(0)
  await shot(page, "old-side-chat")
  const said = await page.request.post(`/api/agents/${agentId}/chats/${old.id}/messages`, {
    data: { text: "more", requestId: crypto.randomUUID() },
  })
  expect(said.status()).toBe(409)
  // It leads back to the main chat, which is where everything happens.
  await page.getByRole("link", { name: "Back to the main chat" }).click()
  await expect(page).toHaveURL(main)
  await expect(page.getByRole("main").getByText("You said: What can you do?")).toBeVisible()
})

test("memory over its limit cannot be saved", async ({ page }) => {
  await signIn(page)
  await openSettings(page, "Memory")
  await page.locator("#user").fill("x".repeat(4100))
  await expect(page.getByText("4100 / 4000")).toBeVisible()
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
