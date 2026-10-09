import { expect, test } from "./fixtures.ts"
import { asOwner, closeSettings, composer, openSettings, signIn, tab } from "./helpers.ts"

// These are about the creature, so here it is drawn live. The first of them names the agent.
asOwner({ agent: null })
test.use({ creature: true })

test("identity edits are saved and show up across the app", async ({ page }) => {
  await signIn(page)
  // The tab's icon is the agent's creature, as it looks now.
  const icon = page.locator('link[rel="icon"]')
  await expect(icon).toHaveAttribute("href", /^data:image\//)
  const before = await icon.getAttribute("href")
  await openSettings(page, "Identity")
  await page.getByLabel("Name").fill("Juniper")
  await page.getByLabel("Tagline").fill("Calm and curious")
  // Its color is a choice; what it looks like is a roll of the dice.
  await page.getByRole("button", { name: "Tide" }).click()
  await page.getByRole("button", { name: "Roll a new look" }).click()
  await page.locator("#user").fill("Prefers short answers")
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByText("Saved", { exact: true })).toBeVisible()
  await expect.poll(() => icon.getAttribute("href")).not.toBe(before)
  await expect(icon).toHaveAttribute("href", /^data:image\//)

  await closeSettings(page)
  await expect(page.getByText("Juniper").first()).toBeVisible()
  await expect(composer(page)).toHaveAttribute("placeholder", "Message Juniper")

  await page.reload()
  await openSettings(page, "Identity")
  await expect(page.getByLabel("Name")).toHaveValue("Juniper")
  await expect(page.locator("#user")).toHaveValue("Prefers short answers")
  await expect(page.getByRole("button", { name: "Tide" })).toHaveAttribute("aria-pressed", "true")
  const agentId = page.url().match(/\/a\/([^/]+)/)![1]!
  const saved = (await (await page.request.get(`/api/agents/${agentId}`)).json()) as {
    agent: { avatar: { color: string; seed?: string }; hatched: boolean }
  }
  expect(saved.agent.avatar.color).toBe("tide")
  expect(saved.agent.avatar.seed).toMatch(/^.{6,}$/)
  // It has a name now, so it is out of its egg whether or not anyone watched.
  expect(saved.agent.hatched).toBe(true)
})

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

test("a creature that could not be drawn as the page opened is drawn once it can be", async ({
  page,
}) => {
  // There is no WebGL to be had as the page opens: a graphics card that is busy, or gone a moment.
  await page.addInitScript(() => {
    const real = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      kind: string,
      ...rest: unknown[]
    ) {
      if (kind !== "2d" && !("webglIsBack" in window)) return null
      return (real as (...args: unknown[]) => unknown).call(this, kind, ...rest)
    } as typeof real
  })
  await signIn(page)
  const creature = page.getByRole("img", { name: "Agent avatar" }).first()
  // A still picture stands in for it.
  await expect(creature.locator("img")).toHaveCount(1)
  await expect(creature.locator("canvas")).toBeHidden()

  // Then there is, and the page is come back to. Nobody loaded it again.
  await page.evaluate(() => {
    Object.assign(window, { webglIsBack: true })
    window.dispatchEvent(new Event("focus"))
  })
  await expect(creature.locator("canvas")).toBeVisible()
  await expect(creature.locator("img")).toHaveCount(0)
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
