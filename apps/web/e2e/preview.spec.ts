import type { LibraryListing } from "@do-computer/protocol"
import { expect, type Page } from "@playwright/test"
import { test } from "./fixtures.ts"
import { asOwner, composer, newChat, signIn, tool } from "./helpers.ts"

asOwner()

const agentOf = (page: Page) => /\/a\/([^/]+)/.exec(page.url())![1]!

/** Put a file in the library, as someone who uploads one does. */
async function add(page: Page, path: string, content: string | Buffer, type: string) {
  const response = await page.request.post(
    `/api/agents/${agentOf(page)}/library?path=${encodeURIComponent(path)}`,
    { data: content, headers: { "content-type": type } },
  )
  expect(response.status()).toBe(201)
}

/** A page that lays itself out by how wide it is, says something, and has something fail in it. */
const PAGE = [
  "<style>.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}",
  ".card{background:var(--card);box-shadow:var(--elevation-card);border-radius:var(--radius);height:90px}</style>",
  '<div class="grid"><div class="card"></div><div class="card"></div><div class="card"></div></div>',
  '<script>console.log("drew", document.querySelectorAll(".card").length, "cards");',
  "setTimeout(function () { notThere() }, 10)</script>",
].join("")

test("the agent looks at a page before it shows it: its heights, its console, what failed", async ({
  page,
}) => {
  await signIn(page)
  await newChat(page)
  await tool(page, "look", { html: PAGE }, /At 680px wide the page is 90px tall/)
  const said = page.getByText(/At 680px wide the page is/).last()
  // Three cards side by side on a computer, and one under another on a phone.
  await expect(said).toContainText("90px tall on a computer")
  await expect(said).toContainText("294px on a phone")
  await expect(said).toContainText("[log] drew 3 cards")
  await expect(said).toContainText("[error] notThere is not defined")
  // Nothing was shown to the person, and nothing was kept.
  await expect(page.getByRole("figure")).toHaveCount(0)

  // Drawn as it was looked at, it is given the room it was measured to take before it has
  // said anything: its address is held back, so that it cannot.
  await page.route("**/d/**/cards.html*", () => {})
  await tool(page, "visual", { title: "Cards", html: PAGE }, /Shown to the person/)
  const visual = page.getByRole("figure", { name: "Visual: cards.html" })
  await expect.poll(async () => (await visual.boundingBox())?.height).toBe(90)
})

test("a page that would not work in the chat is not looked at, and the agent is told why", async ({
  page,
}) => {
  await signIn(page)
  await newChat(page)
  await composer(page).fill("")
  await tool(
    page,
    "look",
    { html: "<style>.app{min-height:100vh}</style><div class=app>x</div>" },
    /takes its height from the window/,
  )
})

/** A page that is only tall once the stylesheet beside it has loaded, and says what it was told. */
const TALL =
  '<!doctype html><html lang="en" data-dc-page><head><meta charset="utf-8">' +
  '<link rel="stylesheet" href="tall.css"></head><body><h1>Third quarter</h1><script>' +
  'console.log("shown", document.documentElement.getAttribute("data-dc-theme"), ' +
  'getComputedStyle(document.documentElement).getPropertyValue("--primary") !== "")</script></body></html>'

test("the agent looks at a page of the library as the app serves it, with the file beside it", async ({
  page,
}) => {
  await signIn(page)
  await add(page, "reports/tall.css", "h1{margin:0;height:1500px}", "text/css")
  await add(page, "reports/tall.html", TALL, "text/html")
  await newChat(page)
  // 1500px of heading and the page's own padding: the stylesheet beside it was loaded.
  await tool(page, "look", { file: "~/library/reports/tall.html" }, /it is 1564px tall/)
  const said = page.getByText(/it is 1564px tall/).last()
  await expect(said).toContainText("as the app shows the page, in a window 1120px wide")
  await expect(said).toContainText("the picture is of 0px to 1339px down")
  await expect(said).toContainText("at 1339 for what is below.")
  // It was given the app's variables, and told it is shown in the dark.
  await expect(said).toContainText("[log] shown dark true")
  // The rest of it, as a phone shows it in the light.
  await tool(
    page,
    "look",
    { file: "reports/tall.html", width: 360, top: 1339, appearance: "light" },
    /in a window 360px wide/,
  )
  const narrow = page.getByText(/in a window 360px wide/).last()
  await expect(narrow).toContainText(
    "it is 1532px tall, and the picture is of 1339px to 1532px down.",
  )
  await expect(narrow).toContainText("[log] shown light true")
})

/** One dot, as a PNG. */
const DOT = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
)

test("a document is laid out for the agent to look at, and a picture is drawn by itself", async ({
  page,
}) => {
  await signIn(page)
  await add(
    page,
    "notes/plan.md",
    "# Launch plan\n\n- [x] Write it\n- [ ] Ship it\n",
    "text/markdown",
  )
  await add(page, "uploads/dot.png", DOT, "image/png")
  await newChat(page)
  await tool(
    page,
    "look",
    { file: "notes/plan.md" },
    /notes\/plan\.md, laid out as a document to read/,
  )
  // A document that fits its window is as tall as the window.
  await expect(
    page.getByText(/notes\/plan\.md, laid out as a document to read/).last(),
  ).toContainText("it is 800px tall, and all of it is in the picture.")
  // What the browser was sent to is the document as a page, where the file itself is its text.
  const { view } = (await (
    await page.request.get(`/api/agents/${agentOf(page)}/library`)
  ).json()) as LibraryListing
  const at = `/d/${agentOf(page)}/${view}/notes/plan.md`
  const laidOut = await page.request.get(`${at}?page`)
  expect(laidOut.headers()["content-type"]).toContain("text/html")
  expect(laidOut.headers()["content-security-policy"]).toContain("sandbox")
  expect(
    (await laidOut.text()).includes('<main class="doc"><h1 id="user-content-launch-plan">'),
  ).toBe(true)
  expect(await (await page.request.get(at)).text()).toBe(
    "# Launch plan\n\n- [x] Write it\n- [ ] Ship it\n",
  )
  await tool(page, "look", { file: "dot.png" }, /uploads\/dot\.png is a picture of 1 by 1 pixels/)
  await tool(
    page,
    "look",
    { file: "notes/plan.pdf" },
    /There is no "notes\/plan\.pdf" in the library/,
  )
})
