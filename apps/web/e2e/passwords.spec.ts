import { expect, test } from "./fixtures.ts"
import {
  asOwner,
  closeSettings,
  openSettings,
  openWorkspaceSettings,
  owner,
  signIn,
  signUp,
} from "./helpers.ts"

// Saved passwords are for the deployment's admins unless it says otherwise: the owner is one here.
test.use({ settings: { DC_ADMIN_EMAILS: owner.email } })
asOwner()

const PASSWORD = "nobody-is-shown-this-again"

/**
 * The logins a workspace keeps for its Doods to sign in to websites with. A Dood signing in
 * with one, in a real browser, is `sign-in.spec.ts`: this is what a person sees of them.
 */
test.describe("a workspace's saved passwords", () => {
  test("are added, given a new password, changed and removed, and never shown again", async ({
    page,
  }) => {
    await signIn(page)
    await openWorkspaceSettings(page, "Passwords")
    const window = page.getByRole("dialog").first()
    await expect(window.getByRole("heading", { name: "Passwords" })).toBeVisible()
    await expect(window.getByRole("heading", { name: "No logins yet" })).toBeVisible()

    // What is not a site is said before anything is sent.
    await window.getByRole("button", { name: "Add a login" }).first().click()
    const adding = page.getByRole("dialog", { name: "Add a login" })
    await adding.getByLabel("Name", { exact: true }).fill("GitHub")
    await adding.getByLabel("Username or email").fill("sawyer@example.com")
    await adding.getByLabel("Password", { exact: true }).fill(PASSWORD)
    await adding.getByLabel("A site to add").fill("not a site")
    await adding.getByRole("button", { name: "Save" }).click()
    await expect(adding.getByRole("alert")).toBeVisible()
    await expect(adding).toBeVisible()
    // An address is taken for its site.
    await adding.getByLabel("A site to add").fill("https://GitHub.com/login")
    await adding.getByLabel("A site to add").press("Enter")
    await expect(adding.getByRole("list", { name: "Used only on" })).toContainText("github.com")
    await adding.getByRole("button", { name: "Save" }).click()
    await expect(adding).toHaveCount(0)

    const saved = window.getByRole("list", { name: "Saved logins" })
    await expect(saved.getByRole("listitem")).toHaveCount(1)
    await expect(saved).toContainText("GitHub")
    await expect(saved).toContainText("sawyer@example.com")
    await expect(saved).toContainText("github.com")
    await expect(saved).toContainText("Not used yet")
    // Neither the page nor what the server answers with has the password in it.
    expect(await page.content()).not.toContain(PASSWORD)
    const workspaces = (await (await page.request.get("/api/workspaces")).json()) as {
      workspaces: { id: string; savedLogins?: boolean }[]
    }
    const mine = workspaces.workspaces[0]!
    expect(mine.savedLogins).toBe(true)
    const listed = await page.request.get(`/api/workspaces/${mine.id}/passwords`)
    expect(listed.status()).toBe(200)
    const text = await listed.text()
    expect(text).toContain("sawyer@example.com")
    expect(text).not.toContain(PASSWORD)

    // A new password is given without the old one being shown.
    await saved.getByRole("button", { name: "Change or remove GitHub" }).click()
    await page.getByRole("menuitem", { name: "Replace the password" }).click()
    const replacing = page.getByRole("dialog", { name: "Replace the password of GitHub" })
    await expect(replacing.getByLabel("New password")).toHaveValue("")
    await replacing.getByLabel("New password").fill("another-one-entirely")
    await replacing.getByRole("button", { name: "Save" }).click()
    await expect(replacing).toHaveCount(0)

    // Its name and its sites are changed, and its password stays as it is.
    await saved.getByRole("button", { name: "Change or remove GitHub" }).click()
    await page.getByRole("menuitem", { name: "Change its name or sites" }).click()
    const changing = page.getByRole("dialog", { name: "Change GitHub" })
    await expect(changing.getByLabel("Password")).toHaveCount(0)
    await changing.getByLabel("Name", { exact: true }).fill("GitHub (work)")
    await changing.getByRole("button", { name: "Add a site" }).click()
    await changing.getByLabel("A site to add").fill("gist.github.com")
    await changing.getByRole("button", { name: "Save" }).click()
    await expect(changing).toHaveCount(0)
    await expect(saved).toContainText("GitHub (work)")
    await expect(saved).toContainText("github.com, gist.github.com")

    // It is still there after the page is loaded again.
    await closeSettings(page)
    await page.reload()
    await openWorkspaceSettings(page, "Passwords")
    await expect(saved).toContainText("GitHub (work)")
    expect(await page.content()).not.toContain("another-one-entirely")

    // Removing asks first.
    await saved.getByRole("button", { name: "Change or remove GitHub (work)" }).click()
    await page.getByRole("menuitem", { name: "Remove" }).click()
    const confirming = page.getByRole("alertdialog")
    await expect(confirming).toContainText("Remove GitHub (work)?")
    await confirming.getByRole("button", { name: "Remove" }).click()
    await expect(window.getByRole("heading", { name: "No logins yet" })).toBeVisible()
  })

  test("are something a Dood asks before using, until it is told it need not", async ({ page }) => {
    await signIn(page)
    await openSettings(page, "Permissions")
    const signing = page.getByRole("group", { name: "Sign in with saved passwords" })
    await expect(signing.getByRole("button", { name: "Ask first", pressed: true })).toBeVisible()
    await signing.getByRole("button", { name: "Allow" }).click()
    await expect(signing.getByRole("button", { name: "Allow", pressed: true })).toBeVisible()
    await signing.getByRole("button", { name: "Ask first" }).click()
    await expect(signing.getByRole("button", { name: "Ask first", pressed: true })).toBeVisible()
    await closeSettings(page)
  })

  test("are not there at all for someone who is not an admin", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, colorScheme: "dark" })
    const page = await context.newPage()
    await page.addInitScript(() => {
      localStorage.setItem("dc-chat-list", "open")
      localStorage.setItem("dc-agent-panel", "closed")
    })
    // The one other address this deployment lets make an account.
    await signUp(page, {
      name: "Maya",
      email: "mobile@example.com",
      password: "correct horse battery",
    })
    await page.waitForURL(/\/a\/[^/]+\/c\/\d+/)

    // No page of them in the workspace's settings.
    await openWorkspaceSettings(page, "Computers")
    const window = page.getByRole("dialog").first()
    await expect(window.getByRole("button", { name: "Models", exact: true })).toBeVisible()
    await expect(window.getByRole("button", { name: "Passwords", exact: true })).toHaveCount(0)
    await closeSettings(page)

    // Nothing to set for the Dood.
    await openSettings(page, "Permissions")
    await expect(page.getByRole("group", { name: "Run commands" })).toBeVisible()
    await expect(page.getByRole("group", { name: "Sign in with saved passwords" })).toHaveCount(0)

    // And the server answers as if there were no such thing, to looking and to saving alike.
    const workspaces = (await (await page.request.get("/api/workspaces")).json()) as {
      workspaces: { id: string; savedLogins?: boolean }[]
    }
    const hers = workspaces.workspaces[0]!
    expect(hers.savedLogins).toBeUndefined()
    expect((await page.request.get(`/api/workspaces/${hers.id}/passwords`)).status()).toBe(404)
    const tried = await page.request.post(`/api/workspaces/${hers.id}/passwords`, {
      data: { name: "x", username: "x", password: "x", sites: ["example.com"] },
    })
    expect(tried.status()).toBe(404)
    await context.close()
  })
})
