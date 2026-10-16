import { expect, test } from "./fixtures.ts"
import {
  asOwner,
  closeSettings,
  composer,
  newChat,
  openSettings,
  sectionHeading,
  sideChats,
  signIn,
  tab,
  tool,
  unfold,
  panelSwitch,
} from "./helpers.ts"

asOwner()

test("the sidebar is a column of faces until it is opened out, and stays how it was left", async ({
  browser,
  baseURL,
}) => {
  // A browser that has never said how it wants things laid out.
  const context = await browser.newContext({ baseURL, colorScheme: "dark" })
  const page = await context.newPage()
  await signIn(page)
  // The Doods are beside the chat as faces, each of which still says whose it is.
  await expect(page.getByRole("heading", { name: "Doods" })).toHaveCount(0)
  await expect(
    page.getByRole("navigation", { name: "Doods" }).getByRole("link"),
  ).toHaveAccessibleName("Juniper")
  // The chat has the room: the agent's panel is away until it is asked for, from the menu on
  // its name, and stays the way it was left.
  const panel = page.getByRole("complementary", { name: "About Juniper" })
  await expect(composer(page)).toBeVisible()
  await expect(panel).toHaveCount(0)
  await panelSwitch(page, "Show")
  await expect(panel.getByRole("img", { name: "Dood avatar" })).toBeVisible()
  await page.reload()
  await expect(panel.getByRole("img", { name: "Dood avatar" })).toBeVisible()
  await panelSwitch(page, "Hide")
  await expect(panel).toHaveCount(0)

  // The agent's side chats are in the same menu.
  await sideChats(page).click()
  await expect(page.getByRole("menuitem", { name: "New side chat" })).toBeVisible()
  await page.keyboard.press("Escape")
  await page.keyboard.press("Escape")

  // Opened out by its edge, the sidebar is the list by name, and still is after a reload.
  const edge = page.getByRole("separator", { name: "Resize the sidebar" })
  await edge.dblclick()
  await expect(page.getByRole("heading", { name: "Doods" })).toBeVisible()
  await page.reload()
  await expect(page.getByRole("heading", { name: "Doods" })).toBeVisible()
  await edge.press("Home")
  await expect(page.getByRole("heading", { name: "Doods" })).toHaveCount(0)
  await context.close()
})

