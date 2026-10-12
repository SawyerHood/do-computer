import { expect, test } from "./fixtures.ts"
import { asOwner, composer, signIn } from "./helpers.ts"
import type { Page } from "@playwright/test"

// Wide enough for the agent's panel to be beside the chat, where its treats are.
test.use({ viewport: { width: 1440, height: 900 } })

asOwner()

const panel = (page: Page) => page.getByRole("complementary", { name: "About Juniper" })

async function say(page: Page, text: string) {
  await composer(page).fill(text)
  await page.keyboard.press("Enter")
  await expect(page.getByRole("log").getByText(`You said: ${text}`)).toBeVisible()
}

test("answered again and again within the hour, the creature earns one treat", async ({ page }) => {
  await signIn(page)
  await page.getByRole("button", { name: "Show Juniper's panel" }).click()
  await expect(panel(page).getByRole("button", { name: "Juniper has no treats" })).toBeVisible()

  const one = panel(page).getByRole("button", { name: "Give Juniper a treat: 1 treat" })
  await say(page, "Hello there")
  await expect(one).toBeVisible()
  // By the time the third answer is there, what followed the second has long been done.
  await say(page, "And again")
  await say(page, "And once more")
  await expect(one).toBeVisible()
})
