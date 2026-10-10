import { expect, test } from "./fixtures.ts"

// The first run where its scene is drawn: a sky, and the egg coming down through it. The rest of
// what the first run asks and does is in welcome.spec.ts, without the drawing.
test.use({ creature: true })

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

test("a card comes back closed, and opens once its words are said", async ({ page }) => {
  await page.goto("/welcome")
  await page.getByRole("button", { name: "Skip" }).click()
  const asked = page.locator("[data-card]")
  await expect(asked.getByRole("status")).toHaveText(/Is somebody out there\?$/)

  // What the card asks for only ever opens. It used to come back still open on the last answer,
  // as tall as the next form, and shut as the words began: that is counted here.
  await page.evaluate(() => {
    const seen = { shut: 0 }
    Object.assign(window, { seenShutting: seen })
    document.addEventListener("transitionrun", (event) => {
      const more = event.target as HTMLElement
      if (event.propertyName === "grid-template-rows" && more.matches("[data-more][inert]")) {
        seen.shut++
      }
    })
  })
  await asked.getByRole("button", { name: "Hello!" }).click()
  await expect(asked.getByLabel("Your name")).toBeVisible()
  const seen = await page.evaluate(
    () => (window as unknown as { seenShutting: { shut: number } }).seenShutting,
  )
  expect(seen.shut).toBe(0)
})
