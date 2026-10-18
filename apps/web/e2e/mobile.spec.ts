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
// Saved logins are for the deployment's admins unless it says otherwise, and cards are kept only
// where it names them: the phone's user is an admin here, and it does, as in passwords.spec.ts.
// Calls are open to everyone on this server, and have no voice: the server hands the app a
// script to play, in which the voice hears a question, hands it on to the Dood, says what the
// Dood answers, and then says goodbye (see calls.spec.ts, which does the same in the web app).
test.use({
  settings: {
    DC_ADMIN_EMAILS: "mobile@example.com",
    DC_SECRET_KINDS: "passwords,cards",
    DC_CALLS: "on",
    DC_CALLS_SCRIPT: "1",
    // A side chat as there were before can be made here, to see that one is kept and read.
    DC_TEST_OLD_SIDE_CHATS: "1",
  },
})
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

/**
 * Wait for something in a row of the agent's working, which in the main chat holds its steps and
 * the events it was told of, folded until opened: the rows are opened as they come.
 */
async function seeInWork(page: Page, locator: ReturnType<Page["locator"]>, timeout = 10_000) {
  // A row does not say whether it is open, so each is opened once, as it comes.
  const rows = page.getByRole("button", { name: /^Work(ed|ing) on it/ }).filter({ visible: true })
  let opened = 0
  await expect
    .poll(
      async () => {
        for (const count = await rows.count(); opened < count; opened++) {
          await rows.nth(opened).click()
        }
        return locator.first().isVisible()
      },
      { timeout },
    )
    .toBe(true)
}

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
  // The message shows it by its name, and not the line that tells the agent.
  await expect(words(page, new RegExp(`^${pasted.source}$`)).first()).toBeVisible()
})

