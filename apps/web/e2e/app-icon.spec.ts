import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures.ts"
import { asOwner, signIn } from "./helpers.ts"

// In the desktop app the app's own picture, the Dock's on a Mac, is its owner's agent on the
// island it hatched on. The page draws it and hands it to the app: here the app is stood in
// for by what it gives a page, and what the page hands over is looked at.
test.use({ creature: true })

asOwner()

/** What the desktop app gives a page of the deployment, with a note of every picture it is handed. */
const asDesktopApp = (page: Page, platform: string) =>
  page.addInitScript((on) => {
    const handed: (string | null)[] = []
    Object.assign(window, {
      handed,
      doComputer: {
        platform: on,
        computer: "test",
        canOpenAtLogin: false,
        welcomed: true,
        sharing: "on",
        signIn: async () => ({ error: "Not here." }),
        cancelSignIn: async () => {},
        share: async () => ({ connected: true }),
        finish: async () => {},
        setIcon: async (picture: string | null) => {
          handed.push(picture)
        },
      },
    })
  }, platform)

const handed = (page: Page) =>
  page.evaluate(() => (window as unknown as { handed: (string | null)[] }).handed)

/** A picture's side, and whether its corner and its middle are see-through. */
const shapeOf = (page: Page, picture: string) =>
  page.evaluate(async (address) => {
    const image = new Image()
    image.src = address
    await image.decode()
    const canvas = document.createElement("canvas")
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext("2d")!
    context.drawImage(image, 0, 0)
    const alpha = (x: number, y: number) => context.getImageData(x, y, 1, 1).data[3]
    return {
      width: image.width,
      height: image.height,
      corner: alpha(2, 2),
      middle: alpha(image.width / 2, image.height / 2),
    }
  }, picture)

/** The picture the app was last handed, once it has been handed one. */
async function shown(page: Page): Promise<string> {
  await expect
    .poll(async () => (await handed(page)).at(-1) ?? null, { timeout: 20_000 })
    .not.toBeNull()
  return (await handed(page)).at(-1)!
}

test("the app's picture is an egg until an agent is met, the agent after, and the usual one signed out", async ({
  page,
}) => {
  await asDesktopApp(page, "darwin")
  // Nobody is signed in, and nobody has been met: an egg on the island, in a Mac's shape.
  await page.goto("/welcome")
  const egg = await shown(page)
  expect(egg).toMatch(/^data:image\/png;base64,/)
  expect(await shapeOf(page, egg)).toEqual({ width: 1024, height: 1024, corner: 0, middle: 255 })

  // The agent whose chat opens.
  await signIn(page)
  const agent = await shown(page)
  expect(agent).toMatch(/^data:image\/png;base64,/)
  expect(agent).not.toBe(egg)
  expect(await shapeOf(page, agent)).toEqual({ width: 1024, height: 1024, corner: 0, middle: 255 })

  // The sign-in page is nobody's: the usual picture.
  await page.goto("/login")
  await expect.poll(() => handed(page)).toEqual([null])
})

test("elsewhere than on a Mac the picture fills its square", async ({ page }) => {
  await asDesktopApp(page, "win32")
  await signIn(page)
  const picture = await shown(page)
  // Its corners are rounded off, and it has no room around it.
  const shape = await shapeOf(page, picture)
  expect(shape).toEqual({ width: 512, height: 512, corner: 0, middle: 255 })
})
