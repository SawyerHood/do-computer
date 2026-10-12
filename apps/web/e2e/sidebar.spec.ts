import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures.ts"
import { asOwner, composer, signIn } from "./helpers.ts"

asOwner()

/** An agent with a name, out of its egg, made without going to it. */
async function make(page: Page, name: string, workspaceId?: string): Promise<string> {
  const made = await page.request.post("/api/agents", {
    data: workspaceId === undefined ? {} : { workspaceId },
  })
  const { agent } = (await made.json()) as { agent: { id: string } }
  await page.request.patch(`/api/agents/${agent.id}`, { data: { name, hatched: true } })
  return agent.id
}

const agents = (page: Page) => page.getByRole("navigation", { name: "Agents" })
const row = (page: Page, name: string) => agents(page).getByRole("link", { name })

test("someone in no team has their agents under no workspace's name", async ({ page }) => {
  await signIn(page)
  await expect(agents(page).getByRole("heading", { name: "Agents" })).toBeVisible()
  await expect(agents(page).getByRole("region")).toHaveCount(1)
  await expect(agents(page).getByRole("button", { name: "Personal", exact: true })).toHaveCount(0)
  await expect(row(page, "Juniper")).toHaveAttribute("aria-current", "page")
  // A team is started from the foot of the list.
  await expect(agents(page).getByRole("button", { name: "New team" })).toBeVisible()
})

test("someone in a team has each workspace's agents under its name, which folds them away", async ({
  page,
}) => {
  await signIn(page)
  const made = await page.request.post("/api/workspaces", {
    data: { name: "Tidewater", color: "teal" },
  })
  const { workspace } = (await made.json()) as { workspace: { id: string } }
  const scout = await make(page, "Scout", workspace.id)
  await page.reload()

  const mine = agents(page).getByRole("region", { name: "Personal" })
  const team = agents(page).getByRole("region", { name: "Tidewater" })
  await expect(agents(page).getByRole("heading", { name: "Agents" })).toHaveCount(0)
  await expect(mine.getByRole("link", { name: "Juniper" })).toBeVisible()
  await expect(team.getByRole("link", { name: "Scout" })).toBeVisible()
  await expect(mine.getByRole("link", { name: "Scout" })).toHaveCount(0)

  // An agent is made in the workspace whose heading was used.
  await team.getByRole("button", { name: "New agent in Tidewater" }).click()
  await page.waitForURL((url) => /\/c\/\d+$/.test(url.pathname) && !url.pathname.includes(scout))
  await expect(team.getByRole("link")).toHaveCount(2)
  await expect(mine.getByRole("link")).toHaveCount(1)
  await row(page, "Juniper").click()
  await expect(composer(page)).toHaveAttribute("placeholder", "Message Juniper")

  // Folded, the team's agents are put away, and the other workspace is as it was.
  const fold = team.getByRole("button", { name: "Tidewater", exact: true })
  await fold.click()
  await expect(fold).toHaveAttribute("aria-expanded", "false")
  await expect(team.getByRole("link")).toHaveCount(0)
  await expect(mine.getByRole("link", { name: "Juniper" })).toBeVisible()
  // It stays folded.
  await page.reload()
  await expect(fold).toHaveAttribute("aria-expanded", "false")
  await expect(team.getByRole("link")).toHaveCount(0)
  await fold.click()
  await expect(team.getByRole("link", { name: "Scout" })).toBeVisible()

  // The workspace's own settings are on its heading.
  await team.getByRole("button", { name: "Tidewater: workspace menu" }).click()
  await page.getByRole("menuitem", { name: "Workspace settings" }).click()
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Back to workspaces" }),
  ).toBeVisible()
})
