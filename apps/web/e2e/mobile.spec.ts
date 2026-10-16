import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Page } from "@playwright/test"
import { startFakeMcp } from "./fake-mcp-server.ts"
import { expect, test } from "./fixtures.ts"

/**
 * The mobile app, running in a browser. Its web build is the same screens and logic as on a
 * phone, drawn by react-native-web, so these check everything but what only a phone has: its
 * own bars, menus and sheets (here a menu is a list over the page, and a question before
 * something is deleted is the browser's own), secure storage, push registration and the share
 * sheet.
 *
 * The build is served under /__mobile on the deployment's own origin, which is how a browser
 * build would be hosted, so its session cookie works as usual.
 */
const dist = fileURLToPath(new URL("../../mobile/dist-web-test/", import.meta.url))

test.skip(!existsSync(join(dist, "index.html")), "the mobile web build has not been exported")
// The app draws the agent's creature with expo-gl, which on the web needs WebGL to be there.
test.use({ viewport: { width: 400, height: 860 }, creature: true })
test.describe.configure({ mode: "serial" })

async function open(page: Page, path = "/__mobile/") {
  await page.route(/\/__mobile(\/.*)?$/, async (route) => {
    const relative = new URL(route.request().url()).pathname.replace(/^\/__mobile\/?/, "")
    const file = join(dist, relative)
    const isFile = relative !== "" && existsSync(file) && statSync(file).isFile()
    await route.fulfill({ path: isFile ? file : join(dist, "index.html") })
  })
  // The pages are handed over by the test and not by a server, so the browser cannot tell that
  // they come from this machine, and would ask before it lets them open a socket to it: the
  // sockets are how the app hears of anything. A browser that never asks has no such permission.
  await page
    .context()
    .grantPermissions(["local-network-access"])
    .catch(() => {})
  await page.goto(path)
}

const account = {
  name: "Phone user",
  email: "mobile@example.com",
  password: "correct horse battery",
}
// A screen that was left for another is still in the page, out of sight, so what a test asks
// for is asked of what can be seen: by role, or among the words that show.
const composer = (page: Page) => page.getByRole("textbox", { name: "Message", exact: true })
const words = (page: Page, text: string | RegExp, options?: { exact?: boolean }) =>
  page.getByText(text, options).filter({ visible: true })
