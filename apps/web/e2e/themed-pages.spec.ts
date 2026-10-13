import { readFileSync } from "node:fs"
import { type LibraryFile, THEME_TOKENS } from "@do-computer/protocol"
import { expect, type Frame, type Page } from "@playwright/test"
import { test } from "./fixtures.ts"
import { asOwner, closeSettings, newChat, openOwnSettings, signIn, tool } from "./helpers.ts"

asOwner()

const agentOf = (page: Page) => /\/a\/([^/]+)/.exec(page.url())![1]!

/** The example in the docs: a dashboard with figures, a chart and a table, with no color of its own. */
const DASHBOARD = readFileSync(
  new URL("../../../docs/examples/themed-dashboard.html", import.meta.url),
  "utf8",
)

/** A page that asks nothing of the app, and one that only borrows a color from it. */
const PLAIN =
  "<!doctype html><html><head><title>Plain</title><style>h1{color:var(--primary)}</style></head>" +
  "<body><h1>Plain</h1><p id=out></p><script>var c;try{c=document.cookie}catch(e){c='blocked'}" +
  "document.getElementById('out').textContent=c+':'+self.origin</script></body></html>"

/** Every variable that is a color, by name. */
const COLORS = THEME_TOKENS.filter(
  (token) => !/^--(elevation|radius|font)/.test(token.name) && token.name !== "--agent-color",
).map((token) => token.name)

/** What each variable comes to where it is asked, as the color something drawn in it would be. */
const resolved = (where: Page | Frame, names: readonly string[]) =>
  where.evaluate((names) => {
    const probe = document.createElement("div")
    document.body.append(probe)
    const colors = Object.fromEntries(
      names.map((name) => {
        probe.style.backgroundColor = `var(${name})`
        return [name, getComputedStyle(probe).backgroundColor]
      }),
    )
    probe.remove()
    return colors
  }, names)

async function add(page: Page, path: string, html: string): Promise<LibraryFile> {
  const response = await page.request.post(
    `/api/agents/${agentOf(page)}/library?path=${encodeURIComponent(path)}`,
    { data: html, headers: { "content-type": "text/html" } },
  )
  expect(response.status()).toBe(201)
  return (await response.json()) as LibraryFile
}

/** The frame a page of the library is shown in, once the page is there. */
async function frameOf(page: Page, name: string): Promise<Frame> {
  const element = await page.locator(`iframe[title="${name}"]`).elementHandle()
  const frame = await element!.contentFrame()
  await frame!.waitForLoadState("load")
  return frame!
}

