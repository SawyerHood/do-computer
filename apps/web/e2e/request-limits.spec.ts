import { expect, test } from "./fixtures.ts"
import { asOwner, composer, newChat, signIn } from "./helpers.ts"

// A request to the model that keeps being cut off before it is sent, as one too large for the
// server's memory is, ends its chat's run. Here no request may be started at all, so the first
// is one too many, as the fourth would be on a server that is reset by each.
test.use({ settings: { DC_REQUEST_TRIES: "0" } })

asOwner()

test("a run whose request keeps being cut off is ended, and the chat says why", async ({
  page,
}) => {
  await signIn(page)
  await newChat(page)
  await composer(page).fill("What is on my screen?")
  await composer(page).press("Enter")
  const failure = page
    .getByRole("alert")
    .filter({ hasText: "its request to the model was cut off several times" })
  await expect(failure).toBeVisible({ timeout: 15_000 })
  await expect(failure).toContainText("too large for the server")
  await expect(failure).toContainText("Send a message to try again")
  // It is the server's own words: there is nothing from a provider to look at.
  await expect(failure.getByRole("button", { name: "Details" })).toHaveCount(0)
  await expect(failure.getByRole("button", { name: "Try again" })).toBeVisible()
  // The model was never asked, and the Dood is not left working.
  await expect(page.getByRole("main").getByText("You said:")).toHaveCount(0)
  await expect(composer(page)).toBeEditable()
  // For a picture of it, once what is under the message has settled.
  if (process.env.DC_CUT_OFF_SHOT !== undefined) {
    await page.waitForTimeout(1_000)
    await page.screenshot({ path: process.env.DC_CUT_OFF_SHOT })
  }
})
