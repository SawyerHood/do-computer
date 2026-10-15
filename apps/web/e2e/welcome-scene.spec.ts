import type { MadeDood } from "@do-computer/protocol"
import { expect, test } from "./fixtures.ts"
import { card, owner } from "./helpers.ts"

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

test("a Dood claimed from a post is on the island while it becomes an agent", async ({ page }) => {
  // Hatched with no account, as its own page does it, and then they signed in elsewhere and
  // were sent back with it.
  const made = (await (
    await page.request.post("/api/doods", {
      data: { name: "Gerald", color: "rose", seed: "post-1234" },
    })
  ).json()) as MadeDood
  expect((await page.request.post("/api/auth/sign-up/email", { data: owner })).status()).toBe(200)
  // Becoming an agent is held back. It takes several trips to the server, and until it was done
  // the island was seen with nobody on it and nothing said.
  let wake = () => {}
  const held = new Promise<void>((resolve) => {
    wake = resolve
  })
  await page.route("**/api/doods/*/agent", async (route) => {
    await held
    await route.continue()
  })
  await page.goto(`/welcome?dood=${made.dood.id}&key=${made.key}`)
  await expect(page.locator("[data-egg]")).toBeVisible()
  const waking = await card(page, /^I’m Gerald, and I’m yours now, Sawyer! Give me a moment/)
  await expect(waking.getByText("Waking up…")).toBeVisible()

  wake()
  const out = await card(page, /^There you are, Sawyer!/)
  await expect(out.getByRole("button", { name: "Start chatting with Gerald" })).toBeVisible()
})
