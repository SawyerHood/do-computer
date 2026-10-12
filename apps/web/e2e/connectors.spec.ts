import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures.ts"
import { FIXED_TOKEN, startFakeMcp } from "./fake-mcp-server.ts"
import {
  asOwner,
  composer,
  newChat,
  openOwnSettings,
  openSettings,
  openWorkspaceSettings,
  signIn,
  tab,
  tool,
} from "./helpers.ts"

asOwner()

test.describe("connectors", () => {
  let mcp: Awaited<ReturnType<typeof startFakeMcp>>
  test.beforeAll(async () => {
    mcp = await startFakeMcp()
  })
  test.afterAll(async () => {
    await mcp.close()
  })

  async function openConnectors(page: Page) {
    await signIn(page)
    await openSettings(page, "Connectors")
    await expect(page.getByRole("heading", { name: "Connectors", exact: true })).toBeVisible()
  }

  test("a connector with a token gives the agent its tools", async ({ page }) => {
    await openConnectors(page)
    await page.locator("#connector-name").fill("Sums")
    await page.getByLabel("Server address").fill(`${mcp.origin}/token/mcp`)
    await page.getByLabel("Access token (optional)").fill(FIXED_TOKEN)
    await page.getByRole("button", { name: "Add connector" }).click()

    const card = page.getByRole("listitem").filter({ hasText: "Sums" })
    await expect(card.getByText("Connected", { exact: true })).toBeVisible()
    await expect(card.getByText("2 tools: add, today")).toBeVisible()
    // The form is ready for another, and the token is not left on screen.
    await expect(page.getByLabel("Access token (optional)")).toHaveValue("")

    await newChat(page)
    await composer(page).fill('/tool sums__add {"a":19,"b":23}')
    await composer(page).press("Enter")
    await expect(page.getByRole("main").getByText("sum is 42").first()).toBeVisible()
  })

  test("a wrong token is reported, and the connector can be removed", async ({ page }) => {
    await openConnectors(page)
    await page.locator("#connector-name").fill("Locked")
    await page.getByLabel("Server address").fill(`${mcp.origin}/token/mcp`)
    await page.getByLabel("Access token (optional)").fill("not-the-token")
    await page.getByRole("button", { name: "Add connector" }).click()

    const card = page.getByRole("listitem").filter({ hasText: "Locked" })
    await expect(card.getByText("Not connected", { exact: true })).toBeVisible()
    await card.getByRole("button", { name: "Remove Locked" }).click()
    await expect(card).toHaveCount(0)
  })

  test("a connector that needs a sign-in sends the user to the service and back", async ({
    page,
  }) => {
    await openConnectors(page)
    await page.locator("#connector-name").fill("Calendar")
    await page.getByLabel("Server address").fill(`${mcp.origin}/oauth/mcp`)
    await page.getByRole("button", { name: "Add connector" }).click()

    // The service's own page, in the same tab.
    await expect(page.getByRole("heading", { name: /use your account/ })).toBeVisible()
    await page.getByRole("link", { name: "Deny" }).click()
    await expect(page).toHaveURL(/settings=agent\.[^.&]+\.connectors/)
    await expect(page.getByRole("alert")).toContainText("You said no.")
    const card = page.getByRole("listitem").filter({ hasText: "Calendar" })
    await expect(card.getByText("Needs sign-in")).toBeVisible()

    await card.getByRole("button", { name: "Sign in" }).click()
    await page.getByRole("link", { name: "Allow" }).click()
    await expect(page.getByRole("status")).toContainText("Calendar is connected.")
    await expect(card.getByText("Connected", { exact: true })).toBeVisible()

    await newChat(page)
    await composer(page).fill("/tool calendar__today {}")
    await composer(page).press("Enter")
    await expect(page.getByRole("main").getByText("Dentist at 3pm").first()).toBeVisible()
  })

  test("a connector switched off is no longer offered to the agent", async ({ page }) => {
    await openConnectors(page)
    const card = page.getByRole("listitem").filter({ hasText: "Sums" })
    await card.getByRole("switch", { name: "Use Sums" }).uncheck()
    await page.reload()
    await expect(card.getByRole("switch", { name: "Use Sums" })).not.toBeChecked()

    await newChat(page)
    await composer(page).fill('/tool sums__add {"a":1,"b":1}')
    await composer(page).press("Enter")
    await expect(
      page
        .getByRole("main")
        .getByText(/sums__add is not available/)
        .first(),
    ).toBeVisible()
  })

  test("Apps is one button and a sign-in, and asks before it does anything", async ({
    page,
    servers,
  }, testInfo) => {
    // The deployment is told Apps is here, where Composio's own server would be.
    const apps = await startFakeMcp(Number(new URL(await servers.appsFor(testInfo.file)).port))
    try {
      await openConnectors(page)
      // What it is, and how to set it up, is a guide: it opens beside the app.
      const guide = page.getByRole("link", { name: "What you get and how to set it up" })
      await expect(guide).toHaveAttribute("href", "/docs/apps")
      await expect(guide).toHaveAttribute("target", "_blank")
      await page.getByRole("button", { name: "Connect apps" }).click()
      // Nothing to type: the service's own page, in the same tab, and back.
      await expect(page.getByRole("heading", { name: /use your account/ })).toBeVisible()
      await page.getByRole("link", { name: "Allow" }).click()
      await expect(page.getByRole("status")).toContainText("Apps is connected.")
      const card = page.getByRole("listitem").filter({ hasText: "through Composio" })
      await expect(card.getByText("Connected", { exact: true })).toBeVisible()
      await expect(card.getByRole("link", { name: "How Apps works" })).toHaveAttribute(
        "href",
        "/docs/apps",
      )
      // There is one of it: with it added, it is no longer offered.
      await expect(page.getByRole("button", { name: "Connect apps" })).toHaveCount(0)

      await newChat(page)
      const waiting = page.getByRole("list", { name: "Waiting for your OK" })
      await composer(page).fill("/tool apps__today {}")
      await composer(page).press("Enter")
      await expect(waiting.getByText(/Use Apps/)).toBeVisible()
      await waiting.getByRole("button", { name: "Allow once" }).click()
      await expect(waiting).toHaveCount(0)
      await expect(composer(page)).toBeEnabled()
      await composer(page).fill("/tool apps__today {}")
      await composer(page).press("Enter")
      await expect(page.getByRole("main").getByText("Dentist at 3pm").first()).toBeVisible()
    } finally {
      await apps.close()
    }
  })

  test("a sign-in link cannot be replayed", async ({ page }) => {
    await signIn(page)
    await page.goto("/api/connectors/callback?code=anything&state=made-up")
    // Nothing to finish: the user lands back in the app, not on a connector.
    await expect(page).toHaveURL(/\/a\/[^/]+\/c\/\d+/)
  })
})