test("the sidebar and the agent's panel are dragged by their edges, and stay as wide as left", async ({
  page,
}) => {
  await signIn(page)
  const sidebar = page
    .locator("aside")
    .filter({ has: page.getByRole("navigation", { name: "Doods" }) })
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
  // It goes no wider than its bound, and stops at its narrowest on the way in.
  await drag(edge, 600)
  await expect.poll(() => width(sidebar)).toBe(448)
  await drag(edge, -260)
  await expect.poll(() => width(sidebar)).toBe(208)
  // Pulled in past that it shuts, to a column of faces, and it is pulled open from there.
  await drag(edge, -120)
  await expect.poll(() => width(sidebar)).toBe(60)
  await expect(page.getByRole("heading", { name: "Doods" })).toHaveCount(0)
  await expect(edge).toHaveAttribute("aria-valuenow", "60")
  await drag(edge, 196)
  await expect(page.getByRole("heading", { name: "Doods" })).toBeVisible()
  await expect.poll(() => width(sidebar)).toBe(256)
  await drag(edge, -600)
  await expect.poll(() => width(sidebar)).toBe(60)
  // The arrow keys move it too: out of being shut to the width it had, and on from there.
  await edge.focus()
  await page.keyboard.press("ArrowRight")
  await expect.poll(() => width(sidebar)).toBe(256)
  await page.keyboard.press("ArrowLeft")
  await page.keyboard.press("ArrowLeft")
  await page.keyboard.press("ArrowLeft")
  await expect.poll(() => width(sidebar)).toBe(208)
  await page.keyboard.press("ArrowLeft")
  await expect.poll(() => width(sidebar)).toBe(60)
  await page.keyboard.press("ArrowRight")
  await page.keyboard.press("ArrowRight")
  await page.keyboard.press("ArrowRight")
  await expect.poll(() => width(sidebar)).toBe(240)

  // The agent's panel is dragged by its other edge: to the left is wider.
  await panelSwitch(page, "Show")
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
  await panelSwitch(page, "Show")
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

test("a section of the panel folds under its heading, and the face gives way to a bar", async ({
  page,
}) => {
  await signIn(page)
  await newChat(page)
  await tool(
    page,
    "write",
    { path: "library/folds/notes.md", content: "# Fold notes\n" },
    "Successfully wrote to library/folds/notes.md",
  )
  await composer(page).fill('/tool send_file {"path":"library/folds/notes.md"}')
  await page.keyboard.press("Enter")
  await expect(page.getByRole("link", { name: "Download notes.md" })).toBeVisible()
  await panelSwitch(page, "Show")
  const panel = page.getByRole("complementary", { name: "About Juniper" })
  const did = panel.getByRole("region", { name: "What it did here" })
  for (const title of ["One", "Two", "Three", "Four", "Five", "Six", "Seven"]) {
    await composer(page).fill(`/tool log {"title":"Thing ${title}","outcome":"Done."}`)
    await page.keyboard.press("Enter")
    await expect(did.getByRole("listitem").filter({ hasText: `Thing ${title}` })).toBeVisible()
  }

  // What it did is open, with its latest few and a way to the rest, and its heading counts them all.
  const didHeading = sectionHeading(page, "What it did here")
  await expect(didHeading).toHaveText(/What it did here\s*7/)
  await expect(did.getByRole("listitem")).toHaveCount(5)
  await did.getByRole("button", { name: "Show 2 more" }).click()
  await expect(did.getByRole("listitem")).toHaveCount(7)
  await did.getByRole("button", { name: "Show fewer" }).click()
  await expect(did.getByRole("listitem")).toHaveCount(5)
  // It folds away under its heading.
  await didHeading.click()
  await expect(didHeading).toHaveAttribute("aria-expanded", "false")
  await expect(did.getByRole("listitem")).toHaveCount(0)
  // What was shared starts folded, and is opened.
  const shared = panel.getByRole("region", { name: "Shared here" })
  await expect(sectionHeading(page, "Shared here")).toHaveAttribute("aria-expanded", "false")
  await unfold(page, "Shared here")
  await expect(shared.getByRole("listitem")).toHaveText([/notes\.md/])

  // Both are as they were left after a reload.
  await page.reload()
  await expect(composer(page)).toBeVisible()
  await panelSwitch(page, "Show")
  await expect(didHeading).toHaveAttribute("aria-expanded", "false")
  await expect(shared.getByRole("listitem")).toHaveText([/notes\.md/])
  await didHeading.click()
  await expect(did.getByRole("listitem")).toHaveCount(5)

  // In a short window the panel scrolls as one. Once the name has gone, a bar says who this is,
  // and a press on it brings the face back.
  await page.setViewportSize({ width: 1280, height: 420 })
  const bar = panel.getByRole("button", { name: "Back to Juniper" })
  await expect(bar).toHaveCount(0)
  await panel.getByRole("heading", { name: "Juniper" }).hover()
  await page.mouse.wheel(0, 2000)
  await expect(bar).toBeVisible()
  await expect(bar).toContainText("Juniper")
  await page.screenshot({ path: "test-results/panel-tucked.png" })
  await bar.click()
  await expect(bar).toHaveCount(0)
  await expect(panel.getByRole("heading", { name: "Juniper" })).toBeInViewport()
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
  await panelSwitch(page, "Show")
  const panel = page.getByRole("complementary", { name: "About Juniper" })
  const shared = panel.getByRole("region", { name: "Shared here" })
  // Folded until it is asked for, it says how many there are.
  await expect(sectionHeading(page, "Shared here")).toHaveText(/Shared here\s*2/)
  await expect(shared.getByRole("listitem")).toHaveCount(0)
  await unfold(page, "Shared here")
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
  // Dragged as far as it goes it leaves the chat 20rem, here beside a sidebar of 288 and the
  // hairline between that and the page. The document is a card 10 in from the page's edge.
  const most = 1280 - 288 - 1 - 320 - 10
  await drag(-600)
  expect(await width()).toBe(most)
  // It comes back from where it is, with the pointer over the page it shows.
  await drag(72)
  expect(await width()).toBe(most - 72)
  await edge.focus()
  await page.keyboard.press("ArrowLeft")
  expect(await width()).toBe(most - 72 + 16)

  // It is as wide when a document is next opened, from its card as well, after a reload.
  await page.reload()
  await page
    .getByRole("log")
    .getByRole("button", { name: /notes\.md/ })
    .first()
    .click()
  await expect(beside.getByRole("heading", { name: "Handout notes", level: 1 })).toBeVisible()
  expect(await width()).toBe(most - 72 + 16)
  await edge.dblclick()
  expect(await width()).toBe(640)

  // As narrow as it goes, every button of its bar is still in view: the ways to show it are down
  // to their pictures, and the file's name is what is cut short.
  await drag(600)
  expect(await width()).toBe(352)
  const bar = beside.locator("header")
  const spills = () => bar.evaluate((header) => header.scrollWidth - header.clientWidth)
  expect(await spills()).toBe(0)
  await expect(beside.getByRole("button", { name: "Split" })).toBeInViewport({ ratio: 1 })
  await expect(beside.getByRole("button", { name: "Close the document" })).toBeInViewport({
    ratio: 1,
  })
  await beside.getByRole("button", { name: "Edit" }).click()
  await beside.getByRole("textbox", { name: "Edit notes.md" }).press("Control+End")
  await page.keyboard.type("More.")
  await expect(beside.getByText("Saved", { exact: true })).toBeInViewport({ ratio: 1 })
  expect(await spills()).toBe(0)
  await page.screenshot({ path: "test-results/document-narrow.png" })

  // A new name is typed where the name was, with room made for it.
  await beside.getByRole("button", { name: "More" }).click()
  await page.getByRole("menuitem", { name: "Rename or move" }).click()
  const name = beside.getByRole("textbox", { name: "Folder and name" })
  await expect(name).toBeFocused()
  expect((await name.boundingBox())!.width).toBeGreaterThan(100)
  expect(await spills()).toBe(0)
  await expect(beside.getByRole("button", { name: "Close the document" })).toBeInViewport({
    ratio: 1,
  })
  await page.keyboard.press("Escape")
  await expect(beside.getByRole("button", { name: "Split" })).toBeVisible()
})

test("the message box is one line at rest, and opens out once it is written in", async ({
  page,
}) => {
  await signIn(page)
  await newChat(page)
  const box = composer(page)
  const around = page.locator("form").filter({ has: box })
  const said = page.getByRole("log").getByText("You said: Hello there")
  await box.fill("Hello there")
  await box.press("Enter")
  await expect(said).toBeVisible()
  // The answer is drawn anew as it ends, and the button to send is back once it has: measured
  // before that, what was found of the answer a moment ago may be gone.
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible()
  const place = async (locator: typeof box) => {
    for (;;) {
      const found = await locator.boundingBox()
      if (found !== null) return found
    }
  }
  const settled = async (height: number) =>
    expect.poll(async () => (await place(around)).height).toBe(height)

  // Sent from, it is still being written in: what is written has the whole width of the box.
  await expect(box).toBeFocused()
  await settled(112)
  const [text, open, clip, arrow] = await Promise.all([
    place(box),
    place(around),
    place(page.getByRole("button", { name: "Attach a file" })),
    place(page.getByRole("button", { name: "Send" })),
  ])
  expect(text.width).toBe(open.width - 12)
  // Its buttons are in a row under that: attaching at one end, sending at the other.
  expect(clip.y).toBeGreaterThanOrEqual(text.y + text.height)
  expect(arrow.y).toBe(clip.y)
  expect(clip.x - open.x).toBeLessThan(12)
  expect(open.x + open.width - (arrow.x + arrow.width)).toBeLessThan(12)

  // Left alone and empty it is one line, with its buttons at either end of it. Its foot stays
  // where it was, and what was said above is still next to it.
  await said.click()
  await settled(48)
  const shut = await place(around)
  expect(shut.y + shut.height).toBe(open.y + open.height)
  const [line, plus, send] = await Promise.all([
    place(box),
    place(page.getByRole("button", { name: "Attach a file" })),
    place(page.getByRole("button", { name: "Send" })),
  ])
  expect(plus.y).toBe(send.y)
  expect(plus.x).toBeLessThan(line.x)
  expect(send.x).toBeGreaterThan(line.x + line.width - 60)
  await expect(said).toBeInViewport()

  // Given the cursor by the page, as when a chat is opened, it is still one line: it opens
  // once it is gone to. Pressing anywhere in the box that is not a button goes to it.
  await page.reload()
  await expect(box).toBeFocused()
  await settled(48)
  await page.mouse.click(shut.x + shut.width / 2, shut.y + shut.height / 2)
  await expect(box).toBeFocused()
  await settled(112)
  // And pressing there again, or a button, leaves the cursor in: the box does not move under the press.
  await page.mouse.click(open.x + open.width / 2, open.y + 55)
  await expect(box).toBeFocused()
  await box.fill("And again")
  await page.getByRole("button", { name: "Send" }).click()
  await expect(page.getByRole("log").getByText("You said: And again")).toBeVisible()
  await expect(box).toBeFocused()
  await expect(box).toHaveValue("")
  await settled(112)

  // Typed in without being gone to, it opens for what is typed, and stays open while that is there.
  await said.click()
  await settled(48)
  await box.fill("one")
  await settled(112)
  // More than two lines and it grows with them.
  await box.fill("one\ntwo\nthree\nfour")
  await settled(162)
  await box.fill("")
})

test("the layout works at phone width", async ({ page }) => {
  await signIn(page)
  await composer(page).fill("What can you do?")
  await composer(page).press("Enter")
  await expect(page.getByRole("main").getByText("You said: What can you do?")).toBeVisible()
  await newChat(page)
  await composer(page).fill("Something aside")
  await composer(page).press("Enter")
  await expect(page.getByRole("main").getByText("You said: Something aside")).toBeVisible()
  await page.setViewportSize({ width: 400, height: 800 })
  await page.reload()
  // Above the page is one row with the agent's name in it: its pages are in the menu on that.
  const name = page.getByRole("button", { name: "Juniper: pages, side chats and settings" })
  expect((await page.locator("header").filter({ has: name }).boundingBox())!.height).toBe(52)
  await name.click()
  await expect(page.getByRole("menuitem", { name: "Chat", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  )
  await page.getByRole("menuitem", { name: "Library" }).click()
  await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible()
  // The library says what it is itself, and the name is part of its bar with nothing added.
  await expect(name).not.toContainText("·")
  // And the row starts with the way back to the chat.
  await page.getByRole("button", { name: "Back to the chat" }).click()
  await expect(page.getByRole("main").getByText("You said: Something aside")).toBeVisible()
  await expect(name).not.toContainText("·")
  await expect(page.getByRole("button", { name: "Back to the chat" })).toHaveCount(0)
  // The menu leads back as well.
  await name.click()
  await page.getByRole("menuitem", { name: "Automations" }).click()
  await expect(page.getByRole("heading", { name: "Automations" })).toBeVisible()
  // Off the chat and the library, the name says which page this is.
  await expect(name).toContainText("Juniper · Automations")
  await name.click()
  await page.getByRole("menuitem", { name: "Chat", exact: true }).click()
  await expect(page.getByRole("main").getByText("You said: Something aside")).toBeVisible()
  // The sidebar is out of sight, and the page has the whole width. The way to it is at the
  // start of the row.
  const agents = page.getByRole("navigation", { name: "Doods" })
  const juniper = agents.getByRole("link", { name: /Juniper/ })
  const sidebar = () =>
    page.locator("[data-pulled-sidebar]").evaluate((el) => el.getBoundingClientRect().width)
  await expect(agents).toHaveCount(0)
  expect(await sidebar()).toBe(0)
  const pageWidth = async () => (await page.getByRole("main").boundingBox())!.width
  expect(await pageWidth()).toBe(400)
  await page.screenshot({ path: "test-results/phone-chat.png" })
  // Asked for, it is the list, and the page slides aside as wide as it was.
  await page.getByRole("button", { name: "Show your Doods" }).click()
  await expect.poll(sidebar).toBe(320)
  await expect(agents.locator("[data-latest]")).toBeVisible()
  expect(await pageWidth()).toBe(400)
  const face = async () => (await juniper.locator("> span").first().boundingBox())!
  expect(await face()).toMatchObject({ x: 10, width: 40 })
  await page.screenshot({ path: "test-results/phone-doods.png" })
  // Choosing the agent there is talking to it: its main chat. The list is gone again.
  await juniper.click()
  await expect.poll(sidebar).toBe(0)
  await expect(agents).toHaveCount(0)
  await expect(page.getByRole("main").getByText("You said: What can you do?")).toBeVisible()
  // The name above says whose chat this is, so nothing is over the transcript saying it again.
  await expect(page.getByRole("button", { name: "Start fresh" })).toHaveCount(0)
  // With no room for two chats, a side chat takes the place of the main one, and leads back.
  await sideChats(page).click()
  await page.getByRole("menuitem", { name: /^Something aside/ }).click()
  await expect(page.getByRole("main").getByText("You said: Something aside")).toBeVisible()
  await expect(page.getByRole("complementary", { name: /^Side chat:/ })).toHaveCount(0)
  await page.getByRole("link", { name: "Main chat", exact: true }).click()
  await expect(page.getByRole("main").getByText("You said: What can you do?")).toBeVisible()
  // Nothing is wider than the screen.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})

test("under a finger every field is written in at a size a phone does not zoom in on", async ({
  page,
  browser,
  baseURL,
}) => {
  /** The smallest text of the fields on the page that are typed in or chosen from. */
  const smallest = (on: typeof page) =>
    on.evaluate(() =>
      Math.min(
        ...[...document.querySelectorAll("input, textarea, select")]
          .filter((field) => !field.matches("[type=file], [type=checkbox], [type=radio]"))
          .map((field) => Number.parseFloat(getComputedStyle(field).fontSize)),
      ),
    )
  await signIn(page)
  await expect(composer(page)).toBeVisible()
  // With a mouse the message box is the size of the chat around it, which is that size too.
  expect(await smallest(page)).toBe(16)

  // Safari on a phone zooms the page in on a field whose text is under 16px, and leaves it so.
  // Held sideways the phone is as wide as this, where the fields would be at their smallest.
  const context = await browser.newContext({
    baseURL,
    colorScheme: "dark",
    viewport: { width: 900, height: 420 },
    hasTouch: true,
    storageState: await page.context().storageState(),
  })
  const phone = await context.newPage()
  await phone.goto("/")
  await expect(composer(phone)).toBeVisible()
  expect(await smallest(phone)).toBe(16)
  // The box is still a line tall over its buttons.
  expect((await composer(phone).boundingBox())!.height).toBeLessThanOrEqual(42)

  // The fields of the agent's settings, which are smaller than the message box with a mouse.
  await openSettings(phone, "Profile")
  await expect(phone.getByRole("dialog").getByLabel("Name")).toBeVisible()
  expect(await smallest(phone)).toBe(16)
  await closeSettings(phone)

  // And a document being written in the library.
  await tab(phone, "Library").click()
  await phone.getByRole("button", { name: "New document" }).first().click()
  await expect(phone.getByRole("textbox", { name: "Edit Untitled.md" })).toBeVisible()
  expect(await smallest(phone)).toBe(16)
  await context.close()
})

test("at phone width a finger pulls the sidebar out across the page, and pushes it shut", async ({
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
  const names = page.getByRole("navigation", { name: "Doods" }).locator("[data-latest]")
  const sidebar = () =>
    page.locator("[data-pulled-sidebar]").evaluate((el) => el.getBoundingClientRect().width)

  // Scrolling the chat is not a swipe, though the finger drifts across as it goes.
  await swipe({ x: 120, y: 300 }, { x: 180, y: 600 })
  // Nor is a finger going the other way.
  await swipe({ x: 300, y: 400 }, { x: 60, y: 410 })
  await expect(names).toHaveCount(0)
  expect(await sidebar()).toBe(0)

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
  await expect(names).toHaveCount(0)

  // A finger that has not gone far lets it go back out of sight.
  await swipe({ x: 24, y: 400 }, { x: 54, y: 402 })
  await expect.poll(sidebar).toBe(0)
  await expect(names).toHaveCount(0)
  // Across the page, and the Doods are there by name. It follows the finger there.
  await finger.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: 24, y: 400 }],
  })
  for (const x of [44, 84, 124]) {
    await finger.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: 402 }],
    })
  }
  await expect.poll(sidebar).toBe(100)
  await finger.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  await expect.poll(sidebar).toBe(320)
  await expect(names).toBeVisible()
  // Scrolling its list leaves it open, and a finger back across it shuts it.
  await swipe({ x: 160, y: 300 }, { x: 150, y: 500 })
  expect(await sidebar()).toBe(320)
  await swipe({ x: 260, y: 400 }, { x: 60, y: 390 })
  await expect.poll(sidebar).toBe(0)
  await expect(names).toHaveCount(0)
  // Open again, a touch on the page beside it shuts it too.
  await swipe({ x: 80, y: 400 }, { x: 280, y: 410 })
  await expect.poll(sidebar).toBe(320)
  await page.touchscreen.tap(370, 400)
  await expect.poll(sidebar).toBe(0)

  // Where the sidebar is beside the page at its own width there is nothing to pull.
  await page.setViewportSize({ width: 1280, height: 800 })
  await swipe({ x: 500, y: 400 }, { x: 800, y: 410 })
  await expect(page.locator("[data-pulled-sidebar]")).toHaveCount(0)
  await context.close()
})
