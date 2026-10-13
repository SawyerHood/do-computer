import { expect, type Page } from "@playwright/test"
import { test } from "./fixtures.ts"
import { asOwner, composer, newChat, signIn, tool } from "./helpers.ts"

asOwner()

const draw = (page: Page, title: string, html: string) =>
  tool(page, "visual", { title, html }, /Shown to the person/)

const visualOf = (page: Page, file: string) => page.getByRole("figure", { name: `Visual: ${file}` })

/** What a color of the app's is, as a browser says it: the same words a page's own would be. */
const appColor = (page: Page, variable: string) =>
  page.evaluate((variable) => {
    const probe = document.createElement("span")
    probe.style.backgroundColor = `var(${variable})`
    document.body.append(probe)
    const color = getComputedStyle(probe).backgroundColor
    probe.remove()
    return color
  }, variable)

test("controls a page writes bare are drawn as the app draws its own", async ({ page }) => {
  await signIn(page)
  await newChat(page)
  await draw(
    page,
    "Controls",
    [
      "<button id=quiet>Later</button>",
      "<button id=main data-variant=primary>Save</button>",
      "<button id=bare data-variant=ghost>Skip</button>",
      "<button id=on aria-pressed=true>Weekly</button>",
      "<input id=field placeholder=Name>",
      "<select id=pick><option>One</option></select>",
      "<input id=tick type=checkbox checked>",
      "<input id=slide type=range>",
    ].join(""),
  )
  const frame = visualOf(page, "controls.html").frameLocator("iframe")
  await expect(frame.locator("#quiet")).toHaveCSS(
    "background-color",
    await appColor(page, "--secondary"),
  )
  // The app's corner, which is half the size of a page's own text.
  await expect(frame.locator("#quiet")).toHaveCSS("border-top-left-radius", "7px")
  await expect(frame.locator("#quiet")).toHaveCSS("cursor", "pointer")
  await expect(frame.locator("#main")).toHaveCSS(
    "background-color",
    await appColor(page, "--primary"),
  )
  await expect(frame.locator("#main")).toHaveCSS(
    "color",
    await appColor(page, "--primary-foreground"),
  )
  await expect(frame.locator("#bare")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
  await expect(frame.locator("#on")).toHaveCSS("background-color", await appColor(page, "--accent"))
  for (const field of ["#field", "#pick"]) {
    await expect(frame.locator(field)).toHaveCSS(
      "border-top-color",
      await appColor(page, "--input"),
    )
    await expect(frame.locator(field)).toHaveCSS("border-top-left-radius", "7px")
  }
  for (const choice of ["#tick", "#slide"]) {
    await expect(frame.locator(choice)).toHaveCSS("accent-color", await appColor(page, "--primary"))
  }
  await page.screenshot({ path: "test-results/widget-controls.png" })
})

/** A widget with a choice to press, a count that is kept, a file to take, and a way to be large. */
const WIDGET = [
  "<p id=count>0</p>",
  "<button id=more>More</button>",
  "<button id=pick data-variant=primary>Go with plan B</button>",
  "<button id=large>Larger</button><button id=small>Smaller</button>",
  "<button id=file>Take the numbers</button>",
  "<script>",
  "var n = 0;",
  "more.onclick = function () { count.textContent = String(++n) };",
  "pick.onclick = function () { dc.say('Go with plan B') };",
  "large.onclick = function () { dc.expand() };",
  "small.onclick = function () { dc.expand(false) };",
  "file.onclick = function () { dc.save('numbers.csv', 'week,signups\\n1,40', 'text/csv') };",
  "</script>",
].join("")

test("a page speaks to the chat when the reader presses something in it, and not by itself", async ({
  page,
}) => {
  await signIn(page)
  await newChat(page)
  // One that tries the moment it loads, with nobody having pressed anything.
  await draw(page, "Eager", "<p>hello</p><script>dc.say('I was never pressed')</script>")
  await expect(visualOf(page, "eager.html").frameLocator("iframe").getByText("hello")).toBeVisible()
  await draw(page, "Plans", WIDGET)
  await expect(composer(page)).toHaveValue("")

  const visual = visualOf(page, "plans.html")
  const frame = visual.frameLocator("iframe")
  // Its words go in the message box, for the person to send or not.
  await composer(page).fill("About the plans:")
  await frame.locator("#pick").click()
  await expect(composer(page)).toHaveValue("About the plans:\nGo with plan B")
  await expect(composer(page)).toBeFocused()
  await expect(page.getByRole("log").getByText("You said: About the plans")).toHaveCount(0)
  await composer(page).fill("")

  // Shown large it is the same page: what was done in it is still done.
  await frame.locator("#more").click()
  await frame.locator("#more").click()
  const before = (await visual.boundingBox())!
  await frame.locator("#large").click()
  await expect
    .poll(async () => (await visual.boundingBox())!.width)
    .toBeGreaterThan(before.width + 200)
  await expect(frame.locator("#count")).toHaveText("2")
  // There it is laid out as a page by itself, with a page's margins.
  await expect(frame.locator("body")).toHaveCSS("padding-left", "24px")
  await page.screenshot({ path: "test-results/widget-large.png" })
  await page.getByRole("button", { name: "Put it back in the reply" }).click()
  await expect
    .poll(async () => Math.round((await visual.boundingBox())!.width))
    .toBe(Math.round(before.width))
  await expect(frame.locator("body")).toHaveCSS("padding-left", "0px")
  await expect(frame.locator("#count")).toHaveText("2")
  // The page can put itself back too.
  await frame.locator("#large").click()
  await expect(page.getByRole("button", { name: "Put it back in the reply" })).toBeVisible()
  await frame.locator("#small").click()
  await expect(page.getByRole("button", { name: "Put it back in the reply" })).toHaveCount(0)

  // A file it hands over is the reader's to keep, under the name it gave.
  const download = page.waitForEvent("download")
  await frame.locator("#file").click()
  const taken = await download
  expect(taken.suggestedFilename()).toBe("numbers.csv")
  const stream = await taken.createReadStream()
  let text = ""
  for await (const chunk of stream) text += chunk
  expect(text).toBe("week,signups\n1,40")
})

test("a page whose script fails says so under it, and the agent can be told", async ({ page }) => {
  await signIn(page)
  await newChat(page)
  await draw(page, "Broken", "<p>half a chart</p><script>drawTheRest()</script>")
  const log = page.getByRole("log")
  await expect(log.getByText("Something in this page did not work.")).toBeVisible()
  await log.getByRole("button", { name: "Tell Juniper" }).click()
  await expect(composer(page)).toHaveValue(/did not work when I opened it\. It said: .*drawTheRest/)
})

test("a page that would not work in a chat is sent back to the agent, not shown", async ({
  page,
}) => {
  await signIn(page)
  await newChat(page)
  await tool(
    page,
    "visual",
    { title: "Kept", html: "<p>x</p><script>localStorage.setItem('seen', '1')</script>" },
    /The page was not shown, because it would not work in the chat/,
  )
  await expect(page.getByText(/has no storage/).last()).toBeVisible()
  await expect(page.getByRole("figure", { name: /Visual: kept/ })).toHaveCount(0)
  // One that is only out of place is shown, and the agent is told for next time.
  await tool(
    page,
    "visual",
    { title: "Loud", html: "<style>.a{color:#ff0000}</style><p class=a>x</p>" },
    /Colors are written out \(#ff0000\)/,
  )
  await expect(visualOf(page, "loud.html")).toBeVisible()
})

test("a page is given the room it took last time before it has loaded", async ({ page }) => {
  await signIn(page)
  await newChat(page)
  await draw(page, "Tall", "<div style='height:412px'>tall</div>")
  const visual = visualOf(page, "tall.html")
  await expect.poll(async () => (await visual.boundingBox())!.height).toBe(412)
  // Its address is held back, so that the page cannot say how tall it is: it is told by what
  // was kept from last time.
  await page.route("**/d/**/tall.html*", () => {})
  await page.reload()
  await expect.poll(async () => (await visual.boundingBox())?.height).toBe(412)
})
