import { existsSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, type Page, test } from "@playwright/test"

/**
 * The mobile app, running in a browser. Its web build is the same screens and logic as on a
 * phone, drawn by react-native-web, so these check everything but the native modules: secure
 * storage, push registration and the share sheet.
 *
 * The build is served under /__mobile on the deployment's own origin, which is how a browser
 * build would be hosted, so its session cookie works as usual.
 */
const dist = fileURLToPath(new URL("../../mobile/dist-web-test/", import.meta.url))

test.skip(!existsSync(join(dist, "index.html")), "the mobile web build has not been exported")
test.use({ viewport: { width: 400, height: 860 } })
test.describe.configure({ mode: "serial" })

async function open(page: Page, path = "/__mobile/") {
  await page.route(/\/__mobile(\/.*)?$/, async (route) => {
    const relative = new URL(route.request().url()).pathname.replace(/^\/__mobile\/?/, "")
    const file = join(dist, relative)
    const isFile = relative !== "" && existsSync(file) && statSync(file).isFile()
    await route.fulfill({ path: isFile ? file : join(dist, "index.html") })
  })
  await page.goto(path)
}

const account = {
  name: "Phone user",
  email: "mobile@example.com",
  password: "correct horse battery",
}
const composer = (page: Page) => page.getByLabel("Message", { exact: true })

async function signIn(page: Page) {
  await open(page)
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible()
  await page.getByLabel("Email").fill(account.email)
  await page.getByLabel("Password").fill(account.password)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page.getByRole("button", { name: "New chat" })).toBeVisible()
}

test("a new user signs up on the phone and meets a brand-new agent", async ({ page }) => {
  await open(page)
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible()
  // A browser build is served by its deployment, so there is no address to type.
  await expect(page.getByLabel("Deployment address")).toHaveCount(0)
  await page.getByRole("button", { name: "Create an account" }).click()
  await page.getByLabel("Name").fill(account.name)
  await page.getByLabel("Email").fill(account.email)
  await page.getByLabel("Password").fill(account.password)
  await page.getByRole("button", { name: "Create account" }).click()

  await expect(page.getByRole("heading", { name: "Your agent" })).toBeVisible()
  await expect(page.getByText("Brand new, and not named yet")).toBeVisible()
  await expect(page.getByText("No chats yet.")).toBeVisible()
})

test("wrong credentials are explained", async ({ page }) => {
  await open(page)
  await page.getByLabel("Email").fill(account.email)
  await page.getByLabel("Password").fill("not the password")
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page.getByRole("alert")).toBeVisible()
})

test("a chat streams the agent's reply and survives leaving and coming back", async ({ page }) => {
  await signIn(page)
  await page.getByRole("button", { name: "New chat" }).click()
  await expect(page.getByText("It has no name yet")).toBeVisible()
  await composer(page).fill("hello from the phone")
  await page.getByRole("button", { name: "Send" }).click()
  await expect(composer(page)).toHaveValue("")
  await expect(page.getByText("You said: hello from the phone")).toBeVisible()

  await page.getByRole("button", { name: "Back to chats" }).click()
  await page.getByRole("link", { name: "hello from the phone" }).click()
  await expect(page.getByText("You said: hello from the phone")).toBeVisible()
})

test("the agent's work shows as tool lines, and a sent file can be opened", async ({ page }) => {
  await signIn(page)
  await page.getByRole("link", { name: "hello from the phone" }).click()
  await composer(page).fill('/tool set_identity {"name":"Pip","tagline":"Small but mighty"}')
  await page.getByRole("button", { name: "Send" }).click()
  await expect(page.getByRole("button", { name: "Named itself Pip" })).toBeVisible()
  await expect(composer(page)).toHaveAttribute("placeholder", "Message Pip")

  await composer(page).fill('/tool write {"path":"list.md","content":"- eggs\\n- flour\\n"}')
  await page.getByRole("button", { name: "Send" }).click()
  await page.getByRole("button", { name: "Wrote list.md" }).click()
  await expect(page.getByText("Successfully wrote to list.md").first()).toBeVisible()

  await composer(page).fill('/tool send_file {"path":"list.md"}')
  await page.getByRole("button", { name: "Send" }).click()
  // Opening hands the file's address to the browser, which downloads it with the session.
  const fetched = page
    .context()
    .waitForEvent("response", (response) => response.url().includes("/library/"))
  await page.getByRole("button", { name: "Open list.md" }).click()
  expect((await fetched).headers()["content-disposition"]).toContain("list.md")
})

