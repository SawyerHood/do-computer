import { expect, test } from "./fixtures.ts"
import { asOwner, composer, newChat, sideChats, signIn, tab, tool } from "./helpers.ts"

asOwner()

test("the sidebar is put away until it is asked for, and stays how it was left", async ({
  browser,
  baseURL,
}) => {
  // A browser that has never said how it wants things laid out.
  const context = await browser.newContext({ baseURL, colorScheme: "dark" })
  const page = await context.newPage()
  await signIn(page)
  await expect(page.getByRole("heading", { name: "Agents" })).toHaveCount(0)
  // The agent has the room instead: its panel is open beside the chat, and stays shut once hidden.
  const panel = page.getByRole("complementary", { name: "About Juniper" })
  await expect(panel.getByRole("img", { name: "Agent avatar" })).toBeVisible()
  await page.getByRole("button", { name: "Hide Juniper's panel" }).click()
  await page.reload()
  await expect(composer(page)).toBeVisible()
  await expect(panel).toHaveCount(0)
  // Pressing the header above the chat brings it back.
  await page.getByRole("button", { name: "Show Juniper beside the chat" }).click()
  await expect(panel.getByRole("img", { name: "Agent avatar" })).toBeVisible()

  // The agent's side chats are reached without it.
  await sideChats(page).click()
  await expect(page.getByRole("menuitem", { name: "New side chat" })).toBeVisible()
  await page.keyboard.press("Escape")

  // Asked for, it is beside the chat, and still there after a reload.
  await page.getByRole("button", { name: "Show the sidebar" }).click()
  await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Show the sidebar" })).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible()
  await page.getByRole("button", { name: "Hide the sidebar" }).click()
  await expect(page.getByRole("heading", { name: "Agents" })).toHaveCount(0)
  await context.close()
})

test("the sidebar and the agent's panel are dragged by their edges, and stay as wide as left", async ({
  page,
}) => {
  await signIn(page)
  const sidebar = page
    .locator("aside")
    .filter({ has: page.getByRole("heading", { name: "Agents" }) })
  const edge = page.getByRole("separator", { name: "Resize the sidebar" })
  // Measured in one step, and looked at until it settles: the panel is put up anew when the tab
  // changes, so for a moment the one that is found is on its way out.
  const width = async (of: typeof sidebar) =>
    Math.round(await of.evaluate((element) => element.getBoundingClientRect().width))
  /** Take hold of an edge and move it sideways by so many pixels. */
  const drag = async (handle: typeof edge, by: number) => {
    const box = (await handle.boundingBox())!
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + by, y, { steps: 4 })
    await page.mouse.up()
  }
  await expect.poll(() => width(sidebar)).toBe(288)

  // Its edge follows the pointer, and the chat has what room is left.
  await drag(edge, 72)
  await expect.poll(() => width(sidebar)).toBe(360)
  await expect(edge).toHaveAttribute("aria-valuenow", "360")
  // It goes no further than its bounds, either way.
  await drag(edge, 600)
  await expect.poll(() => width(sidebar)).toBe(448)
  await drag(edge, -600)
  await expect.poll(() => width(sidebar)).toBe(208)
  // The arrow keys move it too.
  await edge.focus()
  await page.keyboard.press("ArrowRight")
  await page.keyboard.press("ArrowRight")
  await expect.poll(() => width(sidebar)).toBe(240)

  // The agent's panel is dragged by its other edge: to the left is wider.
  await page.getByRole("button", { name: "Show Juniper's panel" }).click()
  const panel = page.getByRole("complementary", { name: "About Juniper" })
  const panelEdge = page.getByRole("separator", { name: "Resize Juniper's panel" })
  await expect.poll(() => width(panel)).toBe(320)
  await drag(panelEdge, -80)
  await expect.poll(() => width(panel)).toBe(400)

  // Both are as they were left after a reload, and the panel is as wide beside another tab.
  await page.reload()
  await expect(composer(page)).toBeVisible()
  await expect.poll(() => width(sidebar)).toBe(240)
  // These tests put the panel away on every load, so it is asked for again.
  await page.getByRole("button", { name: "Show Juniper's panel" }).click()
  await expect.poll(() => width(panel)).toBe(400)
  await tab(page, "Automations").click()
  await page.waitForURL(/\/automations$/)
  await expect.poll(() => width(panel)).toBe(400)
  await tab(page, "Chat").click()
  await expect(composer(page)).toBeVisible()

  // Pressing an edge twice puts its column back to the width it started at.
  await edge.dblclick()
  await expect.poll(() => width(sidebar)).toBe(288)
  await panelEdge.dblclick()
  await expect.poll(() => width(panel)).toBe(320)
})

