import { expect, test } from "./fixtures.ts"
import { card, inOrder, owner } from "./helpers.ts"

inOrder()

// The deployment takes no passwords: GitHub or Google says who someone is. Neither answers
// here, so these are about what is offered and what is refused, not about signing in.
test.use({
  settings: {
    DC_SIGNUP: "open",
    DC_PASSWORD_SIGNIN: "off",
    GITHUB_CLIENT_ID: "a-client",
    GITHUB_CLIENT_SECRET: "a-secret",
    GOOGLE_CLIENT_ID: "another-client",
    GOOGLE_CLIENT_SECRET: "another-secret",
  },
})

test("the sign-in page offers GitHub and Google and asks for no password", async ({
  page,
  request,
}) => {
  // As the page is sent, before any script: the fields were never there to be taken away.
  const sent = await (await request.get("/login")).text()
  expect(sent).toContain("Continue with GitHub")
  expect(sent).toContain("Continue with Google")
  expect(sent).not.toContain('type="password"')

  await page.goto("/login")
  await expect(page.getByRole("button", { name: "Continue with GitHub" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible()
  await expect(page.getByLabel("Password")).toHaveCount(0)
  await expect(page.getByLabel("Email")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Sign in" })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Create an account" })).toBeVisible()
})

test("the first run asks who someone is with a provider alone", async ({ page }) => {
  await page.goto("/welcome")
  await (
    await card(page, /Is somebody out there\?/)
  )
    .getByRole("button", { name: "Hello!" })
    .click()
  const you = await card(page, /who are you\?/)
  await expect(you.getByRole("button", { name: "Continue with GitHub" })).toBeFocused()
  await expect(you.getByRole("button", { name: "Continue with Google" })).toBeVisible()
  await expect(you.getByLabel("Password")).toHaveCount(0)
  await expect(you.getByLabel("Your name")).toHaveCount(0)
  await expect(you.getByRole("button", { name: "That’s me" })).toHaveCount(0)
  await expect(you.getByRole("button", { name: "I already have an account" })).toHaveCount(0)
})

test("an account is not made with a password, nor signed in to with one", async ({ request }) => {
  const made = await request.post("/api/auth/sign-up/email", { data: owner })
  expect(made.status()).toBe(400)
  const signedIn = await request.post("/api/auth/sign-in/email", {
    data: { email: owner.email, password: owner.password },
  })
  expect(signedIn.status()).toBe(400)
  expect((await request.get("/api/me")).status()).toBe(401)
  expect(await (await request.get("/api/auth-methods")).json()).toMatchObject({
    github: true,
    google: true,
    password: false,
  })
})
