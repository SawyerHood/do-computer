import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures.ts"
import { asOwner, closeSettings, composer, openSettings, signIn, tab } from "./helpers.ts"

// The main chat as a message bus: with the switch on, a Dood reaches the people in its main chat
// only through `send`, and everything else it does is folded into one row of its working.

asOwner()

// The look the pictures are taken in. It is settled as a page opens, so a run takes one.
const scheme = process.env.DC_SHOTS_SCHEME === "light" ? "light" : "dark"
test.use({ colorScheme: scheme })

/** A picture of the page, where the run asks for them. */
async function shot(page: Page, name: string) {
  const folder = process.env.DC_SHOTS
  if (folder) await page.screenshot({ path: `${folder}/${name}-${scheme}.png` })
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
  await say(
    page,
    [
      '/tool bash {"command":"echo the forecast is sunny"}',
      '/tool send {"text":"Hello from the bus. **This** is what I sent you."}',
    ].join("\n"),
  )
  await expect(transcript(page).getByText("Hello from the bus.")).toBeVisible()
  // The step it took on the way is in one row that says it worked on it.
  await expect(working(page)).toHaveCount(1)
  await expect(working(page).getByRole("button", { name: "Worked on it · 1 step" })).toBeVisible()
  // What it wrote after sending, with nothing done besides, is no row at all.
  await expect(page.getByRole("status")).toHaveCount(0)
  await expect(transcript(page).getByText(/The tool returned/)).toHaveCount(0)
  // What came before the switch is drawn as it was.
  await expect(transcript(page).getByText("You said: before the switch")).toBeVisible()
  await working(page)
    .getByRole("button", { name: /Worked on it/ })
    .click()
  await expect(working(page).getByText(/Ran: echo the forecast/)).toBeVisible()
  await shot(page, "send-and-working")
})

test("keeps a send that failed in view, and says it was not sent", async ({ page }) => {
  await signIn(page)
  await say(page, '/tool send {"text":"Here is the report.","files":["missing-report.md"]}')
  await expect(transcript(page).getByText("Here is the report.").first()).toBeVisible()
  const alert = transcript(page).getByRole("alert").first()
  await expect(alert).toContainText("Not sent:")
  await expect(alert).toContainText("missing-report.md")
  // The echo model tries again when it is reminded, and that fails the same way.
  await expect(page.getByRole("status")).toHaveCount(0)
  await shot(page, "failed-send")
})

test("is reminded once when it sends nothing, and then shows nothing", async ({ page }) => {
  await signIn(page)
  // The chat as the last test left it, once the Dood is done with it.
  await expect(transcript(page).getByText("Here is the report.").last()).toBeVisible()
  await expect(page.getByRole("status")).toHaveCount(0)
  const before = await working(page).count()
  await say(page, "are you there?")
  await expect(transcript(page).getByText("are you there?", { exact: true })).toBeVisible()
  await expect(working(page)).toHaveCount(before + 1)
  await expect(page.getByRole("status")).toHaveCount(0)
  // It answered with words twice, the second time to the reminder, and neither was shown.
  await expect(transcript(page).getByText("You said: are you there?").first()).toBeHidden()
  await working(page)
    .last()
    .getByRole("button", { name: /Worked on it/ })
    .click()
  // Both of its answers, to the message and to the reminder, are its own working.
  await expect(working(page).last().getByText("You said: are you there?")).toHaveCount(2)
  await expect(working(page).last().getByText("You said: are you there?").last()).toBeVisible()
  await shot(page, "unanswered")
})

test("is told of a sub-agent's report as an event, folded in with the rest of its working", async ({
  page,
}) => {
  await signIn(page)
  await say(
    page,
    '/tool subagent {"action":"start","title":"Look around","task":"Say what you see."}',
  )
  // The report arrives later, as an event. The person had nothing back, so the turn it starts is
  // the one that is reminded; the echo model sends nothing then either.
  const report = working(page).last()
  await expect(report.getByRole("button", { name: /1 event/ })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole("status")).toHaveCount(0)
  // Neither the report nor anything it said about it is shown until the row is opened.
  await expect(
    transcript(page)
      .getByText(/reported back/)
      .first(),
  ).toBeHidden()
  await report.getByRole("button", { name: /Worked on it/ }).click()
  await expect(report.getByText("Look around reported back")).toBeVisible()
  await shot(page, "event-quiet")
})

/** A schedule that runs once, a moment from now, made in the same message as a send. */
const scheduled = (title: string, prompt: string) =>
  [
    `/tool schedule ${JSON.stringify({
      action: "create",
      schedule: new Date(Date.now() + 2_500).toISOString(),
      prompt,
      title,
    })}`,
    `/tool send ${JSON.stringify({ text: `I will see to "${title}" in a moment.` })}`,
  ].join("\n")