test("a request for approval can be answered from the phone", async ({ page }) => {
  await signIn(page)
  const { agents } = (await (await page.request.get("/api/agents")).json()) as {
    agents: { id: string }[]
  }
  const rules = `/api/agents/${agents[0]!.id}/approvals/rules`
  await page.request.patch(rules, { data: { "tool:bash": "ask" } })
  try {
    await page.getByRole("link", { name: "hello from the phone" }).click()
    await composer(page).fill('/tool bash {"command":"echo from-the-phone"}')
    await page.getByRole("button", { name: "Send" }).click()
    await expect(page.getByText("Pip wants to: Run commands")).toBeVisible()
    await expect(page.getByText("echo from-the-phone", { exact: true })).toBeVisible()

    await page.getByRole("button", { name: "Allow once" }).click()
    await expect(page.getByText("Pip wants to: Run commands")).toHaveCount(0)
    await expect(
      page.getByText("Approved: Run commands: echo from-the-phone", { exact: true }),
    ).toBeVisible()
  } finally {
    await page.request.patch(rules, { data: { "tool:bash": "allow" } })
  }
})

test("earlier messages can be brought back after a chat was started fresh", async ({ page }) => {
  await signIn(page)
  await page.getByRole("link", { name: "hello from the phone" }).click()
  await expect(page.getByText("You said: hello from the phone")).toBeVisible()
  const chatId = new URL(page.url()).pathname.split("/").at(-1)!
  const { agents } = (await (await page.request.get("/api/agents")).json()) as {
    agents: { id: string }[]
  }
  await page.request.post(`/api/agents/${agents[0]!.id}/chats/${chatId}/reset`, { data: {} })

  // The transcript now starts at the fresh start, and offers what came before it.
  await expect(page.getByText("You said: hello from the phone")).toHaveCount(0)
  await page.getByRole("button", { name: "Show earlier messages" }).click()
  await expect(page.getByText("You said: hello from the phone")).toBeVisible()
  await expect(page.getByRole("button", { name: "Show earlier messages" })).toHaveCount(0)
})

test("Markdown in a reply is rendered, not shown as markup", async ({ page }) => {
  await signIn(page)
  await page.getByRole("link", { name: "hello from the phone" }).click()
  await composer(page).fill("a list:\n\n- one\n- **two**")
  await page.getByRole("button", { name: "Send" }).click()
  await expect(page.getByText("two", { exact: true })).toBeVisible()
  await expect(page.getByText("**two**")).toHaveCount(1) // only in the user's own bubble
})

test("automations made in chat can be run and removed from their tab", async ({ page }) => {
  await signIn(page)
  await page.getByRole("link", { name: "hello from the phone" }).click()
  await composer(page).fill(
    '/tool schedule {"action":"create","schedule":"every 6h","prompt":"Stretch","title":"Stretch break"}',
  )
  await page.getByRole("button", { name: "Send" }).click()
  await expect(page.getByRole("button", { name: "Scheduled a task" })).toBeVisible()
  await page.getByRole("button", { name: "Back to chats" }).click()

  await page.getByRole("tab", { name: "Automations" }).click()
  await expect(page.getByText("Stretch break")).toBeVisible()
  await expect(page.getByText("Active", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Pause" }).click()
  await expect(page.getByText("Paused", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Run now" }).click()
  await expect(page.getByText(/Last run/)).toBeVisible({ timeout: 15_000 })
  await page.getByRole("button", { name: "Delete Stretch break" }).click()
  await expect(page.getByText("Nothing scheduled yet.")).toBeVisible()
})

test("skills can be read and switched off", async ({ page }) => {
  await signIn(page)
  await page.getByRole("tab", { name: "Skills" }).click()
  await expect(page.getByText("writing-skills")).toBeVisible()
  const toggle = page.getByLabel("Use writing-skills")
  await expect(toggle).toBeChecked()
  await toggle.click()
  await expect(toggle).not.toBeChecked()
  await page.reload()
  await page.getByRole("tab", { name: "Skills" }).click()
  await expect(page.getByLabel("Use writing-skills")).not.toBeChecked()
})

test("the library lists what the agent sent and lets it be deleted", async ({ page }) => {
  await signIn(page)
  await page.getByRole("tab", { name: "Library" }).click()
  await expect(page.getByText("list.md")).toBeVisible()
  await expect(page.getByText(/from your agent/)).toBeVisible()
  await page.getByRole("button", { name: "Delete list.md" }).click()
  await expect(page.getByText("Nothing here yet.")).toBeVisible()
})

test("a second agent can be created and switched to, and signing out ends the session", async ({
  page,
}) => {
  await signIn(page)
  await page.getByRole("tab", { name: "You" }).click()
  await expect(page.getByRole("button", { name: "Switch to Pip" })).toBeVisible()
  await page.getByRole("button", { name: "New agent" }).click()
  await expect(page.getByRole("button", { name: "Switch to New agent" })).toBeVisible()
  await page.getByRole("tab", { name: "Chats" }).click()
  await expect(page.getByRole("heading", { name: "Your agent" })).toBeVisible()

  await page.getByRole("tab", { name: "You" }).click()
  await page.getByRole("button", { name: "Switch to Pip" }).click()
  await page.getByRole("tab", { name: "Chats" }).click()
  await expect(page.getByRole("heading", { name: "Pip" })).toBeVisible()

  await page.getByRole("tab", { name: "You" }).click()
  await page.getByRole("button", { name: "Sign out" }).click()
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible()
  await open(page)
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible()
})
