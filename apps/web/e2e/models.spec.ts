import { expect, test } from "./fixtures.ts"
import {
  asOwner,
  closeSettings,
  composer,
  openSettings,
  openWorkspaceSettings,
  signIn,
} from "./helpers.ts"

asOwner()

/**
 * Signing a workspace in to a model provider. None of this reaches a provider: a key is kept
 * without being tried, and a subscription's sign-in is followed only as far as the page it
 * would open.
 */
test.describe("signing in to model providers", () => {
  test("the Models section lists the providers, the ones most asked for first", async ({
    page,
  }) => {
    await signIn(page)
    await openWorkspaceSettings(page, "Models")
    const providers = page.getByRole("region", { name: "Model providers" })
    await expect(providers.getByRole("listitem").first()).toContainText("Anthropic")
    await expect(
      providers.getByRole("button", { name: "Sign in with Claude Pro or Max" }),
    ).toBeVisible()
    await expect(
      providers.getByRole("button", { name: "Sign in with ChatGPT Plus or Pro" }),
    ).toBeVisible()
    // The deployment has no key here, and says what it runs on without one.
    await expect(page.getByText("A built-in echo model")).toBeVisible()

    // The rest are behind one line, each with a key.
    await expect(providers.getByText("Groq")).toHaveCount(0)
    await providers.getByRole("button", { name: /^\d+ more$/ }).click()
    await expect(providers.getByText("Groq")).toBeVisible()
    await expect(providers.getByRole("button", { name: "Use a key for Groq" })).toBeVisible()
  })

  test("a Claude subscription is signed in to on Claude's page, with the code it shows", async ({
    page,
  }) => {
    await signIn(page)
    await openWorkspaceSettings(page, "Models")
    await page.getByRole("button", { name: "Sign in with Claude Pro or Max" }).click()
    const window = page.getByRole("dialog", { name: "Sign in with Claude Pro or Max" })
    // Not asked how: there is one way that works from a page, and it is taken.
    const link = window.getByRole("link", { name: "Open the sign-in page" })
    await expect(link).toHaveAttribute("href", /^https:\/\/claude\.ai\/oauth\/authorize\?/)
    await expect(link).toHaveAttribute("target", "_blank")
    await expect(window.getByText("Paste the code it shows")).toBeVisible()
    const code = window.getByRole("textbox", { name: "The code it shows" })
    await expect(code).toBeVisible()
    // Nothing to send until something is pasted.
    await expect(window.getByRole("button", { name: "Sign in", exact: true })).toBeDisabled()

    // Leaving it leaves the workspace as it was.
    await window.getByRole("button", { name: "Cancel" }).click()
    await expect(window).toHaveCount(0)
    await expect(page.getByText("Signed in", { exact: true })).toHaveCount(0)
  })

  test("a ChatGPT subscription can be signed in to with a code or on a page", async ({ page }) => {
    await signIn(page)
    await openWorkspaceSettings(page, "Models")
    await page.getByRole("button", { name: "Sign in with ChatGPT Plus or Pro" }).click()
    const window = page.getByRole("dialog", { name: "Sign in with ChatGPT Plus or Pro" })
    await expect(window.getByRole("button", { name: /With a code/ })).toBeVisible()
    await window.getByRole("button", { name: /On a sign-in page/ }).click()
    await expect(window.getByRole("link", { name: "Open the sign-in page" })).toHaveAttribute(
      "href",
      /^https:\/\/auth\.openai\.com\//,
    )
    // Its page ends at an address on the person's own machine, which is what is pasted back.
    await expect(window.getByText("Paste the address you end up at")).toBeVisible()
    await expect(window.getByText("does not load. That is expected.")).toBeVisible()
    // The other way is one step back.
    await window.getByRole("button", { name: "Choose another way" }).click()
    await expect(window.getByRole("button", { name: /With a code/ })).toBeVisible()
    await window.getByRole("button", { name: "Cancel" }).click()
  })

  test("a key signs the workspace in, and its models can be chosen for an agent", async ({
    page,
  }) => {
    await signIn(page)
    await openWorkspaceSettings(page, "Models")
    await page.getByRole("button", { name: "Use a key for Anthropic" }).click()
    const window = page.getByRole("dialog", { name: "Anthropic API key" })
    const key = window.getByLabel("Key", { exact: true })
    await expect(key).toHaveAttribute("type", "password")
    await key.fill("sk-ant-api03-not-a-real-key")
    await window.getByRole("button", { name: "Save" }).click()
    await expect(window).toHaveCount(0)

    const row = page.getByRole("listitem").filter({ hasText: "Anthropic" })
    await expect(row).toContainText("Signed in")
    await expect(row).toContainText("A key · by you, today · 17 models")
    // The key is on the server and nowhere on the page.
    await expect(page.getByText("not-a-real-key")).toHaveCount(0)
    expect(await page.content()).not.toContain("not-a-real-key")

    // The agent's picker has them, under where they come from.
    await closeSettings(page)
    await openSettings(page, "Model and computer")
    const picker = page.getByRole("combobox", { name: "Model" })
    await picker.click()
    await picker.fill("haiku 5.5")
    const list = page.getByRole("listbox", { name: "Model" })
    await expect(list.getByText("Anthropic key · signed in by Sawyer")).toBeVisible()
    await list.getByRole("option", { name: /Claude Haiku 5\.5/ }).click()
    await page.getByRole("button", { name: "Save changes" }).click()
    await expect(page.getByText("Saved", { exact: true })).toBeVisible()
    await expect(picker).toHaveValue("Claude Haiku 5.5")
  })

  test("an agent says so when its workspace is no longer signed in, with the ways out", async ({
    page,
  }) => {
    await signIn(page)
    await openWorkspaceSettings(page, "Models")
    const row = page.getByRole("listitem").filter({ hasText: "Anthropic" })
    await row.getByRole("button", { name: "Sign out" }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "Sign out" }).click()
    await expect(row.getByRole("button", { name: "Use a key for Anthropic" })).toBeVisible()
    await expect(row).not.toContainText("Signed in")
    await closeSettings(page)

    // The agent is still set to Claude Haiku 5.5, which there is now nothing to call with.
    await composer(page).fill("are you there?")
    await composer(page).press("Enter")
    const failed = page.getByRole("alert").filter({ hasText: "isn't signed in" })
    await expect(failed).toContainText("The workspace isn't signed in to this model's provider.")
    await failed.getByRole("button", { name: "Sign in again" }).click()
    await expect(page.getByRole("region", { name: "Model providers" })).toBeVisible()
    await closeSettings(page)
    await failed.getByRole("button", { name: "Pick another model" }).click()
    await expect(page.getByRole("combobox", { name: "Model" })).toBeVisible()
  })
})