test("is told what an automation's run came to, and can stay quiet about it", async ({ page }) => {
  await signIn(page)
  await say(page, scheduled("Weather check", "Check the weather."))
  await expect(
    transcript(page).getByText('I will see to "Weather check" in a moment.'),
  ).toBeVisible()
  const before = await working(page).count()
  // The run reports to the main chat, which the echo model leaves without a word.
  await expect(working(page)).toHaveCount(before + 1, { timeout: 15_000 })
  const row = working(page).last()
  await expect(row.getByRole("button", { name: /1 event/ })).toBeVisible()
  await expect(page.getByRole("status")).toHaveCount(0)
  await expect(transcript(page).getByText(/You are running the scheduled task/)).toBeHidden()
  await row.getByRole("button", { name: /Worked on it/ }).click()
  await expect(row.getByText("The automation Weather check reported")).toBeVisible()
  await row.getByRole("button", { name: "What it said" }).click()
  await expect(
    row.getByText(/You are running the scheduled task "Weather check"/).first(),
  ).toBeVisible()
  await expect(row.getByRole("link", { name: "View run" })).toBeVisible()
  await shot(page, "automation-quiet")
})

test("sends what is worth sending from an automation's result", async ({ page }) => {
  await signIn(page)
  // What the run ends with carries a line the echo model, in the main chat, acts on.
  await say(
    page,
    scheduled(
      "Rain watch",
      `Look at the forecast.\n/tool send ${JSON.stringify({ text: "Rain from 3pm: bring a coat." })}`,
    ),
  )
  await expect(transcript(page).getByText('I will see to "Rain watch" in a moment.')).toBeVisible()
  await expect(transcript(page).getByText("Rain from 3pm: bring a coat.")).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByRole("status")).toHaveCount(0)
  // The event is in the row of working that led to the send.
  const rows = working(page).filter({
    has: page.getByRole("button", { name: /Worked on it · 1 event/ }),
  })
  // This automation's and the last one's.
  await expect(rows).toHaveCount(2)
  const row = rows.nth(1)
  await row.getByRole("button", { name: /Worked on it/ }).click()
  await expect(row.getByText("The automation Rain watch reported")).toBeVisible()
  await shot(page, "automation-send")
})

test("lists the automations' runs as reported to the main chat", async ({ page }) => {
  await signIn(page)
  await tab(page, "Automations").click()
  const card = page.getByRole("listitem").filter({ hasText: "Rain watch" })
  await expect(card.getByText(/reported to the main chat/)).toBeVisible()
  await expect(card.getByRole("link", { name: "View run" })).toBeVisible()
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: "Weather check" })
      .getByText(/reported to the main chat/),
  ).toBeVisible()
  // The tab's menu, out of the picture.
  await page.keyboard.press("Escape")
  await page.mouse.move(0, 0)
  await expect(page.getByRole("menu")).toHaveCount(0)
  await page.waitForTimeout(300)
  await shot(page, "automations-page")
})

test("shows what a sub-agent asks a person for in the main chat, under its name", async ({
  page,
}) => {
  await signIn(page)
  const task = `/tool request_secret ${JSON.stringify({
    secrets: [{ name: "FORECAST_KEY", description: "From the weather service" }],
    purpose: "To read the forecast",
  })}`
  await say(
    page,
    [
      `/tool subagent ${JSON.stringify({ action: "start", title: "Forecast helper", task })}`,
      `/tool send ${JSON.stringify({ text: "A helper is reading the forecast." })}`,
    ].join("\n"),
  )
  const forms = page.getByRole("list", { name: "Secrets it asked for" })
  await expect(forms.getByText(/sub-agent Forecast helper asks for a secret/)).toBeVisible({
    timeout: 15_000,
  })
  await expect(forms.getByText("From the sub-agent")).toBeVisible()
  await expect(forms.getByRole("link", { name: "Forecast helper" })).toBeVisible()
  // What it was working on, and to fill it in only where that was expected.
  await expect(
    forms.getByText(/Asked while working on: .*Fill it in only if you expected it\./),
  ).toBeVisible()
  // The main chat was told of it, in its working, and said nothing about it.
  const row = working(page).last()
  await expect(row.getByRole("button", { name: /event/ })).toBeVisible()
  await row.getByRole("button", { name: /Worked on it/ }).click()
  await expect(
    row.getByText(/The sub-agent Forecast helper asked for the secret FORECAST_KEY/),
  ).toBeVisible()
  await shot(page, "subagent-asks")

  // The answer goes to the sub-agent, which carries on and reports.
  await forms.getByLabel("FORECAST_KEY", { exact: true }).fill("sunny-456")
  await forms.getByRole("button", { name: "Save secret" }).click()
  await expect(forms).toHaveCount(0)
  // Its report is one more event in the same row, which is still open.
  await expect(row.getByText("Forecast helper reported back")).toBeVisible({ timeout: 15_000 })
  await expect(transcript(page).getByText(/sunny-456/)).toHaveCount(0)
})
