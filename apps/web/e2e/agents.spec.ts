import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures.ts"
import {
  asOwner,
  closeSettings,
  composer,
  openSettings,
  signIn,
  tab,
  fromNameMenu,
} from "./helpers.ts"

// These are about the creature, so here it is drawn live. The first of them names the agent.
asOwner({ agent: null })
test.use({ creature: true })

test("identity edits are saved and show up across the app", async ({ page }) => {
  await signIn(page)
  // The tab's icon is the agent's creature, as it looks now.
  const icon = page.locator('link[rel="icon"]')
  await expect(icon).toHaveAttribute("href", /^data:image\//)
  const before = await icon.getAttribute("href")
  await openSettings(page, "Profile")
  await page.getByLabel("Name").fill("Juniper")
  await page.getByLabel("Tagline").fill("Calm and curious")
  // Its color is a choice; what it looks like is a roll of the dice.
  await page.getByRole("button", { name: "Tide" }).click()
  await page.getByRole("button", { name: "Roll a new look" }).click()
  // What it is told about who it works for is kept with what it remembers, in the same form.
  await openSettings(page, "Memory")
  await page.locator("#user").fill("Prefers short answers")
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByText("Saved", { exact: true })).toBeVisible()
  await expect.poll(() => icon.getAttribute("href")).not.toBe(before)
  await expect(icon).toHaveAttribute("href", /^data:image\//)

  await closeSettings(page)
  await expect(page.getByText("Juniper").first()).toBeVisible()
  await expect(composer(page)).toHaveAttribute("placeholder", "Message Juniper")

  await page.reload()
  await openSettings(page, "Profile")
  await expect(page.getByLabel("Name")).toHaveValue("Juniper")
  await expect(page.locator("#user")).toHaveValue("Prefers short answers")
  await expect(page.getByRole("button", { name: "Tide" })).toHaveAttribute("aria-pressed", "true")
  const agentId = page.url().match(/\/a\/([^/]+)/)![1]!
  const saved = (await (await page.request.get(`/api/agents/${agentId}`)).json()) as {
    agent: { avatar: { color: string; seed?: string }; hatched: boolean }
  }
  expect(saved.agent.avatar.color).toBe("tide")
  expect(saved.agent.avatar.seed).toMatch(/^.{6,}$/)
  // It has a name now, so it is out of its egg whether or not anyone watched.
  expect(saved.agent.hatched).toBe(true)
})

test("a new agent is met as an egg, and hatches once", async ({ page }) => {
  await signIn(page)
  const first = page.url().match(/\/a\/([^/]+)/)![1]!
  await page.getByRole("button", { name: "New Dood", exact: true }).click()
  await expect(page).not.toHaveURL(new RegExp(`/a/${first}`))
  await page.waitForURL(/\/a\/[^/]+\/c\/\d+/)
  const agentId = page.url().match(/\/a\/([^/]+)/)![1]!
  const hatched = async () =>
    (
      (await (await page.request.get(`/api/agents/${agentId}`)).json()) as {
        agent: { hatched: boolean }
      }
    ).agent.hatched

  // It starts in its egg, wherever it is shown, and the wait can be skipped.
  expect(await hatched()).toBe(false)
  const welcome = page.getByRole("log").getByRole("img", { name: "Dood avatar" })
  await expect(welcome).toHaveAttribute("data-mood", "egg")
  await expect(page.getByRole("button", { name: "Skip the hatching" })).toBeVisible()

  // Then it is out, here and for good: a reload does not put it back.
  await expect.poll(hatched, { timeout: 15_000 }).toBe(true)
  await expect(page.getByRole("button", { name: "Skip the hatching" })).toHaveCount(0)
  await expect(welcome).toHaveAttribute("data-mood", "idle")
  await page.reload()
  await expect(welcome).toHaveAttribute("data-mood", "idle")
  await expect(page.getByRole("button", { name: "Skip the hatching" })).toHaveCount(0)
  await page.request.delete(`/api/agents/${agentId}`)
})

test("the creature in the agent's panel can be petted", async ({ page }) => {
  await signIn(page)
  await fromNameMenu(page, /^Show .+'s panel$/)
  // One that is still hatching is busy with that.
  await expect(page.getByRole("button", { name: "Skip the hatching" })).toHaveCount(0, {
    timeout: 15_000,
  })
  const creature = page
    .getByRole("complementary", { name: /^About/ })
    .getByRole("img", { name: "Dood avatar" })
  const hearts = creature.locator(".pet-heart")
  const box = (await creature.boundingBox())!
  const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

  // The pointer passing over it on its way elsewhere is not petting.
  await page.mouse.move(middle.x - box.width * 0.6, middle.y)
  await page.mouse.move(middle.x + box.width * 0.6, middle.y, { steps: 12 })
  await expect(hearts).toHaveCount(0)

  // Rubbing it is, and so is a click. The hearts are gone again a moment later.
  await page.waitForTimeout(600)
  for (const side of [-1, 1, -1, 1]) {
    await page.mouse.move(middle.x + side * box.width * 0.3, middle.y, { steps: 10 })
  }
  await expect(hearts).not.toHaveCount(0)
  await expect(hearts).toHaveCount(0)
  await page.mouse.click(middle.x, middle.y)
  await expect(hearts).toHaveCount(1)
})

test("the app opens on the agent that was open last", async ({ page }) => {
  await signIn(page)
  const first = page.url()
  await page.getByRole("button", { name: "New Dood", exact: true }).click()
  await page.waitForURL((url) => /\/c\/\d+$/.test(url.pathname) && url.href !== first)
  const second = page.url()
  const id = second.match(/\/a\/([^/]+)/)![1]!
  // A new agent's page opens before the agent has answered, and it is kept as the one to come
  // back to once it has.
  await expect.poll(() => page.evaluate(() => localStorage.getItem("dc-last-agent"))).toBe(id)

  // Coming to the app by its own address, as starting it does, and not by an agent's.
  await page.goto("/")
  await page.waitForURL(second)
  await expect(composer(page)).toBeVisible()
  // The first agent is opened, and is then the one that is come back to.
  await page.goto(first)
  await expect(composer(page)).toHaveAttribute("placeholder", "Message Juniper")
  await page.goto("/")
  await page.waitForURL(first)

  // An agent that is gone is not come back to: the app opens on the first one there is.
  await page.goto(second)
  await expect(composer(page)).toBeVisible()
  expect((await page.request.delete(`/api/agents/${id}`)).ok()).toBe(true)
  await page.goto("/")
  await page.waitForURL(first)
})

test("a creature that could not be drawn as the page opened is drawn once it can be", async ({
  page,
}) => {
  // There is no WebGL to be had as the page opens: a graphics card that is busy, or gone a moment.
  await page.addInitScript(() => {
    const real = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      kind: string,
      ...rest: unknown[]
    ) {
      if (kind !== "2d" && !("webglIsBack" in window)) return null
      return (real as (...args: unknown[]) => unknown).call(this, kind, ...rest)
    } as typeof real
  })
  await signIn(page)
  const creature = page.getByRole("img", { name: "Dood avatar" }).first()
  // A still picture stands in for it.
  await expect(creature.locator("img")).toHaveCount(1)
  await expect(creature.locator("canvas")).toBeHidden()

  // Then there is, and the page is come back to. Nobody loaded it again.
  await page.evaluate(() => {
    Object.assign(window, { webglIsBack: true })
    window.dispatchEvent(new Event("focus"))
  })
  await expect(creature.locator("canvas")).toBeVisible()
  await expect(creature.locator("img")).toHaveCount(0)
})

test("a second agent can be made, and deleted without touching the first", async ({ page }) => {
  await signIn(page)
  const first = page.url().match(/\/a\/([^/]+)/)![1]!
  await page.getByRole("button", { name: "New Dood", exact: true }).click()
  await expect(page).not.toHaveURL(new RegExp(`/a/${first}`))
  const second = page.url().match(/\/a\/([^/]+)/)![1]!
  await expect(page.getByText("It has no name yet")).toBeVisible()

  await openSettings(page, "Profile")
  await page.getByRole("button", { name: "Delete Dood…" }).click()
  const confirm = page.getByRole("button", { name: "Delete for good" })
  await expect(confirm).toBeDisabled()
  // It has no name yet, so the word to type is "delete".
  await page.getByLabel(/to confirm/).fill("delete")
  await confirm.click()

  // Back on the first agent, which is as it was.
  await expect(page).toHaveURL(new RegExp(`/a/${first}/c/\\d+`))
  await expect(page.getByText("Juniper").first()).toBeVisible()
  const gone = await page.request.get(`/api/agents/${second}`)
  expect(gone.status()).toBe(404)
  const agents = (await (await page.request.get("/api/agents")).json()) as { agents: unknown[] }
  expect(agents.agents.length).toBe(1)
})

/** How much of each creature on the page is drawn: the pixels of its picture that are not clear. */
const drawn = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLCanvasElement>('[aria-label="Dood avatar"] canvas')].map(
      (canvas) => {
        const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height)
        return pixels.data.filter((value, at) => at % 4 === 3 && value > 0).length
      },
    ),
  )

