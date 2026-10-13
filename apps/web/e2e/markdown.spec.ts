import { expect, type Page } from "@playwright/test"
import { test } from "./fixtures.ts"
import { asOwner, composer, newChat, signIn, tab } from "./helpers.ts"

asOwner()

/**
 * Have the agent answer with `markdown`. The model here repeats what it is told after a few
 * words of its own, so the Markdown is sent under a first line that those words can share.
 */
async function reply(page: Page, markdown: string) {
  await composer(page).fill(`as follows\n\n${markdown}`)
  await composer(page).press("Enter")
  const answer = page.getByRole("log").locator("[data-markdown]").last()
  await expect(answer).toContainText("echo model")
  return answer
}

const TABLE = [
  "| Region | Signups | Note |",
  "| :-- | --: | :-- |",
  '| North | 1,204 | grew "fast", twice |',
  "| South | 987 | steady |",
].join("\n")

test("a table in a reply is drawn as one, and is copied for a spreadsheet", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  await signIn(page)
  await newChat(page)
  const answer = await reply(page, TABLE)
  const table = answer.getByRole("table")
  await expect(table.getByRole("columnheader", { name: "Signups" })).toBeVisible()
  await expect(table.getByRole("cell", { name: "1,204" })).toHaveCSS("text-align", "right")

  // Its buttons are there for whoever points at it.
  await table.hover()
  await answer.getByRole("button", { name: "Copy table" }).click()
  await page.getByRole("menuitem", { name: "Copy as CSV" }).click()
  await expect(answer.getByRole("button", { name: "Copied" })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'Region,Signups,Note\nNorth,"1,204","grew ""fast"", twice"\nSouth,987,steady',
  )
  await table.hover()
  await answer.getByRole("button", { name: "Copied" }).click()
  await page.getByRole("menuitem", { name: "Copy as Markdown" }).click()
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(
      [
        "| Region | Signups | Note |",
        "| --- | --: | --- |",
        '| North | 1,204 | grew "fast", twice |',
        "| South | 987 | steady |",
      ].join("\n"),
    )

  // Kept to a line each, a row no longer wraps.
  const cell = table.getByRole("cell", { name: "steady" })
  await expect(cell).toHaveCSS("white-space", "normal")
  await answer.getByRole("button", { name: "Keep each row on one line" }).click()
  await expect(cell).toHaveCSS("white-space", "nowrap")
})

test("code in a reply is in its colors, and is copied as it was written", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  await signIn(page)
  await newChat(page)
  const code =
    'const greeting: string = "hello" // said once\nexport function twice(n: number) {\n  return n * 2\n}'
  const answer = await reply(page, `\`\`\`ts\n${code}\n\`\`\`\n\nAnd \`inline\` too.`)
  const block = answer.locator(".md-code")
  await expect(block.locator(".md-code-language")).toHaveText("ts")
  // Each kind of word is in the color the app has for it.
  const colorOf = (word: string) =>
    block
      .locator("code span span", { hasText: new RegExp(`^${word}$`) })
      .first()
      .evaluate((part) => (part as HTMLElement).style.color)
  await expect.poll(() => colorOf("const")).toBe("var(--syntax-keyword)")
  expect(await colorOf('"hello"')).toBe("var(--syntax-string)")
  expect(await colorOf("// said once")).toBe("var(--syntax-comment)")
  expect(await colorOf("twice")).toBe("var(--syntax-function)")
  // Colored or not, it says what was written, line for line.
  expect(await block.locator("pre").innerText()).toBe(code)

  await block.getByRole("button", { name: "Copy code" }).click()
  await expect(block.getByRole("button", { name: "Copied" })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code)

  const pre = block.locator("pre")
  await expect(pre).toHaveCSS("white-space", "pre")
  await block.getByRole("button", { name: "Wrap long lines" }).click()
  await expect(pre).toHaveCSS("white-space", "pre-wrap")
  // Code in a sentence is left as it is.
  await expect(answer.locator("p code", { hasText: "inline" })).toBeVisible()
  await page.screenshot({ path: "test-results/markdown-code.png" })
})

