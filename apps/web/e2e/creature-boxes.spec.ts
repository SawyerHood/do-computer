import { expect, test } from "./fixtures.ts"
import { asOwner, signIn } from "./helpers.ts"

// The next box turns up six hours after the last is opened. Here it is a few seconds, to see it.
test.use({ settings: { DC_BOX_EVERY_MS: "3000" }, viewport: { width: 1440, height: 900 } })

asOwner()

test("the next box turns up by itself once the last is opened, and no other while it waits", async ({
  page,
}) => {
  await signIn(page)
  await page.getByRole("button", { name: "Show Juniper's panel" }).click()
  const panel = page.getByRole("complementary", { name: "About Juniper" })
  const box = panel.getByRole("button", { name: "Open Juniper's box" })
  const agentId = page.url().match(/\/a\/([^/]+)/)![1]!
  const boxes = async () =>
    (await (await page.request.get(`/api/agents/${agentId}/creature`)).json()).boxes

  // Its first box has waited since it hatched, many of these waits ago, and is the only one.
  await page.waitForTimeout(7_000)
  await expect(box).toBeVisible()
  expect(await boxes()).toBe(1)

  // Opened, there is none, and the page says another is on its way.
  expect((await page.request.post(`/api/agents/${agentId}/creature/open`)).status()).toBe(200)
  await expect(
    panel.getByRole("button", { name: /^Juniper's next box turns up in about/ }),
  ).toBeVisible()

  // It turns up with nothing pressed, nothing said to the agent, and the page not loaded again.
  await expect(box).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(7_000)
  await expect(box).toBeVisible()
  expect(await boxes()).toBe(1)
})
