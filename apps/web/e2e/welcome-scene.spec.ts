import { expect, test } from "./fixtures.ts"

// The first run where its scene is drawn: a sky, and the egg coming down through it. The rest of
// what the first run asks and does is in welcome.spec.ts, without the drawing.
test.use({ creature: true })

test("welcome opens over plain http without randomUUID", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(crypto, "randomUUID", { value: undefined })
  })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/welcome")
  await expect(page.getByRole("button", { name: "Hello!" })).toBeVisible()
})

test("the egg is not seen until it is known where it starts", async ({ page }) => {
  // The answer to who is here is held back. The egg can be drawn before that answer comes, and
  // was seen standing in an empty night until it did.
  let answer = () => {}
  const held = new Promise<void>((resolve) => {
    answer = resolve
  })
  await page.route("**/api/me", async (route) => {
    await held
    await route.continue()
  })
  await page.goto("/welcome")
  // The sky is being drawn, so the egg could be too.
  await expect(page.locator("[data-welcome] > canvas")).toHaveCSS("opacity", "1")
  const egg = page.locator("[data-egg]")
  await expect(egg).toBeHidden()

  // Nobody is signed in: it is first seen at the top of the sky, on its way down.
  answer()
  await expect(egg).toBeVisible()
  expect((await egg.boundingBox())!.y).toBeLessThan(0)
})
