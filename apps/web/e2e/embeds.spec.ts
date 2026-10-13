import { readFileSync } from "node:fs"
import { expect, type Page } from "@playwright/test"
import { test } from "./fixtures.ts"
import { asOwner, composer, newChat, signIn, tab, tool } from "./helpers.ts"

asOwner()

/** Four seconds of a test card, small enough to keep with the tests. */
const CLIP = readFileSync(new URL("./media/clip.webm", import.meta.url))

/** A second of quiet, as a WAV file. */
const SOUND = (() => {
  const samples = 8000
  const wav = Buffer.alloc(44 + samples)
  wav.write("RIFF", 0)
  wav.writeUInt32LE(36 + samples, 4)
  wav.write("WAVEfmt ", 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(8000, 24)
  wav.writeUInt32LE(8000, 28)
  wav.writeUInt16LE(1, 32)
  wav.writeUInt16LE(8, 34)
  wav.write("data", 36)
  wav.writeUInt32LE(samples, 40)
  wav.fill(128, 44)
  return wav
})()

const ROWS = 'Region,Signups,Note\nNorth,"1,204","grew ""fast"""\nSouth,987,steady\n'

/** Have the agent answer with `markdown`: the model here repeats what it is told. */
async function reply(page: Page, markdown: string) {
  await composer(page).fill(`as follows\n\n${markdown}`)
  await composer(page).press("Enter")
  const answer = page.getByRole("log").locator("[data-markdown]").last()
  await expect(answer).toContainText("echo model")
  return answer
}

test("a film, a sound and a table of the library are shown where a reply names them", async ({
  page,
}) => {
  await signIn(page)
  await tab(page, "Library").click()
  await page.getByLabel("Choose a file to upload").setInputFiles([
    { name: "clip.webm", mimeType: "video/webm", buffer: CLIP },
    { name: "chime.wav", mimeType: "audio/wav", buffer: SOUND },
    { name: "signups.csv", mimeType: "text/csv", buffer: Buffer.from(ROWS) },
  ])
  const files = page.getByRole("navigation", { name: "Files" })
  for (const name of ["clip.webm", "chime.wav", "signups.csv"]) {
    await expect(files.getByRole("link", { name })).toBeVisible()
  }
  await tab(page, "Chat").click()
  await newChat(page)

  // Each part of the film that is asked for is noted, with how it was answered.
  const parts: { range: string | undefined; status: number }[] = []
  page.on("response", (response) => {
    if (!response.url().includes("/clip.webm")) return
    parts.push({ range: response.request().headers().range, status: response.status() })
  })
  const answer = await reply(
    page,
    "![The demo](clip.webm)\n\n![The chime](chime.wav)\n\n![The numbers](signups.csv)",
  )

  // The film has a player, which knows how long it is without having been played.
  const film = answer.locator("video")
  await expect(film).toHaveAttribute("aria-label", "clip.webm")
  await expect
    .poll(() => film.evaluate((video: HTMLVideoElement) => video.duration))
    .toBeCloseTo(4, 0)
  // It is moved about in, which is what being sent in parts is for.
  const moved = await film.evaluate(
    (video: HTMLVideoElement) =>
      new Promise<number>((resolve) => {
        video.addEventListener("seeked", () => resolve(video.currentTime), { once: true })
        video.currentTime = 3
      }),
  )
  expect(moved).toBeCloseTo(3, 1)
  expect(parts.length).toBeGreaterThan(0)
  expect(parts.every((part) => part.status === 206 && part.range !== undefined)).toBe(true)

  const sound = answer.locator("audio")
  await expect(sound).toHaveAttribute("aria-label", "chime.wav")
  await expect
    .poll(() => sound.evaluate((audio: HTMLAudioElement) => audio.duration))
    .toBeCloseTo(1, 1)

  const table = answer.getByRole("table", { name: "signups.csv" })
  await expect(table.getByRole("columnheader", { name: "Signups" })).toBeVisible()
  await expect(table.getByRole("cell", { name: "1,204" })).toHaveCSS("text-align", "right")
  await expect(table.getByRole("cell", { name: 'grew "fast"' })).toBeVisible()
  await page.screenshot({ path: "test-results/embeds-in-a-reply.png" })
})

test("a file the agent sends is the thing itself, with its card under it", async ({ page }) => {
  await signIn(page)
  await newChat(page)
  await tool(
    page,
    "bash",
    { command: "printf 'Day,Visits\\nMon,120\\nTue,98\\n' > visits.csv && echo made" },
    /^made$/,
  )
  await tool(page, "send_file", { path: "visits.csv" }, /Sent visits\.csv/)
  const log = page.getByRole("log")
  const table = log.getByRole("table", { name: "visits.csv" })
  await expect(table.getByRole("cell", { name: "120" })).toBeVisible()
  // The card is still there: its name, and the ways to open and take it.
  await expect(log.getByRole("link", { name: "Download visits.csv" })).toBeVisible()
})

test("the library shows a film, a table and a PDF as what they are", async ({ page }) => {
  await signIn(page)
  await tab(page, "Library").click()
  await page
    .getByLabel("Choose a file to upload")
    .setInputFiles([
      { name: "paper.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") },
    ])
  const files = page.getByRole("navigation", { name: "Files" })

  await files.getByRole("link", { name: "clip.webm" }).click()
  const film = page.locator("video")
  await expect(film).toHaveAttribute("aria-label", "clip.webm")
  await expect
    .poll(() => film.evaluate((video: HTMLVideoElement) => video.duration))
    .toBeCloseTo(4, 0)

  // A table is read as a table, and still written as the text it is.
  await files.getByRole("link", { name: "signups.csv" }).click()
  await expect(page.getByRole("table", { name: "signups.csv" })).toBeVisible()
  await page.getByRole("button", { name: "Source" }).click()
  await expect(page.getByRole("textbox", { name: "Edit signups.csv" })).toHaveValue(ROWS)

  // A PDF is given to the browser's own reader, which the library serves it to as a PDF.
  await files.getByRole("link", { name: "paper.pdf" }).click()
  const reader = page.locator('iframe[title="paper.pdf"]')
  await expect(reader).toHaveAttribute("src", /\/paper\.pdf\?v=\d+#toolbar=0/)
  const served = await page.request.get((await reader.getAttribute("src"))!.split("#")[0]!)
  expect(served.headers()["content-type"]).toBe("application/pdf")
  expect(served.headers()["content-security-policy"]).toBeUndefined()
})

test("what is at another site is not asked for until the reader says so", async ({ page }) => {
  // A site of pictures, standing in for anywhere on the web, which notes what it is asked.
  const asked: string[] = []
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGNgSJn+H4QZYIz/KdP/AwBPaAl/8Kk5fgAAAABJRU5ErkJggg==",
    "base64",
  )
  await page.route("https://pictures.example/**", (route) => {
    asked.push(new URL(route.request().url()).pathname)
    return route.fulfill({ contentType: "image/png", body: PNG })
  })
  await signIn(page)
  await newChat(page)
  const answer = await reply(page, "![A cat](https://pictures.example/cat.png?who=reader)")
  // It says where the picture is from, and has not asked there.
  await expect(answer.getByText("pictures.example").first()).toBeVisible()
  await expect(answer.getByRole("img")).toHaveCount(0)
  expect(asked).toEqual([])

  await answer.getByRole("button", { name: "Show", exact: true }).click()
  await expect(answer.getByRole("img", { name: "A cat" })).toBeVisible()
  await expect.poll(() => [...new Set(asked)]).toEqual(["/cat.png"])
  // The site was not told which page asked.
  await expect(answer.getByRole("img", { name: "A cat" })).toHaveAttribute(
    "referrerpolicy",
    "no-referrer",
  )

  // Another from the same site asks again, until the site is said yes to for good.
  const second = await reply(page, "![A dog](https://pictures.example/dog.png)")
  await expect(second.getByRole("img")).toHaveCount(0)
  await second.getByRole("button", { name: "Always from pictures.example" }).click()
  await expect(second.getByRole("img", { name: "A dog" })).toBeVisible()
  const third = await reply(page, "![A bird](https://pictures.example/bird.png)")
  await expect(third.getByRole("img", { name: "A bird" })).toBeVisible()
  // Each was asked for only once it could be, in that order: one may be asked for again as
  // its reply settles, and a picture is asked for a moment after it is on the page.
  await expect.poll(() => [...new Set(asked)]).toEqual(["/cat.png", "/dog.png", "/bird.png"])
})
