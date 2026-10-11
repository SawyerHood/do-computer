import type { Page, TestInfo } from "@playwright/test"
import { expect, test } from "./fixtures.ts"

// A Dood, hatched with no account on the page X plays inside a post, and met on its own page.
// Both are drawn, in the square X gives them.
test.use({ creature: true, viewport: { width: 480, height: 480 } })

/** The same view in the smallest square a post is shown in, for someone to look at. */
async function pictures(page: Page, testInfo: TestInfo, name: string) {
  await page.waitForTimeout(1500)
  await page.screenshot({ path: testInfo.outputPath(`${name}-480.png`) })
  await page.setViewportSize({ width: 340, height: 340 })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: testInfo.outputPath(`${name}-340.png`) })
  await page.setViewportSize({ width: 480, height: 480 })
}

/** Hatch one from the egg to the last panel. Answers with its id. */
async function hatch(page: Page, name: string, testInfo?: TestInfo): Promise<string> {
  await page.goto("/hatch")
  const card = page.locator("[data-dood-card]")
  const says = page.getByRole("status")
  await expect(says).toContainText("An egg is on its way down")
  await page.getByRole("button", { name: "Skip" }).click()
  await expect(says).toContainText("Tap the egg")
  await card.click({ position: { x: 240, y: 200 } })
  await expect(says).toContainText("Again")
  await card.click({ position: { x: 240, y: 200 } })

  await page.getByLabel("Its name").fill(name)
  await page.getByRole("radio", { name: "Moss" }).click()
  await page.getByRole("button", { name: "Hatch", exact: true }).click()
  const out = page.getByText(`${name} is out.`)
  await expect(out).toBeVisible({ timeout: 20_000 })

  // Another egg, as often as wanted: the same name on whatever is in it.
  await page.getByRole("button", { name: "Hatch another" }).click()
  await expect(out).toBeHidden()
  await expect(out).toBeVisible({ timeout: 20_000 })
  await page.getByRole("button", { name: `Keep ${name}` }).click()

  await expect(page.getByText(`${name} came with a present.`)).toBeVisible()
  await page.getByRole("button", { name: "Open it" }).click()
  await expect(page.getByText(`Which one is ${name}'s?`)).toBeVisible({ timeout: 20_000 })
  const keep = page.getByRole("button", { name: "Pick one" })
  await expect(keep).toBeDisabled()
  // A hat where there is one: it is what stands highest, and has to be in the picture.
  const hat = page.locator('button[aria-pressed][data-slot="hat"]')
  await (
    (await hat.count()) > 0 ? hat.first() : page.locator("button[aria-pressed]").nth(2)
  ).click()
  if (testInfo) await pictures(page, testInfo, "choose")
  await page.getByRole("button", { name: /^Keep the / }).click()

  await expect(page.getByText(`${name} is ready.`)).toBeVisible()
  await expect(page.getByRole("link", { name: `Claim ${name}` })).toHaveAttribute(
    "href",
    /^\/welcome\?dood=[^&]+&key=.+/,
  )
  const share = await page.getByRole("link", { name: `Share ${name}` }).getAttribute("href")
  const shared = new URL(share!).searchParams.get("url")!
  expect(shared).toContain("/dood/")
  return shared.split("/dood/")[1]!
}

test("a Dood is hatched, named, given one thing out of its present, and has a page", async ({
  page,
}, testInfo) => {
  const id = await hatch(page, "Pebble", testInfo)
  await page.goto(`/dood/${id}`)
  await expect(page.getByText("Pebble", { exact: true })).toBeVisible()
  await expect(page.getByText("0 pats · 0 treats")).toBeVisible()
  // Whoever hatched it is offered it here too, for as long as nobody has claimed it.
  await expect(page.getByRole("link", { name: "Claim Pebble" })).toBeVisible()
  await pictures(page, testInfo, "meet")
})

test("a treat counts once a day from one visitor", async ({ page }) => {
  const id = await hatch(page, "Biscuit")
  await page.goto(`/dood/${id}`)
  await page.getByRole("button", { name: "Give a treat" }).click()
  await expect(page.getByText("0 pats · 1 treats")).toBeVisible()
  await expect(page.getByRole("button", { name: "Given for today" })).toBeDisabled()

  await page.reload()
  await page.getByRole("button", { name: "Give a treat" }).click()
  await expect(page.getByRole("button", { name: "Given for today" })).toBeDisabled()
  await expect(page.getByText("0 pats · 1 treats")).toBeVisible()
})

test("the pages say in their heads that X may play them in a post", async ({ request }) => {
  const made = await request.post("/api/doods", {
    data: { name: "Marble", color: "plum", seed: "abcd1234" },
  })
  const { dood } = (await made.json()) as { dood: { id: string } }
  const meta = (html: string, name: string) =>
    new RegExp(`<meta[^>]*"${name}"[^>]*>`).exec(html)?.[0] ?? ""

  const page = await request.get(`/dood/${dood.id}`, {
    headers: { "user-agent": "Twitterbot/1.0" },
  })
  const html = await page.text()
  expect(meta(html, "twitter:card")).toContain('"player"')
  expect(meta(html, "twitter:title")).toContain("Meet Marble")
  expect(meta(html, "twitter:player")).toContain(`/dood/${dood.id}"`)
  expect(meta(html, "twitter:image")).toContain("/dood/meet-plum.jpg")
  expect(meta(html, "robots")).toContain("noindex")

  const egg = await (await request.get("/hatch")).text()
  expect(meta(egg, "twitter:card")).toContain('"player"')
  expect(meta(egg, "twitter:title")).toContain("Hatch a Dood")
  expect(egg).toContain("<title>Hatch a Dood</title>")

  const missing = await request.get("/dood/nobody")
  expect(missing.status()).toBe(404)
  expect(await missing.text()).not.toContain('twitter:title" content="Meet')
})

test("strokes are counted, and told to the server a few at a time", async ({ page, request }) => {
  const made = await request.post("/api/doods", {
    data: { name: "Marble", color: "plum", seed: "abcd1234" },
  })
  const { dood } = (await made.json()) as { dood: { id: string } }
  await page.goto(`/dood/${dood.id}`)
  const egg = page.locator("[data-egg]")
  await expect(egg).toBeVisible()
  await expect(page.getByText("0 pats · 0 treats")).toBeVisible()
  const box = (await egg.boundingBox())!
  for (let move = 0; move < 60; move++) {
    const x = box.x + box.width * (0.3 + 0.4 * ((move % 10) / 10))
    await page.mouse.move(x, box.y + box.height * 0.5)
  }
  await expect(page.getByText(/[1-9] pats · 0 treats/)).toBeVisible()
  await expect
    .poll(async () => {
      const answer = await request.get(`/api/doods/${dood.id}`)
      return ((await answer.json()) as { dood: { pats: number } }).dood.pats
    })
    .toBeGreaterThan(0)
})
