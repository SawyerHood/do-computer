import type { Pin } from "@do-computer/protocol"
import { expect, type Page } from "@playwright/test"
import { test } from "./fixtures.ts"
import { asOwner, newChat, signIn, tab, tool, openFile } from "./helpers.ts"

asOwner()

const agentOf = (page: Page) => /\/a\/([^/]+)/.exec(page.url())![1]!

async function pinsOf(page: Page): Promise<Pin[]> {
  const response = await page.request.get(`/api/agents/${agentOf(page)}/pins`)
  return ((await response.json()) as { pins: Pin[] }).pins
}

/** A board as an agent would keep one: a page, with a number on it that changes. */
const board = (visits: string) =>
  `<!doctype html><html><head><title>Relaunch</title></head><body><h1>Pricing relaunch</h1><p id="visits">${visits}</p></body></html>`

const write = (page: Page, path: string, content: string) =>
  tool(page, "write", { path: `library/${path}`, content }, `Successfully wrote to library/${path}`)

/** The panel about the agent is where its pins are, on a screen wide enough for it. */
async function withPanel(page: Page) {
  await page.addInitScript(() => localStorage.setItem("dc-agent-panel", "open"))
  await page.setViewportSize({ width: 1500, height: 900 })
  await signIn(page)
  await newChat(page)
}

test("what the agent pins stays under its face, drawn small, and follows the file", async ({
  page,
}) => {
  await withPanel(page)
  const shelf = page.getByRole("region", { name: "Pinned" })
  // With nothing pinned there is no such section.
  await expect(shelf).toHaveCount(0)
  await write(page, "boards/relaunch.html", board("18,240"))
  await tool(
    page,
    "pin",
    { action: "pin", path: "boards/relaunch.html", title: "Launch board" },
    /Pinned boards\/relaunch\.html as “Launch board”/,
  )
  // The chat says that it was pinned, with the way to open it and to take the pin off.
  const card = page.getByRole("group", { name: "Pinned: Launch board" })
  await expect(card.getByText("Juniper pinned Launch board")).toBeVisible()
  // Under the face it is the page itself, small.
  await expect(shelf.getByText("Launch board")).toBeVisible()
  const small = shelf.frameLocator("iframe")
  await expect(small.locator("#visits")).toHaveText("18,240")
  // It is drawn at half its size, as wide as the panel lets it be.
  const frame = (await shelf.locator("iframe").boundingBox())!
  const tile = (await shelf.getByRole("listitem").first().boundingBox())!
  expect(frame.width).toBeGreaterThan(tile.width - 2)
  expect(frame.width).toBeLessThan(tile.width + 2)
  expect(await small.locator("html").evaluate(() => innerWidth)).toBeGreaterThan(tile.width * 1.9)
  await page.screenshot({ path: "test-results/pinned.png" })

  // The agent changes the file, and what is pinned changes with it, and says that it did.
  await write(page, "boards/relaunch.html", board("18,412"))
  await expect(small.locator("#visits")).toHaveText("18,412")
  await expect(shelf.getByText("Just changed")).toBeVisible()
  await page.screenshot({ path: "test-results/pinned-changed.png" })

  // A press opens it beside the chat, where the panel was, and its bar says that it is pinned.
  await shelf.getByRole("button", { name: "Open Launch board" }).click()
  const beside = page.getByRole("complementary", { name: "Document" })
  await expect(beside.frameLocator("iframe").locator("#visits")).toHaveText("18,412")
  await expect(beside.getByRole("button", { name: "Unpin from Juniper" })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await page.screenshot({ path: "test-results/pinned-beside.png" })
  await beside.getByRole("button", { name: "Close the document" }).click()

  // Taken off from the card in the chat, it is gone from under the face, and can be put back.
  await card.getByRole("button", { name: "Unpin" }).click()
  await expect(card.getByText("Launch board is no longer pinned")).toBeVisible()
  await expect(shelf).toHaveCount(0)
  expect(await pinsOf(page)).toEqual([])
  await card.getByRole("button", { name: "Pin it again" }).click()
  await expect(card.getByText("Juniper pinned Launch board")).toBeVisible()
  await expect(shelf.locator("iframe")).toBeVisible()
  // The agent takes it off by its title.
  await tool(page, "pin", { action: "unpin", path: "Launch board" }, /is no longer pinned/)
  await expect(shelf).toHaveCount(0)
})

test("a person pins a file from its card and from the document, and unpins it there", async ({
  page,
}) => {
  await withPanel(page)
  await write(page, "boards/relaunch.html", board("18,240"))
  await write(page, "pricing/plan.md", "# Pricing plan\n\nThree plans in one row.\n")
  await tool(page, "send_file", { path: "library/pricing/plan.md" }, /Showed the user/)
  // From the file's card in the chat.
  await page.getByRole("button", { name: "Pin plan.md", exact: true }).click()
  const shelf = page.getByRole("region", { name: "Pinned" })
  // A document is drawn small as the document.
  await expect(shelf.getByRole("heading", { name: "Pricing plan" })).toBeVisible()
  // The card says so too: its pin is pressed in. The one under the face is the way to take it off.
  await expect(page.getByRole("button", { name: "Unpin plan.md", pressed: true })).toBeVisible()
  expect(await pinsOf(page)).toMatchObject([{ path: "pricing/plan.md", by: "user" }])

  // From the bar of a document, in the library.
  await tab(page, "Library").click()
  await openFile(page, "relaunch.html")
  await page.getByRole("button", { name: "Pin to Juniper" }).click()
  await expect(page.getByRole("button", { name: "Unpin from Juniper" })).toBeVisible()
  // Beside the library the agent's panel has them too, and there a pin opens in the library.
  await expect(shelf.getByRole("link", { name: "Open plan.md" })).toBeVisible()
  // The second is named, not drawn: one at a time is looked at.
  const second = shelf.getByRole("link", { name: "Open relaunch.html" })
  await expect(second).toBeVisible()
  await expect(shelf.locator("iframe")).toHaveCount(0)
  await page.screenshot({ path: "test-results/pinned-library.png" })
  expect((await pinsOf(page)).map((pin) => pin.path)).toEqual([
    "pricing/plan.md",
    "boards/relaunch.html",
  ])

  // Taken off under the face, the next one is the one drawn.
  await shelf.getByRole("button", { name: "Unpin plan.md" }).click()
  await expect(shelf.frameLocator("iframe").locator("#visits")).toHaveText("18,240")
  // And the bar of the document takes the last one off.
  await page.getByRole("button", { name: "Unpin from Juniper" }).click()
  await expect(shelf).toHaveCount(0)
  expect(await pinsOf(page)).toEqual([])
})

test("a pin whose file was deleted says so, and can be taken off", async ({ page }) => {
  await withPanel(page)
  await write(page, "notes/gone.md", "# Gone soon\n")
  await tool(page, "pin", { action: "pin", path: "notes/gone.md" }, /Pinned notes\/gone\.md/)
  const shelf = page.getByRole("region", { name: "Pinned" })
  await expect(shelf.getByRole("heading", { name: "Gone soon" })).toBeVisible()
  await tool(page, "bash", { command: "rm library/notes/gone.md && echo removed" }, /^removed$/)
  await expect(shelf.getByText("gone.md is no longer in the library")).toBeVisible()
  await shelf.getByRole("button", { name: "Unpin gone.md" }).click()
  await expect(shelf).toHaveCount(0)
})