test("a page of the library is in the app's look, and follows it while it is open", async ({
  page,
}) => {
  await signIn(page)
  const file = await add(page, "reports/signups.html", DASHBOARD)
  await page.goto(`/a/${agentOf(page)}/library?file=${file.id}`)
  const frame = await frameOf(page, "signups.html")
  await expect(frame.getByRole("heading", { name: "Signups, third quarter" })).toBeVisible()
  // Its chart is drawn by its own script, which runs.
  await expect(frame.locator("#plot polyline")).toHaveCount(3)

  // It is dark, as the app is, and every color in it is the app's own: variable by variable.
  await expect(frame.locator("html")).toHaveAttribute("data-dc-theme", "dark")
  const dark = await resolved(page, COLORS)
  expect(await resolved(frame, COLORS)).toEqual(dark)
  expect(new Set(Object.values(dark)).size).toBeGreaterThan(12)
  // The page itself is on the app's background, in its text color and its typeface.
  const app = await page.evaluate(() => {
    const style = getComputedStyle(document.body)
    return { background: style.backgroundColor, color: style.color }
  })
  await expect(frame.locator("html")).toHaveCSS("background-color", app.background)
  await expect(frame.locator("h1")).toHaveCSS("color", app.color)
  await frame.evaluate(() => document.fonts.ready)
  expect(await frame.evaluate(() => document.fonts.check('600 20px "Geist Variable"'))).toBe(true)
  expect(
    await frame.evaluate(() =>
      [...document.fonts].some((face) => face.family.includes("Geist") && face.status === "loaded"),
    ),
  ).toBe(true)
  // The accent is the Dood's own, as it is in the app.
  const accent = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--agent-color").trim(),
  )
  expect(accent).not.toBe("")
  expect(
    await frame.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--agent-color").trim(),
    ),
  ).toBe(accent)
  // The address it was told its colors on is gone from it, so the page never meets it.
  expect(frame.url()).not.toContain("dc-theme")
  await page.screenshot({ path: "test-results/themed-page-dark.png" })

  // It is still nobody: not the app, and not whoever is reading it.
  const reach = await frame.evaluate(async () => {
    const tried = (what: () => unknown) => {
      try {
        return String(what())
      } catch {
        return "blocked"
      }
    }
    return {
      origin: self.origin,
      cookie: tried(() => document.cookie),
      storage: tried(() => localStorage.length),
      app: tried(() => window.parent.document.title),
      session: await fetch("/api/auth/get-session", { credentials: "include" })
        .then(async (response) => (response.ok ? await response.text() : "refused"))
        .catch(() => "blocked"),
    }
  })
  expect(reach).toMatchObject({
    origin: "null",
    cookie: "blocked",
    storage: "blocked",
    app: "blocked",
  })
  expect(reach.session).not.toContain("owner@example.com")

  // The app is made light from its settings. The page follows, and is not loaded again.
  await frame.evaluate(() => {
    document.querySelector("h1")!.setAttribute("data-kept", "yes")
  })
  await openOwnSettings(page, "General")
  await page.getByRole("button", { name: "Light", exact: true }).click()
  await closeSettings(page)
  await expect(frame.locator("html")).toHaveAttribute("data-dc-theme", "light")
  await expect(frame.locator("h1")).toHaveAttribute("data-kept", "yes")
  const light = await resolved(page, COLORS)
  expect(light["--background"]).not.toBe(dark["--background"])
  expect(light["--chart-2"]).not.toBe(dark["--chart-2"])
  expect(await resolved(frame, COLORS)).toEqual(light)
  await expect(frame.locator("html")).toHaveCSS(
    "background-color",
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
  )
  await page.screenshot({ path: "test-results/themed-page-light.png" })

  // And back, the same way.
  await openOwnSettings(page, "General")
  await page.getByRole("button", { name: "Dark", exact: true }).click()
  await closeSettings(page)
  await expect(frame.locator("html")).toHaveAttribute("data-dc-theme", "dark")
  await expect(frame.locator("h1")).toHaveAttribute("data-kept", "yes")
  expect(await resolved(frame, COLORS)).toEqual(dark)
})

test("opened in a tab of its own it starts as the app is, and fits a phone", async ({
  page,
  context,
}) => {
  await signIn(page)
  const file = await add(page, "reports/quarter.html", DASHBOARD)
  await page.goto(`/a/${agentOf(page)}/library?file=${file.id}`)
  await frameOf(page, "quarter.html")
  await openOwnSettings(page, "General")
  await page.getByRole("button", { name: "Light", exact: true }).click()
  await closeSettings(page)
  const address = await page.getByRole("link", { name: "Open in a new tab" }).getAttribute("href")
  // The device is dark, and the app was made light: the page is as the app is.
  const alone = await context.newPage()
  await alone.goto(address!)
  await expect(alone.locator("html")).toHaveAttribute("data-dc-theme", "light")
  expect(alone.url()).not.toContain("dc-theme")
  await expect(alone.locator("#plot polyline")).toHaveCount(3)
  await alone.evaluate(() => document.fonts.ready)
  await alone.screenshot({
    path: "test-results/themed-dashboard-desktop-light.png",
    fullPage: true,
  })

  // Nothing in it scrolls sideways, at a desk or on a phone, and its chart is drawn to fit.
  const fits = () =>
    alone.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    )
  expect(await fits()).toBe(true)
  for (const width of [390, 320]) {
    await alone.setViewportSize({ width, height: 844 })
    await expect
      .poll(() => alone.locator("#plot svg").evaluate((svg) => svg.getAttribute("viewBox")))
      .toMatch(new RegExp(`^0 0 ${width - 2 * 16 - 2 * 16} `))
    expect(await fits()).toBe(true)
    // The table is wider than a phone, and scrolls inside its own box.
    expect(
      await alone.locator(".scroll").evaluate((box) => box.scrollWidth > box.clientWidth),
    ).toBe(true)
  }
  await alone.setViewportSize({ width: 390, height: 844 })
  await alone.screenshot({ path: "test-results/themed-dashboard-phone-light.png", fullPage: true })

  // Opened with nothing said of the app's colors, it follows the device, and when that changes.
  await alone.goto(address!.split("#")[0]!)
  await expect(alone.locator("html")).not.toHaveAttribute("data-dc-theme")
  const background = () =>
    alone.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)
  const dark = await background()
  await alone.screenshot({ path: "test-results/themed-dashboard-phone-dark.png", fullPage: true })
  await alone.emulateMedia({ colorScheme: "light" })
  await expect.poll(background).not.toBe(dark)
  await alone.emulateMedia({ colorScheme: "dark" })
  await expect.poll(background).toBe(dark)
  await alone.setViewportSize({ width: 1280, height: 860 })
  await alone.screenshot({ path: "test-results/themed-dashboard-desktop-dark.png", fullPage: true })
  await alone.close()
  await openOwnSettings(page, "General")
  await page.getByRole("button", { name: "Dark", exact: true }).click()
  await closeSettings(page)
})

