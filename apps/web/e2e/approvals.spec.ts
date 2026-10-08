import { expect, test } from "./fixtures.ts"
import { asOwner, composer, newChat, openSettings, signIn, tool } from "./helpers.ts"

asOwner()

test("an agent told to ask first waits for an answer before it acts", async ({ page }) => {
  await signIn(page)
  await openSettings(page, "Permissions")
  const commands = page.getByRole("group", { name: "Run commands" })
  await expect(commands.getByRole("button", { name: "Allow", pressed: true })).toBeVisible()
  await commands.getByRole("button", { name: "Ask first" }).click()
  await expect(commands.getByRole("button", { name: "Ask first", pressed: true })).toBeVisible()
  await page.reload()
  await expect(commands.getByRole("button", { name: "Ask first", pressed: true })).toBeVisible()

  await newChat(page)
  const transcript = page.getByRole("log")
  const waiting = page.getByRole("list", { name: "Waiting for your OK" })
  const run = '/tool bash {"command":"echo ran-with-permission"}'
  await composer(page).fill(run)
  await composer(page).press("Enter")
  // The command did not run; the request says exactly what would.
  await expect(waiting.getByText("Juniper wants to: Run commands")).toBeVisible()
  await expect(waiting.getByText("echo ran-with-permission")).toBeVisible()
  await expect(transcript.getByText("ran-with-permission", { exact: true })).toHaveCount(0)

  await waiting.getByRole("button", { name: "Allow once" }).click()
  await expect(waiting).toHaveCount(0)
  await expect(
    transcript.getByText("Approved: Run commands: echo ran-with-permission", { exact: true }),
  ).toBeVisible()
  // The echo model does not act on being told; a real one would. Its next attempt is let through.
  await expect(composer(page)).toBeEnabled()
  await composer(page).fill(run)
  await composer(page).press("Enter")
  await expect(transcript.getByText("ran-with-permission", { exact: true }).first()).toBeVisible()

  // Once was once. This time the answer is no.
  await composer(page).fill('/tool bash {"command":"echo second-try"}')
  await composer(page).press("Enter")
  await waiting.getByRole("button", { name: "Don’t allow" }).click()
  await expect(
    transcript.getByText("Not allowed: Run commands: echo second-try", { exact: true }),
  ).toBeVisible()
  await expect(waiting).toHaveCount(0)

  // Back to trusting it, as the other tests expect.
  await openSettings(page, "Permissions")
  await commands.getByRole("button", { name: "Allow" }).click()
  await expect(commands.getByRole("button", { name: "Allow", pressed: true })).toBeVisible()
})

test("a reply that fails is said plainly, with the provider's answer behind Details", async ({
  page,
}) => {
  test.setTimeout(60_000)
  await signIn(page)
  await newChat(page)
  await composer(page).fill(
    '/fail 503: {"message":"Provider returned error","code":503,"metadata":{"raw":"{\\"error\\":{\\"code\\":\\"service_overloaded\\",\\"message\\":\\"The backend is temporarily overloaded. Please retry.\\"}}","provider_name":"Meta","retry_after_seconds":60}}',
  )
  await composer(page).press("Enter")
  // A failure like this one is tried again a few times first, and none of that is shown.
  const failure = page.getByRole("alert").filter({ hasText: "The model is overloaded right now." })
  await expect(failure).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole("alert")).toHaveCount(1)
  await expect(failure).toContainText("Tried 4 times.")
  await expect(failure).not.toContainText("Provider returned error")

  await failure.getByRole("button", { name: "Details" }).click()
  await expect(failure).toContainText("Provider returned error")
  await expect(failure).toContainText("retry after 60s")

  // Trying again asks again, and the echo model answers this time.
  await failure.getByRole("button", { name: "Try again" }).click()
  await expect(page.getByText("You said: Try again")).toBeVisible()
  await expect(failure.getByRole("button", { name: "Try again" })).toHaveCount(0)
})