const row = (page: Page, name: string) => page.getByRole("button", { name: new RegExp(`^${name}`) })
/** An agent's row in the list, which says its name, the latest from it, and when. */
const agent = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^${name}, `) })
const back = (page: Page) => page.getByRole("link", { name: /(, back|^Go back)$/ })
const item = (page: Page, name: string) => page.getByRole("menuitem", { name, exact: true })
const agentId = async (page: Page) =>
  ((await (await page.request.get("/api/agents")).json()) as { agents: { id: string }[] })
    .agents[0]!.id

/** Say yes to the next thing the app asks before doing, and give back what it asked. */
function agree(page: Page): Promise<string> {
  return new Promise((resolve) => {
    page.once("dialog", (dialog) => {
      resolve(dialog.message())
      void dialog.accept()
    })
  })
}

async function send(page: Page, text: string) {
  await composer(page).fill(text)
  await page.getByRole("button", { name: "Send" }).click()
  await expect(composer(page)).toHaveValue("")
}

async function signIn(page: Page) {
  await open(page)
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible()
  await page.getByLabel("Email").fill(account.email)
  await page.getByLabel("Password").fill(account.password)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page.getByRole("heading", { name: "Doods" })).toBeVisible()
}

/** Signed in, and in the main chat of the agent the first test hatched. */
async function openChat(page: Page) {
  await signIn(page)
  await agent(page, "Pip").click()
  await expect(composer(page)).toHaveAttribute("placeholder", "Message Pip")
}

test("a new user signs up on the phone, hatches an agent and lands in its chat", async ({
  page,
}) => {
  await open(page)
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible()
  await page.getByRole("button", { name: "Create an account" }).click()
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible()
  await page.getByLabel("Name").fill(account.name)
  await page.getByLabel("Email").fill(account.email)
  await page.getByLabel("Password").fill(account.password)
  await page.getByRole("button", { name: "Create account" }).click()

  // The first run: the agent is met as an egg, which is named and then hatches, once.
  await expect(words(page, /I don’t have a name yet/)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId("avatar-egg")).toBeVisible()
  await expect(page.getByRole("button", { name: "That’s your name" })).toBeDisabled()
  await page.getByLabel("A name for it").fill("Pip")
  await page.getByRole("radio", { name: "Moss" }).click()
  await page.getByRole("button", { name: "That’s your name" }).click()

  // What it thinks with is asked only where there is something to choose from.
  const start = page.getByRole("button", { name: "Start chatting with Pip" })
  const use = page.getByRole("button", { name: /^Use / })
  await expect(start.or(use)).toBeVisible({ timeout: 15_000 })
  if (await use.isVisible()) await use.click()
  await expect(start).toBeVisible({ timeout: 20_000 })
  const hatched = async () =>
    (
      (await (await page.request.get("/api/agents")).json()) as {
        agents: { name: string; hatched: boolean }[]
      }
    ).agents[0]
  await expect.poll(hatched, { timeout: 15_000 }).toMatchObject({ name: "Pip", hatched: true })
  await expect(page.getByTestId("avatar-egg")).toHaveCount(0)

  await start.click()
  await expect(page.getByRole("heading", { name: "Hi Phone, I’m Pip." })).toBeVisible()
  await expect(composer(page)).toHaveAttribute("placeholder", "Message Pip")
  await expect(page.getByRole("button", { name: "Skip the hatching" })).toHaveCount(0)
})

test("wrong credentials are explained", async ({ page }) => {
  await open(page)
  // A browser build is served by its deployment, so there is no address to type or change.
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible()
  await expect(page.getByLabel("Deployment address")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Change server" })).toHaveCount(0)
  await page.getByLabel("Email").fill(account.email)
  await page.getByLabel("Password").fill("not the password")
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page.getByRole("alert")).toBeVisible()
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible()
})

test("signing in lands on the agents, and an agent's row opens its chat", async ({ page }) => {
  await signIn(page)
  await expect(agent(page, "Pip")).toBeVisible()
  await agent(page, "Pip").click()
  await expect(page.getByRole("button", { name: "Pip's page" })).toBeVisible()
  // Nothing has been said in it yet, so it is the agent, large, and no longer in its egg.
  await expect(page.getByRole("heading", { name: "Pip", exact: true })).toBeVisible()
  await expect(words(page, "What would you like to do?")).toBeVisible()
  await expect(page.getByRole("button", { name: "Skip the hatching" })).toHaveCount(0)
  await expect(composer(page)).toHaveAttribute("placeholder", "Message Pip")
})

test("a chat streams the agent's reply and survives leaving and coming back", async ({ page }) => {
  await openChat(page)
  const sending = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      /\/chats\/[^/]+\/messages$/.test(new URL(request.url()).pathname),
  )
  await send(page, "hello from the phone")
  // A message says where it was written. Built for a browser, the app is in one.
  expect(((await sending).postDataJSON() as { from?: unknown }).from).toMatchObject({
    app: "browser",
  })
  await expect(words(page, /You said: hello from the phone/)).toBeVisible()
  // Stop is there only while the agent works, and the hello gives way to the conversation.
  await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0)
  await expect(words(page, "What would you like to do?")).toHaveCount(0)

  // The row in the list says the latest from the agent, and leads back to the same chat.
  await back(page).click()
  await expect(agent(page, "Pip")).toContainText("You said: hello from the phone")
  await agent(page, "Pip").click()
  await expect(words(page, /You said: hello from the phone/)).toBeVisible()
})

test("a copied picture is pasted into the message box and goes with the message", async ({
  page,
}) => {
  await openChat(page)
  await composer(page).fill("Look at this: ")
  // A screenshot on the clipboard is called image.png every time, so it is named for the moment.
  await composer(page).evaluate((box) => {
    const png = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      ),
      (character) => character.charCodeAt(0),
    )
    const data = new DataTransfer()
    data.items.add(new File([png], "image.png", { type: "image/png" }))
    box.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    )
  })
  // It is shown as the picture it is, small, above what was typed, which is left as it was.
  const pasted = /pasted-\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d\.png/
  await expect(page.getByLabel("Attached files").getByRole("img", { name: pasted })).toBeVisible()
  await expect(page.getByRole("button", { name: /^Remove pasted-/ })).toBeVisible()
  await expect(composer(page)).toHaveValue("Look at this: ")

  await page.getByRole("button", { name: "Send" }).click()
  await expect(composer(page)).toHaveValue("")
  // It is in the library by then, and the agent is told its name.
  await expect(words(page, new RegExp(`^Attached: ${pasted.source}$`)).first()).toBeVisible()
})

test("the agent's work leaves only its answer, and a sent file can be opened", async ({ page }) => {
  await openChat(page)
  await send(page, '/tool write {"path":"list.md","content":"- eggs\\n- flour\\n"}')
  await expect(words(page, /Successfully wrote to list\.md/).first()).toBeVisible()
  // The call itself is not in the transcript, only what the agent said.
  await expect(page.getByRole("button", { name: "Wrote list.md" })).toHaveCount(0)

  await send(page, '/tool send_file {"path":"list.md"}')
  const file = page.getByRole("button", { name: /^list\.md, \d+ B$/ })
  await expect(file).toBeVisible()
  // Downloading hands the file's address to the browser, which fetches it with the session.
  const fetched = page
    .context()
    .waitForEvent("response", (response) => /\/library\/[^/?]+$/.test(response.url()))
  await page.getByRole("button", { name: "Download list.md" }).click()
  expect((await fetched).headers()["content-disposition"]).toContain("list.md")

  // A document opens where it is kept, in the library.
  await file.click()
  await expect(page.getByRole("tablist", { name: "How to show it" })).toBeVisible()
  await expect(words(page, "eggs")).toBeVisible()
})

test("a request for approval can be answered from the phone", async ({ page }) => {
  await openChat(page)
  const rules = `/api/agents/${await agentId(page)}/approvals/rules`
  await page.request.patch(rules, { data: { "tool:bash": "ask" } })
  try {
    await send(page, '/tool bash {"command":"echo from-the-phone"}')
    // It waits above the composer, which is still there to write in.
    await expect(words(page, "Pip asks first · from this chat")).toBeVisible()
    await expect(words(page, "echo from-the-phone", { exact: true })).toBeVisible()
    const top = async (of: ReturnType<typeof words>) => (await of.boundingBox())!.y
    const asking = await top(words(page, "Pip asks first · from this chat"))
    expect(asking).toBeGreaterThan(await top(words(page, /^\/tool bash/)))
    expect(asking).toBeLessThan(await top(composer(page)))

    await page.getByRole("button", { name: "Allow once" }).click()
    await expect(words(page, "Pip asks first · from this chat")).toHaveCount(0)
    // The answer is told to the agent, and is in the transcript as a note of its own.
    await expect(
      words(page, "Approved: Run commands: echo from-the-phone", { exact: true }),
    ).toBeVisible()
  } finally {
    await page.request.patch(rules, { data: { "tool:bash": "allow" } })
  }
})

test("the agent can be spoken to while it works", async ({ page }) => {
  await openChat(page)
  // The browser has a fake microphone, so recording works without hardware or a prompt.
  await page
    .context()
    .grantPermissions(["local-network-access", "microphone"])
    .catch(() => page.context().grantPermissions(["microphone"]))
  await send(page, '/tool bash {"command":"sleep 20"}')
  // Stop is beside the microphone and not in its place.
  const stop = page.getByRole("button", { name: "Stop", exact: true })
  await expect(stop).toBeVisible()
  await page.getByRole("button", { name: "Dictate" }).click()
  await expect(page.getByRole("button", { name: "Stop dictating" })).toBeVisible()
  await expect(composer(page)).toBeHidden()
  await page.getByRole("button", { name: "Cancel dictating" }).click()
  await expect(composer(page)).toBeVisible()

  await stop.click()
  await expect(stop).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Dictate" })).toBeVisible()
})

test("the message box is one line until it is written in, and then has the model under it", async ({
  page,
}) => {
  // The deployment has one model here, and one is nothing to choose between. The app is told
  // of a second, and that the first has more than one way of thinking.
  await page.route(/\/api\/models(\?.*)?$/, async (route) => {
    const response = await route.fetch()
    const { models } = (await response.json()) as { models: Record<string, unknown>[] }
    await route.fulfill({
      response,
      json: {
        models: [
          { ...models[0], thinking: ["low", "medium", "high"] },
          { ...models[0], id: "echo/echo-2", name: "Echo Two" },
        ],
      },
    })
  })
  await openChat(page)
  const box = (await composer(page).boundingBox())!
  const attach = page.getByRole("button", { name: "Attach a file" })
  const dictate = page.getByRole("button", { name: "Dictate" })
  const model = page.getByRole("button", { name: "Model and thinking" })
  const middle = async (of: typeof attach) => {
    const at = (await of.boundingBox())!
    return at.y + at.height / 2
  }
  // Left alone, "+" and the microphone are on its one line, inside it.
  expect(await middle(attach)).toBeGreaterThan(box.y)
  expect(await middle(attach)).toBeLessThan(box.y + box.height)
  expect(await middle(dictate)).toBeLessThan(box.y + box.height)
  expect((await attach.boundingBox())!.x).toBeGreaterThanOrEqual(box.x)
  await expect(model).toHaveCount(0)

  // Written in, the words have its whole width, and the buttons are in a row under them.
  await composer(page).fill("a message long enough to want the room")
  const open = (await composer(page).boundingBox())!
  expect(open.width).toBeCloseTo(box.width, 0)
  expect(await middle(attach)).toBeGreaterThan(open.y + open.height)
  expect(await middle(page.getByRole("button", { name: "Send" }))).toBeGreaterThan(
    open.y + open.height,
  )

  // What the agent thinks with is beside "+": the models, and how hard the chosen one thinks.
  await model.click()
  await expect(item(page, "Echo Two")).toBeVisible()
  await expect(item(page, "Thinking: Medium")).toBeVisible()
  await item(page, "Thinking: High").click()
  await expect
    .poll(async () => {
      const { agents } = (await (await page.request.get("/api/agents")).json()) as {
        agents: { thinking: string }[]
      }
      return agents[0]!.thinking
    })
    .toBe("high")
  // Choosing left what was written as it was.
  await expect(composer(page)).toHaveValue("a message long enough to want the room")
  await page.request.patch(`/api/agents/${await agentId(page)}`, { data: { thinking: "medium" } })
  await composer(page).fill("")
})

test("Markdown in a reply is rendered, not shown as markup", async ({ page }) => {
  await openChat(page)
  await send(page, "a list:\n\n- one\n- **two**")
  await expect(words(page, "two", { exact: true })).toBeVisible()
  await expect(words(page, "**two**")).toHaveCount(1) // only in the user's own bubble
})

test("a sent message says Sending and then Delivered, and the word leaves", async ({ page }) => {
  await openChat(page)
  await send(page, "are you there?")
  // It is on its way, then the Dood has it, and a few seconds later nothing is said of it.
  await expect(page.getByLabel(/^(Sending|Delivered)$/)).toBeVisible()
  await expect(page.getByLabel("Delivered", { exact: true })).toBeVisible()
  await expect(words(page, "Delivered", { exact: true })).toBeVisible()
  await page.screenshot({ path: "test-results/phone-delivered.png" })
  await expect(page.getByLabel("Delivered", { exact: true })).toHaveCount(0, { timeout: 10_000 })
  // A chat that is opened says nothing of the messages it already had.
  await page.reload()
  await expect(composer(page)).toBeVisible()
  await expect(words(page, "are you there?").first()).toBeVisible()
  await expect(page.getByLabel("Delivered", { exact: true })).toHaveCount(0)
})

test("code in a reply is in its colors, wraps, and a table is copied as CSV or as Markdown", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
  await openChat(page)
  await send(
    page,
    "Here:\n\n```ts\nconst total = add(price, 2) // a note\n```\n\n| City | High |\n| --- | --: |\n| **Lisbon** | 21 |\n| Porto, PT | 19 |",
  )
  // The words of the language, what is called and a comment are each in a color of their own.
  const keyword = page.getByText("const", { exact: true }).last()
  await expect(keyword).toBeVisible()
  const color = (text: string) =>
    page
      .getByText(text, { exact: true })
      .last()
      .evaluate((piece) => getComputedStyle(piece).color)
  const colors = new Set([await color("const"), await color("add"), await color("// a note")])
  expect(colors.size).toBe(3)
  await page.screenshot({ path: "test-results/phone-code-table.png" })

  // The reply has all arrived: what is switched in a block is kept by the message it is in.
  const copy = page.getByRole("button", { name: "Copy the table" }).last()
  await expect(copy).toBeVisible()
  await expect(page.getByRole("button", { name: "Dictate" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0)
  // Long lines scroll sideways until they are asked to wrap.
  await page.getByRole("button", { name: "Wrap long lines" }).last().click()
  await expect(page.getByRole("button", { name: "Stop wrapping long lines" })).toHaveCount(1)

  await copy.click()
  await item(page, "Copy as CSV").click()
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('City,High\nLisbon,21\n"Porto, PT",19')
  await copy.click()
  await item(page, "Copy as Markdown").click()
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("| City | High |\n| --- | --: |\n| Lisbon | 21 |\n| Porto, PT | 19 |")
})