test("what the agent shared is listed in its panel, and a document's edge is dragged too", async ({
  page,
}) => {
  await signIn(page)
  await newChat(page)
  await tool(
    page,
    "write",
    { path: "library/handout/notes.md", content: "# Handout notes\n" },
    "Successfully wrote to library/handout/notes.md",
  )
  await tool(
    page,
    "write",
    { path: "library/handout/index.html", content: "<h1>Handout page</h1>" },
    "Successfully wrote to library/handout/index.html",
  )
  for (const name of ["notes.md", "index.html"]) {
    await composer(page).fill(`/tool send_file {"path":"library/handout/${name}"}`)
    await page.keyboard.press("Enter")
    await expect(page.getByRole("link", { name: `Download ${name}` })).toBeVisible()
  }

  // The panel lists both, the newest first, under who is here and above what it did.
  await page.getByRole("button", { name: "Show Juniper's panel" }).click()
  const panel = page.getByRole("complementary", { name: "About Juniper" })
  const shared = panel.getByRole("region", { name: "Shared here" })
  await expect(shared.getByRole("listitem")).toHaveText([/index\.html/, /notes\.md/])
  await page.screenshot({ path: "test-results/panel-shared.png" })

  // One opens beside the chat from there, in the panel's place, which is back when it is closed.
  await shared.getByRole("button", { name: /notes\.md/ }).click()
  const beside = page.getByRole("complementary", { name: "Document" })
  await expect(beside.getByRole("heading", { name: "Handout notes", level: 1 })).toBeVisible()
  await expect(panel).toHaveCount(0)
  await beside.getByRole("button", { name: "Close the document" }).click()
  await shared.getByRole("button", { name: /index\.html/ }).click()
  await expect(
    beside
      .frameLocator('iframe[title="index.html"]')
      .getByRole("heading", { name: "Handout page" }),
  ).toBeVisible()

  const edge = page.getByRole("separator", { name: "Resize the document" })
  const width = async () => Math.round((await beside.boundingBox())!.width)
  const drag = async (by: number) => {
    const box = (await edge.boundingBox())!
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + by, y, { steps: 4 })
    await page.mouse.up()
  }
  expect(await width()).toBe(640)
  // Dragged as far as it goes it leaves the chat 20rem, here beside a sidebar of 288.
  await drag(-600)
  expect(await width()).toBe(1280 - 288 - 320)
  // It comes back from where it is, with the pointer over the page it shows.
  await drag(72)
  expect(await width()).toBe(600)
  await edge.focus()
  await page.keyboard.press("ArrowLeft")
  expect(await width()).toBe(616)

  // It is as wide when a document is next opened, from its card as well, after a reload.
  await page.reload()
  await page
    .getByRole("log")
    .getByRole("button", { name: /notes\.md/ })
    .first()
    .click()
  await expect(beside.getByRole("heading", { name: "Handout notes", level: 1 })).toBeVisible()
  expect(await width()).toBe(616)
  await edge.dblclick()
  expect(await width()).toBe(640)
})

