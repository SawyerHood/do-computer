import { expect, test } from "./fixtures.ts"
import { asOwner, closeSettings, openOwnSettings, signIn, workspaceMenu } from "./helpers.ts"

asOwner()

test("the settings open on what is one's own and on two lists, each gone inside of", async ({
  page,
}) => {
  await signIn(page)
  const dialog = page.getByRole("dialog")
  await openOwnSettings(page, "Doods")
  await expect(dialog.getByRole("heading", { name: "Doods", exact: true })).toBeVisible()

  // An agent is chosen from the list, and the window is then its own settings.
  await dialog.getByRole("button", { name: "Juniper's settings" }).click()
  await expect(dialog.getByRole("heading", { name: "Profile", exact: true })).toBeVisible()
  await expect(dialog.getByLabel("Name")).toHaveValue("Juniper")
  await expect(page).toHaveURL(/settings=agent\.[^.&]+$/)
  await dialog.getByRole("button", { name: "Memory", exact: true }).click()
  await expect(page).toHaveURL(/settings=agent\.[^.&]+\.memory$/)
  await dialog.getByRole("button", { name: "Back to Doods" }).click()
  await expect(dialog.getByRole("heading", { name: "Doods", exact: true })).toBeVisible()

  // So is a workspace. One's own has no people to set, so it opens on its computers.
  await dialog.getByRole("button", { name: "Workspaces", exact: true }).click()
  await dialog.getByRole("button", { name: /: workspace settings$/ }).click()
  await expect(dialog.getByRole("heading", { name: "Computers", exact: true })).toBeVisible()
  await expect(dialog.getByRole("button", { name: "People", exact: true })).toHaveCount(0)
  await dialog.getByRole("button", { name: "Back to workspaces" }).click()
  await expect(dialog.getByRole("heading", { name: "Workspaces", exact: true })).toBeVisible()

  await closeSettings(page)
  await expect(page).not.toHaveURL(/settings=/)
})

test("the ways in from the rest of the app go straight inside", async ({ page }) => {
  await signIn(page)
  const dialog = page.getByRole("dialog")
  // The agent's strip leads to that agent.
  await page.getByRole("button", { name: "Juniper's settings" }).click()
  await expect(dialog.getByRole("button", { name: "Back to Doods" })).toBeVisible()
  await expect(dialog.getByRole("heading", { name: "Profile", exact: true })).toBeVisible()
  // From what it thinks with to what its workspace is signed in to, in the same window.
  await dialog.getByRole("button", { name: "Model and computers", exact: true }).click()
  await dialog.getByRole("button", { name: "Models", exact: true }).click()
  await expect(dialog.getByRole("button", { name: "Back to workspaces" })).toBeVisible()
  await expect(dialog.getByRole("heading", { name: "Models", exact: true })).toBeVisible()
  await closeSettings(page)

  // The workspace's menu leads to that workspace.
  await workspaceMenu(page).click()
  await page.getByRole("menuitem", { name: /Workspace settings/ }).click()
  await expect(dialog.getByRole("button", { name: "Back to workspaces" })).toBeVisible()
  await expect(dialog.getByRole("heading", { name: "Computers", exact: true })).toBeVisible()
})

test("an address from before there was one window still opens where it led", async ({ page }) => {
  await signIn(page)
  const chat = page.url().split("?")[0]!
  const dialog = page.getByRole("dialog")
  await page.goto(`${chat}?settings=identity`)
  await expect(dialog.getByRole("heading", { name: "Profile", exact: true })).toBeVisible()
  await page.goto(`${chat}?workspace=computers`)
  await expect(dialog.getByRole("heading", { name: "Computers", exact: true })).toBeVisible()
  await page.goto(`${chat}?workspace=agents`)
  await expect(dialog.getByRole("heading", { name: "Default model" })).toBeVisible()
  await page.goto(`/a/${chat.match(/\/a\/([^/]+)/)![1]!}/connectors`)
  await expect(dialog.getByRole("heading", { name: "Connectors", exact: true })).toBeVisible()
})

test("the theme is chosen under General, and kept by the browser", async ({ page }) => {
  await signIn(page)
  await openOwnSettings(page, "General")
  const html = page.locator("html")
  // Nothing is chosen yet, so it is as the device has it, which here is dark.
  await expect(page.getByRole("button", { name: "System", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await expect(html).toHaveClass(/dark/)
  await page.getByRole("button", { name: "Light", exact: true }).click()
  await expect(html).not.toHaveClass(/dark/)
  await page.reload()
  await expect(html).not.toHaveClass(/dark/)
  await expect(page.getByRole("button", { name: "Light", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await page.getByRole("button", { name: "System", exact: true }).click()
  await expect(html).toHaveClass(/dark/)
})

test("on a phone the settings show a list, and then what was chosen from it", async ({
  page,
  browser,
}) => {
  await signIn(page)
  const context = await browser.newContext({
    viewport: { width: 390, height: 780 },
    hasTouch: true,
    storageState: await page.context().storageState(),
  })
  const phone = await context.newPage()
  await phone.goto(page.url())
  const dialog = phone.getByRole("dialog")
  await phone.getByRole("button", { name: /'s settings$/ }).click()
  // The agent's sections, and nothing of any one of them.
  const profile = dialog.getByRole("button", { name: "Profile", exact: true })
  await expect(profile).toBeVisible()
  await expect(dialog.getByLabel("Name")).toBeHidden()
  await profile.click()
  await expect(dialog.getByLabel("Name")).toBeVisible()
  await expect(profile).toBeHidden()

  // Back out a step at a time: to its sections, to the list of agents, to the top.
  await dialog.getByRole("button", { name: "Back to Juniper" }).click()
  await dialog.getByRole("button", { name: "Back to Doods" }).click()
  await expect(dialog.getByRole("heading", { name: "Doods", exact: true })).toBeVisible()
  await dialog.getByRole("button", { name: "Back to Settings" }).click()
  await expect(dialog.getByRole("button", { name: "General", exact: true })).toBeVisible()
  // The way out is there on a section too, over the bar at its top.
  await dialog.getByRole("button", { name: "General", exact: true }).click()
  await dialog.getByRole("button", { name: "Close" }).click()
  await expect(dialog).toHaveCount(0)
  await context.close()
})
