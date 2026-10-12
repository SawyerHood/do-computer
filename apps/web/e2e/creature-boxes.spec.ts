import { expect, test } from "./fixtures.ts"
import { asOwner, signIn } from "./helpers.ts"

// A box turns up every twelve hours. Here it is every few seconds, to see one do it.
test.use({ settings: { DC_BOX_EVERY_MS: "3000" }, viewport: { width: 1440, height: 900 } })

asOwner()

test("a box turns up by itself while the page is open, and waits with the others", async ({
  page,
}) => {
  await signIn(page)
  await page.getByRole("button", { name: "Show Juniper's panel" }).click()
  const box = page
    .getByRole("complementary", { name: "About Juniper" })
    .getByRole("button", { name: /^Open (one of )?Juniper's/ })
  await expect(box).toBeVisible()
  const waiting = async () =>
    Number(/(\d+) boxes$/.exec((await box.getAttribute("aria-label")) ?? "")?.[1] ?? 1)

  // Nothing is pressed, nothing is said to the agent, and the page is not loaded again.
  const before = await waiting()
  await expect.poll(waiting, { timeout: 15_000 }).toBeGreaterThan(before)
  await expect.poll(waiting, { timeout: 15_000 }).toBeGreaterThan(before + 1)
})