test("a still picture of a creature is drawn though its page opened out of sight", async ({
  page,
}) => {
  // A window that is not showing, as the desktop app's is while it is closed, and a tab opened
  // behind another: nothing moves there, and a picture that waited to be moved stayed a blank.
  await page.addInitScript(() => {
    const shown = () => "shown" in window
    Object.defineProperty(document, "hidden", { get: () => !shown() })
    Object.defineProperty(document, "visibilityState", {
      get: () => (shown() ? "visible" : "hidden"),
    })
  })
  await signIn(page)
  await expect(composer(page)).toBeVisible()
  // Some move and some are still: the one above the chat is a still.
  expect((await drawn(page)).length).toBeGreaterThan(2)
  // Longer than a still is given to take up its pose.
  await page.waitForTimeout(600)
  await page.evaluate(() => {
    Object.assign(window, { shown: true })
    document.dispatchEvent(new Event("visibilitychange"))
  })
  await expect.poll(() => drawn(page)).not.toContain(0)
})

/**
 * Keep every context a page asks its graphics card for, in `window.made`. Returns what says how
 * many there have been.
 */
async function keepContexts(page: Page) {
  await page.addInitScript(() => {
    const made: WebGLRenderingContext[] = []
    Object.assign(window, { made })
    const real = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      kind: string,
      ...rest: unknown[]
    ) {
      const context = (real as (...args: unknown[]) => unknown).call(this, kind, ...rest)
      if (kind !== "2d" && context !== null && !made.includes(context as WebGLRenderingContext)) {
        made.push(context as WebGLRenderingContext)
      }
      return context
    } as typeof real
  })
  return () =>
    page.evaluate(() => (window as unknown as { made: WebGLRenderingContext[] }).made.length)
}