test("a note has its name over it, and a section that folds opens when its heading is pressed", async ({
  page,
}) => {
  await openChat(page)
  await send(
    page,
    "Two things:\n\n> [!WARNING]\n> Mind the gap.\n\n<details>\n<summary>The full log</summary>\n\n- step one\n- step two\n\n</details>",
  )
  await expect(words(page, "Warning", { exact: true }).last()).toBeVisible()
  await expect(words(page, "Mind the gap.").last()).toBeVisible()
  // The mark is not shown as words, but in the reader's own message, which is as they typed it.
  await expect(words(page, "[!WARNING]")).toHaveCount(1)
  // The reply has all arrived: what is opened is kept by the message it is in.
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Dictate" })).toBeVisible()
  const heading = page.getByRole("button", { name: "The full log" }).last()
  await expect(heading).toHaveAttribute("aria-expanded", "false")
  await expect(words(page, "step two")).toHaveCount(1) // only in the reader's own message
  await heading.click()
  await expect(heading).toHaveAttribute("aria-expanded", "true")
  await expect(words(page, "step two")).toHaveCount(2)
  await page.screenshot({ path: "test-results/phone-note-details.png" })
})

test("a mermaid block is drawn as its diagram by the deployment's page, with the code a press away", async ({
  page,
}) => {
  await openChat(page)
  await send(page, "A diagram:\n\n```mermaid\nflowchart LR\n  Draft --> Review --> Shipped\n```")
  const diagram = page.getByLabel("Diagram", { exact: true }).last().frameLocator("iframe")
  await expect(diagram.locator("svg")).toBeVisible()
  await expect(diagram.getByRole("img", { name: "Diagram" })).toContainText("Review")
  // The words under the diagram are gone once it is drawn.
  await expect(words(page, "Drawing the diagram…")).toHaveCount(0)
  await page.screenshot({ path: "test-results/phone-diagram.png" })
  await page.getByRole("button", { name: "Show the code" }).last().click()
  await expect(words(page, /Draft --> Review --> Shipped/).last()).toBeVisible()
  await page.getByRole("button", { name: "Show the diagram" }).last().click()
  await expect(diagram.locator("svg")).toBeVisible()

  // One that cannot be drawn stays code.
  await send(page, "Another:\n\n```mermaid\nthis is not a diagram\n```")
  await expect(page.getByRole("button", { name: "Wrap long lines" }).last()).toBeVisible()
  await expect(words(page, "this is not a diagram").last()).toBeVisible()
  await expect(page.getByRole("button", { name: "Show the code" })).toHaveCount(1)
})

