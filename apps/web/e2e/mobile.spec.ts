import { existsSync, readFileSync, statSync } from "node:fs"
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
// Calls are open to everyone on this server, and have no voice: the server hands the app a
// script to play, in which the voice hears a question, hands it on to the Dood, says what the
// Dood answers, and then says goodbye (see calls.spec.ts, which does the same in the web app).
test.use({ settings: { DC_CALLS: "on", DC_CALLS_SCRIPT: "1" } })
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

  // The server kept each thing said once, in order, and the work went to a side chat of the call's own.
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
  expect(kept.chatId).toMatch(/^\d+$/)
  expect(chat.messages.some((message) => message.spoken !== undefined)).toBe(false)
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
  await expect(page.getByRole("button", { name: "Pip's side chats" })).toBeVisible()
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