test("going from one agent to another draws their creatures with the context that was there", async ({
  page,
}) => {
  // Every creature on the page goes and others come. The context used to go with them, while
  // the canvases still held what they had copied from it, and a new one was made for the next
  // page. On a Mac that lost the browser its graphics card's process now and then.
  const made = await keepContexts(page)
  await signIn(page)
  const created = await page.request.post("/api/agents")
  const second = ((await created.json()) as { agent: { id: string } }).agent.id
  await page.reload()
  await expect(composer(page)).toBeVisible()
  const agents = page.getByRole("navigation", { name: "Doods" })
  await agents.locator(`a[href="/a/${second}"]`).click()
  await expect(page).toHaveURL(new RegExp(`/a/${second}/c/\\d+`))
  // On a narrow screen the sidebar is out of sight, and no creature stays on the page from one
  // agent to the next.
  await page.setViewportSize({ width: 400, height: 800 })
  await expect(agents).toHaveCount(0)
  await expect.poll(() => drawn(page)).not.toContain(0)
  expect(await made()).toBe(1)

  for (let move = 0; move < 6; move++) {
    if (move % 2 === 0) await page.goBack()
    else await page.goForward()
    await page.waitForTimeout(150)
  }
  await expect.poll(() => drawn(page)).not.toContain(0)
  expect(await made()).toBe(1)

  expect((await page.request.delete(`/api/agents/${second}`)).ok()).toBe(true)
})

test("creatures keep their picture when the graphics card goes away, and move again by another", async ({
  page,
}) => {
  const made = await keepContexts(page)
  await signIn(page)
  await expect(composer(page)).toBeVisible()
  await expect.poll(() => drawn(page)).not.toContain(0)

  // Taken away, and not given back.
  const before = await made()
  await page.evaluate(() => {
    for (const context of (window as unknown as { made: WebGLRenderingContext[] }).made) {
      context.getExtension("WEBGL_lose_context")?.loseContext()
    }
  })
  // Frames go by with nothing to draw from. What was drawn is still there.
  await page.waitForTimeout(500)
  expect(await drawn(page)).not.toContain(0)
  // After a while another is asked for, and they are drawn from that.
  await expect.poll(made, { timeout: 15_000 }).toBeGreaterThan(before)
  await page.waitForTimeout(300)
  expect(await drawn(page)).not.toContain(0)
})

test("creatures are drawn again after the graphics card's process dies", async ({
  page,
  browser,
}) => {
  await page.addInitScript(() => {
    const lost = { times: 0 }
    Object.assign(window, { lost })
    const real = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      kind: string,
      ...rest: unknown[]
    ) {
      const context = (real as (...args: unknown[]) => unknown).call(this, kind, ...rest)
      if (kind !== "2d" && context !== null && !("watched" in this)) {
        Object.assign(this, { watched: true })
        this.addEventListener("webglcontextlost", () => lost.times++)
      }
      return context
    } as typeof real
  })
  await signIn(page)
  await expect(composer(page)).toBeVisible()
  await expect.poll(() => drawn(page)).not.toContain(0)
  // Long enough for the stills among them to have been held.
  await page.waitForTimeout(600)

  // The process that draws for the whole browser is killed, as a graphics card that is reset
  // takes it down. The browser starts another and gives every canvas back, clear.
  const session = await browser.newBrowserCDPSession()
  const { processInfo } = await session.send("SystemInfo.getProcessInfo")
  const graphics = processInfo.filter((entry) => entry.type === "GPU")
  expect(graphics).toHaveLength(1)
  process.kill(graphics[0]!.id, "SIGKILL")
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { lost: { times: number } }).lost.times))
    .toBeGreaterThan(0)

  // Those that move and those that are held are all drawn again, and stay drawn.
  await expect.poll(() => drawn(page), { timeout: 15_000 }).not.toContain(0)
  await page.waitForTimeout(1_500)
  expect(await drawn(page)).not.toContain(0)
})
