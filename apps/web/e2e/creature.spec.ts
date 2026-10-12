import { RARITIES, TREATS_PER_BOX } from "@durable-computer/protocol"
import { expect, test } from "./fixtures.ts"
import { asOwner, composer, signIn } from "./helpers.ts"
import type { Page } from "@playwright/test"

// Wide enough for the agent's panel to be beside the chat, where its creature is looked after.
// It earns one treat an hour at most: here it earns one for every answer, to have a few to give.
test.use({
  creature: true,
  settings: { DC_TREAT_EVERY_MS: "0" },
  viewport: { width: 1440, height: 900 },
})

asOwner()

const panel = (page: Page) => page.getByRole("complementary", { name: "About Juniper" })
const treats = (page: Page, count: number) =>
  panel(page).getByRole("button", {
    name:
      count === 0
        ? "Juniper has no treats"
        : `Give Juniper a treat: ${count} ${count === 1 ? "treat" : "treats"}`,
  })

/** Sign in, and open the agent's panel: its creature is looked after there. */
async function open(page: Page) {
  await signIn(page)
  await page.getByRole("button", { name: "Show Juniper's panel" }).click()
  await expect(panel(page)).toBeVisible()
}

async function say(page: Page, text: string) {
  await composer(page).fill(text)
  await page.keyboard.press("Enter")
  await expect(page.getByRole("log").getByText(`You said: ${text}`)).toBeVisible()
}

test("the creature earns treats as the agent answers, and is given them one at a time", async ({
  page,
}) => {
  await open(page)
  // It has earned nothing yet. A box is waiting all the same: its first one is a welcome.
  await expect(treats(page, 0)).toBeVisible()
  await expect(panel(page).getByRole("button", { name: "Open Juniper's box" })).toBeVisible()

  await say(page, "Hello there")
  await expect(treats(page, 1)).toBeVisible()
  await say(page, "And again")
  await expect(treats(page, 2)).toBeVisible()

  // Pressing the pile sends a treat to its mouth. Nothing is said about it in the chat.
  await treats(page, 2).click()
  await expect(treats(page, 1)).toBeVisible()
  await expect(page.getByRole("log").getByText(/treat/i)).toHaveCount(0)
})

test("a box opens on something to wear, which is put on and kept in the wardrobe", async ({
  page,
}) => {
  await open(page)
  // Its picture at the top of its pages says that a box is waiting.
  const picture = page.getByRole("button", { name: /^Juniper's wardrobe/ }).first()
  await expect(picture).toHaveAccessibleName("Juniper's wardrobe: a box is waiting")

  await panel(page).getByRole("button", { name: "Open Juniper's box" }).click()
  const box = page.getByRole("dialog")
  await expect(box.getByRole("heading", { name: "Juniper found a box" })).toBeVisible()
  await box.getByRole("button", { name: "Open the box" }).click()

  // What was inside is named, with how rare it is, once the box has opened on it.
  await expect(box.getByText("1 of 200 found")).toBeVisible({ timeout: 15_000 })
  const found = (await box.getByRole("heading").textContent())!
  expect(found).not.toBe("Juniper found a box")
  await expect(
    box.getByText(new RegExp(`^(${RARITIES.map((rarity) => rarity.label).join("|")})$`)),
  ).toBeVisible()
  await box.getByRole("button", { name: "Wear it" }).click()
  await expect(box).toHaveCount(0)

  // There was only the one box.
  await expect(picture).toHaveAccessibleName("Juniper's wardrobe")
  await expect(panel(page).getByRole("button", { name: "Open Juniper's box" })).toHaveCount(0)

  // The wardrobe has it, and says the creature has it on. Everything else is still to find.
  await picture.click()
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
  await page
    .getByRole("button", { name: /^Juniper's wardrobe/ })
    .first()
    .click()
  await expect(
    page.getByRole("dialog").getByRole("list", { name: "What Juniper has on" }),
  ).toContainText(found)
})

test("enough treats and the creature finds another box", async ({ page }) => {
  await open(page)
  // One treat was given before, and one is left over.
  await expect(treats(page, 1)).toBeVisible()
  const more = TREATS_PER_BOX - 1
  for (let answer = 2; answer <= more; answer++) {
    await say(page, `Treat number ${answer}`)
    await expect(treats(page, answer)).toBeVisible()
  }
  const box = panel(page).getByRole("button", { name: "Open Juniper's box" })
  for (let left = more; left > 0; left--) {
    await expect(box).toHaveCount(0)
    // It eats one at a time, so the next is given once the last is gone.
    await expect(treats(page, left)).toHaveAttribute("aria-busy", "false")
    await treats(page, left).click()
    await expect(treats(page, left - 1)).toBeVisible()
  }
  await expect(box).toBeVisible()
})

test("a treat carried while another is earned is still eaten when it is let go", async ({
  page,
}) => {
  await open(page)
  await say(page, "One for now")
  await expect(treats(page, 1)).toBeVisible()
  const pile = (await treats(page, 1).boundingBox())!
  const creature = (await panel(page).getByRole("img", { name: "Agent avatar" }).boundingBox())!
  await page.mouse.move(pile.x + pile.width / 2, pile.y + pile.height / 2)
  await page.mouse.down()
  await page.mouse.move(pile.x + pile.width / 2 + 30, pile.y - 30, { steps: 4 })
  // The pile is made anew as the treat lands on it, and the pointer was held by the old one:
  // the treat then hung where it was let go, and no other could be given.
  await say(page, "And one while it is carried")
  await expect(treats(page, 2)).toBeVisible()
  await page.mouse.move(creature.x + creature.width / 2, creature.y + creature.height * 0.6, {
    steps: 6,
  })
  await page.mouse.up()
  await expect(treats(page, 1)).toHaveAttribute("aria-busy", "false")
})

test("a box that is waiting holds still", async ({ page }) => {
  // Asked for less motion it does not rock, so its picture should be the same on every beat.
  await page.emulateMedia({ reducedMotion: "reduce" })
  await open(page)
  await panel(page).getByRole("button", { name: "Open Juniper's box" }).click()
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

test.describe("on a phone, where the wardrobe is the creature's page", () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test("a box opened in the wardrobe leaves the wardrobe open behind it", async ({ page }) => {
    await signIn(page)
    await page.getByRole("button", { name: "Juniper's wardrobe: a box is waiting" }).click()
    const wardrobe = page
      .getByRole("dialog", { includeHidden: true })
      .filter({ has: page.getByRole("tablist", { name: "Where it is worn", includeHidden: true }) })
    await expect(wardrobe).toBeVisible()
    await wardrobe.getByRole("button", { name: "Open Juniper's box" }).click()

    // The box is over the wardrobe, which used to be shut to show it.
    const box = page
      .getByRole("dialog")
      .filter({ has: page.getByRole("button", { name: "Open the box" }) })
    await expect(box.getByRole("heading", { name: "Juniper found a box" })).toBeVisible()
    await expect(wardrobe).toBeVisible()
    await box.getByRole("button", { name: "Open the box" }).click()
    const kept = page.getByRole("button", { name: "Keep it for later" })
    await expect(kept).toBeVisible({ timeout: 15_000 })
    await kept.click()

    // With the box done with, the wardrobe is where it was, and has what was inside.
    await expect(kept).toHaveCount(0)
    await expect(wardrobe).toBeVisible()
    await expect(wardrobe.getByText("2 of 200 found")).toBeVisible()
    await expect(wardrobe.getByRole("button", { name: "Open Juniper's box" })).toHaveCount(0)
  })
})
