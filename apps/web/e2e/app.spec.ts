import { type ChildProcess, spawn } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, type Page, test } from "@playwright/test"
import { FIXED_TOKEN, startFakeMcp } from "./fake-mcp-server.ts"

const owner = { name: "Sawyer", email: "owner@example.com", password: "correct horse battery" }

async function signUp(page: Page, account = owner) {
  await page.goto("/signup")
  await page.getByLabel("Name").fill(account.name)
  await page.getByLabel("Email").fill(account.email)
  await page.getByLabel("Password").fill(account.password)
  await page.getByRole("button", { name: "Create account" }).click()
}

async function signIn(page: Page) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(owner.email)
  await page.getByLabel("Password").fill(owner.password)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForURL(/\/a\/[^/]+\/c\/\d+/)
}

const composer = (page: Page) => page.getByRole("textbox", { name: "Message" })

/** Start a chat and wait until it is the one on screen, so typing lands in it. */
async function newChat(page: Page) {
  const before = page.url()
  await page.getByRole("button", { name: "New chat", exact: true }).click()
  await page.waitForURL((url) => /\/c\/\d+$/.test(url.pathname) && url.href !== before)
  await expect(composer(page)).toHaveValue("")
}

// On a wide screen the chat list starts closed and the panel about the agent starts open. Most
// of these tests work in the chat list and read the transcript, so they have the list open and
// the panel put away, the way someone might have left them. The tests of those two say so.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("dc-chat-list", "open")
    localStorage.setItem("dc-agent-panel", "closed")
  })
})

// The tests share one server and run in order: the first creates the account the rest use.
test.describe.configure({ mode: "serial" })

test("a visitor is sent to sign in", async ({ page }) => {
  await page.goto("/")
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible()
})

test("signing up creates an agent and opens its first chat", async ({ page }) => {
  await signUp(page)
  await page.waitForURL(/\/a\/[^/]+\/c\/\d+/)
  await expect(page.getByRole("heading", { name: "Say hello" })).toBeVisible()
  await expect(page.getByText("It has no name yet")).toBeVisible()
})

test("a second account is refused on an invite-only deployment", async ({ page }) => {
  await signUp(page, { name: "Other", email: "other@example.com", password: owner.password })
  await expect(page.getByRole("alert")).toContainText("invitation")
  await expect(page).toHaveURL(/\/signup$/)
})

test("a message is answered, streamed into the transcript, and titles the chat", async ({
  page,
}) => {
  await signIn(page)
  await composer(page).fill("What can you do?")
  await page.keyboard.press("Enter")
  await expect(composer(page)).toHaveValue("")
  await expect(page.getByText("You said: What can you do?")).toBeVisible()
  await expect(page.getByRole("link", { name: "What can you do?" })).toBeVisible()

  // The transcript is the agent's, not the tab's: it is still there after a reload.
  await page.reload()
  await expect(page.getByText("You said: What can you do?")).toBeVisible()
})

test("a reply that fails is said plainly, with the provider's answer behind Details", async ({
  page,
}) => {
  await signIn(page)
  await newChat(page)
  await composer(page).fill(
    '/fail 503: {"message":"Provider returned error","code":503,"metadata":{"raw":"{\\"error\\":{\\"code\\":\\"service_overloaded\\",\\"message\\":\\"The backend is temporarily overloaded. Please retry.\\"}}","provider_name":"Meta","retry_after_seconds":60}}',
  )
  await composer(page).press("Enter")
  const failure = page.getByRole("alert").filter({ hasText: "The model is overloaded right now." })
  await expect(failure).toBeVisible()
  await expect(failure).not.toContainText("Provider returned error")

  await failure.getByRole("button", { name: "Details" }).click()
  await expect(failure).toContainText("Provider returned error")
  await expect(failure).toContainText("retry after 60s")

  // Trying again asks again, and the echo model answers this time.
  await failure.getByRole("button", { name: "Try again" }).click()
  await expect(page.getByText("You said: Try again")).toBeVisible()
  await expect(failure.getByRole("button", { name: "Try again" })).toHaveCount(0)
})

test("assistant text is rendered as Markdown", async ({ page }) => {
  await signIn(page)
  await composer(page).fill("a list:\n\n- one\n- two")
  await page.keyboard.press("Enter")
  await expect(page.locator(".prose-chat li")).toHaveText(["one", "two"])
})