/**
 * Signing the server itself in, which is for whoever its settings name. What it is signed in to
 * is offered to everyone as its own.
 */
test.describe("the server's own models", () => {
  test("someone who looks after the server signs it in, for every workspace", async ({ page }) => {
    await signIn(page)
    await openWorkspaceSettings(page, "Server models")
    await expect(page.getByText("A built-in echo model")).toBeVisible()
    await page.getByRole("button", { name: "Use a key for OpenAI", exact: true }).click()
    const window = page.getByRole("dialog", { name: "OpenAI API key" })
    await expect(window).toContainText("Everyone on this server can then set agents to these")
    await window.getByLabel("Key", { exact: true }).fill("sk-not-a-real-key")
    await window.getByRole("button", { name: "Save" }).click()
    await expect(window).toHaveCount(0)
    const row = page.getByRole("listitem").filter({ hasText: /^OOpenAI(?! Codex)/ })
    await expect(row).toContainText("Signed in")
    await expect(page.getByText(/models? through OpenAI, offered to everyone/)).toBeVisible()

    // A workspace has them without signing in to anything, as the deployment's own.
    await page.getByRole("button", { name: "Models", exact: true }).click()
    await expect(page.getByText(/through OpenAI, paid for by this deployment/)).toBeVisible()
    const own = page.getByRole("region", { name: "Model providers" })
    await expect(own.getByRole("listitem").filter({ hasText: /^OOpenAI(?! Codex)/ })).toContainText(
      "Already here. Sign in to use your own account.",
    )
    await closeSettings(page)
    await openSettings(page, "Model and computer")
    const picker = page.getByRole("combobox", { name: "Model" })
    await picker.click()
    await picker.fill("gpt-6 luna")
    const list = page.getByRole("listbox", { name: "Model" })
    await expect(list.getByRole("option", { name: /GPT-6 Luna/ }).first()).toBeVisible()
    await expect(list.getByText(/signed in by/)).toHaveCount(0)
  })
})
