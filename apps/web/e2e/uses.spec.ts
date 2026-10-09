import { type ChildProcess, spawn } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures.ts"
import { asOwner, composer, signIn } from "./helpers.ts"

asOwner()

const ask = async (page: Page, action: Record<string, unknown>) => {
  await composer(page).fill(`/tool screen ${JSON.stringify({ computer: "use-laptop", ...action })}`)
  await page.keyboard.press("Enter")
}

test.describe("an agent using a computer's screen", () => {
  let daemon: ChildProcess | undefined
  test.afterAll(() => void daemon?.kill())

  test("is watched in the chat while it is at it, paused, opened large, stopped, and gone over afterwards", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(90_000)
    const home = mkdtempSync(join(tmpdir(), "dc-uses-"))
    // The real daemon with a pretend screen: it draws a picture and touches nothing.
    daemon = spawn(
      "node",
      [
        fileURLToPath(new URL("../../daemon/dist/daemon.cjs", import.meta.url)),
        baseURL!,
        "--name",
        "use-laptop",
      ],
      {
        env: {
          ...process.env,
          HOME: home,
          DC_DAEMON_DIR: join(home, ".dc"),
          DC_DAEMON_POLL_MS: "200",
          DC_DAEMON_FAKE_SCREEN: "1",
        },
      },
    )
    let output = ""
    daemon.stdout!.on("data", (chunk) => (output += String(chunk)))
    await expect
      .poll(() => /http\S+\/pair\?code=[A-Z0-9-]+/.exec(output)?.[0], { timeout: 10_000 })
      .toBeTruthy()
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page)
    await page.goto(/http\S+\/pair\?code=[A-Z0-9-]+/.exec(output)![0])
    await page.getByRole("button", { name: "Connect this computer" }).click()
    await expect(page.getByRole("heading", { name: "Connected" })).toBeVisible()
    await expect.poll(() => output, { timeout: 15_000 }).toContain("Connected to")

    // In the agent's main chat, where its panel is beside it.
    await page.goto("/")
    await page.getByRole("button", { name: "Show Juniper's panel" }).click()
    await ask(page, { action: "click", x: 200, y: 120, note: "Clicking the button" })

    // The screen stays the agent's for a while after its step, and is shown for as long.
    const view = page.locator('[data-use="screen"]')
    await expect(view).toBeVisible({ timeout: 20_000 })
    await expect(view).toContainText("use-laptop")
    await expect(view).toContainText("the screen")
    await expect(view.locator('img[src^="data:image/"]')).toBeVisible()
    await expect(view.getByRole("status")).toContainText("Clicking the button")

    // The agent's panel says where it is, with the same picture small.
    const now = page.getByRole("region", { name: "On use-laptop now" })
    await expect(now).toContainText("The screen")
    await expect(now.locator("img")).toBeVisible()

    // Paused, it stays the agent's for as long as it is: the rest is looked at with no hurry.
    await view.getByRole("button", { name: "Pause" }).click()
    await expect(view.getByText("Paused")).toBeVisible()

    // The picture in the panel opens the same screen large, with the steps so far beside it.
    await now.getByRole("button", { name: "Open it large" }).click()
    const large = page.getByRole("dialog")
    await expect(large.getByRole("heading", { name: "use-laptop" })).toBeVisible()
    await expect(large.getByRole("list", { name: "Steps so far" })).toContainText(
      "Clicking the button",
    )
    // Once it has finished opening.
    await expect(large).toHaveCSS("opacity", "1")
    // Letting the agent carry on is here too, and is told to the window behind.
    await large.getByRole("button", { name: "Carry on" }).click()
    await expect(large.getByRole("button", { name: "Pause" })).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(view.getByText("Paused")).toBeHidden()

    await view.getByRole("button", { name: "Stop" }).click()
    await expect(view).toBeHidden()
    const word = page.locator('[data-use-ended="screen"]')
    await expect(word).toContainText(/Juniper used use-laptop's screen.* · 1 step/)
    await expect(now).toBeHidden()
    await word.getByRole("button", { name: "What it did" }).click()
    await expect(word.getByText("1 of 1")).toBeVisible()
    const kept = word.locator('img[src*="/shots/"]').first()
    await expect(kept).toBeVisible()
    await expect
      .poll(() => kept.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0)

    // On a phone the window is as wide as the chat, and its steps unfold under it.
    await page.setViewportSize({ width: 390, height: 780 })
    await ask(page, { action: "type", text: "4,820", note: "Typing the total" })
    const second = page.locator('[data-use="screen"]')
    await expect(second).toBeVisible({ timeout: 20_000 })
    await expect(second.getByRole("status")).toContainText("Typing the total")
    await second.getByRole("button", { name: "Open it large" }).last().click()
    await expect(second.getByRole("list", { name: "Steps so far" })).toContainText(
      "Typing the total",
    )
    await expect(page.getByRole("dialog")).toBeHidden()
    // The first use is still word of what was done, above it.
    await expect(page.locator('[data-use-ended="screen"]')).toHaveCount(1)
  })

  test("is one window for the several things of a round, each of them a step to go back over", async ({
    page,
  }) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page)
    await page.goto("/")
    const step = (action: Record<string, unknown>) =>
      `/tool screen ${JSON.stringify({ computer: "use-laptop", ...action })}`
    await composer(page).fill(
      [
        step({ action: "click", x: 120, y: 80, note: "Clicking Mail in the Dock" }),
        step({ action: "type", text: "4,820", note: "Typing 4,820" }),
        step({ action: "click", x: 480, y: 300, note: "Clicking the Shipping cell" }),
      ].join("\n"),
    )
    await page.keyboard.press("Enter")
    // One window for the three, showing the last of them.
    // The window of the use before it folds away once this one begins.
    const view = page.locator('[data-use="screen"]').last()
    await expect(view.getByRole("status")).toContainText("Clicking the Shipping cell", {
      timeout: 20_000,
    })
    await expect(page.locator('[data-use="screen"]')).toHaveCount(1)
    // The agent's pointer is where it last clicked, three quarters of the way across.
    const pointer = view.locator("[data-pointer]")
    await expect(pointer).toHaveCSS("left", /px/)
    expect(await pointer.evaluate((el: HTMLElement) => el.style.left)).toBe("75%")
    expect(await pointer.evaluate((el: HTMLElement) => el.style.top)).toBe("75%")

    await view.getByRole("button", { name: "Stop" }).click()
    const word = page.locator('[data-use-ended="screen"]').last()
    await expect(word).toContainText("3 steps")
    await word.getByRole("button", { name: "What it did" }).click()
    // It opens on the first step, and each of the others is one press away.
    await expect(word.getByText("1 of 3")).toBeVisible()
    await expect(word).toContainText("Clicking Mail in the Dock")
    await word.getByRole("button", { name: "Step 3: Clicking the Shipping cell" }).click()
    await expect(word.getByText("3 of 3")).toBeVisible()
    await word.getByRole("button", { name: "Step 2: Typing 4,820" }).click()
    await expect(word.getByText("2 of 3")).toBeVisible()
  })
})