test("a mermaid block is drawn as its diagram, with the code a click away", async ({ page }) => {
  await signIn(page)
  await newChat(page)
  const answer = await reply(page, "```mermaid\nflowchart LR\n  Draft --> Review --> Shipped\n```")
  const diagram = answer.getByRole("img", { name: "Diagram" })
  await expect(diagram.locator("svg")).toBeVisible()
  await expect(diagram).toContainText("Review")
  // It is drawn in the app's colors: its words are the reply's own.
  const ink = await page.evaluate(() => {
    const probe = document.createElement("canvas").getContext("2d")!
    probe.fillStyle = getComputedStyle(document.body).color
    probe.fillRect(0, 0, 1, 1)
    const [r, g, b] = probe.getImageData(0, 0, 1, 1).data
    return `#${[r, g, b].map((part) => part!.toString(16).padStart(2, "0")).join("")}`
  })
  expect(await diagram.locator("svg style").innerHTML()).toContain(`fill:${ink}`)
  await page.screenshot({ path: "test-results/markdown-diagram.png" })

  await answer.getByRole("button", { name: "Show the code" }).click()
  await expect(answer.locator("pre")).toContainText("Draft --> Review")
  await answer.getByRole("button", { name: "Show the diagram" }).click()
  await expect(diagram.locator("svg")).toBeVisible()

  // One that says nothing Mermaid can draw is left as its code.
  const broken = await reply(page, "```mermaid\nthis is not a diagram\n```")
  await expect(broken.locator("pre")).toContainText("this is not a diagram")
  await expect(broken.getByRole("img", { name: "Diagram" })).toHaveCount(0)
})

test("notes, folding sections and task lists are drawn, and nothing in a reply can run", async ({
  page,
}) => {
  await signIn(page)
  await newChat(page)
  const answer = await reply(
    page,
    [
      "> [!WARNING]",
      "> This deletes the folder.",
      "",
      "<details><summary>The long version</summary>",
      "",
      "Hidden until asked for, with <kbd>Ctrl</kbd> in it.",
      "",
      "</details>",
      "",
      "- [x] written",
      "- [ ] sent",
      "",
      '<img src="https://127.0.0.1:9/none.png" onerror="window.ran = 1" alt="nothing there">',
      "",
      "<script>window.ran = 2</script>",
      "",
      '<a href="javascript:window.ran=3">press</a>',
    ].join("\n"),
  )
  const note = answer.getByRole("note")
  await expect(note).toContainText("Warning")
  await expect(note).toContainText("This deletes the folder.")
  await expect(note).not.toContainText("[!")

  const hidden = answer.getByText("Hidden until asked for")
  await expect(hidden).toBeHidden()
  await answer.getByText("The long version").click()
  await expect(hidden).toBeVisible()
  await expect(answer.locator("kbd")).toHaveText("Ctrl")

  await expect(answer.getByRole("checkbox")).toHaveCount(2)
  await expect(answer.getByRole("checkbox").first()).toBeChecked()
  await expect(answer.getByRole("checkbox").first()).toBeDisabled()

  // The picture that is not there is its words, and nothing it or the script said was run.
  await expect(answer.getByText("nothing there")).toBeVisible()
  await expect(answer.locator("script")).toHaveCount(0)
  await answer.getByText("press").click()
  expect(await page.evaluate(() => (window as { ran?: number }).ran)).toBeUndefined()
})

/** A small picture: four pixels of teal. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGNgSJn+H4QZYIz/KdP/AwBPaAl/8Kk5fgAAAABJRU5ErkJggg==",
  "base64",
)

test("a picture and a link in a reply may be files of the library", async ({ page }) => {
  await signIn(page)
  await tab(page, "Library").click()
  await page.getByLabel("Choose a file to upload").setInputFiles([
    { name: "chart.png", mimeType: "image/png", buffer: PNG },
    { name: "notes.md", mimeType: "text/markdown", buffer: Buffer.from("# Notes\n\nKept.") },
  ])
  const files = page.getByRole("navigation", { name: "Files" })
  await expect(files.getByRole("link", { name: "notes.md" })).toBeVisible()
  await expect(files.getByRole("link", { name: "chart.png" })).toBeVisible()
  await tab(page, "Chat").click()
  await newChat(page)
  const answer = await reply(
    page,
    "![The chart](chart.png)\n\nRead [the notes](notes.md), or ![gone](missing.png) and a second:\n\n![Again](./chart.png)",
  )
  const picture = answer.getByRole("img", { name: "The chart" })
  await expect(picture).toHaveAttribute("src", /\/d\/[^/]+\/[^/]+\/chart\.png/)
  await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(2)
  // One the library does not have is its words.
  await expect(answer.getByText("gone")).toBeVisible()
  await expect(answer.getByRole("img", { name: "gone" })).toHaveCount(0)

  // Clicked, it is shown large, with the reply's other picture a step away.
  await picture.click()
  const viewer = page.getByRole("dialog", { name: "The chart" })
  await expect(viewer.getByText("1 of 2")).toBeVisible()
  await viewer.getByRole("button", { name: "Next picture" }).click()
  await expect(page.getByRole("dialog", { name: "Again" })).toBeVisible()
  await page.keyboard.press("Escape")

  // The link opens the document where the chat is.
  await answer.getByRole("link", { name: "the notes" }).click()
  await expect(page.getByRole("heading", { name: "Notes" })).toBeVisible()
  await expect(composer(page)).toBeVisible()
})