test("chats are separate, and an archived chat leaves the list", async ({ page }) => {
  await signIn(page)
  await page.getByRole("button", { name: "New chat", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Say hello" })).toBeVisible()
  await composer(page).fill("second chat here")
  await page.keyboard.press("Enter")
  await expect(page.getByText("You said: second chat here")).toBeVisible()
  await expect(page.getByText("You said: What can you do?")).toHaveCount(0)

  await page.getByRole("link", { name: "second chat here" }).hover()
  await page.getByRole("button", { name: "Archive second chat here" }).click()
  await expect(page.getByRole("link", { name: "second chat here" })).toHaveCount(0)
  await expect(page.getByText("You said: What can you do?")).toBeVisible()
})

test("identity edits are saved and show up across the app", async ({ page }) => {
  await signIn(page)
  await page.getByRole("button", { name: "Identity and memory" }).click()
  await page.getByLabel("Name").fill("Juniper")
  await page.getByLabel("Tagline").fill("Calm and curious")
  // Its color is a choice; what it looks like is a roll of the dice.
  await page.getByRole("button", { name: "Tide" }).click()
  await page.getByRole("button", { name: "Roll a new look" }).click()
  await page.locator("#user").fill("Prefers short answers")
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByText("Saved", { exact: true })).toBeVisible()

  await page.getByRole("link", { name: "Back to chat" }).click()
  await expect(page.getByText("Juniper").first()).toBeVisible()
  await expect(composer(page)).toHaveAttribute("placeholder", "Message Juniper")

  await page.reload()
  await page.getByRole("button", { name: "Identity and memory" }).click()
  await expect(page.getByLabel("Name")).toHaveValue("Juniper")
  await expect(page.locator("#user")).toHaveValue("Prefers short answers")
  await expect(page.getByRole("button", { name: "Tide" })).toHaveAttribute("aria-pressed", "true")
  const agentId = page.url().match(/\/a\/([^/]+)/)![1]!
  const saved = (await (await page.request.get(`/api/agents/${agentId}`)).json()) as {
    agent: { avatar: { color: string; seed?: string }; hatched: boolean }
  }
  expect(saved.agent.avatar.color).toBe("tide")
  expect(saved.agent.avatar.seed).toMatch(/^.{6,}$/)
  // It has a name now, so it is out of its egg whether or not anyone watched.
  expect(saved.agent.hatched).toBe(true)
})

test("memory over its limit cannot be saved", async ({ page }) => {
  await signIn(page)
  await page.getByRole("button", { name: "Identity and memory" }).click()
  await page.locator("#user").fill("x".repeat(1400))
  await expect(page.getByText("1400 / 1375")).toBeVisible()
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled()
})

test("the agent uses its computer: one line says what it is doing, and only its answer stays", async ({
  page,
}) => {
  await signIn(page)
  await newChat(page)
  await composer(page).fill(
    '/tool bash {"command":"sleep 1; echo from the shell > note.txt && cat note.txt && ls"}',
  )
  await page.keyboard.press("Enter")
  // While it works, a single line says what it is doing, with the command it is running.
  await expect(page.getByRole("status")).toContainText("Running: sleep 1; echo from the shell")
  // Its creature, above the chat, is at work. It is the only one of it that moves: the one in
  // the sidebar is a picture, and there is none beside the line.
  await expect(page.locator("main [data-mood]")).toHaveAttribute("data-mood", "working")
  await expect(page.locator("[data-mood]")).toHaveCount(2)

  const transcript = page.getByRole("log")
  await expect(transcript.getByText("The tool returned:")).toBeVisible()
  await expect(transcript).toContainText("note.txt")
  // The identity files are part of the workspace.
  await expect(transcript).toContainText("MEMORY.md")

  // Once it has answered, the line is gone and the call itself was never put in the transcript.
  await expect(page.getByRole("status")).toHaveCount(0)
  await expect(transcript.getByRole("button", { name: /echo from the shell/ })).toHaveCount(0)
  await expect(transcript.getByText(/echo from the shell > note/)).toHaveCount(1)

  // The work behind the answer is kept in the panel about the agent, which opens from the header
  // above the chat and takes its place. There it can be opened and read.
  const panel = page.getByRole("complementary", { name: "About Juniper" })
  const header = page.getByRole("button", { name: "Show Juniper beside the chat" })
  await expect(panel).toHaveCount(0)
  await header.click()
  await expect(header).toHaveCount(0)
  await expect(panel.getByRole("img", { name: "Agent avatar" })).toHaveAttribute(
    "data-mood",
    /idle|done/,
  )
  // It is one entry for what was asked: a few words, so the list can be taken in at a glance.
  const work = panel.getByRole("listitem").filter({ hasText: "/tool bash" }).first()
  await expect(work).toContainText('/tool bash {"command":"sleep 1; echo from…')
  // What came of it and its steps are inside, and what a step returned is inside that.
  const step = work.getByText("Ran: sleep 1; echo from the shell", { exact: false })
  await expect(work.getByText("The tool returned")).toBeHidden()
  await expect(step).toBeHidden()
  await work.getByText("/tool bash").click()
  await expect(work.getByText("The tool returned")).toBeVisible()
  await expect(work.getByText("1 step")).toBeVisible()
  await expect(work.getByText("MEMORY.md")).toBeHidden()
  await step.click()
  await expect(work.getByText("MEMORY.md")).toBeVisible()
  // Beside its name it says what it is doing in a word or two, not the whole command.
  await expect(panel.getByText("Ready", { exact: true })).toBeVisible()
  // Put away, the header is back.
  await panel.getByRole("button", { name: "Hide this panel" }).click()
  await expect(panel).toHaveCount(0)
  await expect(header).toBeVisible()
  await expect(transcript.getByText("Thought for a moment")).toHaveCount(0)
})

test("a scheduled task runs on its own and reports back to the chat it was asked in", async ({
  page,
}) => {
  await signIn(page)
  await newChat(page)
  const soon = new Date(Date.now() + 2_500).toISOString()
  await composer(page).fill(
    `/tool schedule {"action":"create","schedule":"${soon}","prompt":"Say the magic words","title":"Magic words"}`,
  )
  await page.keyboard.press("Enter")
  await expect(page.getByText(/Scheduled\. \w+: "Magic words"/)).toBeVisible()

  // Nothing else is sent: the report arrives by itself, live.
  await expect(page.getByText("Scheduled: Magic words")).toBeVisible({ timeout: 15_000 })
  await expect(
    page.getByText(/You said: \[You are running the scheduled task "Magic words"/),
  ).toBeVisible()

  await page.getByRole("button", { name: "Automations" }).click()
  const card = page.getByRole("listitem").filter({ hasText: "Magic words" })
  await expect(card.getByText("Done", { exact: true })).toBeVisible()
  await expect(card.getByText(/reported back/)).toBeVisible()
  await card.getByRole("link", { name: "View run" }).click()
  await expect(page.getByText("Say the magic words").first()).toBeVisible()
})

test("automations can be paused, run on demand and deleted", async ({ page }) => {
  await signIn(page)
  await newChat(page)
  await composer(page).fill(
    '/tool schedule {"action":"create","schedule":"every 6h","prompt":"Stretch","title":"Stretch break"}',
  )
  await page.keyboard.press("Enter")
  await expect(page.getByText(/Scheduled\./)).toBeVisible()

  await page.getByRole("button", { name: "Automations" }).click()
  const card = page.getByRole("listitem").filter({ hasText: "Stretch break" })
  await expect(card.getByText("Active", { exact: true })).toBeVisible()
  await card.getByRole("button", { name: "Pause" }).click()
  await expect(card.getByText("Paused", { exact: true })).toBeVisible()
  await card.getByRole("button", { name: "Run now" }).click()
  await expect(card.getByText(/Last run/)).toBeVisible({ timeout: 15_000 })
  await card.getByRole("button", { name: "Delete Stretch break" }).click()
  await expect(page.getByRole("listitem").filter({ hasText: "Stretch break" })).toHaveCount(0)
})

test("scheduled runs do not clutter the chat list", async ({ page }) => {
  await signIn(page)
  await expect(page.getByRole("link", { name: "Magic words", exact: true })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Stretch break", exact: true })).toHaveCount(0)
})

test("the agent saves a skill, and it can be read, switched off and deleted", async ({ page }) => {
  await signIn(page)
  await newChat(page)
  await composer(page).fill(
    '/tool skill {"action":"create","name":"morning-brief","description":"Put together the morning brief.","content":"1. Check the calendar"}',
  )
  await page.keyboard.press("Enter")
  await expect(page.getByText('Saved skill "morning-brief".')).toBeVisible()

  await page.getByRole("button", { name: "Skills" }).click()
  const card = page.getByRole("listitem").filter({ hasText: "morning-brief" })
  await expect(card.getByText("Written by the agent")).toBeVisible()
  await expect(page.getByRole("listitem").filter({ hasText: "writing-skills" })).toContainText(
    "Built in",
  )
  await card.getByRole("button", { name: "Read" }).click()
  await expect(card.locator("pre")).toContainText("1. Check the calendar")
  await card.getByRole("checkbox", { name: "Use morning-brief" }).uncheck()
  await expect(card.getByRole("checkbox", { name: "Use morning-brief" })).not.toBeChecked()
  await card.getByRole("button", { name: "Delete morning-brief" }).click()
  await expect(page.getByRole("listitem").filter({ hasText: "morning-brief" })).toHaveCount(0)
})

test("installing a skill from a bad URL explains what went wrong", async ({ page }) => {
  await signIn(page)
  await page.getByRole("button", { name: "Skills" }).click()
  await page.getByLabel("Skill URL").fill("https://127.0.0.1:1/not-a-skill/SKILL.md")
  await page.getByRole("button", { name: "Install" }).click()
  await expect(page.getByRole("alert")).toBeVisible({ timeout: 15_000 })
})

/** Have the agent call a tool, and wait for what the tool says it did. */
async function tool(page: Page, name: string, args: Record<string, unknown>, said: string) {
  await composer(page).fill(`/tool ${name} ${JSON.stringify(args)}`)
  await page.keyboard.press("Enter")
  await expect(page.getByText(said).last()).toBeVisible()
}

test("a document the agent writes opens from the chat, to be read and edited", async ({ page }) => {
  await signIn(page)
  await newChat(page)
  await tool(
    page,
    "write",
    {
      path: "library/notes/plan.md",
      content: "# The plan\n\nShip it. Then read [more](more.md).\n",
    },
    "Successfully wrote to library/notes/plan.md",
  )
  await tool(
    page,
    "write",
    { path: "library/notes/more.md", content: "# More\n" },
    "Successfully wrote to library/notes/more.md",
  )
  await composer(page).fill('/tool send_file {"path":"library/notes/plan.md"}')
  await page.keyboard.press("Enter")

  const card = page
    .getByRole("main")
    .getByRole("button", { name: /plan\.md/ })
    .first()
  await expect(card).toBeVisible()
  const download = page.waitForEvent("download")
  await page.getByRole("link", { name: "Download plan.md" }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe("plan.md")
  expect(readFileSync(await file.path(), "utf8")).toContain("Ship it.")

  // The card opens the document beside the chat, where a link to the one next to it opens that.
  await card.click()
  const beside = page.getByRole("complementary", { name: "Document" })
  await expect(beside.getByRole("heading", { name: "The plan", level: 1 })).toBeVisible()
  await expect(composer(page)).toBeVisible()
  await page.screenshot({ path: "test-results/library-beside-chat.png" })
  await beside.getByRole("link", { name: "more", exact: true }).click()
  await expect(beside.getByRole("heading", { name: "More", level: 1 })).toBeVisible()

  // From there it opens in the library, in its folder.
  await beside.getByRole("link", { name: "Open in the Library" }).click()
  await expect(page).toHaveURL(/\/library\?path=notes%2Fmore\.md/)
  const files = page.getByRole("navigation", { name: "Files" })
  await expect(files.getByRole("button", { name: "notes" })).toBeVisible()
  await files.getByRole("link", { name: "plan.md" }).click()
  await expect(files.getByRole("link", { name: "plan.md" })).toHaveAttribute("aria-current", "page")
  await expect(page.getByRole("heading", { name: "The plan", level: 1 })).toBeVisible()

  // A link to the document beside it opens that one.
  await page.getByRole("link", { name: "more", exact: true }).click()
  await expect(page.getByRole("heading", { name: "More", level: 1 })).toBeVisible()
  await files.getByRole("link", { name: "plan.md" }).click()

  // What the user types is saved, and is what the agent then reads.
  await page.getByRole("button", { name: "Split" }).click()
  const editor = page.getByRole("textbox", { name: "Edit plan.md" })
  await editor.fill("# The plan\n\nShip it on **Friday**.\n")
  await expect(page.getByText("Saved", { exact: true })).toBeVisible()
  await expect(page.locator(".prose-doc strong")).toHaveText("Friday")
  await page.screenshot({ path: "test-results/library-document.png" })

  await page.getByRole("button", { name: "Back to chat" }).click()
  await tool(page, "bash", { command: "cat library/notes/plan.md" }, "Ship it on Friday.")

  // And what the agent then writes shows up, with the earlier content kept.
  await tool(
    page,
    "write",
    { path: "library/notes/plan.md", content: "# The plan\n\nShipped.\n" },
    "Successfully wrote to library/notes/plan.md",
  )
  await page.getByRole("button", { name: "Library", exact: true }).click()
  await page
    .getByRole("navigation", { name: "Files" })
    .getByRole("link", { name: "plan.md" })
    .click()
  await expect(page.getByText("Shipped.")).toBeVisible()
  await page.getByRole("button", { name: "History" }).click()
  await expect(page.getByRole("menuitem", { name: /Put back this version/ })).toHaveCount(2)
  await page
    .getByRole("menuitem", { name: /Put back this version/ })
    .first()
    .click()
  await expect(page.locator(".prose-doc strong")).toHaveText("Friday")
})

test("a page the agent writes is shown as a page, apart from the app", async ({ page }) => {
  await signIn(page)
  await newChat(page)
  await tool(
    page,
    "bash",
    {
      command: [
        "mkdir -p library/site",
        `printf '%s' '<link rel="stylesheet" href="style.css"><h1>Energy</h1><p id="out">static</p><a href="../notes/plan.md">the plan</a><script src="app.js"></script>' > library/site/index.html`,
        `printf '%s' 'h1{color:rgb(0, 128, 128)}' > library/site/style.css`,
        `printf '%s' 'var c;try{c=document.cookie}catch(e){c="blocked"}document.getElementById("out").textContent="ran:"+c+":"+self.origin;fetch("/api/me",{credentials:"include",mode:"no-cors"})' > library/site/app.js`,
        "echo made",
      ].join(" && "),
    },
    "made",
  )
  await page.getByRole("button", { name: "Library", exact: true }).click()
  // The page asks the app who is signed in, the way a hostile page would.
  const asked = page.waitForRequest(
    (request) => request.url().endsWith("/api/me") && request.frame() !== page.mainFrame(),
  )
  await page
    .getByRole("navigation", { name: "Files" })
    .getByRole("link", { name: "index.html" })
    .click()
  // The browser sends that without the session: to it, the page is another site.
  expect((await (await asked).allHeaders()).cookie).toBeUndefined()

  const frame = page.frameLocator('iframe[title="index.html"]')
  // The stylesheet and the script beside it loaded, by their relative addresses.
  await expect(frame.getByRole("heading", { name: "Energy" })).toHaveCSS(
    "color",
    "rgb(0, 128, 128)",
  )
  // The script ran, but as nobody: it may not read cookies, and its origin is not the app's.
  await expect(frame.locator("#out")).toHaveText("ran:blocked:null")
  await page.screenshot({ path: "test-results/library-page.png" })

  // A link from the page to a document opens the document here.
  await frame.getByRole("link", { name: "the plan" }).click()
  await expect(page).toHaveURL(/path=notes%2Fplan\.md/)
  await expect(page.getByRole("heading", { name: "The plan", level: 1 })).toBeVisible()

  // The address of a page works without the session, and only with its own key.
  await page
    .getByRole("navigation", { name: "Files" })
    .getByRole("link", { name: "index.html" })
    .click()
  const address = await page.locator('iframe[title="index.html"]').getAttribute("src")
  const anonymous = await page.request.fetch(address!, { headers: { cookie: "" } })
  expect(anonymous.status()).toBe(200)
  expect(anonymous.headers()["content-security-policy"]).toContain("sandbox")
  const forged = await page.request.fetch(address!.replace(/\/d\/([^/]+)\/[^/]+\//, "/d/$1/0-00/"))
  expect(forged.status()).toBe(404)
})

test("the user can add, rename and delete files, and bring one back", async ({ page }) => {
  await signIn(page)
  await page.getByRole("button", { name: "Library", exact: true }).click()
  const files = page.getByRole("navigation", { name: "Files" })

  // An upload goes into the folder last clicked.
  await files.getByRole("button", { name: "notes" }).click()
  await page.getByLabel("Choose a file to upload").setInputFiles({
    name: "notes from me.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("remember the milk"),
  })
  await files.getByRole("button", { name: "notes" }).click()
  await files.getByRole("link", { name: "notes from me.txt" }).click()
  await expect(page).toHaveURL(
    /path=notes%2Fnotes\+from\+me\.txt|path=notes%2Fnotes%20from%20me\.txt/,
  )
  await expect(page.getByRole("textbox", { name: "Edit notes from me.txt" })).toHaveValue(
    "remember the milk",
  )

  await page.getByRole("button", { name: "More" }).click()
  await page.getByRole("menuitem", { name: "Rename or move" }).click()
  await page.getByLabel("Folder and name").fill("lists/shopping.txt")
  await page.getByRole("button", { name: "Save" }).click()
  await expect(files.getByRole("link", { name: "shopping.txt" })).toHaveAttribute(
    "aria-current",
    "page",
  )
  await expect(files.getByRole("button", { name: "lists" })).toBeVisible()

  await page.getByRole("button", { name: "More" }).click()
  await page.getByRole("menuitem", { name: "Delete" }).click()
  await expect(files.getByRole("link", { name: "shopping.txt" })).toHaveCount(0)

  await page.getByRole("button", { name: /Recently deleted/ }).click()
  await page.getByRole("button", { name: "Restore shopping.txt" }).click()
  await expect(files.getByRole("link", { name: "shopping.txt" })).toHaveAttribute(
    "aria-current",
    "page",
  )

  // A new document starts beside the open file, ready to be written.
  await page.getByRole("button", { name: "New document" }).first().click()
  await expect(page.getByRole("textbox", { name: "Edit Untitled.md" })).toBeVisible()
  await expect(files.getByRole("link", { name: "Untitled.md" })).toBeVisible()
  await page.screenshot({ path: "test-results/library-new.png" })
})

test("a file attached to a message is one the agent can open", async ({ page }) => {
  await signIn(page)
  await newChat(page)
  await page.getByLabel("Choose files to attach").setInputFiles({
    name: "shopping.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("oat milk\nrye bread\n"),
  })
  const attached = page.getByRole("list", { name: "Attached files" })
  await expect(attached.getByText("shopping.txt")).toBeVisible()
  await composer(page).fill("Here is my list")
  await composer(page).press("Enter")
  const transcript = page.getByRole("log")
  // The message names the file, and the chip is gone once it is sent.
  await expect(transcript.getByText("Attached: shopping.txt").first()).toBeVisible()
  await expect(attached).toHaveCount(0)
  await expect(transcript.getByText(/echo model\.\)/)).toBeVisible()

  await composer(page).fill('/tool library {"action":"get","file":"shopping.txt"}')
  await composer(page).press("Enter")
  await expect(transcript.getByText(/Copied shopping\.txt \(19 bytes\) to/).first()).toBeVisible()
  await composer(page).fill('/tool bash {"command":"cat uploads/shopping.txt"}')
  await composer(page).press("Enter")
  await expect(transcript.getByText("rye bread").first()).toBeVisible()

  // It is also in the library, with the other things the user attached in chats.
  await page.getByRole("button", { name: "Library", exact: true }).click()
  const files = page.getByRole("navigation", { name: "Files" })
  await expect(files.getByRole("button", { name: "uploads" })).toBeVisible()
  await expect(files.getByTitle("uploads/shopping.txt")).toBeVisible()
  // And in the agent's own folder, without it having to fetch the file first.
  await page.getByRole("button", { name: "Back to chat" }).click()
  await composer(page).fill('/tool bash {"command":"wc -c < library/uploads/shopping.txt"}')
  await composer(page).press("Enter")
  await expect(transcript.getByText("19", { exact: true }).first()).toBeVisible()
})

test("a picture pasted into the message box is attached, under a name of its own", async ({
  page,
}) => {
  await signIn(page)
  await newChat(page)
  await composer(page).fill("Look at this: ")
  const paste = (name: string, text?: string) =>
    page.evaluate(
      ([name, text]) => {
        const png = Uint8Array.from(
          atob(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
          ),
          (character) => character.charCodeAt(0),
        )
        const data = new DataTransfer()
        data.items.add(new File([png], name!, { type: "image/png" }))
        if (text) data.setData("text/plain", text)
        document
          .querySelector('textarea[aria-label="Message"]')!
          .dispatchEvent(
            new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
          )
      },
      [name, text] as const,
    )
  // A screenshot on the clipboard is called image.png every time, so it is named for the moment.
  await paste("image.png")
  const attached = page.getByRole("list", { name: "Attached files" })
  await expect(attached.getByText(/^pasted-\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d\.png$/)).toBeVisible()
  // A copied file keeps its own name. What was typed is left as it was.
  await paste("receipt.png")
  await expect(attached.getByText("receipt.png")).toBeVisible()
  await expect(composer(page)).toHaveValue("Look at this: ")
  // The built-in echo model cannot look at pictures, and the box says what that means.
  await expect(attached.getByRole("note")).toContainText("cannot look at pictures")

  await composer(page).press("Enter")
  await expect(
    page
      .getByRole("log")
      .getByText(/Attached: pasted-[\d_-]+\.png, receipt\.png/)
      .first(),
  ).toBeVisible()
  await expect(attached).toHaveCount(0)
})

test("dictation without a model key says what is missing", async ({ browser, baseURL }) => {
  // A browser with a fake microphone, so recording works without hardware or a prompt.
  const context = await browser.newContext({
    baseURL,
    permissions: ["microphone"],
    colorScheme: "dark",
  })
  const page = await context.newPage()
  await signIn(page)
  await page.getByRole("button", { name: "Dictate" }).click()
  await expect(page.getByRole("button", { name: "Stop dictating" })).toBeVisible()
  await page.waitForTimeout(600)
  await page.getByRole("button", { name: "Stop dictating" }).click()
  await expect(page.getByRole("alert")).toContainText("Dictation needs a model key")
  await context.close()
})

test.describe("pairing a computer", () => {
  const home = mkdtempSync(join(tmpdir(), "dc-e2e-laptop-"))
  let daemon: ChildProcess | undefined
  let output = ""

  test.afterAll(() => void daemon?.kill())

  test("a daemon on the user's machine is paired from the link it prints", async ({
    page,
    baseURL,
  }) => {
    writeFileSync(join(home, "hello.txt"), "a file on the user's laptop\n")
    // The real daemon, as a user would run it, with its home pointed at a scratch directory.
    daemon = spawn(
      "node",
      [
        fileURLToPath(new URL("../../daemon/dist/daemon.cjs", import.meta.url)),
        baseURL!,
        "--name",
        "test-laptop",
      ],
      {
        env: {
          ...process.env,
          HOME: home,
          DC_DAEMON_DIR: join(home, ".dc"),
          DC_DAEMON_POLL_MS: "200",
        },
      },
    )
    daemon.stdout!.on("data", (chunk) => (output += String(chunk)))
    await expect
      .poll(() => /pair\?code=[A-Z0-9-]+/.exec(output)?.[0], { timeout: 10_000 })
      .toBeTruthy()
    const link = /http\S+\/pair\?code=[A-Z0-9-]+/.exec(output)![0]

    await signIn(page)
    await page.goto(link)
    await expect(page.getByRole("heading", { name: "Connect this computer?" })).toBeVisible()
    await expect(page.getByText("test-laptop")).toBeVisible()
    await expect(page.getByText(/run any command/)).toBeVisible()
    await page.getByRole("button", { name: "Connect this computer" }).click()
    await expect(page.getByRole("heading", { name: "Connected" })).toBeVisible()

    await page.getByRole("link", { name: "See your computers" }).click()
    const card = page.getByRole("listitem").filter({ hasText: "test-laptop" })
    await expect(card.getByText("Online", { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => output).toContain("Connected to")
  })

  test("the agent works on the paired computer when asked to", async ({ page }) => {
    await signIn(page)
    await newChat(page)
    await composer(page).fill(
      '/tool bash {"command":"cat hello.txt && echo agent was here > from-agent.txt","computer":"test-laptop"}',
    )
    await page.keyboard.press("Enter")
    await expect(page.getByText("a file on the user's laptop")).toBeVisible()
    // The command really ran on that machine, and the machine has a record of it.
    expect(readFileSync(join(home, "from-agent.txt"), "utf8")).toBe("agent was here\n")
    expect(readFileSync(join(home, ".dc/audit.log"), "utf8")).toContain("cat hello.txt")
  })

  test("removing the computer cuts the daemon off", async ({ page }) => {
    await signIn(page)
    await page.getByRole("button", { name: "Computers" }).click()
    await page.getByRole("button", { name: "Remove test-laptop" }).click()
    await expect(page.getByRole("listitem").filter({ hasText: "test-laptop" })).toHaveCount(0)
    await expect.poll(() => output, { timeout: 10_000 }).toContain("was removed from your account")
    await expect.poll(() => daemon!.exitCode, { timeout: 10_000 }).toBe(0)

    await newChat(page)
    await composer(page).fill('/tool bash {"command":"ls","computer":"test-laptop"}')
    await page.keyboard.press("Enter")
    await expect(page.getByText(/There is no computer named "test-laptop"/)).toBeVisible()
  })

  test("an expired or mistyped code is explained", async ({ page }) => {
    await signIn(page)
    await page.goto("/pair?code=ZZZZ-ZZZZ")
    await expect(page.getByRole("heading", { name: "That code did not work" })).toBeVisible()
  })
})

test.describe("connectors", () => {
  let mcp: Awaited<ReturnType<typeof startFakeMcp>>
  test.beforeAll(async () => {
    mcp = await startFakeMcp()
  })
  test.afterAll(async () => {
    await mcp.close()
  })

  async function openConnectors(page: Page) {
    await signIn(page)
    await page.getByRole("button", { name: "Connectors" }).click()
    await expect(page.getByRole("heading", { name: "Connectors", exact: true })).toBeVisible()
  }

  test("a connector with a token gives the agent its tools", async ({ page }) => {
    await openConnectors(page)
    await page.getByLabel("Name", { exact: true }).fill("Sums")
    await page.getByLabel("Server address").fill(`${mcp.origin}/token/mcp`)
    await page.getByLabel("Access token (optional)").fill(FIXED_TOKEN)
    await page.getByRole("button", { name: "Add connector" }).click()

    const card = page.getByRole("listitem").filter({ hasText: "Sums" })
    await expect(card.getByText("Connected", { exact: true })).toBeVisible()
    await expect(card.getByText("2 tools: add, today")).toBeVisible()
    // The form is ready for another, and the token is not left on screen.
    await expect(page.getByLabel("Access token (optional)")).toHaveValue("")

    await newChat(page)
    await composer(page).fill('/tool sums__add {"a":19,"b":23}')
    await composer(page).press("Enter")
    await expect(page.getByRole("main").getByText("sum is 42").first()).toBeVisible()
  })

  test("a wrong token is reported, and the connector can be removed", async ({ page }) => {
    await openConnectors(page)
    await page.getByLabel("Name", { exact: true }).fill("Locked")
    await page.getByLabel("Server address").fill(`${mcp.origin}/token/mcp`)
    await page.getByLabel("Access token (optional)").fill("not-the-token")
    await page.getByRole("button", { name: "Add connector" }).click()

    const card = page.getByRole("listitem").filter({ hasText: "Locked" })
    await expect(card.getByText("Not connected", { exact: true })).toBeVisible()
    await card.getByRole("button", { name: "Remove Locked" }).click()
    await expect(card).toHaveCount(0)
  })

  test("a connector that needs a sign-in sends the user to the service and back", async ({
    page,
  }) => {
    await openConnectors(page)
    await page.getByLabel("Name", { exact: true }).fill("Calendar")
    await page.getByLabel("Server address").fill(`${mcp.origin}/oauth/mcp`)
    await page.getByRole("button", { name: "Add connector" }).click()

    // The service's own page, in the same tab.
    await expect(page.getByRole("heading", { name: /use your account/ })).toBeVisible()
    await page.getByRole("link", { name: "Deny" }).click()
    await expect(page).toHaveURL(/\/a\/[^/]+\/connectors/)
    await expect(page.getByRole("alert")).toContainText("You said no.")
    const card = page.getByRole("listitem").filter({ hasText: "Calendar" })
    await expect(card.getByText("Needs sign-in")).toBeVisible()

    await card.getByRole("button", { name: "Sign in" }).click()
    await page.getByRole("link", { name: "Allow" }).click()
    await expect(page.getByRole("status")).toContainText("Calendar is connected.")
    await expect(card.getByText("Connected", { exact: true })).toBeVisible()

    await newChat(page)
    await composer(page).fill("/tool calendar__today {}")
    await composer(page).press("Enter")
    await expect(page.getByRole("main").getByText("Dentist at 3pm").first()).toBeVisible()
  })

  test("a connector switched off is no longer offered to the agent", async ({ page }) => {
    await openConnectors(page)
    const card = page.getByRole("listitem").filter({ hasText: "Sums" })
    await card.getByRole("checkbox", { name: "Use Sums" }).uncheck()
    await page.reload()
    await expect(card.getByRole("checkbox", { name: "Use Sums" })).not.toBeChecked()

    await newChat(page)
    await composer(page).fill('/tool sums__add {"a":1,"b":1}')
    await composer(page).press("Enter")
    await expect(
      page
        .getByRole("main")
        .getByText(/sums__add is not available/)
        .first(),
    ).toBeVisible()
  })

  test("a sign-in link cannot be replayed", async ({ page }) => {
    await signIn(page)
    await page.goto("/api/connectors/callback?code=anything&state=made-up")
    // Nothing to finish: the user lands back in the app, not on a connector.
    await expect(page).toHaveURL(/\/a\/[^/]+\/c\/\d+/)
  })
})

test("search finds something said in another chat and opens that chat", async ({ page }) => {
  await signIn(page)
  await newChat(page)
  await composer(page).fill("The wifi password at the cabin is heron-lantern-42")
  await composer(page).press("Enter")
  // The whole answer, not its first words: a reply still being written is not in the history yet.
  await expect(
    page.getByRole("main").getByText(/You said: The wifi password[\s\S]*echo model\.\)/),
  ).toBeVisible()
  const cabin = page.url()
  await newChat(page)

  await page.getByRole("searchbox", { name: "Search chats" }).fill("heron-lantern")
  const results = page.getByRole("region", { name: "Search results" })
  // Both what the user said and the agent's answer match.
  await expect(results.getByRole("link")).toHaveCount(2)
  await expect(results.getByRole("link").first()).toContainText("heron-lantern-42")
  await results.getByRole("link").first().click()
  await expect(page).toHaveURL(cabin)

  await page.getByRole("searchbox", { name: "Search chats" }).fill("no-such-thing-anywhere")
  await expect(results).toContainText("Nothing matches.")
  // Clearing the search brings the chat list back.
  await page.getByRole("searchbox", { name: "Search chats" }).fill("")
  await expect(page.getByRole("link", { name: /The wifi password/ })).toBeVisible()
})

test("starting fresh keeps the earlier messages within reach", async ({ page }) => {
  await signIn(page)
  await newChat(page)
  await composer(page).fill("The first thing I said")
  await composer(page).press("Enter")
  const transcript = page.getByRole("log")
  await expect(transcript.getByText("You said: The first thing I said")).toBeVisible()

  await page.getByRole("button", { name: "Start fresh" }).click()
  await expect(transcript.getByText("New context")).toBeVisible()
  await expect(transcript.getByText("The first thing I said")).toHaveCount(0)
  await composer(page).fill("The second thing")
  await composer(page).press("Enter")
  await expect(transcript.getByText("You said: The second thing")).toBeVisible()

  // What came before is not gone, here or after a reload.
  await page.reload()
  await page.getByRole("button", { name: "Show earlier messages" }).click()
  await expect(transcript.getByText("The first thing I said", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Show earlier messages" })).toHaveCount(0)
  // In order: the old exchange, the marker, the new one.
  const text = await transcript.innerText()
  expect(text.indexOf("The first thing I said")).toBeLessThan(text.indexOf("New context"))
  expect(text.indexOf("New context")).toBeLessThan(text.indexOf("The second thing"))
})

test("an agent told to ask first waits for an answer before it acts", async ({ page }) => {
  await signIn(page)
  await page.getByRole("button", { name: "Permissions" }).click()
  const commands = page.getByRole("radiogroup", { name: "Run commands" })
  await expect(commands.getByRole("radio", { name: "Allow" })).toBeChecked()
  await commands.getByRole("radio", { name: "Ask first" }).click()
  await expect(commands.getByRole("radio", { name: "Ask first" })).toBeChecked()
  await page.reload()
  await expect(commands.getByRole("radio", { name: "Ask first" })).toBeChecked()

  await newChat(page)
  const transcript = page.getByRole("log")
  const waiting = page.getByRole("list", { name: "Waiting for your OK" })
  const run = '/tool bash {"command":"echo ran-with-permission"}'
  await composer(page).fill(run)
  await composer(page).press("Enter")
  // The command did not run; the request says exactly what would.
  await expect(waiting.getByText("Juniper wants to: Run commands")).toBeVisible()
  await expect(waiting.getByText("echo ran-with-permission")).toBeVisible()
  await expect(transcript.getByText("ran-with-permission", { exact: true })).toHaveCount(0)

  await waiting.getByRole("button", { name: "Allow once" }).click()
  await expect(waiting).toHaveCount(0)
  await expect(
    transcript.getByText("Approved: Run commands: echo ran-with-permission", { exact: true }),
  ).toBeVisible()
  // The echo model does not act on being told; a real one would. Its next attempt is let through.
  await expect(composer(page)).toBeEnabled()
  await composer(page).fill(run)
  await composer(page).press("Enter")
  await expect(transcript.getByText("ran-with-permission", { exact: true }).first()).toBeVisible()

  // Once was once. This time the answer is no.
  await composer(page).fill('/tool bash {"command":"echo second-try"}')
  await composer(page).press("Enter")
  await waiting.getByRole("button", { name: "Don’t allow" }).click()
  await expect(
    transcript.getByText("Not allowed: Run commands: echo second-try", { exact: true }),
  ).toBeVisible()
  await expect(waiting).toHaveCount(0)

  // Back to trusting it, as the other tests expect.
  await page.getByRole("button", { name: "Permissions" }).click()
  await commands.getByRole("radio", { name: "Allow" }).click()
  await expect(commands.getByRole("radio", { name: "Allow" })).toBeChecked()
})

test("the settings page shows what the agent's thinking has cost", async ({ page }) => {
  await signIn(page)
  await page.getByRole("button", { name: "Identity and memory" }).click()
  const usage = page.getByRole("region", { name: "Usage" })
  await expect(usage.getByRole("table", { name: "Usage by model" })).toBeVisible()
  // The built-in echo model is free, and says so.
  await expect(usage.getByRole("row").nth(1)).toContainText("$0")
})

test("a new agent is met as an egg, and hatches once", async ({ page }) => {
  await signIn(page)
  const first = page.url().match(/\/a\/([^/]+)/)![1]!
  await page.getByRole("button", { name: "Switch agent" }).click()
  await page.getByRole("menuitem", { name: "New agent" }).click()
  await expect(page).not.toHaveURL(new RegExp(`/a/${first}`))
  await page.waitForURL(/\/a\/[^/]+\/c\/\d+/)
  const agentId = page.url().match(/\/a\/([^/]+)/)![1]!
  const hatched = async () =>
    (
      (await (await page.request.get(`/api/agents/${agentId}`)).json()) as {
        agent: { hatched: boolean }
      }
    ).agent.hatched

  // It starts in its egg, wherever it is shown, and the wait can be skipped.
  expect(await hatched()).toBe(false)
  const welcome = page.getByRole("log").getByRole("img", { name: "Agent avatar" })
  await expect(welcome).toHaveAttribute("data-mood", "egg")
  await expect(page.getByRole("button", { name: "Skip the hatching" })).toBeVisible()

  // Then it is out, here and for good: a reload does not put it back.
  await expect.poll(hatched, { timeout: 15_000 }).toBe(true)
  await expect(page.getByRole("button", { name: "Skip the hatching" })).toHaveCount(0)
  await expect(welcome).toHaveAttribute("data-mood", "idle")
  await page.reload()
  await expect(welcome).toHaveAttribute("data-mood", "idle")
  await expect(page.getByRole("button", { name: "Skip the hatching" })).toHaveCount(0)
  await page.request.delete(`/api/agents/${agentId}`)
})

test("a second agent can be made, and deleted without touching the first", async ({ page }) => {
  await signIn(page)
  const first = page.url().match(/\/a\/([^/]+)/)![1]!
  await page.getByRole("button", { name: "Switch agent" }).click()
  await page.getByRole("menuitem", { name: "New agent" }).click()
  await expect(page).not.toHaveURL(new RegExp(`/a/${first}`))
  const second = page.url().match(/\/a\/([^/]+)/)![1]!
  await expect(page.getByText("It has no name yet")).toBeVisible()

  await page.getByRole("button", { name: "Identity and memory" }).click()
  await page.getByRole("button", { name: "Delete agent…" }).click()
  const confirm = page.getByRole("button", { name: "Delete for good" })
  await expect(confirm).toBeDisabled()
  // It has no name yet, so the word to type is "delete".
  await page.getByLabel(/to confirm/).fill("delete")
  await confirm.click()

  // Back on the first agent, which is as it was.
  await expect(page).toHaveURL(new RegExp(`/a/${first}/c/\\d+`))
  await expect(page.getByText("Juniper").first()).toBeVisible()
  const gone = await page.request.get(`/api/agents/${second}`)
  expect(gone.status()).toBe(404)
  const agents = (await (await page.request.get("/api/agents")).json()) as { agents: unknown[] }
  expect(agents.agents.length).toBe(1)
})

test("the API refuses bodies that are too large and routes that are not a client's", async ({
  page,
}) => {
  await signIn(page)
  const agentId = page.url().match(/\/a\/([^/]+)/)![1]!
  const chatId = page.url().match(/\/c\/(\d+)/)![1]!
  const api = `/api/agents/${agentId}`

  // A megabyte is the most any JSON route reads, whatever the request claims.
  const big = await page.request.post(`${api}/chats/${chatId}/messages`, {
    data: { text: "x".repeat(1_100_000), requestId: "too-big" },
  })
  expect(big.status()).toBe(413)
  const upload = await page.request.post(`${api}/library?name=huge.bin`, {
    headers: { "content-type": "application/octet-stream" },
    data: Buffer.alloc(27 * 1024 * 1024),
  })
  expect(upload.status()).toBe(413)
  // And the app is still there afterwards.
  expect((await page.request.get(`${api}/library`)).ok()).toBe(true)

  // What the gateway keeps for itself is not reachable through it.
  for (const [method, path] of [
    ["delete", "computers/anything"],
    ["post", "init"],
    ["post", "destroy"],
    ["patch", "schedules/__proto__"],
    ["patch", "skills/constructor"],
  ] as const) {
    const response = await page.request[method](`${api}/${path}`, { data: { enabled: false } })
    expect(`${method} ${path} ${response.status()}`).toBe(`${method} ${path} 404`)
  }
  expect(({} as Record<string, unknown>).enabled).toBe(undefined)
})

test("signing in works when it is tried before the page's script has loaded", async ({ page }) => {
  // Hold the scripts back, as a slow connection would, so the form is on screen but not yet live.
  await page.route(/\.js(\?.*)?$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    await route.continue()
  })
  await page.goto("/login")
  await page.getByLabel("Email").fill(owner.email)
  await page.getByLabel("Password").fill(owner.password)
  // What was typed early is still there once the script takes over, and the button waited for it.
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForURL(/\/a\/[^/]+\/c\/\d+/)
  expect(page.url()).not.toContain("password")
})

test("chatting works over plain http, where the browser withholds some features", async ({
  page,
}) => {
  // A page served over http from anything but localhost has no crypto.randomUUID and no
  // clipboard. That is how a self-hosted install on a home network or a tailnet is often reached.
  await page.addInitScript(() => {
    Object.defineProperty(crypto, "randomUUID", { value: undefined })
    Object.defineProperty(navigator, "clipboard", { value: undefined })
  })
  await signIn(page)
  await newChat(page)
  await composer(page).fill("sent without the secure-context extras")
  await composer(page).press("Enter")
  await expect(
    page.getByRole("log").getByText("You said: sent without the secure-context extras"),
  ).toBeVisible()

  // The command to pair a computer can still be copied, by selecting it.
  await page.getByRole("button", { name: "Computers" }).click()
  await page.getByRole("button", { name: "Copy command" }).first().click()
  await expect(page.getByText(/Selected\. Press/)).toBeVisible()
  expect(await page.evaluate(() => window.getSelection()?.toString())).toContain("install.sh")
})

test("a message that cannot be sent says so and stays in the box", async ({ page }) => {
  await signIn(page)
  await newChat(page)
  await page.route(/\/chats\/\d+\/messages$/, (route) => route.abort())
  await composer(page).fill("this one will not get through")
  await composer(page).press("Enter")
  await expect(page.getByRole("alert")).toContainText("That was not sent")
  await expect(composer(page)).toHaveValue("this one will not get through")

  // And goes once the way is clear.
  await page.unroute(/\/chats\/\d+\/messages$/)
  await composer(page).press("Enter")
  await expect(
    page.getByRole("log").getByText("You said: this one will not get through"),
  ).toBeVisible()
  await expect(page.getByRole("alert")).toHaveCount(0)
})

test("the transcript rests at the newest message, with no empty space under it", async ({
  page,
}) => {
  await signIn(page)
  await newChat(page)
  /** How far the last message ends above the bottom of the transcript, and whether the page scrolls. */
  const measure = () =>
    page.evaluate(() => {
      const viewport = document.querySelector('[data-slot="message-scroller-viewport"]')!
      const items = document.querySelectorAll('[data-slot="message-scroller-item"]')
      const last = items[items.length - 1]!.getBoundingClientRect()
      const frame = viewport.getBoundingClientRect()
      return {
        gap: Math.round(frame.bottom - last.bottom),
        atEnd: viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 2,
        pageScrolls: document.scrollingElement!.scrollHeight > window.innerHeight + 1,
      }
    })
  const say = async (text: string) => {
    await composer(page).fill(text)
    await composer(page).press("Enter")
    await expect(
      page.getByRole("log").getByText(new RegExp(`You said: ${text}[\\s\\S]*echo model`)),
    ).toBeVisible()
  }

  // One exchange: it sits at the bottom, next to the message box, not at the top of an empty page.
  await say("short one")
  await expect.poll(async () => (await measure()).gap).toBeLessThan(60)

  // A long conversation: still at the end, with nothing but the usual margin under the newest.
  for (const n of [2, 3, 4, 5, 6, 7]) await say(`message ${n}`)
  await expect.poll(async () => (await measure()).gap).toBeLessThan(60)
  expect(await measure()).toMatchObject({ atEnd: true, pageScrolls: false })

  // Someone reading further up is brought back when they send something.
  await page.locator('[data-slot="message-scroller-viewport"]').evaluate((element) => {
    element.scrollTop = 0
  })
  await say("back to the end")
  await expect.poll(async () => (await measure()).atEnd).toBe(true)
})

test.describe("choosing a model", () => {
  // A deployment with a model key offers hundreds. This one has none, so the list is stood in for:
  // the real echo model, plus enough others to need searching.
  const stubModels = async (page: Page) => {
    const others = Array.from({ length: 150 }, (_, index) => ({
      id: `openrouter/maker-${index % 7}/model-${index}`,
      name: `Maker ${index % 7}: Model ${index}`,
      reasoning: index % 2 === 0,
      inputCost: 1 + (index % 5),
      outputCost: 5 + (index % 9),
      contextWindow: 200_000,
      images: index % 3 === 0,
    }))
    const models = [
      {
        id: "echo/echo-1",
        name: "Echo (no model key configured)",
        reasoning: false,
        inputCost: 0,
        outputCost: 0,
        recommended: true,
      },
      {
        id: "openrouter/anthropic/claude-sonnet-5.5",
        name: "Anthropic: Claude Sonnet 5.5",
        reasoning: true,
        inputCost: 2,
        outputCost: 10,
        contextWindow: 1_000_000,
        images: true,
        recommended: true,
      },
      ...others,
    ]
    await page.route("**/api/models", (route) => route.fulfill({ json: { models } }))
  }

  test("an agent's model is picked from a list that narrows as you type", async ({ page }) => {
    await stubModels(page)
    await signIn(page)
    await page.getByRole("button", { name: "Identity and memory" }).click()
    const picker = page.getByRole("combobox", { name: "Model" })
    await expect(picker).toHaveValue("Echo (no model key configured)")

    await picker.click()
    const list = page.getByRole("listbox", { name: "Model" })
    // Not all hundred and fifty at once, and it says there are more.
    await expect(list.getByRole("option")).toHaveCount(60)
    await expect(list).toContainText("92 more. Type to narrow them down.")
    await expect(list.getByRole("option", { selected: true })).toContainText("Echo")

    // Words in any order, against the name and the id.
    await picker.fill("5.5 claude")
    await expect(list.getByRole("option")).toHaveCount(1)
    await expect(list.getByRole("option")).toContainText("$2.0 in, $10 out per million tokens")
    await expect(list.getByRole("option")).toContainText("1M context")
    await picker.fill("maker-3/")
    await expect(list.getByRole("option").first()).toContainText("Maker 3: Model 3")
    await picker.fill("nothing like this")
    await expect(list).toContainText("No model matches.")

    // Escape puts the choice back as it was.
    await picker.press("Escape")
    await expect(list).toHaveCount(0)
    await expect(picker).toHaveValue("Echo (no model key configured)")

    // Arrow keys and Enter choose, without submitting the form around the picker.
    await picker.click()
    await picker.fill("model 14")
    await picker.press("ArrowDown")
    await picker.press("Enter")
    await expect(list).toHaveCount(0)
    await expect(picker).not.toHaveValue("Echo (no model key configured)")
    // "model 14" matches Model 14 first, then 114; one step down is the second.
    await expect(picker).toHaveValue("Maker 2: Model 114")
    await expect(page.getByText("Saved", { exact: true })).toHaveCount(0)

    // The server has the last word: this stand-in model does not exist there.
    await page.getByRole("button", { name: "Save changes" }).click()
    await expect(page.getByRole("alert")).toContainText("Unknown model")

    // Back to the real one, by clicking it.
    await picker.click()
    await picker.fill("echo")
    await list.getByRole("option", { name: /Echo/ }).click()
    await expect(picker).toHaveValue("Echo (no model key configured)")
  })

  test("the default for new agents is set once, under Settings", async ({ page }) => {
    await stubModels(page)
    await signIn(page)
    await page.getByRole("button", { name: "Settings" }).click()
    await expect(page.getByRole("heading", { name: "Default model" })).toBeVisible()
    const picker = page.getByRole("combobox", { name: "Default model" })
    await expect(picker).toHaveValue("Echo (no model key configured)")
    await expect(page.getByText("This is the server’s default.")).toBeVisible()
    expect(await (await page.request.get("/api/settings")).json()).toEqual({
      defaultModel: null,
      deploymentDefaultModel: "echo/echo-1",
      defaultComputer: null,
      deploymentDefaultComputer: "just-bash",
    })

    // A model the server does not have is refused, and nothing is saved.
    await picker.click()
    await picker.fill("claude sonnet")
    await picker.press("Enter")
    await expect(page.getByRole("alert")).toContainText("not available on this deployment")
    expect((await (await page.request.get("/api/settings")).json()).defaultModel).toBe(null)

    // One it has is saved as the user's own choice, and survives a reload.
    await picker.click()
    await picker.fill("echo")
    await picker.press("Enter")
    await expect(page.getByRole("status")).toHaveText("Saved")
    await page.reload()
    await expect(page.getByRole("button", { name: "Use this server’s default" })).toBeVisible()
    expect((await (await page.request.get("/api/settings")).json()).defaultModel).toBe(
      "echo/echo-1",
    )

    // And can be handed back to the server's default.
    await page.getByRole("button", { name: "Use this server’s default" }).click()
    await expect(page.getByText("This is the server’s default.")).toBeVisible()
    expect((await (await page.request.get("/api/settings")).json()).defaultModel).toBe(null)
  })
})

test.describe("choosing a computer", () => {
  type AgentState = { computer: string | null }
  const agentIn = (page: Page) => page.url().match(/\/a\/([^/]+)/)![1]!
  const stateOf = async (page: Page, agentId: string) =>
    (await (await page.request.get(`/api/agents/${agentId}`)).json()) as AgentState

  /** Make another agent and land on it, leaving the first one as it is. */
  async function newAgent(page: Page): Promise<string> {
    const before = agentIn(page)
    await page.getByRole("button", { name: "Switch agent" }).click()
    await page.getByRole("menuitem", { name: "New agent" }).click()
    await expect(page).not.toHaveURL(new RegExp(`/a/${before}`))
    await page.waitForURL(/\/a\/[^/]+\/c\/\d+/)
    return agentIn(page)
  }

  test("an agent is moved to another kind from its own page, and told what that means", async ({
    page,
  }) => {
    await signIn(page)
    const agentId = await newAgent(page)
    expect((await stateOf(page, agentId)).computer).toBe("just-bash")
    await composer(page).fill('/tool bash {"command":"echo kept > kept.txt && ls"}')
    await page.keyboard.press("Enter")
    await expect(page.getByRole("log")).toContainText("kept.txt")

    await page.getByRole("button", { name: "Identity and memory" }).click()
    const section = page.getByRole("region", { name: "Computer" })
    // It is not moved in the middle of an answer, and says why.
    await expect
      .poll(async () => {
        const response = await page.request.patch(`/api/agents/${agentId}`, {
          data: { computer: "none" },
        })
        if (response.status() === 409) {
          expect(((await response.json()) as { error: string }).error).toContain(
            "in the middle of something",
          )
        }
        return response.status()
      })
      .toBe(200)
    await page.request.patch(`/api/agents/${agentId}`, { data: { computer: "just-bash" } })
    await page.reload()
    // Each kind says what it is, and without any provider's key these two are what there is.
    await expect(section.getByRole("radio")).toHaveCount(2)
    await expect(section.getByRole("radio", { name: "Built-in shell" })).toBeChecked()
    await expect(
      section.getByRole("radio", { name: "Built-in shell" }),
    ).toHaveAccessibleDescription(/lightweight shell inside this server/)
    await expect(section.getByRole("note")).toHaveCount(0)

    // Nothing moves until it is saved, and before that it says what moving does.
    await section.getByRole("radio", { name: "No computer" }).check()
    await expect(section.getByRole("note")).toContainText("Files are not copied")
    expect((await stateOf(page, agentId)).computer).toBe("just-bash")
    await page.getByRole("button", { name: "Save changes" }).click()
    await expect(page.getByText("Saved", { exact: true })).toBeVisible()
    await expect(section.getByRole("note")).toHaveCount(0)
    expect((await stateOf(page, agentId)).computer).toBe("none")
    await page.reload()
    await expect(section.getByRole("radio", { name: "No computer" })).toBeChecked()

    // Moved back, it finds what it left.
    await section.getByRole("radio", { name: "Built-in shell" }).check()
    await page.getByRole("button", { name: "Save changes" }).click()
    await expect(page.getByText("Saved", { exact: true })).toBeVisible()
    await page.getByRole("link", { name: "Back to chat" }).click()
    await page.waitForURL(/\/c\/\d+$/)
    await newChat(page)
    await composer(page).fill('/tool bash {"command":"cat kept.txt"}')
    await page.keyboard.press("Enter")
    await expect(page.getByRole("log")).toContainText("The tool returned:")
    await expect(page.getByRole("log")).toContainText("kept")

    // A kind this server does not offer is refused.
    const refused = await page.request.patch(`/api/agents/${agentId}`, {
      data: { computer: "daytona" },
    })
    expect(refused.status()).toBe(400)
    expect((await stateOf(page, agentId)).computer).toBe("just-bash")
    await page.request.delete(`/api/agents/${agentId}`)
  })

  test("the kind a new agent gets is set once, under Settings", async ({ page }) => {
    await signIn(page)
    await page.getByRole("button", { name: "Settings" }).click()
    const section = page.getByRole("region", { name: "Default computer" })
    await expect(section.getByRole("radio", { name: "Built-in shell" })).toBeChecked()
    await expect(section.getByText("this server’s default")).toBeVisible()
    expect(await (await page.request.get("/api/computer-kinds")).json()).toMatchObject({
      kinds: [{ id: "just-bash" }, { id: "none" }],
      default: "just-bash",
    })

    await section.getByRole("radio", { name: "No computer" }).check()
    await expect(section.getByRole("status")).toHaveText("Saved")
    expect((await (await page.request.get("/api/settings")).json()).defaultComputer).toBe("none")
    await page.reload()
    await expect(section.getByRole("radio", { name: "No computer" })).toBeChecked()

    // A new agent starts there. The ones that exist are where they were.
    const first = agentIn(page)
    await page.getByRole("link", { name: "Back to chat" }).click()
    const made = await newAgent(page)
    expect((await stateOf(page, made)).computer).toBe("none")
    expect((await stateOf(page, first)).computer).toBe("just-bash")
    await page.request.delete(`/api/agents/${made}`)

    // Choosing the server's own default goes back to following it.
    await page.goto(`/a/${first}/settings`)
    await section.getByRole("radio", { name: "Built-in shell" }).check()
    await expect(section.getByRole("status")).toHaveText("Saved")
    expect((await (await page.request.get("/api/settings")).json()).defaultComputer).toBe(null)
    const refused = await page.request.patch("/api/settings", {
      data: { defaultComputer: "modal" },
    })
    expect(refused.status()).toBe(400)
  })
})

test("the chat list is put away until it is asked for, and stays how it was left", async ({
  browser,
  baseURL,
}) => {
  // A browser that has never said how it wants things laid out.
  const context = await browser.newContext({ baseURL, colorScheme: "dark" })
  const page = await context.newPage()
  await signIn(page)
  await expect(page.getByRole("searchbox", { name: "Search chats" })).toHaveCount(0)
  // The agent has the room instead: its panel is open beside the chat, and stays shut once hidden.
  const panel = page.getByRole("complementary", { name: "About Juniper" })
  await expect(panel.getByRole("img", { name: "Agent avatar" })).toBeVisible()
  await panel.getByRole("button", { name: "Hide this panel" }).click()
  await page.reload()
  await expect(composer(page)).toBeVisible()
  await expect(panel).toHaveCount(0)
  // Pressing the header above the chat brings it back.
  await page.getByRole("button", { name: "Show Juniper beside the chat" }).click()
  await expect(panel.getByRole("img", { name: "Agent avatar" })).toBeVisible()

  // A chat can be started without it.
  const before = page.url()
  await page.getByRole("button", { name: "New chat", exact: true }).click()
  await page.waitForURL((url) => /\/c\/\d+$/.test(url.pathname) && url.href !== before)

  // Asked for, it is beside the chat, and still there after a reload.
  await page.getByRole("button", { name: "Chats", exact: true }).click()
  await expect(page.getByRole("searchbox", { name: "Search chats" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Chats", exact: true })).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole("searchbox", { name: "Search chats" })).toBeVisible()
  await page.getByRole("button", { name: "Hide chats" }).click()
  await expect(page.getByRole("searchbox", { name: "Search chats" })).toHaveCount(0)
  await context.close()
})

test("signing out ends the session", async ({ page }) => {
  await signIn(page)
  await page.getByRole("button", { name: "Sign out" }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.goto("/")
  await expect(page).toHaveURL(/\/login$/)
})

test("the layout works at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 800 })
  await signIn(page)
  await page.getByRole("button", { name: "Chats" }).click()
  // The agent's pages are a menu that fits the sheet.
  const pages = page.getByRole("navigation", { name: "Pages" })
  await expect(pages.getByRole("link")).toHaveCount(8)
  // Measured once the sheet has finished sliding in.
  await expect(async () => {
    const sheet = (await page.getByRole("dialog").boundingBox())!
    expect(sheet.x).toBe(0)
    for (const link of await pages.getByRole("link").all()) {
      const box = (await link.boundingBox())!
      expect(box.x + box.width).toBeLessThanOrEqual(sheet.x + sheet.width)
    }
  }).toPass()
  await expect(page.getByRole("link", { name: "What can you do?" })).toBeVisible()
  await page.getByRole("link", { name: "What can you do?" }).click()
  await expect(page.getByText("You said: What can you do?")).toBeVisible()
  // Nothing is wider than the screen.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})
