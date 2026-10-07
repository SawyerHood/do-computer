import { expect, test } from "./fixtures.ts"
import { asOwner, composer, signIn, tab } from "./helpers.ts"

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

  // A chat can be started without it.
  const before = page.url()
  await page.getByRole("button", { name: "New chat", exact: true }).click()
  await page.waitForURL((url) => /\/c\/\d+$/.test(url.pathname) && url.href !== before)

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
  const width = async (of: typeof sidebar) => {
    await of.waitFor()
    return Math.round((await of.boundingBox())!.width)
  }
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
  expect(await width(sidebar)).toBe(288)

  // Its edge follows the pointer, and the chat has what room is left.
  await drag(edge, 72)
  expect(await width(sidebar)).toBe(360)
  await expect(edge).toHaveAttribute("aria-valuenow", "360")
  // It goes no further than its bounds, either way.
  await drag(edge, 600)
  expect(await width(sidebar)).toBe(448)
  await drag(edge, -600)
  expect(await width(sidebar)).toBe(208)
  // The arrow keys move it too.
  await edge.focus()
  await page.keyboard.press("ArrowRight")
  await page.keyboard.press("ArrowRight")
  expect(await width(sidebar)).toBe(240)

  // The agent's panel is dragged by its other edge: to the left is wider.
  await page.getByRole("button", { name: "Show Juniper's panel" }).click()
  const panel = page.getByRole("complementary", { name: "About Juniper" })
  const panelEdge = page.getByRole("separator", { name: "Resize Juniper's panel" })
  expect(await width(panel)).toBe(320)
  await drag(panelEdge, -80)
  expect(await width(panel)).toBe(400)

  // Both are as they were left after a reload, and the panel is as wide beside another tab.
  await page.reload()
  await expect(composer(page)).toBeVisible()
  expect(await width(sidebar)).toBe(240)
  // These tests put the panel away on every load, so it is asked for again.
  await page.getByRole("button", { name: "Show Juniper's panel" }).click()
  expect(await width(panel)).toBe(400)
  await tab(page, "Automations").click()
  await page.waitForURL(/\/automations$/)
  expect(await width(panel)).toBe(400)
  await tab(page, "Chat").click()
  await expect(composer(page)).toBeVisible()

  // Pressing an edge twice puts its column back to the width it started at.
  await edge.dblclick()
  expect(await width(sidebar)).toBe(288)
  await panelEdge.dblclick()
  expect(await width(panel)).toBe(320)
})

test("the layout works at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 800 })
  await signIn(page)
  await composer(page).fill("What can you do?")
  await composer(page).press("Enter")
  await expect(page.getByText("You said: What can you do?")).toBeVisible()
  // More chats than the list shows at once, so that one is among the older ones.
  const agentId = page.url().match(/\/a\/([^/]+)/)![1]!
  for (let made = 0; made < 9; made++) {
    expect((await page.request.post(`/api/agents/${agentId}/chats`, { data: {} })).ok()).toBe(true)
  }
  await page.reload()
  // The agent's pages are tabs across the top, and fit the screen.
  const pages = page.getByRole("navigation", { name: "Juniper's pages" })
  await expect(pages.getByRole("link")).toHaveCount(3)
  for (const link of await pages.getByRole("link").all()) {
    const box = (await link.boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(400)
  }
  // The sidebar is a sheet from the side. Measured once it has finished sliding in.
  await page.getByRole("button", { name: "Agents and chats" }).click()
  await expect(async () => {
    const sheet = (await page.getByRole("dialog").boundingBox())!
    expect(sheet.x).toBe(0)
  }).toPass()
  // Only an agent's latest chats are listed until the rest are asked for.
  await page.getByRole("button", { name: /older chats?$/ }).click()
  await expect(page.getByRole("link", { name: "What can you do?" })).toBeVisible()
  await page.getByRole("link", { name: "What can you do?" }).click()
  await expect(page.getByText("You said: What can you do?")).toBeVisible()
  // Nothing is wider than the screen.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})
