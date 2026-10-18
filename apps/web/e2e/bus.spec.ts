import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures.ts"
import { asOwner, closeSettings, composer, openSettings, signIn, tab } from "./helpers.ts"

// The main chat as a message bus: a Dood reaches the people in its main chat only through
// `send`. Its own words and ordinary steps are not shown at all; what a chat draws anywhere (a
// sub-agent it started, the events it was told of) is drawn in order, as it is there.

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
/** A row of the Dood's own working, which a chat with the bus on no longer has. */
const rows = (page: Page) => transcript(page).getByText(/Work(ed|ing) on it/)

async function say(page: Page, text: string) {
  await composer(page).fill(text)
  await page.keyboard.press("Enter")
}

test("is how every Dood's main chat works, with no switch for it", async ({ page }) => {
  await signIn(page)
  // What it says to a person is what it sends, and that is all there is to see of an answer.
  await say(page, "hello there")
  await expect(transcript(page).getByText("You said: hello there")).toBeVisible()
  await expect(rows(page)).toHaveCount(0)
  await openSettings(page, "Model and computers")
  await expect(page.getByRole("dialog").getByRole("switch", { name: /what it sends/ })).toHaveCount(
    0,
  )
  await closeSettings(page)
})

test("shows what it sends, and keeps its own words and steps to itself", async ({ page }) => {
  await signIn(page)
  await say(
    page,
    [
      '/tool bash {"command":"echo the forecast is sunny"}',
      '/tool send {"text":"Hello from the bus. **This** is what I sent you."}',
    ].join("\n"),
  )
  await expect(transcript(page).getByText("Hello from the bus.")).toBeVisible()
  await expect(page.getByRole("status")).toHaveCount(0)
  // No row of working, and nothing of the step or of what it wrote after sending.
  await expect(rows(page)).toHaveCount(0)
  await expect(transcript(page).getByText(/Ran: echo/)).toHaveCount(0)
  await expect(transcript(page).getByText(/The tool returned/)).toHaveCount(0)
  await shot(page, "send-and-working")
})

test("ends its turn with a send marked done, and nothing is left under it", async ({ page }) => {
  await signIn(page)
  await say(page, '/tool send {"text":"😄 what is the wow about?","done":true}')
  await expect(transcript(page).getByText("😄 what is the wow about?")).toBeVisible()
  await expect(page.getByRole("status")).toHaveCount(0)
  await expect(rows(page)).toHaveCount(0)
  // The run ended with the send: the echo model was not asked again, so it said nothing more.
  await expect(transcript(page).getByText(/The tool returned/)).toHaveCount(0)
  await shot(page, "simple-reply")
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
  // The echo model answers this in words, and does not send them, as a model that forgot to.
  await say(page, "/quiet are you there?")
  await expect(transcript(page).getByText("/quiet are you there?", { exact: true })).toBeVisible()
  await expect(page.getByRole("status")).toHaveCount(0)
  // It answered with words twice, the second time to the reminder, and neither is shown.
  await expect(transcript(page).getByText("You said: /quiet are you there?")).toHaveCount(0)
  await expect(rows(page)).toHaveCount(0)
  await shot(page, "unanswered")
})

test("draws the sub-agent it started, and its report when it comes, each in its place", async ({
  page,
}) => {
  await signIn(page)
  await say(
    page,
    [
      '/tool subagent {"action":"start","title":"Look around","task":"Say what you see."}',
      '/tool send {"text":"A helper is looking around."}',
    ].join("\n"),
  )
  await expect(transcript(page).getByText("A helper is looking around.")).toBeVisible()
  // The report arrives later, as an event, drawn as it is in any chat.
  const report = transcript(page).getByText("Look around reported back")
  await expect(report).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole("status")).toHaveCount(0)
  await expect(rows(page)).toHaveCount(0)
  await expect(transcript(page).getByRole("button", { name: "What it reported" })).toBeVisible()
  await expect(transcript(page).getByText(/subagent-report/)).toHaveCount(0)
  await shot(page, "subagent-report")
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
  // The run reports to the main chat, which the echo model leaves without a word. The event is
  // drawn in its place, with what it said folded.
  const row = transcript(page).locator('[data-event="automation"]').last()
  await expect(row.getByText("The automation Weather check reported")).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByRole("status")).toHaveCount(0)
  await expect(rows(page)).toHaveCount(0)
  await expect(transcript(page).getByText(/You are running the scheduled task/)).toBeHidden()
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
  // The event is drawn before the send it led to: this automation's and the last one's.
  const events = transcript(page).locator('[data-event="automation"]')
  await expect(events).toHaveCount(2)
  await expect(events.nth(1).getByText("The automation Rain watch reported")).toBeVisible()
  await expect(events.nth(1).getByRole("link", { name: "View run" })).toBeVisible()
  await expect(rows(page)).toHaveCount(0)
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
  // The main chat was told of it, drawn in its place, and said nothing about it.
  await expect(
    transcript(page).getByText(/The sub-agent Forecast helper asked for the secret FORECAST_KEY/),
  ).toBeVisible()
  await expect(rows(page)).toHaveCount(0)
  await shot(page, "subagent-asks")

  // The answer goes to the sub-agent, which carries on and reports.
  await forms.getByLabel("FORECAST_KEY", { exact: true }).fill("sunny-456")
  await forms.getByRole("button", { name: "Save secret" }).click()
  await expect(forms).toHaveCount(0)
  // Its report is one more event, drawn after it.
  await expect(transcript(page).getByText("Forecast helper reported back")).toBeVisible({
    timeout: 15_000,
  })
  await expect(transcript(page).getByText(/sunny-456/)).toHaveCount(0)
})
