import { existsSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Page } from "@playwright/test"
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
  await send(page, "hello from the phone")
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
