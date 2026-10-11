import { expect, test } from "./fixtures.ts"
import { inOrder, owner, signIn, signUp } from "./helpers.ts"

inOrder()

// The deployment has a landing page, and sign-up by invitation: open to the first person to
// arrive, who is its owner, and to nobody new after.
test.use({ settings: { DC_LANDING: "1" } })

test("a stranger is shown the landing page, sent whole, with the way in", async ({
  page,
  request,
}) => {
  // The page is there before any script is: it is what a search engine and a slow phone get.
  const sent = await (await request.get("/")).text()
  expect(sent).toContain("personal assistant.")
  expect(sent).toContain("Get started")

  await page.goto("/")
  await expect(page).toHaveURL(/\/$/)
  await expect(
    page.getByRole("heading", { level: 1, name: "Your open source personal assistant." }),
  ).toBeVisible()
  // Eight to choose from, and choosing one makes it the large one.
  await expect(page.locator("button[aria-pressed]")).toHaveCount(8)
  await page.getByRole("button", { name: "Biscuit: The builder" }).click()
  await expect(page.getByText("Biscuit, the builder.")).toBeVisible()
  await expect(page.getByText("The checkout test is failing again.")).toBeVisible()
  await expect(page.getByRole("button", { name: "Biscuit: The builder" })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  // The app is shown, a page of it at a time.
  await page.getByRole("tab", { name: "Library" }).click()
  await expect(page.getByRole("img", { name: "Do Computer: Library" })).toBeVisible()
  // What it does is shown as pictures of the app: below the eight and the large one there is
  // one creature more, the one that is dressed.
  await expect(page.getByRole("heading", { name: "A computer of its own" })).toBeVisible()
  await expect(page.locator(".lp-pick [data-mood]")).toHaveCount(9)
  await expect(page.locator(".lp [data-mood]")).toHaveCount(10)

  await page.getByRole("link", { name: "Get started" }).first().click()
  await expect(page).toHaveURL(/\/welcome$/)
})

test("someone signed in is taken to their agent, as before", async ({ page }) => {
  await signUp(page)
  await expect(page).toHaveURL(/\/a\/[^/]+\/c\/\d+/)
  await page.goto("/")
  await expect(page).toHaveURL(/\/a\/[^/]+\/c\/\d+/)
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(0)
})

test("once nobody new can sign up, it says coming soon, with one small way in", async ({
  page,
  request,
}) => {
  const sent = await (await request.get("/")).text()
  expect(sent).toContain("Coming soon")
  expect(sent).not.toContain("Get started")

  await page.goto("/")
  // Said as large as the button it stands in for, not as the small print beside one.
  await expect(page.locator(".lp-pitch").getByText("Coming soon")).toHaveCSS("height", "46px")
  await expect(page.getByRole("link", { name: "Get started" })).toHaveCount(0)
  await expect(page.locator('a[href="/welcome"], a[href="/signup"]')).toHaveCount(0)

  // The one way in is for whoever has an account, and the page it leads to offers no other.
  await page
    .getByText("Already have access?")
    .first()
    .getByRole("link", { name: "Sign in" })
    .click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByText("Do Computer is not open to everyone yet.")).toBeVisible()
  await expect(page.getByRole("link", { name: "Create an account" })).toBeHidden()
  await page.getByLabel("Email").fill(owner.email)
  await page.getByLabel("Password").fill(owner.password)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForURL(/\/a\/[^/]+\/c\/\d+/)
})

test("someone sent to sign in by a page that wants them back may still be new", async ({
  page,
}) => {
  await page.goto("/login?next=%2Finvite%2Fabc")
  await expect(page.getByRole("link", { name: "Create an account" })).toBeVisible()
  await expect(page.getByText("Do Computer is not open to everyone yet.")).toHaveCount(0)
})

test("signing out leads back to signing in, and the address to the landing page", async ({
  page,
}) => {
  await signIn(page)
  await page.getByRole("button", { name: /settings and signing out$/ }).click()
  await page.getByRole("menuitem", { name: "Sign out" }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.goto("/")
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByText("Coming soon").first()).toBeVisible()
})
