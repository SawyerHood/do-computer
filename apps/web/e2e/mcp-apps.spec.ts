import { expect, test } from "./fixtures.ts"
import { startFakeMcp } from "./fake-mcp-server.ts"
import { asOwner, composer, newChat, openSettings, signIn, tool, seeInWork } from "./helpers.ts"

asOwner()

let mcp: Awaited<ReturnType<typeof startFakeMcp>>
test.beforeAll(async () => {
  mcp = await startFakeMcp()
})
test.afterAll(async () => {
  await mcp.close()
})

test("a connector's own page for a tool is shown with what the tool answered, kept apart from the app", async ({
  page,
}) => {
  await signIn(page)
  await openSettings(page, "Connectors")
  await page.locator("#connector-name").fill("Weather")
  await page.getByLabel("Server address").fill(`${mcp.origin}/apps/mcp`)
  await page.getByRole("button", { name: "Add connector" }).click()
  const card = page.getByRole("listitem").filter({ hasText: "Weather" })
  await expect(card.getByText("Connected", { exact: true })).toBeVisible()

  await newChat(page)
  await tool(page, "weather__forecast", { city: "Lisbon" }, /Sunny, 21 degrees/)
  // It says whose page it is: not the agent's, and not the app's.
  const log = page.getByRole("log")
  // Drawn in the row of the agent's working, which opens on it.
  await seeInWork(page, log.getByText("From Weather"))
  const app = log.getByRole("figure", { name: "App: forecast from Weather" })
  const frame = app.frameLocator("iframe")
  // The page was told what the tool was asked and what it answered.
  await expect(frame.locator("#city")).toHaveText("Lisbon")
  await expect(frame.locator("#temp")).toHaveText("Sunny, 21 degrees")
  // And where it is shown: by whom, in the dark, in the app's own ink.
  await expect(frame.locator("html")).toHaveAttribute("data-host", "do-computer")
  await expect(frame.locator("html")).toHaveAttribute("data-theme", "dark")
  await expect(frame.locator("#city")).toHaveCSS(
    "color",
    await page.evaluate(() => getComputedStyle(document.body).color),
  )
  // It is nobody: it has no cookies, and cannot reach the app it is served from.
  await expect(frame.locator("html")).toHaveAttribute("data-cookie", "blocked")
  await expect(frame.locator("html")).toHaveAttribute("data-api", "blocked")
  // The frame is as tall as the page says it is.
  const tall = await frame
    .locator("html")
    .evaluate((root) => Math.ceil(root.getBoundingClientRect().height))
  expect(tall).toBeLessThan(200)
  // With the line round it.
  await expect.poll(async () => Math.round((await app.boundingBox())!.height)).toBe(tall + 2)
  await page.screenshot({ path: "test-results/mcp-app.png" })

  // The app going light is told to the page, which does not load again to follow it.
  await page.evaluate(() => document.documentElement.classList.remove("dark"))
  await expect(frame.locator("html")).toHaveAttribute("data-theme", "light")
  await expect(frame.locator("#temp")).toHaveText("Sunny, 21 degrees")
  await page.evaluate(() => document.documentElement.classList.add("dark"))
})

test("the page uses its server's tools: one that only reads at once, one that may change something once the person agrees", async ({
  page,
}) => {
  await signIn(page)
  await newChat(page)
  await tool(page, "weather__forecast", { city: "Porto" }, /Sunny, 21 degrees/)
  const app = page.getByRole("log").getByRole("figure", { name: "App: forecast from Weather" })
  await seeInWork(page, app)
  const frame = app.frameLocator("iframe")
  await expect(frame.locator("#city")).toHaveText("Porto")

  await frame.getByRole("button", { name: "Refresh" }).click()
  await expect(frame.locator("#log")).toHaveText("refresh done")
  await expect(page.getByRole("alertdialog")).toHaveCount(0)

  // Booking may change something, so the person is asked, and a no is told to the page.
  await frame.getByRole("button", { name: "Book a trip" }).click()
  const asked = page.getByRole("alertdialog")
  await expect(asked.getByRole("heading")).toHaveText("Let this page use “book”?")
  await expect(asked).toContainText("The page from Weather wants to run that tool there")
  await asked.getByRole("button", { name: "Cancel" }).click()
  await expect(frame.locator("#log")).toHaveText("refused: The person said no.")
  await frame.getByRole("button", { name: "Book a trip" }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Run it" }).click()
  await expect(frame.locator("#log")).toHaveText("book done")

  // Its words go in the message box, for the person to send or not.
  await frame.getByRole("button", { name: "Tell the Dood" }).click()
  await expect(composer(page)).toHaveValue("Book the trip to Porto")
  await expect(page.getByRole("log").getByText("You said: Book the trip")).toHaveCount(0)

  // Shown large it is the same page, and is told so.
  const before = (await app.boundingBox())!
  await frame.getByRole("button", { name: "Larger" }).click()
  await expect
    .poll(async () => (await app.boundingBox())!.width)
    .toBeGreaterThan(before.width + 200)
  await expect(frame.locator("html")).toHaveAttribute("data-mode", "fullscreen")
  await expect(frame.locator("#log")).toHaveText("book done")
  await page.getByRole("button", { name: "Put it back in the reply" }).click()
  await expect(frame.locator("html")).toHaveAttribute("data-mode", "inline")
})
