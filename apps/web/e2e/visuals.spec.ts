import type { SiteSummary } from "@durable-computer/protocol"
import { expect, type Page } from "@playwright/test"
import { test } from "./fixtures.ts"
import { asOwner, newChat, signIn, tab, tool } from "./helpers.ts"

asOwner()

const agentOf = (page: Page) => /\/a\/([^/]+)/.exec(page.url())![1]!

/** A page as an agent would write one: in the app's colors, with a script and a link in it. */
const CHART = [
  "<!doctype html><html><head><title>Signups</title>",
  "<style>.bar{height:120px;background:var(--chart-1);border-radius:var(--radius)}",
  "h2{margin:0 0 12px;font-size:15px}p{color:var(--muted-foreground)}</style></head><body>",
  "<h2>Signups by week</h2><div class=bar></div>",
  "<p id=out>static</p><a href=https://example.com/report>the report</a>",
  "<script>var c;try{c=document.cookie}catch(e){c='blocked'}",
  "document.getElementById('out').textContent='ran:'+c+':'+self.origin</script>",
  "</body></html>",
].join("")

test("a visual the agent draws is the page itself, in the chat", async ({ page }) => {
  await signIn(page)
  await newChat(page)
  await tool(page, "visual", { title: "Signups by week", html: CHART }, /Shown to the person/)
  const visual = page.getByRole("figure", { name: "Visual: signups-by-week.html" })
  const frame = visual.frameLocator("iframe")
  await expect(frame.getByRole("heading", { name: "Signups by week" })).toBeVisible()
  // Its script ran, but as nobody: it may not read cookies, and its origin is not the app's.
  await expect(frame.locator("#out")).toHaveText("ran:blocked:null")
  // It is in the app's colors: dark here, and the text is the chat's own.
  await expect(frame.locator("html")).toHaveAttribute("data-dc-theme", "dark")
  const ink = await page.evaluate(() => getComputedStyle(document.body).color)
  await expect(frame.locator("h2")).toHaveCSS("color", ink)
  // The frame is as tall as the page is, so nothing in it scrolls and nothing is left empty.
  const tall = await frame.locator("html").evaluate((root) => root.scrollHeight)
  await expect.poll(async () => (await visual.boundingBox())!.height).toBe(tall)
  expect(tall).toBeGreaterThan(150)
  // It is part of the answer, so it has no margin of its own.
  await expect(frame.locator("body")).toHaveCSS("padding-left", "0px")
  // And as wide as the answer.
  const column = (await page
    .getByText(/Shown to the person/)
    .last()
    .boundingBox())!
  expect((await visual.boundingBox())!.width).toBeGreaterThan(column.width - 40)
  await page.screenshot({ path: "test-results/visual-in-chat.png" })

  // The app going light is told to the page, which does not load again to follow it.
  await frame.locator("#out").evaluate((out) => {
    out.textContent = "still here"
  })
  await page.evaluate(() => document.documentElement.classList.remove("dark"))
  await expect(frame.locator("html")).toHaveAttribute("data-dc-theme", "light")
  await expect(frame.locator("#out")).toHaveText("still here")
  await expect(frame.locator("h2")).toHaveCSS(
    "color",
    await page.evaluate(() => getComputedStyle(document.body).color),
  )
  await page.screenshot({ path: "test-results/visual-in-chat-light.png" })
  await page.evaluate(() => document.documentElement.classList.add("dark"))

  // A link in it opens in a new tab, and the visual stays where it is.
  const opened = page.waitForEvent("popup")
  await frame.getByRole("link", { name: "the report" }).click()
  expect((await opened).url()).toBe("https://example.com/report")
  await expect(frame.getByRole("heading", { name: "Signups by week" })).toBeVisible()
})

