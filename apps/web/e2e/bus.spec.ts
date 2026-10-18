import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures.ts"
import { asOwner, closeSettings, composer, openSettings, signIn } from "./helpers.ts"

// The main chat as a message bus: with the switch on, a Dood reaches the people in its main chat
// only through `send`, and everything else it does is folded into one row of its working.

asOwner()

/** A picture of the page, in both looks, where the run asks for them. */
async function shot(page: Page, name: string) {
  const folder = process.env.DC_SHOTS
  if (!folder) return
  await page.screenshot({ path: `${folder}/${name}-dark.png` })
  // The look is settled as the page opens, and is the class on the page from then on.
  await page.evaluate(() => document.documentElement.classList.remove("dark"))
  await page.screenshot({ path: `${folder}/${name}-light.png` })
  await page.evaluate(() => document.documentElement.classList.add("dark"))
}

const transcript = (page: Page) => page.getByRole("log")
/** The rows of the Dood's own working. */
const working = (page: Page) => transcript(page).locator("[data-work]")

async function say(page: Page, text: string) {
  await composer(page).fill(text)
  await page.keyboard.press("Enter")
}

test("is switched on in the Dood's settings, and is off until then", async ({ page }) => {
  await signIn(page)
  // Off, the Dood's words are its answer, as they always were.
  await say(page, "before the switch")
  await expect(transcript(page).getByText("You said: before the switch")).toBeVisible()
  await expect(working(page)).toHaveCount(0)

  await openSettings(page, "Model and computers")
  const toggle = page
    .getByRole("dialog")
    .getByRole("switch", { name: "Speak only through what it sends (preview)" })
  await expect(toggle).not.toBeChecked()
  await toggle.click()
  await expect(toggle).toBeChecked()
  await toggle.scrollIntoViewIfNeeded()
  await shot(page, "settings-switch")
  await closeSettings(page)
})

test("shows what it sends, and folds its own working into one row", async ({ page }) => {
  await signIn(page)
  await say(page, '/tool send {"text":"Hello from the bus. **This** is what I sent you."}')
  await expect(transcript(page).getByText("Hello from the bus.")).toBeVisible()
  // What it wrote after sending is its own, in a row that says it worked on it.
  await expect(working(page)).toHaveCount(1)
  await expect(transcript(page).getByText(/The tool returned/).first()).toBeHidden()
  // What came before the switch is drawn as it was.
  await expect(transcript(page).getByText("You said: before the switch")).toBeVisible()
  await working(page).getByRole("button", { name: /Worked on it/ }).click()
  await expect(working(page).getByText(/The tool returned/)).toBeVisible()
  await shot(page, "send-and-working")
})

test("is reminded once when it sends nothing, and then shows nothing", async ({ page }) => {
  await signIn(page)
  await say(page, "are you there?")
  await expect(transcript(page).getByText("are you there?", { exact: true })).toBeVisible()
  await expect(working(page)).toHaveCount(2)
  await expect(page.getByRole("status")).toHaveCount(0)
  // It answered with words twice, the second time to the reminder, and neither was shown.
  await expect(transcript(page).getByText("You said: are you there?").first()).toBeHidden()
  await working(page).last().getByRole("button", { name: /Worked on it/ }).click()
  // Both of its answers, to the message and to the reminder, are its own working.
  await expect(working(page).last().getByText("You said: are you there?")).toHaveCount(2)
  await expect(working(page).last().getByText("You said: are you there?").last()).toBeVisible()
  await shot(page, "unanswered")
})

test("is told of a sub-agent's report as an event, and can stay quiet", async ({ page }) => {
  await signIn(page)
  await say(
    page,
    '/tool subagent {"action":"start","title":"Look around","task":"Say what you see."}',
  )
  // The report arrives later, as an event, and the turn it sets going says nothing.
  const report = working(page).last()
  await expect(report.getByRole("button", { name: /1 event/ })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole("status")).toHaveCount(0)
  // Neither the report nor anything it said about it is shown until the row is opened.
  await expect(transcript(page).getByText(/reported back/).first()).toBeHidden()
  await report.getByRole("button", { name: /Worked on it/ }).click()
  await expect(report.getByText("Look around reported back")).toBeVisible()
  await shot(page, "event-quiet")
})
