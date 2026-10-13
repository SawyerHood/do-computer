import { expect } from "@playwright/test"
import { test } from "./fixtures.ts"
import { asOwner, composer, newChat, signIn, tool } from "./helpers.ts"

asOwner()

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
  await tool(page, "visual_preview", { html: PAGE }, /At 680px wide the page is 90px tall/)
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
    "visual_preview",
    { html: "<style>.app{min-height:100vh}</style><div class=app>x</div>" },
    /takes its height from the window/,
  )
})
