import { expect, test } from "./fixtures.ts"

// The guides are for anyone: nobody here is signed in.

test("a guide is a page, sent whole, with the way to hand it to an agent", async ({
  page,
  request,
  baseURL,
  context,
}) => {
  // The page is there before any script is, so an agent given the page's own address can read it.
  const sent = await (await request.get("/docs/self-hosting")).text()
  expect(sent).toContain("On a machine of yours")
  expect(sent).toContain("pnpm build")
  expect(sent).toContain(`href="/docs/self-hosting.md"`)

  // `/docs` opens the first guide.
  await page.goto("/docs")
  await expect(page).toHaveURL(/\/docs\/self-hosting$/)
  await expect(page).toHaveTitle("Self-hosting · Do Computer")
  await expect(page.getByRole("heading", { level: 1, name: "Self-hosting" })).toBeVisible()

  // What is copied names the file at this deployment's own address.
  const prompt = `Follow ${baseURL}/docs/self-hosting.md and set up Do Computer for me.`
  await expect(page.locator("pre[data-prompt]")).toHaveText(prompt)
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  await page.getByRole("button", { name: "Copy prompt" }).click()
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(prompt)
  await page.getByRole("button", { name: "Copy page as Markdown" }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^# Self-hosting\n/)

  // A block of commands is copied without the button's own words in it.
  const build = page.locator(".dx-code", { hasText: "pnpm build" }).first()
  await build.getByRole("button", { name: "Copy" }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("pnpm build")

  // The steps that wait for the person are marked, and the checks are still said in words.
  await expect(page.locator(".dx-needs").first()).toHaveText("Needs you")
  await expect(page.locator(".dx-check").first()).toContainText("Check: ")

  // A section is gone to from the list at the side, which then says where the reader is.
  const side = page.locator(".dx-side")
  await side.getByRole("link", { name: "On Cloudflare" }).click()
  await expect(page).toHaveURL(/#on-cloudflare$/)
  await expect(page.getByRole("heading", { level: 2, name: "On Cloudflare" })).toBeInViewport()
  await expect(side.getByRole("link", { name: "On Cloudflare" })).toHaveAttribute(
    "aria-current",
    "location",
  )
})

test("the same guide is given to an agent as the file it is written in", async ({
  request,
  baseURL,
}) => {
  const file = await request.get("/docs/self-hosting.md")
  expect(file.headers()["content-type"]).toBe("text/markdown; charset=utf-8")
  const text = await file.text()
  expect(text).toMatch(/^# Self-hosting\n/)
  expect(text).toContain("**If you are an agent**")
  expect(text).not.toContain("<html")

  const list = await request.get("/llms.txt")
  expect(list.headers()["content-type"]).toBe("text/plain; charset=utf-8")
  expect(await list.text()).toContain(`- [Self-hosting](${baseURL}/docs/self-hosting.md): `)

  expect((await request.get("/docs/no-such-guide.md")).status()).toBe(404)
  expect((await request.get("/docs/no-such-guide")).status()).toBe(404)
})

test("on a phone the guides fold into a line, and nothing is wider than the screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 780 })
  await page.goto("/docs/self-hosting")
  await expect(page.locator(".dx-side")).toBeHidden()
  await page.locator(".dx-menu summary").click()
  await page.locator(".dx-menu").getByRole("link", { name: "Settings" }).click()
  await expect(page.getByRole("heading", { level: 2, name: "Settings" })).toBeInViewport()
  // Choosing where to go folds the list again.
  await expect(page.locator(".dx-menu")).not.toHaveAttribute("open", "")
  const wider = await page.locator(".dx").evaluate((el) => el.scrollWidth - el.clientWidth)
  expect(wider).toBe(0)
})
