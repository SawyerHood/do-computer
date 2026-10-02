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
  await page.getByRole("button", { name: "Ember" }).click()
  await page.getByRole("button", { name: "Glasses" }).click()
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
  await expect(page.getByRole("button", { name: "Ember" })).toHaveAttribute("aria-pressed", "true")
})

test("memory over its limit cannot be saved", async ({ page }) => {
  await signIn(page)
  await page.getByRole("button", { name: "Identity and memory" }).click()
  await page.locator("#user").fill("x".repeat(1400))
  await expect(page.getByText("1400 / 1375")).toBeVisible()
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled()
})

test("the agent uses its computer, and the transcript shows what it ran", async ({ page }) => {
  await signIn(page)
  await newChat(page)
  await composer(page).fill(
    '/tool bash {"command":"echo from the shell > note.txt && cat note.txt && ls"}',
  )
  await page.keyboard.press("Enter")
  await expect(page.getByText("The tool returned:")).toBeVisible()
  const row = page.getByRole("main").getByRole("button", { name: /echo from the shell/ })
  await row.click()
  await expect(page.locator("pre").filter({ hasText: "from the shell" }).last()).toContainText(
    "note.txt",
  )
  // The identity files are part of the workspace.
  await expect(page.locator("pre").last()).toContainText("MEMORY.md")
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

test("a file the agent sends appears in the chat and in the library", async ({ page }) => {
  await signIn(page)
  await newChat(page)
  await composer(page).fill(
    '/tool write {"path":"plan.md","content":"# The plan\\n\\nShip it.\\n"}',
  )
  await page.keyboard.press("Enter")
  await expect(page.getByText("Successfully wrote to plan.md")).toBeVisible()
  await composer(page).fill('/tool send_file {"path":"plan.md"}')
  await page.keyboard.press("Enter")

  const card = page.getByRole("main").getByRole("link", { name: /plan\.md/ })
  await expect(card).toBeVisible()
  const download = page.waitForEvent("download")
  await card.click()
  const file = await download
  expect(file.suggestedFilename()).toBe("plan.md")
  expect(readFileSync(await file.path(), "utf8")).toBe("# The plan\n\nShip it.\n")

  await page.getByRole("button", { name: "Library" }).click()
  const row = page.getByRole("listitem").filter({ hasText: "plan.md" })
  await expect(row).toContainText("from your agent")

  // The user can add files too, and remove any of them.
  await page.getByLabel("Choose a file to upload").setInputFiles({
    name: "notes from me.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("remember the milk"),
  })
  await expect(page.getByRole("listitem").filter({ hasText: "notes from me.txt" })).toContainText(
    "uploaded by you",
  )
  await row.getByRole("button", { name: "Delete plan.md" }).click()
  await expect(page.getByRole("listitem").filter({ hasText: "plan.md" })).toHaveCount(0)
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

  // It is also in the library, as something the user uploaded.
  await page.getByRole("button", { name: "Library", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible()
  await expect(page.getByText("shopping.txt", { exact: true })).toBeVisible()
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
  await expect(page.getByRole("link", { name: "What can you do?" })).toBeVisible()
  await page.getByRole("link", { name: "What can you do?" }).click()
  await expect(page.getByText("You said: What can you do?")).toBeVisible()
  // Nothing is wider than the screen.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})
