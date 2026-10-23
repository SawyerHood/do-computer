import { RARITIES, wearItem } from "@do-computer/protocol"
import { expect, test } from "./fixtures.ts"
import { asOwner, signIn, panelSwitch } from "./helpers.ts"
import type { Page } from "@playwright/test"

// Wide enough for the agent's panel to be beside the chat, where its creature is looked after.
test.use({ creature: true, viewport: { width: 1440, height: 900 } })

asOwner()

const panel = (page: Page) => page.getByRole("complementary", { name: "About Juniper" })
const treat = (page: Page) => panel(page).getByRole("button", { name: "Give Juniper a treat" })
const waitingBox = (page: Page) => panel(page).getByRole("button", { name: "Open Juniper's box" })

/** Sign in, and open the agent's panel: its creature is looked after there. */
async function open(page: Page) {
  await signIn(page)
  await panelSwitch(page, "Show")
  await expect(panel(page)).toBeVisible()
}

test("the creature is given a treat as often as anyone likes, and none of them is a box", async ({
  page,
}) => {
  await open(page)
  // A box is waiting all the same: its first one is a welcome.
  await expect(waitingBox(page)).toBeVisible()
  for (let given = 0; given < 3; given++) {
    // It eats one at a time, so the next is given once the last is gone.
    await expect(treat(page)).toHaveAttribute("aria-busy", "false")
    await treat(page).click()
    await expect(treat(page)).toHaveAttribute("aria-busy", "true")
  }
  await expect(treat(page)).toHaveAttribute("aria-busy", "false")

  // The agent has counted them, and that is all they came to. Nothing is said in the chat.
  const agentId = page.url().match(/\/a\/([^/]+)/)![1]!
  const creature = async () => (await page.request.get(`/api/agents/${agentId}/creature`)).json()
  await expect.poll(async () => (await creature()).fed).toBe(3)
  expect(await creature()).toMatchObject({ boxes: 1, joy: 0 })
  await expect(page.getByRole("log").getByText(/treat/i)).toHaveCount(0)
})

test("a treat carried onto the creature is eaten when it is let go", async ({ page }) => {
  await open(page)
  const from = (await treat(page).boundingBox())!
  const creature = (await panel(page).getByRole("img", { name: "Dood avatar" }).boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2 + 30, from.y - 30, { steps: 4 })
  await page.mouse.move(creature.x + creature.width / 2, creature.y + creature.height * 0.6, {
    steps: 6,
  })
  await page.mouse.up()
  await expect(treat(page)).toHaveAttribute("aria-busy", "true")
  await expect(treat(page)).toHaveAttribute("aria-busy", "false")
})

test("a box that is waiting holds still", async ({ page }) => {
  // Asked for less motion it does not rock, so its picture should be the same on every beat.
  await page.emulateMedia({ reducedMotion: "reduce" })
  await open(page)
  await waitingBox(page).click()
  const box = page.getByRole("dialog")
  await expect(box.getByRole("heading", { name: "Juniper found a box" })).toBeVisible()
  await expect(box.locator("canvas")).toBeVisible()
  // The creatures on the page are drawn side by side in one picture, some on every beat and
  // some on every other. The box's place among them moved with that, and its dither with it.
  const pictures = () =>
    box.locator("canvas").evaluate(async (canvas: HTMLCanvasElement) => {
      const seen = new Set<string>()
      for (let frame = 0; frame < 24; frame++) {
        await new Promise((resolve) => requestAnimationFrame(resolve))
        seen.add(canvas.toDataURL())
      }
      return seen.size
    })
  await expect.poll(pictures).toBe(1)
})

