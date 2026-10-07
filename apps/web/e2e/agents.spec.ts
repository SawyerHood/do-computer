import { expect, test } from "./fixtures.ts"
import { asOwner, openSettings, signIn } from "./helpers.ts"

asOwner()
// These are about the creature, so here it is drawn live.
test.use({ creature: true })

test("a new agent is met as an egg, and hatches once", async ({ page }) => {
  await signIn(page)
  const first = page.url().match(/\/a\/([^/]+)/)![1]!
  await page.getByRole("button", { name: "New agent", exact: true }).click()
  await expect(page).not.toHaveURL(new RegExp(`/a/${first}`))
  await page.waitForURL(/\/a\/[^/]+\/c\/\d+/)
  const agentId = page.url().match(/\/a\/([^/]+)/)![1]!
  const hatched = async () =>
    (
      (await (await page.request.get(`/api/agents/${agentId}`)).json()) as {
        agent: { hatched: boolean }
      }
    ).agent.hatched

  // It starts in its egg, wherever it is shown, and the wait can be skipped.
  expect(await hatched()).toBe(false)
  const welcome = page.getByRole("log").getByRole("img", { name: "Agent avatar" })
  await expect(welcome).toHaveAttribute("data-mood", "egg")
  await expect(page.getByRole("button", { name: "Skip the hatching" })).toBeVisible()

  // Then it is out, here and for good: a reload does not put it back.
  await expect.poll(hatched, { timeout: 15_000 }).toBe(true)
  await expect(page.getByRole("button", { name: "Skip the hatching" })).toHaveCount(0)
  await expect(welcome).toHaveAttribute("data-mood", "idle")
  await page.reload()
  await expect(welcome).toHaveAttribute("data-mood", "idle")
  await expect(page.getByRole("button", { name: "Skip the hatching" })).toHaveCount(0)
  await page.request.delete(`/api/agents/${agentId}`)
})

test("the creature in the agent's panel can be petted", async ({ page }) => {
  await signIn(page)
  await page.getByRole("button", { name: /^Show .+'s panel$/ }).click()
  // One that is still hatching is busy with that.
  await expect(page.getByRole("button", { name: "Skip the hatching" })).toHaveCount(0, {
    timeout: 15_000,
  })
  const creature = page
    .getByRole("complementary", { name: /^About/ })
    .getByRole("img", { name: "Agent avatar" })
  const hearts = creature.locator(".pet-heart")
  const box = (await creature.boundingBox())!
  const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

  // The pointer passing over it on its way elsewhere is not petting.
  await page.mouse.move(middle.x - box.width * 0.6, middle.y)
  await page.mouse.move(middle.x + box.width * 0.6, middle.y, { steps: 12 })
  await expect(hearts).toHaveCount(0)

  // Rubbing it is, and so is a click. The hearts are gone again a moment later.
  await page.waitForTimeout(600)
  for (const side of [-1, 1, -1, 1]) {
    await page.mouse.move(middle.x + side * box.width * 0.3, middle.y, { steps: 10 })
  }
  await expect(hearts).not.toHaveCount(0)
  await expect(hearts).toHaveCount(0)
  await page.mouse.click(middle.x, middle.y)
  await expect(hearts).toHaveCount(1)
})

test("a second agent can be made, and deleted without touching the first", async ({ page }) => {
  await signIn(page)
  const first = page.url().match(/\/a\/([^/]+)/)![1]!
  await page.getByRole("button", { name: "New agent", exact: true }).click()
  await expect(page).not.toHaveURL(new RegExp(`/a/${first}`))
  const second = page.url().match(/\/a\/([^/]+)/)![1]!
  await expect(page.getByText("It has no name yet")).toBeVisible()

  await openSettings(page, "Move or delete")
  await page.getByRole("button", { name: "Delete agent…" }).click()
  const confirm = page.getByRole("button", { name: "Delete for good" })
  await expect(confirm).toBeDisabled()
  // It has no name yet, so the word to type is "delete".
  await page.getByLabel(/to confirm/).fill("delete")
  await confirm.click()

  // Back on the first agent, which is as it was.
  await expect(page).toHaveURL(new RegExp(`/a/${first}/c/\\d+`))
  await expect(page.getByText("Juniper").first()).toBeVisible()
  const gone = await page.request.get(`/api/agents/${second}`)
  expect(gone.status()).toBe(404)
  const agents = (await (await page.request.get("/api/agents")).json()) as { agents: unknown[] }
  expect(agents.agents.length).toBe(1)
})