test("a visual is a file of the library, opened beside the chat and shared from there", async ({
  page,
  browser,
}) => {
  await signIn(page)
  // The panel about the agent is where a document opens, on a screen wide enough for both.
  await page.setViewportSize({ width: 1500, height: 900 })
  await newChat(page)
  await tool(page, "visual", { title: "Churn by plan", html: CHART }, /Shown to the person/)
  const visual = page.getByRole("figure", { name: "Visual: churn-by-plan.html" })
  await visual.scrollIntoViewIfNeeded()
  await visual.hover()
  await visual.getByRole("button", { name: "Open beside the chat" }).click()
  const beside = page.getByRole("complementary", { name: "Document" })
  await expect(
    beside.frameLocator("iframe").getByRole("heading", { name: "Signups by week" }),
  ).toBeVisible()
  // There it is a page by itself, with a page's margins, still in the app's colors.
  await expect(beside.frameLocator("iframe").locator("body")).toHaveCSS("padding-left", "24px")
  await expect(beside.frameLocator("iframe").locator("html")).toHaveAttribute(
    "data-dc-theme",
    "dark",
  )
  await page.screenshot({ path: "test-results/visual-beside.png" })

  // Shared from the visual itself: only its own workspace can open it, until someone says so.
  await visual.hover()
  await visual.getByRole("button", { name: "Share" }).click()
  const popover = page.getByRole("dialog")
  await expect(popover.getByText("Share with a link")).toBeVisible()
  await popover.getByRole("button", { name: "Share", exact: true }).click()
  await expect(popover.getByText("Shared with a link")).toBeVisible()
  await expect(popover.getByRole("radio", { name: "Only you" })).toBeChecked()
  await page.screenshot({ path: "test-results/visual-share.png" })
  const address = await popover.getByRole("link").getAttribute("href")
  expect(address).toMatch(/\/s\/[a-z2-9]{16}$/)
  const visitor = await browser.newContext()
  const outside = await visitor.newPage()
  expect((await outside.goto(address!))!.status()).toBe(401)

  await popover.getByRole("radio", { name: "Anyone with the link" }).click()
  await expect(popover.getByRole("radio", { name: "Anyone with the link" })).toBeChecked()
  expect((await outside.goto(address!))!.status()).toBe(200)
  // Shared, it is still in the app's colors, as light or dark as its reader has things.
  const shared = outside.frameLocator("iframe")
  await expect(shared.getByRole("heading", { name: "Signups by week" })).toBeVisible()
  await expect(shared.locator("#out")).toHaveText("ran:blocked:null")
  await expect(shared.locator("body")).toHaveCSS("padding-left", "24px")
  await outside.screenshot({ path: "test-results/visual-shared.png" })
  await visitor.close()
  await page.keyboard.press("Escape")

  // The document beside the chat says it is shared, and so does the library.
  await expect(beside.getByRole("button", { name: "Shared with a link" })).toBeVisible()
  await tab(page, "Library").click()
  const sites = page.getByRole("region", { name: "Shared with a link" })
  await expect(sites.getByRole("link", { name: "Churn by plan" })).toBeVisible()
  await expect(sites.getByText("Public")).toBeVisible()
  await page.screenshot({ path: "test-results/library-shared.png" })
  // Among the files it is under visuals, as any page is.
  await page
    .getByRole("navigation", { name: "Files" })
    .getByRole("link", { name: "churn-by-plan.html" })
    .click()
  await expect(
    page.frameLocator('iframe[title="churn-by-plan.html"]').getByText("ran:blocked:null"),
  ).toBeVisible()
})

test("a site the agent shares is a card in the chat, which says who can open it now", async ({
  page,
}) => {
  await signIn(page)
  await newChat(page)
  await tool(
    page,
    "bash",
    {
      command:
        "mkdir -p library/sites/plan && printf '%s' '<h1>Launch plan</h1>' > library/sites/plan/index.html && echo made",
    },
    /^made$/,
  )
  await tool(
    page,
    "share",
    { action: "publish", path: "sites/plan", title: "Launch plan" },
    /Shared sites\/plan as “Launch plan”/,
  )
  const card = page.getByRole("group", { name: "Site: Launch plan" })
  await expect(card.getByText("Only you")).toBeVisible()
  await expect(card.getByText(/\/s\/[a-z2-9]{16}$/)).toBeVisible()
  await expect(card.getByRole("link", { name: "Open" })).toHaveAttribute("target", "_blank")
  await page.screenshot({ path: "test-results/site-card.png" })

  // Who can open it is chosen from the card.
  await card.getByRole("button", { name: "Who can open it" }).click()
  const popover = page.getByRole("dialog")
  await popover.getByRole("radio", { name: "Anyone with the link" }).click()
  await expect(card.getByText("Public")).toBeVisible()
  await page.screenshot({ path: "test-results/site-share.png" })
  const response = await page.request.get(`/api/agents/${agentOf(page)}/sites`)
  const { sites } = (await response.json()) as { sites: SiteSummary[] }
  expect(sites.find((site) => site.title === "Launch plan")).toMatchObject({ public: true })

  // Stopped, the card says so, and offers to share it again.
  await popover.getByRole("button", { name: "Stop sharing" }).click()
  await expect(card.getByText("Not shared any more")).toBeVisible()
  await expect(card.getByRole("link", { name: "Open" })).toHaveCount(0)
  await card.getByRole("button", { name: "Share again" }).click()
  await expect(card.getByText("Only you")).toBeVisible()

  // What the agent does to it later shows on the same card: here, asked to make it public,
  // it has to ask, and the card stays as it was.
  await tool(page, "share", { action: "private", site: "Launch plan" }, /can now be opened by/)
  await expect(page.getByRole("group", { name: "Site: Launch plan" }).first()).toContainText(
    "Only you",
  )
})