test("the layout works at phone width", async ({ page }) => {
  await signIn(page)
  await composer(page).fill("What can you do?")
  await composer(page).press("Enter")
  await expect(page.getByText("You said: What can you do?")).toBeVisible()
  await newChat(page)
  await composer(page).fill("Something aside")
  await composer(page).press("Enter")
  await expect(page.getByText("You said: Something aside")).toBeVisible()
  await page.setViewportSize({ width: 400, height: 800 })
  await page.reload()
  // The agent's pages are tabs across the top, and fit the screen.
  const pages = page.getByRole("navigation", { name: "Juniper's pages" })
  await expect(pages.getByRole("link")).toHaveCount(3)
  for (const link of await pages.getByRole("link").all()) {
    const box = (await link.boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(400)
  }
  // The sidebar is a sheet from the side. Measured once it has finished sliding in.
  await page.getByRole("button", { name: "Agents", exact: true }).click()
  await expect(async () => {
    const sheet = (await page.getByRole("dialog").boundingBox())!
    expect(sheet.x).toBe(0)
  }).toPass()
  // Choosing the agent there is talking to it: its main chat.
  await page
    .getByRole("dialog")
    .getByRole("link", { name: /Juniper/ })
    .click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(page.getByText("You said: What can you do?")).toBeVisible()
  // The strip says whose chat this is, so nothing is over the transcript saying it again.
  await expect(page.getByRole("button", { name: "Start fresh" })).toHaveCount(0)
  // With no room for two chats, a side chat takes the place of the main one, and leads back.
  await sideChats(page).click()
  await page.getByRole("menuitem", { name: /^Something aside/ }).click()
  await expect(page.getByText("You said: Something aside")).toBeVisible()
  await expect(page.getByRole("complementary", { name: /^Side chat:/ })).toHaveCount(0)
  await page.getByRole("link", { name: "Main chat", exact: true }).click()
  await expect(page.getByText("You said: What can you do?")).toBeVisible()
  // Nothing is wider than the screen.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})

test("under a finger the message box is written in at a size a phone does not zoom in on", async ({
  page,
  browser,
  baseURL,
}) => {
  const size = (on: typeof page) =>
    composer(on).evaluate((box) => Number.parseFloat(getComputedStyle(box).fontSize))
  await signIn(page)
  await expect(composer(page)).toBeVisible()
  // With a mouse it is the size of the chat around it.
  expect(await size(page)).toBe(15)

  // Safari on a phone zooms the page in on a box whose text is under 16px, and leaves it so.
  const context = await browser.newContext({
    baseURL,
    colorScheme: "dark",
    viewport: { width: 400, height: 800 },
    hasTouch: true,
    storageState: await page.context().storageState(),
  })
  const phone = await context.newPage()
  await phone.goto("/")
  await expect(composer(phone)).toBeVisible()
  expect(await size(phone)).toBeGreaterThanOrEqual(16)
  // It is still a line tall beside its buttons, and no wider than the screen.
  const box = (await composer(phone).boundingBox())!
  expect(box.height).toBeLessThanOrEqual(40)
  expect(
    await phone.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0)
  await context.close()
})

test("at phone width a finger draws the sidebar out from the left, and pushes it back", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    colorScheme: "dark",
    viewport: { width: 400, height: 800 },
    hasTouch: true,
  })
  const page = await context.newPage()
  await signIn(page)
  await expect(composer(page)).toBeVisible()
  const finger = await context.newCDPSession(page)
  /** A finger put down, drawn in a line to somewhere else, and lifted once it has come to rest. */
  const swipe = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await finger.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] })
    for (let step = 1; step <= 8; step++) {
      const x = from.x + ((to.x - from.x) * step) / 8
      const y = from.y + ((to.y - from.y) * step) / 8
      await finger.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] })
    }
    // Lifted while still moving, what is under it would be flung on past its end.
    await page.waitForTimeout(100)
    await finger.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [to] })
    await finger.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  }
  const sheet = page.getByRole("dialog")

  // Scrolling the chat is not a swipe, though the finger drifts across as it goes.
  await swipe({ x: 120, y: 300 }, { x: 180, y: 600 })
  // Nor is a finger going the other way.
  await swipe({ x: 300, y: 400 }, { x: 60, y: 410 })
  await expect(sheet).toHaveCount(0)

  // On something that scrolls sideways, a finger across it is scrolling that.
  await composer(page).fill(`Here:\n\n\`\`\`\n${"wide ".repeat(60)}\n\`\`\`\n`)
  await composer(page).press("Enter")
  const code = page.locator("pre").first()
  // Once the reply has enough of it to be wider than the screen.
  await expect
    .poll(() => code.evaluate((pre) => pre.scrollWidth - pre.clientWidth))
    .toBeGreaterThan(300)
  const block = (await code.boundingBox())!
  const middle = block.y + block.height / 2
  await swipe({ x: block.x + 216, y: middle }, { x: block.x + 16, y: middle })
  await expect.poll(() => code.evaluate((pre) => pre.scrollLeft)).toBeGreaterThan(150)
  await swipe({ x: block.x + 16, y: middle }, { x: block.x + 136, y: middle })
  await expect.poll(() => code.evaluate((pre) => pre.scrollLeft)).toBeLessThan(150)
  await expect(sheet).toHaveCount(0)

  // Across the page from the left, and the sidebar is there, as from its button.
  await swipe({ x: 24, y: 400 }, { x: 220, y: 420 })
  await expect(sheet.getByRole("link", { name: /Juniper/ })).toBeVisible()
  await expect(async () => {
    expect((await sheet.boundingBox())!.x).toBe(0)
  }).toPass()
  // Scrolling its list leaves it open, and a finger back across it puts it away.
  await swipe({ x: 160, y: 300 }, { x: 150, y: 500 })
  await expect(sheet).toBeVisible()
  await swipe({ x: 260, y: 400 }, { x: 60, y: 390 })
  await expect(sheet).toHaveCount(0)

  // Where the sidebar is beside the page there is nothing to draw out.
  await page.setViewportSize({ width: 1280, height: 800 })
  await swipe({ x: 500, y: 400 }, { x: 800, y: 410 })
  await expect(sheet).toHaveCount(0)
  await context.close()
})