test("earlier messages can be brought back after a chat was started fresh", async ({ page }) => {
  await openChat(page)
  await expect(words(page, /You said: hello from the phone/)).toBeVisible()
  await page.getByRole("button", { name: "More", exact: true }).click()
  const asked = agree(page)
  await item(page, "Start fresh").click()
  expect(await asked).toContain("Start fresh?")

  // The transcript now starts at the fresh start, and offers what came before it.
  await expect(words(page, /You said: hello from the phone/)).toHaveCount(0)
  await page.getByRole("button", { name: "Show earlier messages" }).click()
  await expect(words(page, /You said: hello from the phone/)).toBeVisible()
  await expect(page.getByRole("button", { name: "Show earlier messages" })).toHaveCount(0)
})

test("the agent's page says what it is and has, and a skill can be switched off and on", async ({
  page,
}) => {
  await openChat(page)
  await page.getByRole("button", { name: "Pip's page" }).click()
  await expect(page.getByRole("heading", { name: "Pip" }).first()).toBeVisible()
  for (const name of [
    "Profile",
    "Memory",
    "Model and computers",
    "Skills",
    "Connectors",
    "Permissions",
    "Usage",
  ]) {
    await expect(row(page, name)).toBeVisible()
  }
  await expect(row(page, "Model and computers")).toContainText("Echo")

  await row(page, "Skills").click()
  await expect(page.getByRole("heading", { name: "Skills" })).toBeVisible()
  await expect(row(page, "planning-automations")).toContainText("Built in")
  const toggle = page.getByRole("switch", { name: "Use writing-skills" })
  await expect(toggle).toBeChecked()
  await toggle.click()
  await expect(toggle).not.toBeChecked()
  // It is the agent's setting and not the page's: it is still off when the page is read again.
  await page.reload()
  await expect(toggle).not.toBeChecked()
  await toggle.click()
  await expect(toggle).toBeChecked()
})

test("the library shows what the agent wrote, and a deleted file can be restored", async ({
  page,
}) => {
  await openChat(page)
  await send(page, '/tool write {"path":"library/plan.md","content":"# Plan\\n\\nBuy a kite.\\n"}')
  await expect(words(page, /Successfully wrote/).last()).toBeVisible()
  await page.getByRole("button", { name: "More", exact: true }).click()
  await item(page, "Library").click()

  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible()
  // What the agent sent in chat is kept here too, and says who it is from.
  await expect(row(page, "list\\.md")).toContainText("Pip")
  await row(page, "plan\\.md").click()
  await expect(page.getByRole("tablist", { name: "How to show it" })).toBeVisible()
  await expect(words(page, "Buy a kite.")).toBeVisible()
  await back(page).click()

  // Deleting asks first, and what is deleted can be had back.
  await page.getByRole("button", { name: "More for plan.md" }).click()
  const asked = agree(page)
  await item(page, "Delete").click()
  expect(await asked).toContain("plan.md")
  await expect(row(page, "plan\\.md")).toHaveCount(0)
  await expect(row(page, "list\\.md")).toBeVisible()

  await row(page, "Recently deleted").click()
  await page.getByRole("button", { name: "Restore plan.md" }).click()
  await expect(page.getByRole("button", { name: "Restore plan.md" })).toHaveCount(0)
  await back(page).click()
  await expect(row(page, "plan\\.md")).toBeVisible()
})

/* ---------- pins ---------- */

/** A picture of the phone's pins, for whoever looks at the change. */
async function shoot(page: Page, name: string) {
  // A menu fades in and out; the picture is of the page once it has stopped moving.
  await page.waitForTimeout(500)
  await page.screenshot({ path: `test-results/mobile-${name}.png` })
}
type ListedFile = { id: string; path: string }
const libraryOf = async (page: Page): Promise<ListedFile[]> =>
  (
    (await (await page.request.get(`/api/agents/${await agentId(page)}/library`)).json()) as {
      files: ListedFile[]
    }
  ).files
const fileAt = async (page: Page, path: string) => {
  const file = (await libraryOf(page)).find((each) => each.path === path)
  expect(file, `${path} is in the library`).toBeDefined()
  return file!
}
const pinsOf = async (page: Page) =>
  (
    (await (await page.request.get(`/api/agents/${await agentId(page)}/pins`)).json()) as {
      pins: { fileId: string; path: string; by: string }[]
    }
  ).pins
const pinFile = async (page: Page, path: string) => {
  const file = await fileAt(page, path)
  const response = await page.request.put(`/api/agents/${await agentId(page)}/pins/${file.id}`)
  expect(response.ok()).toBe(true)
}

test("what the Dood pins is shown in its chat, and under its face on its page as it changes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openChat(page)
  await send(
    page,
    '/tool write {"path":"library/boards/launch.html","content":"<h1>Launch</h1><ul><li>Write the post</li><li>Ship it</li></ul>"}',
  )
  await expect(words(page, /Successfully wrote/).last()).toBeVisible()
  await send(page, '/tool pin {"action":"pin","path":"boards/launch.html","title":"Launch board"}')

  // The chat says what was pinned, with the way to open it and to take the pin off.
  await expect(words(page, "Pip pinned Launch board")).toBeVisible()
  await expect(words(page, "boards/launch.html").last()).toBeVisible()
  await shoot(page, "pin-card")
  // The card says how the pin stands now: taken off, it offers to put it back as it was.
  await page.getByRole("button", { name: "Unpin Launch board" }).click()
  await expect(words(page, "Launch board is no longer pinned")).toBeVisible()
  expect(await pinsOf(page)).toEqual([])
  await page.getByRole("button", { name: "Pin it again" }).click()
  await expect(words(page, "Pip pinned Launch board")).toBeVisible()
  expect(await pinsOf(page)).toMatchObject([{ path: "boards/launch.html", by: "user" }])

  // Open leads to the library's own viewer, whose bar says that it is pinned.
  await page.getByRole("button", { name: "Open Launch board" }).click()
  await expect(page.getByRole("button", { name: "Unpin from Pip" })).toBeVisible()
  await back(page).click()

  // The chat's More has what is pinned, a press from opening.
  await page.getByRole("button", { name: "More", exact: true }).click()
  await expect(item(page, "Open Launch board")).toBeVisible()
  await shoot(page, "chat-pinned-menu")
  await item(page, "Open Launch board").click()
  await expect(page.getByRole("button", { name: "Unpin from Pip" })).toBeVisible()
  await back(page).click()

  // Under the face on the Dood's page, with the first drawn as what it is.
  await page.getByRole("button", { name: "Pip's page" }).click()
  await expect(words(page, "Pinned", { exact: true })).toBeVisible()
  await expect(row(page, "Launch board, ")).toBeVisible()
  await expect(page.locator('iframe[title="launch.html"]')).toBeVisible()

  // Something pinned elsewhere is here at once: the Dood says when its pins change.
  await pinFile(page, "list.md")
  await expect(row(page, "list\\.md, ")).toBeVisible()
  await words(page, /^Pinned for everyone/).scrollIntoViewIfNeeded()
  await shoot(page, "pins-on-page")

  // A pin is taken off from its menu, and the file stays in the library.
  await page.getByRole("button", { name: "More for list.md" }).click()
  await item(page, "Unpin").click()
  await expect(row(page, "list\\.md, ")).toHaveCount(0)
  expect((await pinsOf(page)).map((pin) => pin.path)).toEqual(["boards/launch.html"])
  await fileAt(page, "list.md")

  await row(page, "Launch board, ").click()
  await expect(page.getByRole("button", { name: "Unpin from Pip" })).toBeVisible()
})