test("a page that did not ask for the app's look is left as it was written", async ({ page }) => {
  await signIn(page)
  const file = await add(page, "plain.html", PLAIN)
  await page.goto(`/a/${agentOf(page)}/library?file=${file.id}`)
  const frame = await frameOf(page, "plain.html")
  await expect(frame.getByRole("heading", { name: "Plain" })).toBeVisible()
  // It has no background, type or margins from the app: it is the browser's own page.
  await expect(frame.locator("html")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
  await expect(frame.locator("body")).toHaveCSS("margin-left", "8px")
  await expect(frame.locator("body")).toHaveCSS("padding-left", "0px")
  expect(
    await frame.locator("body").evaluate((body) => getComputedStyle(body).fontFamily),
  ).not.toContain("Geist")
  // The variables are there for it all the same, and the one it used is the app's.
  expect((await resolved(frame, ["--primary"]))["--primary"]).toBe(
    (await resolved(page, ["--primary"]))["--primary"],
  )
  await expect(frame.locator("h1")).toHaveCSS(
    "color",
    (await resolved(page, ["--primary"]))["--primary"]!,
  )
  // It is not laid out as part of anything, and is as apart from the app as any page.
  await expect(frame.locator("html")).not.toHaveAttribute("data-dc-inline")
  await expect(frame.locator("#out")).toHaveText("blocked:null")
})

test("a visual has the chart colors, in the chat and by itself", async ({ page }) => {
  await signIn(page)
  await newChat(page)
  const html =
    "<!doctype html><html><head><title>Bars</title><style>.bars{display:flex;gap:8px;height:80px}" +
    ".bars i{flex:1;border-radius:4px 4px 0 0}</style></head><body><div class=bars>" +
    [1, 2, 3, 4, 5, 6]
      .map((n) => `<i id=s${n} style="background:var(--chart-${n})"></i>`)
      .join("") +
    "</div></body></html>"
  await tool(page, "visual", { title: "Six series", html }, /Shown to the person/)
  const visual = page.getByRole("figure", { name: "Visual: six-series.html" })
  const frame = visual.frameLocator("iframe")
  const series = [1, 2, 3, 4, 5, 6].map((n) => `--chart-${n}`)
  const app = await resolved(page, series)
  // Six colors, no two the same, and the same six the app has.
  expect(new Set(Object.values(app)).size).toBe(6)
  for (const [at, name] of series.entries()) {
    await expect(frame.locator(`#s${at + 1}`)).toHaveCSS("background-color", app[name]!)
  }
  // It is part of the answer: on the chat's own background, with no margin of its own.
  await expect(frame.locator("html")).toHaveAttribute("data-dc-inline", "")
  await expect(frame.locator("body")).toHaveCSS("padding-left", "0px")
  await page.screenshot({ path: "test-results/themed-visual.png" })
})