test.describe("choosing a model", () => {
  // A deployment with a model key offers hundreds. This one has none, so the list is stood in for:
  // the real echo model, plus enough others to need searching.
  const stubModels = async (page: Page) => {
    const others = Array.from({ length: 150 }, (_, index) => ({
      id: `openrouter/maker-${index % 7}/model-${index}`,
      name: `Maker ${index % 7}: Model ${index}`,
      reasoning: index % 2 === 0,
      inputCost: 1 + (index % 5),
      outputCost: 5 + (index % 9),
      contextWindow: 200_000,
      images: index % 3 === 0,
    }))
    const models = [
      {
        id: "echo/echo-1",
        name: "Echo (no model key configured)",
        reasoning: false,
        inputCost: 0,
        outputCost: 0,
        recommended: true,
      },
      {
        id: "openrouter/anthropic/claude-sonnet-5.5",
        name: "Anthropic: Claude Sonnet 5.5",
        reasoning: true,
        inputCost: 2,
        outputCost: 10,
        contextWindow: 1_000_000,
        images: true,
        recommended: true,
      },
      ...others,
    ]
    await page.route(/\/api\/models(\?|$)/, (route) => route.fulfill({ json: { models } }))
  }

  test("an agent's model is picked from a list that narrows as you type", async ({ page }) => {
    await stubModels(page)
    await signIn(page)
    await openSettings(page, "Model and computers")
    const picker = page.getByRole("combobox", { name: "Model" })
    await expect(picker).toHaveValue("Echo (no model key configured)")

    await picker.click()
    const list = page.getByRole("listbox", { name: "Model" })
    // Not all hundred and fifty at once, and it says there are more.
    await expect(list.getByRole("option")).toHaveCount(60)
    await expect(page.getByText("92 more. Type to narrow them down.")).toBeVisible()
    await expect(list.getByRole("option", { selected: true })).toContainText("Echo")

    // Words in any order, against the name and the id.
    await picker.fill("5.5 claude")
    await expect(list.getByRole("option")).toHaveCount(1)
    await expect(list.getByRole("option")).toContainText("$2.0 in, $10 out per million tokens")
    await expect(list.getByRole("option")).toContainText("1M context")
    await picker.fill("maker-3/")
    await expect(list.getByRole("option").first()).toContainText("Maker 3: Model 3")
    await picker.fill("nothing like this")
    await expect(page.getByText("No model matches.")).toBeVisible()

    // Escape puts the choice back as it was.
    await picker.press("Escape")
    await expect(list).toHaveCount(0)
    await expect(picker).toHaveValue("Echo (no model key configured)")

    // Arrow keys and Enter choose, without submitting the form around the picker.
    await picker.click()
    await picker.fill("model 14")
    await picker.press("ArrowDown")
    await picker.press("Enter")
    await expect(list).toHaveCount(0)
    await expect(picker).not.toHaveValue("Echo (no model key configured)")
    // "model 14" matches Model 14 first, then 114; one step down is the second.
    await expect(picker).toHaveValue("Maker 2: Model 114")
    await expect(page.getByText("Saved", { exact: true })).toHaveCount(0)

    // The server has the last word: this stand-in model does not exist there.
    await page.getByRole("button", { name: "Save changes" }).click()
    await expect(page.getByRole("alert")).toContainText("Unknown model")

    // Back to the real one, by clicking it.
    await picker.click()
    await picker.fill("echo")
    await list.getByRole("option", { name: /Echo/ }).click()
    await expect(picker).toHaveValue("Echo (no model key configured)")

    // With its list closed, Escape is the settings window's again.
    await picker.press("Escape")
    await expect(page.getByRole("dialog")).toHaveCount(0)
  })

  test("how hard an agent thinks is chosen under its model", async ({ page }) => {
    await signIn(page)
    await openSettings(page, "Model and computers")
    const thinking = page.getByRole("group", { name: "Thinking" })
    // The echo model does not reason, so there is nothing to choose.
    await expect(thinking).toContainText("does not think")
    await expect(thinking.getByRole("button")).toHaveCount(0)

    // Say that it can, with levels of its own, and those are what is offered.
    await page.route(/\/api\/models(\?|$)/, (route) =>
      route.fulfill({
        json: {
          models: [
            {
              id: "echo/echo-1",
              name: "Echo (no model key configured)",
              reasoning: true,
              thinking: ["low", "high", "max"],
              inputCost: 0,
              outputCost: 0,
            },
          ],
        },
      }),
    )
    await page.reload()
    await expect(thinking.getByRole("button")).toHaveCount(3)
    // The agent is on medium, which this model lacks; it would use the next one up.
    await expect(thinking.getByRole("button", { name: "High", pressed: true })).toBeVisible()
    // Choosing moves nothing: the form stays where it was.
    const save = page.getByRole("button", { name: "Save changes" })
    const before = await save.boundingBox()
    await thinking.getByText("Max").click()
    expect(await save.boundingBox()).toEqual(before)
    await page.getByRole("button", { name: "Save changes" }).click()
    await expect(page.getByText("Saved", { exact: true })).toBeVisible()
    await page.reload()
    await expect(thinking.getByRole("button", { name: "Max", pressed: true })).toBeVisible()
  })

  test("the default for new agents is set once, under Settings", async ({ page }) => {
    await stubModels(page)
    await signIn(page)
    await openOwnSettings(page, "General")
    await expect(page.getByRole("heading", { name: "Default model" })).toBeVisible()
    const picker = page.getByRole("combobox", { name: "Default model" })
    await expect(picker).toHaveValue("Echo (no model key configured)")
    await expect(page.getByText("This is the server’s default.")).toBeVisible()
    expect(await (await page.request.get("/api/settings")).json()).toEqual({
      defaultModel: null,
      deploymentDefaultModel: "echo/echo-1",
      defaultComputer: null,
      deploymentDefaultComputer: "just-bash",
    })

    // A model the server does not have is refused, and nothing is saved.
    await picker.click()
    await picker.fill("claude sonnet")
    await picker.press("Enter")
    await expect(page.getByRole("alert")).toContainText("not available on this deployment")
    expect((await (await page.request.get("/api/settings")).json()).defaultModel).toBe(null)

    // One it has is saved as the user's own choice, and survives a reload.
    await picker.click()
    await picker.fill("echo")
    await picker.press("Enter")
    await expect(page.getByRole("status")).toHaveText("Saved")
    await page.reload()
    await expect(page.getByRole("button", { name: "Use this server’s default" })).toBeVisible()
    expect((await (await page.request.get("/api/settings")).json()).defaultModel).toBe(
      "echo/echo-1",
    )

    // And can be handed back to the server's default.
    await page.getByRole("button", { name: "Use this server’s default" }).click()
    await expect(page.getByText("This is the server’s default.")).toBeVisible()
    expect((await (await page.request.get("/api/settings")).json()).defaultModel).toBe(null)
  })
})