test("a person pins from the library, at most eight, and a pin whose file was deleted says so", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openChat(page)
  await page.getByRole("button", { name: "More", exact: true }).click()
  await item(page, "Library").click()
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible()

  // From a file's menu in the list, and the row then says it is pinned.
  await page.getByRole("button", { name: "More for plan.md" }).click()
  await expect(item(page, "Pin to Pip")).toBeVisible()
  await shoot(page, "library-pin-menu")
  await item(page, "Pin to Pip").click()
  await expect(row(page, "plan\\.md, pinned")).toBeVisible()
  await shoot(page, "library-pinned")
  expect((await pinsOf(page)).map((pin) => pin.path)).toEqual(["boards/launch.html", "plan.md"])

  // From the bar of the open file, where it is taken off again.
  await row(page, "plan\\.md").click()
  await page.getByRole("button", { name: "Unpin from Pip" }).click()
  await expect(page.getByRole("button", { name: "Pin to Pip" })).toBeVisible()
  expect((await pinsOf(page)).map((pin) => pin.path)).toEqual(["boards/launch.html"])
  await page.getByRole("button", { name: "Pin to Pip" }).click()
  await expect(page.getByRole("button", { name: "Unpin from Pip" })).toBeVisible()
  await shoot(page, "viewer-pinned")
  await back(page).click()

  // Eight are as many as a Dood can have, and the ninth is refused in words.
  for (const name of ["a.md", "b.md", "c.md", "d.md", "e.md", "gone.md"]) {
    await keep(page, name, "text/markdown", Buffer.from(`# ${name}\n`), "pinboard")
    await pinFile(page, `pinboard/${name}`)
  }
  expect(await pinsOf(page)).toHaveLength(8)
  await page.getByRole("button", { name: "More for list.md" }).click()
  const told = agree(page)
  await item(page, "Pin to Pip").click()
  expect(await told).toContain("8 things are pinned already")
  expect(await pinsOf(page)).toHaveLength(8)

  // A pin whose file was deleted stays on the Dood's page, saying so, until it is taken off.
  const gone = await fileAt(page, "pinboard/gone.md")
  await page.request.delete(`/api/agents/${await agentId(page)}/library/${gone.id}`)
  await back(page).click()
  await page.getByRole("button", { name: "Pip's page" }).click()
  await expect(words(page, "No longer in the library")).toBeVisible()
  await words(page, /^Pinned for everyone/).scrollIntoViewIfNeeded()
  await shoot(page, "pin-gone")
  await page.getByRole("button", { name: "Unpin gone.md" }).click()
  await expect(words(page, "No longer in the library")).toHaveCount(0)
  expect(await pinsOf(page)).toHaveLength(7)

  // Left as it was found, for the tests after these.
  const id = await agentId(page)
  for (const pin of await pinsOf(page))
    await page.request.delete(`/api/agents/${id}/pins/${pin.fileId}`)
  for (const file of await libraryOf(page)) {
    if (file.path.startsWith("pinboard/"))
      await page.request.delete(`/api/agents/${id}/library/${file.id}`)
  }
})

test("automations made in chat can be paused, resumed, run and deleted", async ({ page }) => {
  await openChat(page)
  await send(
    page,
    '/tool schedule {"action":"create","schedule":"every 6h","prompt":"Stretch","title":"Stretch break"}',
  )
  // The echo model repeats what the tool told it, which says the schedule exists.
  await expect(words(page, /Scheduled\. [0-9a-f]{8}: "Stretch break"/).first()).toBeVisible()
  await page.getByRole("button", { name: "Pip's page" }).click()
  await page.getByRole("button", { name: "Automations", exact: true }).click()

  const automation = page.getByRole("button", { name: "Stretch break", exact: true })
  await expect(automation).toContainText("Every 6 hours")
  await expect(automation).toContainText("Active")
  await automation.click()
  const active = page.getByRole("switch", { name: "Active" })
  await active.click()
  await expect(active).not.toBeChecked()
  await expect(words(page, "Paused", { exact: true })).toBeVisible()
  await active.click()
  await expect(active).toBeChecked()

  await expect(words(page, "It has not run yet.")).toBeVisible()
  await page.getByRole("button", { name: "Run now" }).click()
  await expect(words(page, "It has not run yet.")).toHaveCount(0, { timeout: 15_000 })

  const asked = agree(page)
  await page.getByRole("button", { name: "Delete Stretch break" }).click()
  expect(await asked).toContain("Stretch break")
  await expect(words(page, "Nothing scheduled yet.")).toBeVisible()
})

test("a side chat is started from the agent's side chats and is listed there afterwards", async ({
  page,
}) => {
  await openChat(page)
  await page.getByRole("button", { name: "Pip's side chats" }).click()
  await expect(page.getByRole("heading", { name: "Side chats" })).toBeVisible()
  await expect(words(page, /^None yet\./)).toBeVisible()
  await page.getByRole("button", { name: "New side chat" }).click()

  await send(page, "an aside about kites")
  await expect(words(page, /You said: an aside about kites/)).toBeVisible()
  await expect(page).toHaveURL(/\/a\/[^/]+\/c\/[^/]+$/)

  // The main chat is as it was, and the side chat is in its list.
  await back(page).click()
  await expect(words(page, /You said: an aside about kites/)).toHaveCount(0)
  await page.getByRole("button", { name: "Pip's side chats" }).click()
  await expect(row(page, "an aside about kites")).toBeVisible()
})

