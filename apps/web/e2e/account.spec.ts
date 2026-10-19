import { expect, test } from "./fixtures.ts"
import {
  card,
  composer,
  inOrder,
  introduce,
  openSettings,
  owner,
  sideChats,
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

test("a side chat opens beside the main chat, is separate from it, and can be put away", async ({
  page,
}) => {
  await signIn(page)
  const main = page.url()
  await sideChats(page).click()
  await expect(page.getByText(/^None yet\./)).toBeVisible()
  await page.getByRole("menuitem", { name: "New side chat" }).click()

  // The main chat stays where it is, and the side chat is in a column of its own beside it.
  const beside = page.getByRole("complementary", { name: /^Side chat:/ })
  // It continues from the main chat, which the agent carries into it and which is not shown in it.
  await expect(beside.getByText(/picks up from the main chat, which stays as it was/)).toBeVisible()
  await expect(beside.getByText("Continues from the main chat")).toHaveCount(0)
  await expect(page).toHaveURL(new RegExp(`${new URL(main).pathname}\\?side=\\d+$`))
  await expect(page.getByRole("main").getByText("You said: What can you do?")).toBeVisible()
  await beside.getByRole("textbox", { name: "Message" }).fill("second chat here")
  await page.keyboard.press("Enter")
  await expect(beside.getByText("You said: second chat here")).toBeVisible()
  await expect(beside.getByText("You said: What can you do?")).toHaveCount(0)
  await expect(beside.getByText("Continues from the main chat")).toBeVisible()
  // What came before that is the main chat's, and is not offered here.
  await expect(beside.getByRole("button", { name: "Show earlier messages" })).toHaveCount(0)
  await expect(beside.getByRole("heading", { name: "second chat here" })).toBeVisible()
  await page.screenshot({ path: process.env.DC_SIDE_CHAT_SHOT ?? "/dev/null" }).catch(() => {})

  // It is still beside the main chat after a reload, and it is listed in the agent's side chats.
  await page.reload()
  await expect(beside.getByText("You said: second chat here")).toBeVisible()
  await sideChats(page).click()
  await expect(page.getByRole("menuitem", { name: /^second chat here/ })).toBeVisible()
  // Once for the side chats, and once for the menu on the name that they are in.
  await page.keyboard.press("Escape")
  await page.keyboard.press("Escape")

  // Given the whole chat, a line under the strip says what it is and leads back.
  await beside.getByRole("link", { name: "Give it the whole chat" }).click()
  await expect(beside).toHaveCount(0)
  await expect(page.getByRole("main").getByText("You said: second chat here")).toBeVisible()
  await expect(page.getByRole("main").getByText("You said: What can you do?")).toHaveCount(0)
  await expect(composer(page)).toHaveAttribute("placeholder", /in this side chat$/)
  await page.getByRole("link", { name: "Main chat", exact: true }).click()
  await expect(page).toHaveURL(main)
  await expect(page.getByRole("main").getByText("You said: What can you do?")).toBeVisible()

  // From the menu it opens beside the main chat again, and is put away from there.
  await sideChats(page).click()
  await page.getByRole("menuitem", { name: /^second chat here/ }).click()
  await beside.getByRole("button", { name: "Archive second chat here" }).click()
  await expect(beside).toHaveCount(0)
  await expect(page).toHaveURL(main)
  await sideChats(page).click()
  await expect(page.getByRole("menuitem", { name: /^second chat here/ })).toHaveCount(0)
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