test("the agent's work leaves only its answer, and a sent file can be opened", async ({ page }) => {
  await openChat(page)
  await send(page, '/tool write {"path":"list.md","content":"- eggs\\n- flour\\n"}')
  await expect(words(page, /Successfully wrote to list\.md/).first()).toBeVisible()
  // The call itself is not in the transcript, only what the agent said.
  await expect(page.getByRole("button", { name: "Wrote list.md" })).toHaveCount(0)

  await send(page, '/tool send {"text":"","files":["list.md"]}')
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
    // The answer is told to the agent as an event, in the row of its working.
    await seeInWork(page, words(page, /allowed Run commands: echo from-the-phone/))
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
  await send(page, "just before starting fresh")
  await expect(words(page, /You said: just before starting fresh/)).toBeVisible()
  await page.getByRole("button", { name: "More", exact: true }).click()
  const asked = agree(page)
  await item(page, "Start fresh").click()
  expect(await asked).toContain("Start fresh?")

  // The transcript now starts at the fresh start, and offers what came before it.
  await expect(words(page, /You said: just before starting fresh/)).toHaveCount(0)
  await page.getByRole("button", { name: "Show earlier messages" }).click()
  await expect(words(page, /You said: just before starting fresh/)).toBeVisible()
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

  // The chat says what was pinned, with the way to open it and to take the pin off, in the row
  // of the Dood's working.
  await seeInWork(page, words(page, "Pip pinned Launch board"))
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

test("a Dood is talked to in its main chat alone, and an old side chat is kept to read", async ({
  page,
}) => {
  await openChat(page)
  // Nothing on the main chat starts another chat.
  await expect(page.getByRole("button", { name: /side chats/ })).toHaveCount(0)
  const id = await agentId(page)
  const made = await page.request.post(`/api/agents/${id}/chats/old`, {
    data: { text: "an aside about kites", requestId: crypto.randomUUID() },
  })
  expect(made.status()).toBe(201)

  // A Dood with old side chats has a row for them on its page, which lists them to read.
  await page.getByRole("button", { name: "Pip's page" }).click()
  await row(page, "Old side chats").click()
  await expect(words(page, /Kept to read\.$/)).toBeVisible()
  await row(page, "an aside about kites").click()
  await expect(words(page, /You said: an aside about kites/)).toBeVisible()
  await expect(words(page, /^An old side chat, kept to read\./)).toBeVisible()
  await expect(composer(page)).toHaveCount(0)
  await page
    .screenshot({
      path: process.env.DC_SHOTS ? `${process.env.DC_SHOTS}/mobile-old-side-chat.png` : "/dev/null",
    })
    .catch(() => {})
  // It leads back to the main chat.
  await page.getByRole("button", { name: "Back to the main chat" }).click()
  await expect(composer(page)).toBeVisible()
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
  await send(page, '/tool send {"text":"","files":["sent.webm"]}')
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
  await send(page, '/tool send {"text":"","files":["sent.csv"]}')
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
    // It says whose page it is: not the Dood's, and not the app's. It is in the row of the
    // Dood's working.
    await seeInWork(page, words(page, "From Weather"))
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

/** A box to type in on the screen in front, by what it is called. */
const box = (page: Page, name: string) =>
  page.getByLabel(name, { exact: true }).filter({ visible: true })
const save = (page: Page) =>
  page.getByRole("button", { name: "Save", exact: true }).filter({ visible: true })
/** A row that is a button and says nothing more than its name. */
const plainRow = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true }).filter({ visible: true })

async function openPasswords(page: Page) {
  await page.getByRole("button", { name: "Phone user: settings and signing out" }).click()
  await page.getByRole("button", { name: "Personal: workspace settings" }).click()
  await row(page, "Passwords").click()
  await expect(page.getByRole("heading", { name: "Passwords" })).toBeVisible()
}

test("a workspace's saved logins are added, changed, given a new password and removed on the phone, and never shown again", async ({
  page,
}) => {
  const PASSWORD = "nobody-is-shown-this-again"
  await signIn(page)
  await openPasswords(page)
  const logins = page.getByRole("list", { name: "Saved logins" })
  await expect(logins).toContainText("No logins yet")
  await expect(page.getByRole("list", { name: "Saved cards" })).toContainText("No cards yet")

  await plainRow(page, "Add a login").click()
  await expect(page.getByRole("heading", { name: "Add a login" })).toBeVisible()
  await box(page, "Name").fill("Example")
  // Each box is named to the system, so that the phone's own saved passwords can fill it in.
  await expect(box(page, "Username or email")).toHaveAttribute("autocomplete", "username")
  await expect(box(page, "Password")).toHaveAttribute("autocomplete", "current-password")
  await expect(box(page, "Password")).toHaveAttribute("type", "password")
  await box(page, "Username or email").fill("test.user@example.com")
  await box(page, "Password").fill(PASSWORD)
  // What is not a site is said before anything is sent.
  await box(page, "A site to add").fill("not a site")
  await save(page).click()
  await expect(page.getByRole("alert").filter({ visible: true })).toContainText("not a site")
  // An address is taken for its site.
  await box(page, "A site to add").fill("https://Example.com/login")
  await box(page, "A site to add").press("Enter")
  await expect(
    page.getByRole("list", { name: "Used only on" }).filter({ visible: true }),
  ).toContainText("example.com")
  await save(page).click()

  await expect(logins).toContainText("Example")
  await expect(logins).toContainText("test.user@example.com · example.com")
  await expect(logins).toContainText("Not used yet")
  // Neither the page nor what the server answers with has the password in it.
  expect(await page.content()).not.toContain(PASSWORD)
  const workspaces = (await (await page.request.get("/api/workspaces")).json()) as {
    workspaces: { id: string; savedLogins?: boolean }[]
  }
  const mine = workspaces.workspaces[0]!
  expect(mine.savedLogins).toBe(true)
  const listed = await (await page.request.get(`/api/workspaces/${mine.id}/passwords`)).text()
  expect(listed).toContain("test.user@example.com")
  expect(listed).not.toContain(PASSWORD)

  // Its name and its sites are changed, and its password is not there to change.
  await row(page, "Example").click()
  await expect(page.getByRole("heading", { name: "Example" })).toBeVisible()
  await expect(box(page, "Password")).toHaveCount(0)
  await expect(words(page, "Its password stays as it is.")).toBeVisible()
  await box(page, "Name").fill("Example at work")
  await box(page, "A site to add").fill("app.example.org")
  await save(page).click()
  await expect(logins).toContainText("Example at work")
  await expect(logins).toContainText("example.com, app.example.org")

  // A new password is given without the old one being shown.
  await row(page, "Example at work").click()
  await plainRow(page, "Replace the password").click()
  await expect(page.getByRole("heading", { name: "Replace the password" })).toBeVisible()
  await expect(box(page, "New password")).toHaveValue("")
  await box(page, "New password").fill("another-one-entirely")
  await save(page).click()
  await expect(page.getByRole("heading", { name: "Example at work" })).toBeVisible()
  expect(await page.content()).not.toContain("another-one-entirely")

  // Removing asks first.
  const asked = agree(page)
  await plainRow(page, "Remove").click()
  expect(await asked).toContain("Remove Example at work?")
  await expect(logins).toContainText("No logins yet")
})

test("a card is added on the phone without a security code, shown by its last four digits, and removed", async ({
  page,
}) => {
  await signIn(page)
  await openPasswords(page)
  const cards = page.getByRole("list", { name: "Saved cards" })
  await plainRow(page, "Add a card").click()
  await expect(page.getByRole("heading", { name: "Add a card" })).toBeVisible()
  // There is nowhere to type a security code: it is not kept.
  await expect(page.getByLabel(/security code|CVC|CVV/i).filter({ visible: true })).toHaveCount(0)
  // Each box has the keypad it needs and is named to the system for what it is.
  await expect(box(page, "Card number")).toHaveAttribute("autocomplete", "cc-number")
  await expect(box(page, "Card number")).toHaveAttribute("inputmode", "numeric")
  await expect(box(page, "Expires")).toHaveAttribute("autocomplete", "cc-exp")
  await expect(box(page, "Name on the card")).toHaveAttribute("autocomplete", "cc-name")

  // A number that is not a card's is said before anything is sent.
  await box(page, "Card number").fill("4242424242424241")
  await box(page, "Expires").fill("0840")
  await expect(box(page, "Expires")).toHaveValue("08/40")
  await save(page).click()
  await expect(page.getByRole("alert").filter({ visible: true })).toContainText("not a card number")
  await box(page, "Card number").fill("4242424242424242")
  await expect(box(page, "Card number")).toHaveValue("4242 4242 4242 4242")
  await expect(box(page, "Name")).toHaveAttribute("placeholder", "Visa ending 4242")
  await box(page, "Name on the card").fill("Test Person")
  await save(page).click()

  await expect(cards).toContainText("Visa ending 4242")
  await expect(cards).toContainText("expires 08/40 · Test Person")
  await expect(cards).toContainText("Not used yet")
  // Neither the page nor what the server answers with has the number in it.
  expect(await page.content()).not.toContain("4242 4242")
  const workspaces = (await (await page.request.get("/api/workspaces")).json()) as {
    workspaces: { id: string }[]
  }
  const listed = await (
    await page.request.get(`/api/workspaces/${workspaces.workspaces[0]!.id}/cards`)
  ).text()
  expect(listed).toContain('"last4":"4242"')
  expect(listed).not.toContain("4242424242424242")

  const asked = agree(page)
  await page.getByRole("button", { name: "Remove Visa ending 4242" }).click()
  expect(await asked).toContain("Remove Visa ending 4242?")
  await expect(cards).toContainText("No cards yet")
})

test("a payment a Dood asks about takes the card's security code with the yes, and a login it asks for is given with its sites", async ({
  page,
}) => {
  // Asking needs a computer with a browser on a shop's page (sign-in.spec.ts goes through it
  // all): here the server's answers are stood in for, so that what the phone shows and sends
  // can be looked at.
  const now = Date.now()
  let pending = true
  let answered: unknown
  await page.route(/\/api\/agents\/[^/]+\/approvals$/, async (route) => {
    const response = await route.fetch()
    const state = (await response.json()) as { pending: unknown[] }
    await route.fulfill({
      response,
      json: {
        ...state,
        pending: pending
          ? [
              {
                id: "pay-1",
                chatId: "1",
                chatTitle: "Main",
                chatKind: "chat",
                title: "Pay on shop.example.com with Visa ending 4242",
                detail:
                  "Card: Visa ending 4242\nPage: https://shop.example.com/checkout\nIt will press: “Pay $12.98”\nIt says: “Two mugs”",
                createdAt: now,
                onceOnly: true,
                wants: { label: "Security code" },
              },
            ]
          : [],
      },
    })
  })
  await page.route(/\/api\/agents\/[^/]+\/approvals\/pay-1$/, async (route) => {
    answered = route.request().postDataJSON()
    pending = false
    await route.fulfill({ json: { ok: true } })
  })
  let asking = true
  let given: unknown
  await page.route(/\/api\/agents\/[^/]+\/secrets$/, (route) =>
    route.fulfill({
      json: {
        requests: asking
          ? [
              {
                id: "login-1",
                chatId: "1",
                purpose: "To check the order",
                fields: [
                  { name: "username", description: "The username or email you sign in with" },
                  { name: "password", description: null },
                ],
                destination: { kind: "login", site: "shop.example.com" },
                createdAt: now,
              },
            ]
          : [],
      },
    }),
  )
  await page.route(/\/api\/agents\/[^/]+\/secrets\/login-1$/, async (route) => {
    given = route.request().postDataJSON()
    asking = false
    await route.fulfill({ json: { ok: true } })
  })
  await openChat(page)

  // The payment: no "always", and no yes until a code of three or four digits is typed.
  await expect(words(page, "Pay on shop.example.com with Visa ending 4242")).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Always allow" }).filter({ visible: true }),
  ).toHaveCount(0)
  const code = box(page, "Security code")
  await expect(code).toHaveAttribute("type", "password")
  await expect(code).toHaveAttribute("inputmode", "numeric")
  await expect(code).toHaveAttribute("maxlength", "4")
  await expect(code).toHaveAttribute("autocomplete", "off")
  const allow = page.getByRole("button", { name: "Allow once" }).filter({ visible: true })
  await code.fill("12")
  await expect(allow).toBeDisabled()
  await code.fill("123")
  await allow.click()
  await expect(words(page, "Pay on shop.example.com with Visa ending 4242")).toHaveCount(0)
  expect(answered).toEqual({ decision: "once", typed: "123" })

  // The login: the site that asked is always among its sites, and another can be added.
  await expect(words(page, "Pip needs a login for shop.example.com")).toBeVisible()
  await expect(box(page, "Username or email")).toHaveAttribute("autocomplete", "username")
  await expect(box(page, "Password")).toHaveAttribute("autocomplete", "current-password")
  await expect(page.getByRole("button", { name: "Remove shop.example.com" })).toHaveCount(0)
  await box(page, "Username or email").fill("test.user@example.com")
  await box(page, "Password").fill("not-a-real-password")
  await box(page, "A site to add").fill("accounts.example.com")
  await page.getByRole("button", { name: "Save", exact: true }).filter({ visible: true }).click()
  await expect(words(page, "Pip needs a login for shop.example.com")).toHaveCount(0)
  expect(given).toEqual({
    values: { username: "test.user@example.com", password: "not-a-real-password" },
    sites: ["shop.example.com", "accounts.example.com"],
  })
})

/** Where the pictures of a call on the phone are put, for whoever reads the change. */
const callShots = "test-results/mobile-call"

test("a Dood is called from the phone: it talks, hands on what was asked, and the chat keeps the call", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openChat(page)
  // The call is placed a moment late and the hand-off is taken a moment late, so that what the
  // screen shows meanwhile can be seen.
  const hold = async (route: import("@playwright/test").Route, ms: number) => {
    await new Promise((done) => setTimeout(done, ms))
    await route.continue()
  }
  await page.route(/\/api\/agents\/[^/]+\/calls$/, (route) =>
    route.request().method() === "POST" ? hold(route, 1_500) : route.continue(),
  )
  await page.route(/\/api\/agents\/[^/]+\/calls\/[^/]+\/work$/, (route) => hold(route, 2_500))

  await page.getByRole("button", { name: "Call Pip" }).click()
  // The call is a screen of its own: the Dood, what is going on, and the buttons of a call.
  await expect(words(page, "Calling Pip…")).toBeVisible()
  await expect(page.getByRole("button", { name: "End" })).toBeVisible()
  await page.screenshot({ path: `${callShots}/1-calling.png` })

  // The voice hears the question and hands it on: the Dood is working on it.
  await expect(words(page, "On a call")).toBeVisible()
  await expect(words(page, "What did I say before the call?").first()).toBeVisible()
  await expect(words(page, "Handed to Pip")).toBeVisible()
  await expect(page.getByTestId("call-status").filter({ visible: true })).toHaveText(
    "Working on it",
  )
  await page.screenshot({ path: `${callShots}/2-handed-on.png` })

  // The Dood's answer is said by its voice, and the call goes on to its goodbye.
  await expect(words(page, "Any time.")).toBeVisible({ timeout: 15_000 })
  await expect(words(page, "Handed to Pip")).toHaveCount(0)
  await expect(page.getByTestId("call-status").filter({ visible: true })).toHaveText("Listening")
  // Muting is said plainly, and taken back.
  await page.getByRole("button", { name: "Mute" }).click()
  await expect(page.getByTestId("call-status").filter({ visible: true })).toHaveText("You’re muted")
  await page.screenshot({ path: `${callShots}/3-muted.png` })
  await page.getByRole("button", { name: "Unmute" }).click()
  await expect(page.getByTestId("call-status").filter({ visible: true })).toHaveText("Listening")

  // Back in the chat the call goes on, and the bar over the chat leads back to it.
  await page.getByRole("button", { name: "Chat", exact: true }).click()
  const bar = page.getByRole("button", { name: /^On a call with Pip, / })
  await expect(bar).toBeVisible()
  await expect(page.getByRole("button", { name: "On a call with Pip", exact: true })).toBeVisible()
  await page.screenshot({ path: `${callShots}/4-in-the-chat.png` })
  await bar.click()
  await page.getByRole("button", { name: "End" }).click()

  // The chat has one record of the call, with what was said folded inside it.
  await expect(composer(page)).toBeVisible()
  await expect(words(page, /^A call of /)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole("button", { name: /^On a call with Pip/ })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Call Pip" })).toBeEnabled()
  await page.getByRole("button", { name: "What was said" }).last().click()
  await expect(words(page, /You: What did I say before the call\?/)).toBeVisible()
  await expect(words(page, /Dood: Any time\./)).toBeVisible()
  await page.screenshot({ path: `${callShots}/5-record.png` })

  // The server kept each thing said once, in order, and the work was asked in the main chat.
  const id = await agentId(page)
  const state = (await (await page.request.get(`/api/agents/${id}`)).json()) as {
    chats: { id: string; main?: boolean }[]
  }
  const main = state.chats.find((chat) => chat.main)!.id
  const chat = (await (await page.request.get(`/api/agents/${id}/chats/${main}`)).json()) as {
    messages: {
      spoken?: unknown
      parts: { call?: { chatId?: string; lines: { who: string; text: string }[] } }[]
    }[]
  }
  const kept = chat.messages.flatMap((message) => message.parts).find((part) => part.call)!.call!
  expect(kept.lines.map((line) => line.who)).toEqual(["you", "dood", "you", "dood"])
  expect(kept.lines[0]!.text).toBe("What did I say before the call?")
  expect(kept.lines[3]!.text).toBe("Any time.")
  expect(kept.chatId).toBeUndefined()
  expect(chat.messages.some((message) => message.spoken !== undefined)).toBe(true)
})

test("a Dood is not offered a call where the server does not offer one", async ({ page }) => {
  await page.route(/\/api\/agents\/[^/]+\/calls$/, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          json: { available: false, reason: "admins", voices: [], voice: null },
        })
      : route.continue(),
  )
  await openChat(page)
  await expect(page.getByRole("button", { name: "Pip's page" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Call Pip" })).toHaveCount(0)
})

test("the page that carries a call's sound on the phone makes an offer, carries events both ways, and mutes", async ({
  page,
}) => {
  // The page is run as the browser build runs it, in a frame of the app's own origin, and the
  // test is the app around it and the voice at the other end, which here is a second
  // connection in the test's own page. Only the voice's provider is stood in for.
  await open(page)
  await page
    .context()
    .grantPermissions(["local-network-access", "microphone"])
    .catch(() => page.context().grantPermissions(["microphone"]))
  const { LINE_PAGE } = await import("../../mobile/src/call/line-page.ts")
  const heard = await page.evaluate(async (html) => {
    const frame = document.createElement("iframe")
    frame.setAttribute("allow", "microphone; autoplay")
    const said: { type: string; [key: string]: unknown }[] = []
    const waitFor = (type: string) =>
      new Promise<{ type: string; [key: string]: unknown }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no ${type}`)), 10_000)
        const look = () => {
          const found = said.find((message) => message.type === type)
          if (found === undefined) return void setTimeout(look, 20)
          clearTimeout(timer)
          resolve(found)
        }
        look()
      })
    window.addEventListener("message", (event) => {
      if (event.source !== frame.contentWindow || typeof event.data !== "string") return
      said.push(JSON.parse(event.data))
    })
    const tell = (message: unknown) =>
      frame.contentWindow!.postMessage(JSON.stringify(message), "*")
    frame.srcdoc = html
    document.body.appendChild(frame)
    await waitFor("ready")
    tell({ type: "open" })
    const offer = (await waitFor("offer")) as { sdp: string }

    // The voice: it answers the offer, and talks on the channel the page opened.
    const voice = new RTCPeerConnection()
    const toPage = new Promise<string>((resolve) => {
      voice.ondatachannel = (event) => {
        const channel = event.channel
        channel.onmessage = (message) => resolve(String(message.data))
        channel.onopen = () => channel.send(JSON.stringify({ type: "session.started" }))
      }
    })
    const microphone = new Promise<MediaStreamTrack>((resolve) => {
      voice.ontrack = (event) => resolve(event.track)
    })
    await voice.setRemoteDescription({ type: "offer", sdp: offer.sdp })
    await voice.setLocalDescription(await voice.createAnswer())
    await new Promise<void>((resolve) => {
      if (voice.iceGatheringState === "complete") return resolve()
      voice.onicegatheringstatechange = () => {
        if (voice.iceGatheringState === "complete") resolve()
      }
      setTimeout(resolve, 2_500)
    })
    tell({ type: "answer", sdp: voice.localDescription!.sdp })
    await waitFor("answered")
    const event = (await waitFor("event")) as { data: string }
    tell({ type: "send", events: [JSON.stringify({ type: "session.close" })] })
    const sentToVoice = await toPage
    const track = await microphone
    await waitFor("levels")
    tell({ type: "mute", muted: true })
    tell({ type: "close" })
    voice.close()
    return {
      offerHasAudio: /m=audio/.test(offer.sdp),
      offerHasChannel: /m=application/.test(offer.sdp),
      event: event.data,
      sentToVoice,
      microphone: track.kind,
    }
  }, LINE_PAGE)
  expect(heard).toEqual({
    offerHasAudio: true,
    offerHasChannel: true,
    event: JSON.stringify({ type: "session.started" }),
    sentToVoice: JSON.stringify({ type: "session.close" }),
    microphone: "audio",
  })
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

/** The Doods in the list as they are seen, from the top down, by name. */
async function shownInOrder(page: Page): Promise<string[]> {
  const names = new Map(
    (
      (await (await page.request.get("/api/agents")).json()) as {
        agents: { id: string; name: string | null }[]
      }
    ).agents.map((each) => [each.id, each.name ?? ""]),
  )
  const ids = await page.locator('[data-testid^="agent-"]').evaluateAll((rows) =>
    rows
      .map((row) => ({
        id: row.getAttribute("data-testid")!.slice(6),
        box: row.getBoundingClientRect(),
      }))
      .filter((row) => row.box.height > 0)
      .sort((a, b) => a.box.top - b.box.top)
      .map((row) => row.id),
  )
  return ids.map((id) => names.get(id) ?? id)
}

test("the Doods are in the order they were put in elsewhere, and are moved on the phone too", async ({
  page,
}) => {
  // As wide and as tall as a phone of the day, for its pictures.
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page)
  const me = ((await (await page.request.get("/api/me")).json()) as { user: { id: string } }).user
  const order = `/api/workspaces/${encodeURIComponent(`personal:${me.id}`)}/agent-order`
  const made = (await (await page.request.post("/api/agents")).json()) as { agent: { id: string } }
  await page.request.patch(`/api/agents/${made.agent.id}`, {
    data: { name: "Fern", hatched: true },
  })
  await page.reload()
  await expect(agent(page, "Fern")).toBeVisible()
  const ids = Object.fromEntries(
    (
      (await (await page.request.get("/api/agents")).json()) as {
        agents: { id: string; name: string }[]
      }
    ).agents.map((each) => [each.name, each.id]),
  )

  // Put in order in a browser, they are in that order here, as it is said and with nothing
  // asked for again.
  await page.request.put(order, { data: { ids: [ids.Pip, ids.Fern, ids.Dot] } })
  await expect.poll(() => shownInOrder(page)).toEqual(["Pip", "Fern", "Dot"])

  // Edit is the list's edit mode: each row has a handle, and a row is no longer opened.
  await page.getByRole("button", { name: "Edit", exact: true }).click()
  const handle = (name: string) => page.getByRole("button", { name: `Move ${name}` })
  await expect(handle("Pip")).toBeVisible()
  await page.screenshot({ path: "test-results/dood-order-phone-before.png" })

  // The top one is dragged by its handle to the foot of the list. The rows it passes make room.
  const from = (await handle("Pip").boundingBox())!
  const to = (await handle("Dot").boundingBox())!
  const x = from.x + from.width / 2
  await page.mouse.move(x, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(x, from.y + from.height / 2 + 10, { steps: 3 })
  await page.mouse.move(x, to.y + to.height / 2 + 6, { steps: 14 })
  await expect.poll(() => shownInOrder(page)).toEqual(["Fern", "Dot", "Pip"])
  await page.screenshot({ path: "test-results/dood-order-phone-during.png" })
  await page.mouse.up()
  await expect.poll(() => shownInOrder(page)).toEqual(["Fern", "Dot", "Pip"])
  // The server has it, so every browser has it too.
  await expect
    .poll(
      async () =>
        (
          (await (await page.request.get("/api/agent-order")).json()) as {
            order: Record<string, string[]>
          }
        ).order[`personal:${me.id}`],
    )
    .toEqual([ids.Fern, ids.Dot, ids.Pip])
  await page.screenshot({ path: "test-results/dood-order-phone-after.png" })

  // Put in another order elsewhere while it is in edit mode, it follows that too.
  await page.request.put(order, { data: { ids: [ids.Dot, ids.Pip, ids.Fern] } })
  await expect.poll(() => shownInOrder(page)).toEqual(["Dot", "Pip", "Fern"])

  // Done leaves edit mode, and the order is kept when the app is opened again.
  await page.getByRole("button", { name: "Done", exact: true }).click()
  await expect(handle("Pip")).toHaveCount(0)
  await open(page)
  await expect.poll(() => shownInOrder(page)).toEqual(["Dot", "Pip", "Fern"])

  // Sort by latest, in edit mode, gives the order up for the one last heard from first.
  await page.getByRole("button", { name: "Edit", exact: true }).click()
  await page.getByRole("button", { name: "Personal: sort by latest" }).click()
  await expect
    .poll(
      async () =>
        (
          (await (await page.request.get("/api/agent-order")).json()) as {
            order: Record<string, string[]>
          }
        ).order,
    )
    .toEqual({})
  await expect(page.getByRole("button", { name: "Personal: sort by latest" })).toHaveCount(0)
  await page.getByRole("button", { name: "Done", exact: true }).click()
  await agent(page, "Pip").click()
  await expect(composer(page)).toHaveAttribute("placeholder", "Message Pip")
})

test("with the bus on, shows what was sent and what a chat draws anywhere, and no row of working", async ({
  page,
}) => {
  await openChat(page)
  const { agents } = (await (await page.request.get("/api/agents")).json()) as {
    agents: { id: string; name: string }[]
  }
  const pip = agents.find((one) => one.name === "Pip")!.id
  // What it said before the switch is drawn as it was.
  const returned = await words(page, /The tool returned/).count()
  await page.request.patch(`/api/agents/${pip}`, { data: { bus: true } })
  await send(page, '/tool send {"text":"Bus reply from Pip.","done":true}')
  await expect(words(page, "Bus reply from Pip.")).toBeVisible()
  await send(
    page,
    [
      '/tool subagent {"action":"start","title":"Phone helper","task":"Say what you see."}',
      '/tool send {"text":"A helper is on it."}',
    ].join("\n"),
  )
  await expect(words(page, "A helper is on it.")).toBeVisible()
  // The report is drawn in its place, as in any chat; the Dood's own words are not.
  await expect(words(page, /reported back/).last()).toBeVisible({ timeout: 15_000 })
  await expect(words(page, /Work(ed|ing) on it/)).toHaveCount(0)
  await expect(words(page, /The tool returned/)).toHaveCount(returned)
  // The turn the report started ends without a word, and leaves no line saying it is at work.
  await expect(words(page, /^Thinking/)).toHaveCount(0)
  await page.screenshot({ path: "test-results/phone-bus.png" })
  await page.request.patch(`/api/agents/${pip}`, { data: { bus: false } })
})