/** A picture of four dots, small enough to write here. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGNgSJn+H4QZYIz/KdP/AwBPaAl/8Kk5fgAAAABJRU5ErkJggg==",
  "base64",
)

/** Four seconds of quiet, as a WAV file. */
const SOUND = (() => {
  const samples = 4 * 8000
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

/** Four seconds of film, of a kind the test browser plays. */
const CLIP = readFileSync(new URL("./media/clip.webm", import.meta.url))

/** The player of the film called `name` on the screen in front: the latest, where a chat has several. */
const film = (page: Page, name: string) =>
  page.getByLabel(name, { exact: true }).filter({ visible: true }).locator("video").last()
const lengthOf = (video: HTMLVideoElement) => video.duration
/** Move a film to `at` seconds in, and say where it then is. */
const moveTo = (video: HTMLVideoElement, at: number) =>
  new Promise<number>((resolve) => {
    video.addEventListener("seeked", () => resolve(video.currentTime), { once: true })
    video.currentTime = at
  })

/** Put a file in the library of the agent the first test hatched: at its top, or in `dir`. */
async function keep(page: Page, name: string, type: string, body: Buffer, dir = "") {
  const response = await page.request.post(
    `/api/agents/${await agentId(page)}/library?name=${encodeURIComponent(name)}&dir=${encodeURIComponent(dir)}`,
    { data: body, headers: { "content-type": type } },
  )
  expect(response.ok()).toBe(true)
}

/** Have the agent answer with `markdown`: the model here repeats what it is told. */
const reply = (page: Page, markdown: string) => send(page, `as follows\n\n${markdown}`)

test("a picture at another site is not asked for until the reader says so, and a yes for a site is kept", async ({
  page,
}) => {
  // A site of pictures, standing in for anywhere on the web, which notes what it is asked.
  const asked: string[] = []
  await page.route("https://pictures.example/**", (route) => {
    asked.push(new URL(route.request().url()).pathname)
    return route.fulfill({ contentType: "image/png", body: PNG })
  })
  const always = page.getByRole("button", { name: "Always from pictures.example" })
  await openChat(page)
  await reply(page, "![A cat](https://pictures.example/cat.png?who=reader)")
  // It says where the picture is from, and has not asked there.
  await expect(always).toBeVisible()
  await expect(words(page, /^A cat from pictures\.example$/)).toBeVisible()
  await expect(page.getByRole("img", { name: "A cat" })).toHaveCount(0)
  // A picture is asked for a moment after it is on the page, so it is given that moment.
  await page.waitForTimeout(500)
  expect(asked).toEqual([])

  await page.getByRole("button", { name: "Show", exact: true }).click()
  await expect(page.getByRole("img", { name: "A cat" }).first()).toBeVisible()
  await expect.poll(() => [...new Set(asked)]).toEqual(["/cat.png"])

  // Another from the same site asks again, until the site is said yes to for good.
  await reply(page, "![A dog](https://pictures.example/dog.png)")
  await expect(always).toBeVisible()
  await page.waitForTimeout(500)
  expect([...new Set(asked)]).toEqual(["/cat.png"])
  await always.click()
  await expect(page.getByRole("img", { name: "A dog" }).first()).toBeVisible()
  await expect.poll(() => [...new Set(asked)]).toEqual(["/cat.png", "/dog.png"])
  await reply(page, "![A bird](https://pictures.example/bird.png)")
  await expect(page.getByRole("img", { name: "A bird" }).first()).toBeVisible()
  await expect(always).toHaveCount(0)

  // The yes is kept on the device: the chat opened afresh shows all three without asking.
  await page.reload()
  await expect(composer(page)).toHaveAttribute("placeholder", "Message Pip")
  await expect(page.getByRole("img", { name: "A cat" }).first()).toBeVisible()
  await expect(page.getByRole("img", { name: "A bird" }).first()).toBeVisible()
  await expect(always).toHaveCount(0)
})

test("a file of the library named in a reply is shown as what it is: a picture, a film, a sound, a table", async ({
  page,
}) => {
  await openChat(page)
  await keep(page, "q3.png", "image/png", PNG, "charts")
  await keep(page, "chime.wav", "audio/wav", SOUND)
  await keep(
    page,
    "signups.csv",
    "text/csv",
    Buffer.from('Region,Signups,Note\nNorth,"1,204","grew ""fast"""\nSouth,987,steady\n'),
  )
  await keep(page, "clip.webm", "video/webm", CLIP)
  await keep(page, "broken.webm", "video/webm", Buffer.from("no film at all"))
  // How often the library is asked what it holds, which is how a fresh address is had.
  let listings = 0
  page.on("request", (request) => {
    if (/\/api\/agents\/[^/]+\/library$/.test(new URL(request.url()).pathname)) listings += 1
  })

  // The picture is asked for where the library's files are viewed, which needs no session.
  const drawn = page.waitForResponse((response) =>
    /\/d\/[^/]+\/[^/]+\/charts\/q3\.png/.test(response.url()),
  )
  await reply(
    page,
    [
      "![The chart](charts/q3.png)",
      "![A chime](chime.wav)",
      "![Signups](signups.csv)",
      "![The film](clip.webm)",
      "![A film that is none](broken.webm)",
      "![A lost thing](nowhere.png)",
    ].join("\n\n"),
  )
  expect((await drawn).status()).toBe(200)
  await expect(page.getByRole("img", { name: "The chart" }).first()).toBeVisible()

  // The film has a player with the browser's own controls, which knows how long it is without
  // having been played, and can be moved about in.
  const player = film(page, "clip.webm")
  await expect(player).toHaveJSProperty("controls", true)
  await expect.poll(() => player.evaluate(lengthOf)).toBeCloseTo(4, 0)
  expect(await player.evaluate((video: HTMLVideoElement) => video.paused)).toBe(true)
  expect(await player.evaluate(moveTo, 3)).toBeCloseTo(3, 0)
  // It is in a box of the usual shape, whatever its own is.
  const shape = (await page.getByLabel("clip.webm", { exact: true }).boundingBox())!
  expect(shape.width / shape.height).toBeCloseTo(16 / 9, 1)

  // The sound has a player, which knows how long it is and can be moved along.
  const play = page.getByRole("button", { name: "Play chime.wav" })
  const bar = page.getByRole("slider", { name: "Where chime.wav is played from" })
  await expect(play).toBeVisible()
  await expect(bar).toHaveAttribute("aria-valuemax", "4")
  await expect(words(page, "0:04", { exact: true })).toBeVisible()
  const box = (await bar.boundingBox())!
  // A little past three seconds of its four.
  await bar.click({ position: { x: box.width * 0.8, y: box.height / 2 } })
  await expect(bar).toHaveAttribute("aria-valuenow", "3")
  await expect(words(page, "0:03", { exact: true })).toBeVisible()
  await play.click()
  await expect(page.getByRole("button", { name: "Pause chime.wav" })).toBeVisible()
  // It plays to its end, and is then ready to be played again.
  await expect(play).toBeVisible()

  // The table's first rows, with what quotes hold kept whole.
  for (const cell of ["Region", "North", "1,204", 'grew "fast"', "987", "steady"]) {
    await expect(words(page, cell, { exact: true })).toBeVisible()
  }
  // What is not in the library is its words.
  await expect(words(page, "A lost thing", { exact: true })).toBeVisible()
  // A film that cannot be played says so, once the library has been asked again for where it
  // is, and no more than once; and there is a way to it in the library.
  await expect(words(page, "broken.webm could not be played here.")).toBeVisible()
  await expect(film(page, "broken.webm")).toHaveCount(0)
  const asked = listings
  await page.waitForTimeout(500)
  expect(listings).toBe(asked)
  await page.getByRole("button", { name: "Open in the library" }).click()
  await expect(page).toHaveURL(/\/library\/[^/?]+$/)
})

test("a film or a sound whose address has grown old is asked for again, and then plays", async ({
  page,
}) => {
  await openChat(page)
  await keep(page, "old.webm", "video/webm", CLIP)
  await keep(page, "old.wav", "audio/wav", SOUND)
  await reply(page, "![An old film](old.webm)\n\n![An old sound](old.wav)")
  const player = film(page, "old.webm")
  const bar = page.getByRole("slider", { name: "Where old.wav is played from" })
  await expect.poll(() => player.evaluate(lengthOf)).toBeCloseTo(4, 0)
  await expect(bar).toHaveAttribute("aria-valuemax", "4")

  // The chat is opened afresh, and the first the app then hears of the library, its files are
  // at an address that no longer works: the film and the sound both start from there.
  let old = true
  await page.route(/\/api\/agents\/[^/]+\/library$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue()
    const response = await route.fetch()
    const listing = (await response.json()) as { view: string }
    if (!old) return route.fulfill({ response })
    old = false
    return route.fulfill({ response, json: { ...listing, view: "an-old-address" } })
  })
  const refused = (name: string) =>
    page.waitForResponse((response) => response.url().includes(`/an-old-address/${name}`))
  const asked = [refused("old.webm"), refused("old.wav")]
  await page.reload()
  await expect(composer(page)).toHaveAttribute("placeholder", "Message Pip")
  for (const response of await Promise.all(asked)) expect(response.ok()).toBe(false)
  // The library is asked where its files are now, and each is played from there.
  await expect.poll(() => player.evaluate(lengthOf)).toBeCloseTo(4, 0)
  expect(await player.evaluate((video: HTMLVideoElement) => video.currentSrc)).not.toContain(
    "an-old-address",
  )
  await expect(bar).toHaveAttribute("aria-valuemax", "4")
  await expect(words(page, /^old\.\w+ could not be played here\.$/)).toHaveCount(0)
})

test("a film the agent sends has the player over its card, and the library plays it", async ({
  page,
}) => {
  await openChat(page)
  // The agent has the film where it works, as it would one it had recorded, and sends it. The
  // model here says a long thing slowly, so the film is not written out by it.
  await keep(page, "take.webm", "video/webm", CLIP)
  await send(page, '/tool library {"action":"get","file":"take.webm","path":"sent.webm"}')
  await expect(words(page, /Copied take\.webm/).first()).toBeVisible()
  await send(page, '/tool send_file {"path":"sent.webm"}')
  const card = page.getByRole("button", { name: /^sent\.webm, [\d.]+ KB$/ })
  await expect(card).toBeVisible()
  const player = film(page, "sent.webm")
  await expect.poll(() => player.evaluate(lengthOf)).toBeCloseTo(4, 0)
  expect(await player.evaluate(moveTo, 2)).toBeCloseTo(2, 0)
  // The player is over the card, and not under it.
  expect((await player.boundingBox())!.y).toBeLessThan((await card.boundingBox())!.y)

  // The card opens the film in the library, which plays it too, and the one in the chat stops.
  const stopped = () =>
    page
      .locator("video")
      .evaluateAll((all) => all.every((video) => (video as HTMLVideoElement).paused))
  await player.evaluate((video: HTMLVideoElement) => {
    video.muted = true
    video.loop = true
    return video.play()
  })
  expect(await stopped()).toBe(false)
  await card.click()
  await expect(page).toHaveURL(/\/library\/[^/?]+$/)
  await expect.poll(() => film(page, "sent.webm").evaluate(lengthOf)).toBeCloseTo(4, 0)
  await expect.poll(stopped).toBe(true)
})

test("a table the agent sends has its first rows over its card", async ({ page }) => {
  await openChat(page)
  await send(page, '/tool write {"path":"sent.csv","content":"City,Visits\\nLeeds,41\\nYork,7\\n"}')
  await expect(words(page, /Successfully wrote to sent\.csv/).first()).toBeVisible()
  await send(page, '/tool send_file {"path":"sent.csv"}')
  await expect(page.getByRole("button", { name: /^sent\.csv, \d+ B$/ })).toBeVisible()
  for (const cell of ["City", "Visits", "Leeds", "41", "York"]) {
    await expect(words(page, cell, { exact: true })).toBeVisible()
  }
})

test("a page the agent drew puts words in the message box when the reader presses in it, and not by itself", async ({
  page,
}) => {
  const draw = (title: string, html: string) =>
    send(page, `/tool visual ${JSON.stringify({ title, html })}`)
  const frameOf = (file: string) => page.getByLabel(`Visual: ${file}`).frameLocator("iframe")
  await openChat(page)
  // One that tries the moment it loads, with nobody having pressed anything.
  await draw("Eager", "<p>hello</p><script>dc.say('I was never pressed')</script>")
  await expect(frameOf("eager.html").getByText("hello")).toBeVisible()
  // What a page says reaches the app a moment after it says it, so it is given that moment.
  await page.waitForTimeout(500)
  await expect(composer(page)).toHaveValue("")
  await draw(
    "Plans",
    "<button id=pick>Plan B</button><script>pick.onclick = function () { dc.say('Go with plan B') }</script>",
  )
  const pick = frameOf("plans.html").getByRole("button", { name: "Plan B" })
  await expect(pick).toBeVisible()
  await expect(composer(page)).toHaveValue("")

  await pick.click()
  await expect(composer(page)).toHaveValue("Go with plan B")
  // The words are the reader's to send: nothing was said for them.
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible()
  await expect(words(page, "Go with plan B", { exact: true })).toHaveCount(1) // only in the box
  // More goes after what is there, on a line of its own.
  await pick.click()
  await expect(composer(page)).toHaveValue("Go with plan B\nGo with plan B")
})

test("a page the agent drew hands the reader a file, and is opened on a screen of its own in the app's colors", async ({
  page,
}) => {
  await openChat(page)
  await send(
    page,
    `/tool visual ${JSON.stringify({
      title: "Figures",
      html: "<button id=save>Save</button><button id=large>Larger</button><script>save.onclick = function () { dc.save('figures.csv', 'a,b\\n1,2', 'text/csv') }; large.onclick = function () { dc.expand() }</script>",
    })}`,
  )
  const frame = page.getByLabel("Visual: figures.html").frameLocator("iframe")
  await expect(frame.getByRole("button", { name: "Save" })).toBeVisible()
  const download = page.waitForEvent("download")
  await frame.getByRole("button", { name: "Save" }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe("figures.csv")
  expect(readFileSync(await file.path(), "utf8")).toBe("a,b\n1,2")

  // Large, on a phone, is the library's own screen for the page, in the app's light or dark.
  await frame.getByRole("button", { name: "Larger" }).click()
  const large = page.locator('iframe[title="figures.html"]').last()
  await expect(large).toBeVisible()
  await expect(large.contentFrame().getByRole("button", { name: "Larger" })).toBeVisible()
  await expect(large.contentFrame().locator("html")).toHaveAttribute(
    "data-dc-theme",
    /^(light|dark)$/,
  )
  expect(await large.getAttribute("src")).toContain("#dc-theme=")
  await page.screenshot({ path: "test-results/phone-page-large.png" })
})

test("a connector's own page for a tool is shown in the chat, told what the tool answered, and asks before a tool that may change something", async ({
  page,
}) => {
  const mcp = await startFakeMcp()
  try {
    await signIn(page)
    const id = await agentId(page)
    const added = await page.request.post(`/api/agents/${id}/connectors`, {
      data: { name: "Weather", url: `${mcp.origin}/apps/mcp` },
    })
    expect(added.ok()).toBe(true)
    await agent(page, "Pip").click()
    await send(page, `/tool weather__forecast ${JSON.stringify({ city: "Lisbon" })}`)
    // It says whose page it is: not the Dood's, and not the app's.
    await expect(words(page, "From Weather")).toBeVisible()
    const frame = page.getByLabel("App: forecast from Weather").frameLocator("iframe")
    // The page was told what the tool was asked and what it answered, and where it is shown.
    await expect(frame.locator("#city")).toHaveText("Lisbon")
    await expect(frame.locator("#temp")).toHaveText("Sunny, 21 degrees")
    await expect(frame.locator("html")).toHaveAttribute("data-host", "do-computer")
    // It is nobody: it has no cookies, and cannot reach the app it is served from.
    await expect(frame.locator("html")).toHaveAttribute("data-cookie", "blocked")
    await expect(frame.locator("html")).toHaveAttribute("data-api", "blocked")
    await page.screenshot({ path: "test-results/phone-connector-page.png" })

    // A tool that only reads runs at once.
    await frame.getByRole("button", { name: "Refresh" }).click()
    await expect(frame.locator("#log")).toHaveText("refresh done")
    // Booking may change something, so the person is asked, and a no is told to the page.
    const refused = new Promise<string>((resolve) =>
      page.once("dialog", (dialog) => {
        resolve(dialog.message())
        void dialog.dismiss()
      }),
    )
    await frame.getByRole("button", { name: "Book a trip" }).click()
    expect(await refused).toContain("Let this page use “book”?")
    await expect(frame.locator("#log")).toHaveText("refused: The person said no.")
    const agreed = agree(page)
    await frame.getByRole("button", { name: "Book a trip" }).click()
    expect(await agreed).toContain("The page from Weather wants to run that tool there")
    await expect(frame.locator("#log")).toHaveText("book done")
    // Its words go in the message box, for the person to send or not.
    await frame.getByRole("button", { name: "Tell the Dood" }).click()
    await expect(composer(page)).toHaveValue("Book the trip to Lisbon")
  } finally {
    await mcp.close()
  }
})

test("a second agent hatches and names itself, settings show who and what there is, and signing out ends the session", async ({
  page,
}) => {
  await signIn(page)
  await page.getByRole("button", { name: "New", exact: true }).click()
  await item(page, "New Dood").click()
  // It is met in its own chat as an egg with no name, which hatches there, once.
  await expect(page).toHaveURL(/\/a\/[^/]+$/)
  await expect(page.getByRole("heading", { name: "Say hello" })).toBeVisible()
  await expect(words(page, /It has no name yet/)).toBeVisible()
  const unhatched = async () =>
    (
      (await (await page.request.get("/api/agents")).json()) as { agents: { hatched: boolean }[] }
    ).agents.filter((each) => !each.hatched).length
  await expect.poll(unhatched, { timeout: 15_000 }).toBe(0)
  await expect(page.getByRole("button", { name: "Skip the hatching" })).toHaveCount(0)
  await expect(composer(page)).toHaveAttribute("placeholder", "Say hello")
  // The name it gives itself is told to the page as it happens, and to the list behind it.
  await send(page, '/tool set_identity {"name":"Dot","tagline":"Small but mighty"}')
  await expect(composer(page)).toHaveAttribute("placeholder", "Message Dot")
  await expect(page.getByRole("button", { name: "Dot's page" })).toBeVisible()
  await back(page).click()
  await expect(agent(page, "Dot")).toBeVisible()
  await expect(agent(page, "Pip")).toBeVisible()

  await page.getByRole("button", { name: "Phone user: settings and signing out" }).click()
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible()
  await expect(words(page, "Phone user", { exact: true })).toBeVisible()
  await expect(words(page, /^mobile@example\.com/)).toBeVisible()
  await expect(row(page, "Notifications")).toBeVisible()
  await expect(page.getByRole("button", { name: "Personal: workspace settings" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Pip's settings" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Dot's settings" })).toBeVisible()
  await row(page, "General").click()
  await expect(page.getByRole("heading", { name: "General" })).toBeVisible()
  await back(page).click()

  const asked = agree(page)
  await page.getByRole("button", { name: "Sign out" }).click()
  expect(await asked).toContain("Sign out")
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible()
  await open(page)
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible()
})
