import { expect, test } from "./fixtures.ts"
import { FIXED_TOKEN, startFakeMcp } from "./fake-mcp-server.ts"
import { asOwner, composer, newChat, openSettings, signIn } from "./helpers.ts"

asOwner()

/** Have the agent call a tool. The echo model does what it is told and says what came of it. */
async function use(page: import("@playwright/test").Page, name: string, args: object) {
  await expect(composer(page)).toBeEnabled()
  await composer(page).fill(`/tool ${name} ${JSON.stringify(args)}`)
  await composer(page).press("Enter")
}

test.describe("what an agent can do in the app by itself", () => {
  let mcp: Awaited<ReturnType<typeof startFakeMcp>>
  test.beforeAll(async () => {
    mcp = await startFakeMcp()
  })
  test.afterAll(async () => {
    await mcp.close()
  })

  test("it asks for a secret in a form, which is saved without being said", async ({ page }) => {
    await signIn(page)
    await newChat(page)
    const transcript = page.getByRole("log")
    const forms = page.getByRole("list", { name: "Secrets it asked for" })
    await use(page, "request_secret", {
      secrets: [{ name: "WEATHER_KEY", description: "From the weather service" }],
      purpose: "To check the forecast",
    })
    await expect(forms.getByText("Juniper asks for a secret")).toBeVisible()
    await expect(forms.getByText("“To check the forecast”")).toBeVisible()
    await expect(forms.getByText("From the weather service")).toBeVisible()
    await expect(forms.getByText(/What you type is not put in the chat/)).toBeVisible()

    const field = forms.getByLabel("WEATHER_KEY", { exact: true })
    await expect(field).toHaveAttribute("type", "password")
    await forms.getByRole("button", { name: "Save secret" }).click()
    await expect(forms.getByRole("alert")).toContainText("Type a value for WEATHER_KEY.")
    await field.fill("sunny-123")
    await forms.getByRole("button", { name: "Show WEATHER_KEY" }).click()
    await expect(field).toHaveAttribute("type", "text")
    await forms.getByRole("button", { name: "Save secret" }).click()

    await expect(forms).toHaveCount(0)
    await expect(transcript.getByText(/gave WEATHER_KEY, saved to .*\.env/)).toBeVisible()
    await expect(transcript.getByText(/sunny-123/)).toHaveCount(0)
    // It is in the file, where a command can use it.
    await use(page, "bash", { command: "sed s/sunny/found/ .env" })
    await expect(transcript.getByText(/WEATHER_KEY='found-123'/).first()).toBeVisible()
    // And still nowhere in what was said, after the page is loaded again.
    await page.reload()
    await expect(transcript.getByText(/gave WEATHER_KEY/)).toBeVisible()
    await expect(transcript.getByText(/sunny-123/)).toHaveCount(0)
  })

  test("it is told when someone would rather not give a secret", async ({ page }) => {
    await signIn(page)
    await newChat(page)
    const forms = page.getByRole("list", { name: "Secrets it asked for" })
    await use(page, "request_secret", { secrets: [{ name: "BANK_PIN" }, { name: "BANK_USER" }] })
    await expect(forms.getByText("Juniper asks for 2 secrets")).toBeVisible()
    await forms.getByRole("button", { name: "Not now" }).click()
    await expect(forms).toHaveCount(0)
    await expect(
      page.getByRole("log").getByText(/chose not to give BANK_PIN, BANK_USER/),
    ).toBeVisible()
  })

  test("it asks before adding a connector, and has the person sign in from the chat", async ({
    page,
  }) => {
    await signIn(page)
    await openSettings(page, "Permissions")
    await expect(
      page
        .getByRole("radiogroup", { name: "Add and change connectors" })
        .getByRole("radio", { name: "Ask first" }),
    ).toBeChecked()
    await newChat(page)
    const chat = page.url()
    const transcript = page.getByRole("log")
    const waiting = page.getByRole("list", { name: "Waiting for your OK" })
    const add = { action: "add", name: "Calendar", url: `${mcp.origin}/oauth/mcp` }
    await use(page, "connectors", add)
    await expect(waiting.getByText("Juniper wants to: Add a connector")).toBeVisible()
    await expect(waiting.getByText(`Calendar: ${mcp.origin}/oauth/mcp`)).toBeVisible()
    await waiting.getByRole("button", { name: "Allow once" }).click()
    await expect(waiting).toHaveCount(0)
    // The echo model does not act on being told; a real one would. Its next attempt goes through.
    await use(page, "connectors", add)

    const signIns = page.getByRole("list", { name: "Connectors to sign in to" })
    await expect(signIns.getByText(/Juniper added the connector Calendar/)).toBeVisible()
    await signIns.getByRole("button", { name: "Sign in" }).click()
    // The service's own page, in the same tab, and then back to the chat that asked.
    await expect(page.getByRole("heading", { name: /use your account/ })).toBeVisible()
    await page.getByRole("link", { name: "Allow" }).click()
    await expect(page).toHaveURL(chat)
    await expect(transcript.getByText(/connected Calendar/)).toBeVisible()
    await expect(signIns).toHaveCount(0)

    await use(page, "calendar__today", {})
    await expect(page.getByRole("main").getByText("Dentist at 3pm").first()).toBeVisible()
  })

  test("it asks for a connector's access token in the form, and never sees it", async ({
    page,
  }) => {
    await signIn(page)
    await openSettings(page, "Permissions")
    const rule = page.getByRole("radiogroup", { name: "Add and change connectors" })
    await rule.getByRole("radio", { name: "Allow" }).click()
    await expect(rule.getByRole("radio", { name: "Allow" })).toBeChecked()
    await newChat(page)
    const transcript = page.getByRole("log")
    await use(page, "connectors", {
      action: "add",
      name: "Sums",
      url: `${mcp.origin}/token/mcp`,
      needs_token: true,
    })
    const forms = page.getByRole("list", { name: "Secrets it asked for" })
    await expect(forms.getByText("Juniper asks for the access token of Sums")).toBeVisible()
    await forms.getByLabel("Access token").fill(FIXED_TOKEN)
    await forms.getByRole("button", { name: "Save secret" }).click()
    await expect(forms).toHaveCount(0)
    await expect(
      transcript.getByText(/gave its access token, saved to the connector Sums/),
    ).toBeVisible()
    await expect(transcript.getByText(FIXED_TOKEN)).toHaveCount(0)

    await use(page, "sums__add", { a: 19, b: 23 })
    await expect(page.getByRole("main").getByText("sum is 42").first()).toBeVisible()
    await use(page, "connectors", { action: "list" })
    await expect(
      transcript.getByText(/Sums \(id c\w+, .*\): connected, 2 tools/).first(),
    ).toBeVisible()
  })

  test("it asks before adding a machine, and says when there is none to add", async ({ page }) => {
    await signIn(page)
    await newChat(page)
    const transcript = page.getByRole("log")
    const waiting = page.getByRole("list", { name: "Waiting for your OK" })
    const add = { action: "add", name: "builder" }
    await use(page, "computers", add)
    await expect(
      waiting.getByText("Juniper wants to: Add a machine to the workspace"),
    ).toBeVisible()
    await waiting.getByRole("button", { name: "Allow once" }).click()
    await expect(waiting).toHaveCount(0)
    await use(page, "computers", add)
    // This server has only the built-in shell, which is one agent's and cannot be added.
    await expect(transcript.getByText(/no kind of machine that can be added/).first()).toBeVisible()
    await use(page, "computers", { action: "connect_own" })
    await expect(
      transcript.getByText(/curl -fsSL http:\/\/127\.0\.0\.1:\d+\/install\.sh \| sh/).first(),
    ).toBeVisible()
  })

  test("it sees its own settings and what it has cost", async ({ page }) => {
    await signIn(page)
    await newChat(page)
    const transcript = page.getByRole("log")
    await use(page, "settings", { action: "get" })
    await expect(transcript.getByText(/Model: echo\/echo-1/).first()).toBeVisible()
    await expect(transcript.getByText(/Cost so far:/).first()).toBeVisible()
  })
})
