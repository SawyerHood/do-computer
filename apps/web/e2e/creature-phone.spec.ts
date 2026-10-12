import { expect, test } from "./fixtures.ts"
import { asOwner, signIn } from "./helpers.ts"

// On a phone there is no panel: the wardrobe is the creature's page, and where it is looked after.
test.use({ creature: true, viewport: { width: 390, height: 844 } })

asOwner()

test("on a phone, a box opened in the wardrobe leaves the wardrobe open behind it", async ({
  page,
}) => {
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
  await expect(wardrobe.getByText("1 of 200 found")).toBeVisible()
  await expect(wardrobe.getByRole("button", { name: "Open Juniper's box" })).toHaveCount(0)
})