test("the creature's picture at the top of its pages shows and hides its panel", async ({
  page,
}) => {
  await signIn(page)
  await expect(panel(page)).toHaveCount(0)
  const picture = page.getByRole("button", { name: /^Show Juniper's panel/ })
  await expect(picture).toHaveAttribute("aria-pressed", "false")
  await picture.click()
  await expect(panel(page)).toBeVisible()
  // It opens the panel and nothing over it.
  await expect(page.getByRole("dialog")).toHaveCount(0)
  const hide = page.getByRole("button", { name: /^Hide Juniper's panel/ })
  await expect(hide).toHaveAttribute("aria-pressed", "true")
  await hide.click()
  await expect(panel(page)).toHaveCount(0)
})

test("a box opens on something to wear, which is put on and kept in the wardrobe", async ({
  page,
}) => {
  await open(page)
  // Its picture at the top of its pages says that a box is waiting.
  const picture = page.getByRole("button", { name: /^Hide Juniper's panel/ })
  await expect(picture).toHaveAccessibleName("Hide Juniper's panel: a box is waiting")

  await waitingBox(page).click()
  const box = page.getByRole("dialog")
  await expect(box.getByRole("heading", { name: "Juniper found a box" })).toBeVisible()
  await box.getByRole("button", { name: "Open the box" }).click()

  // What was inside is named, with how rare it is, once the box has opened on it.
  await expect(box.getByText("1 of 200 in the wardrobe")).toBeVisible({ timeout: 15_000 })
  const found = (await box.getByRole("heading").textContent())!
  expect(found).not.toBe("Juniper found a box")
  await expect(
    box.getByText(new RegExp(`^(${RARITIES.map((rarity) => rarity.label).join("|")})$`)),
  ).toBeVisible()
  await box.getByRole("button", { name: "Wear it" }).click()
  await expect(box).toHaveCount(0)

  // There was only the one box. The next turns up by itself, six hours on.
  await expect(picture).toHaveAccessibleName("Hide Juniper's panel")
  await expect(waitingBox(page)).toHaveCount(0)
  await expect(
    panel(page).getByRole("button", { name: "The next box turns up in about 6 hours" }),
  ).toBeVisible()

  // The wardrobe has it, and says the creature has it on. Everything else is still to find.
  await panel(page).getByRole("button", { name: "Juniper's wardrobe" }).click()
  const wardrobe = page.getByRole("dialog")
  await expect(wardrobe.getByText("1 of 200 found")).toBeVisible()
  const wearing = wardrobe.getByRole("list", { name: "What Juniper has on" })
  await expect(wearing).toContainText(found)
  await expect(wardrobe.getByRole("tab", { name: /1\/\d+$/ })).toHaveCount(1)
  await wardrobe.getByRole("tab", { name: /1\/\d+$/ }).click()
  const tile = wardrobe.getByRole("button", { name: found, exact: true })
  await expect(tile).toHaveAttribute("aria-pressed", "true")
  await expect(wardrobe.getByRole("listitem", { name: /^Not found yet/ }).first()).toBeVisible()

  // Picked again it comes off, and picked once more it is back on.
  await tile.click()
  await expect(tile).toHaveAttribute("aria-pressed", "false")
  await expect(wearing).not.toContainText(found)
  await tile.click()
  await expect(wearing).toContainText(found)

  // It is still on after the page is loaded again: the agent keeps it, not the browser.
  await page.reload()
  // Whether its panel is open after a reload is up to the shell, so its picture opens it if not.
  const show = page.getByRole("button", { name: "Show Juniper's panel" })
  await expect(show.or(panel(page))).toBeVisible()
  if (await show.isVisible()) await show.click()
  await panel(page).getByRole("button", { name: "Juniper's wardrobe" }).click()
  await expect(
    page.getByRole("dialog").getByRole("list", { name: "What Juniper has on" }),
  ).toContainText(found)
})

test("the wardrobe is the workspace's: every Dood in it wears from it, two at once", async ({
  page,
}) => {
  await open(page)
  const made = (await (await page.request.post("/api/agents", { data: {} })).json()) as {
    agent: { id: string }
  }
  await page.request.patch(`/api/agents/${made.agent.id}`, {
    data: { name: "Bramble", hatched: true },
  })
  await page.reload()
  const show = page.getByRole("button", { name: "Show Juniper's panel" })
  await expect(show.or(panel(page))).toBeVisible()
  if (await show.isVisible()) await show.click()
  await panel(page).getByRole("button", { name: "Juniper's wardrobe" }).click()
  const wardrobe = page.getByRole("dialog")
  // What Juniper found is the workspace's, and says who found it.
  await expect(wardrobe.getByText("1 of 200 found by your Doods")).toBeVisible()
  const juniper = page.url().match(/\/a\/([^/]+)/)![1]!
  const { owned } = (await (await page.request.get(`/api/agents/${juniper}/creature`)).json()) as {
    owned: string[]
  }
  const found = wearItem(owned[0]!)!.name
  await wardrobe.getByRole("tab", { name: /1\/\d+$/ }).click()
  const tile = wardrobe.getByRole("button", { name: found, exact: true })
  await expect(tile).toContainText("found by Juniper")

  // Bramble is dressed in it too, from the same wardrobe.
  await wardrobe.getByRole("radio", { name: "Bramble" }).click()
  await expect(wardrobe.getByRole("list", { name: "What Bramble has on" })).toBeVisible()
  await expect(tile).toHaveAttribute("aria-pressed", "false")
  await tile.click()
  await expect(tile).toHaveAttribute("aria-pressed", "true")
  await expect(wardrobe.getByRole("list", { name: "What Bramble has on" })).toContainText(found)
  await expect(tile.locator("[title^='Worn by']")).toHaveAttribute(
    "title",
    /^Worn by (Juniper, Bramble|Bramble, Juniper)$/,
  )
})
