import { expect, test } from "./fixtures.ts"
import { asOwner, composer, newChat, signIn } from "./helpers.ts"

asOwner()

test("a large screenshot is scaled in the browser to what a model is shown before it is sent", async ({
  page,
}) => {
  // The page is told the agent's model looks at pictures, as one from OpenRouter would; the
  // built-in echo model does not, and the server leaves them out for it, which is beside the point.
  await page.route(/\/api\/models(\?|$)/, async (route) => {
    const listed = (await (await route.fetch()).json()) as { models: Record<string, unknown>[] }
    await route.fulfill({
      json: { ...listed, models: listed.models.map((model) => ({ ...model, images: true })) },
    })
  })
  await signIn(page)
  await newChat(page)
  await composer(page).fill("What is on this screen?")

  // A retina screenshot, 2880 by 1800 and megabytes as a PNG: noise under bands of "text",
  // which a PNG cannot squeeze, as a rendered scene or a photo.
  const pasted = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(2880, 1800)
    const context = canvas.getContext("2d")!
    const image = context.createImageData(2880, 1800)
    for (let index = 0; index < image.data.length; index += 4) {
      const y = Math.floor(index / 4 / 2880)
      const text = y % 24 < 4
      image.data[index] = text ? 30 : 180 + Math.random() * 40
      image.data[index + 1] = text ? 30 : 170 + Math.random() * 40
      image.data[index + 2] = text ? 40 : 160 + Math.random() * 40
      image.data[index + 3] = 255
    }
    context.putImageData(image, 0, 0)
    const blob = await canvas.convertToBlob({ type: "image/png" })
    const data = new DataTransfer()
    data.items.add(new File([blob], "retina.png", { type: "image/png" }))
    document
      .querySelector('textarea[aria-label="Message"]')!
      .dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
      )
    return blob.size
  })
  expect(pasted).toBeGreaterThan(5_000_000)
  const attached = page.getByRole("list", { name: "Attached files" })
  // What is shown is the copy for the agent, already scaled; the original goes to the library.
  await expect(attached.getByRole("img", { name: "retina.png" })).toHaveJSProperty(
    "naturalWidth",
    1356,
  )
  await expect(attached.getByRole("note")).toHaveCount(0)
  await page.screenshot({ path: "test-results/pictures-pasted.png" })

  // What goes with the message is no larger than a model is shown: a longest edge of 1568 and
  // 1.15 megapixels, which here is 1356 by 847, as a JPEG.
  const sent = page.waitForRequest(
    (request) => request.method() === "POST" && /\/messages$/.test(new URL(request.url()).pathname),
  )
  await composer(page).press("Enter")
  const body = (await sent).postDataJSON() as { images?: { mimeType: string; data: string }[] }
  expect(body.images).toHaveLength(1)
  const picture = body.images![0]!
  const drawn = await page.evaluate(async ({ mimeType, data }) => {
    const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType }))
    return { width: bitmap.width, height: bitmap.height, bytes: bytes.length }
  }, picture)
  expect(picture.mimeType).toBe("image/jpeg")
  expect(drawn).toMatchObject({ width: 1356, height: 847 })
  expect(drawn.bytes).toBeLessThan(pasted / 10)
  console.log(`pasted ${pasted} bytes as a 2880x1800 PNG; sent ${JSON.stringify(drawn)}`)
  await expect(
    page
      .getByRole("log")
      .getByText(/Attached: retina\.png/)
      .first(),
  ).toBeVisible()
  await expect(page.getByRole("log").getByText("Sending")).toHaveCount(0)
  await page.screenshot({ path: "test-results/pictures-sent.png" })
})
