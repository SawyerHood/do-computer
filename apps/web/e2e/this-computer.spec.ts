import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures.ts"
import { asOwner, card, composer, owner, signIn } from "./helpers.ts"

// Someone who has Doods already and signs in to the desktop app on another computer is taken
// straight to them: no egg comes down, and no Dood is hatched to ask about the computer. That
// is asked in the app, and what is given the computer is a workspace. Here the app is stood in
// for by what it gives a page.
asOwner()

/**
 * What the desktop app gives a page of the deployment on its first run, with a note of what it
 * is asked. Sharing this computer is its daemon asking to be paired, which gets a code. With
 * `pairedAs`, the first run is over and this computer is the one the server knows by that.
 */
const asDesktopApp = (page: Page, pairedAs: string | null = null) =>
  page.addInitScript((pairedAs) => {
    const asked: unknown[] = []
    Object.assign(window, {
      asked,
      doComputer: {
        platform: "darwin",
        computer: "sawyers-air",
        canOpenAtLogin: true,
        welcomed: pairedAs !== null,
        sharing: pairedAs === null ? "off" : "on",
        pairedAs: async () => pairedAs,
        signIn: async () => ({ error: "Not here." }),
        cancelSignIn: async () => {},
        share: async (options: { readOnly: boolean }) => {
          asked.push({ share: options })
          const started = await fetch("/api/computers/pair/start", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name: "sawyers-air",
              hostname: "sawyers-air.local",
              platform: "darwin",
              home: "/Users/sawyer",
              readOnly: options.readOnly,
            }),
          })
          return { code: ((await started.json()) as { code: string }).code }
        },
        finish: async (options: unknown) => {
          asked.push({ finish: options })
        },
        setIcon: async () => {},
      },
    })
  }, pairedAs)

const asked = (page: Page) => page.evaluate(() => (window as unknown as { asked: unknown[] }).asked)

type Listed = {
  id: string
  name: string
  kind: string
  workspaceId: string
  agentIds: string[]
  readOnly: boolean
}
/** The computers that were paired: a workspace has machines of its own besides. */
const paired = async (page: Page) =>
  (
    (await (await page.request.get("/api/computers")).json()) as { computers: Listed[] }
  ).computers.filter((computer) => computer.kind === "paired")

const question = (page: Page) =>
  page.getByRole("dialog").filter({ hasText: "Let your Doods work on this computer?" })

let team = ""
let own: string[] = []
let teams: string[] = []

test("someone who has Doods is taken straight to them, and asked about this computer there", async ({
  page,
}) => {
  await signIn(page)
  // Two Doods of their own, and a team with one.
  const made = async (workspaceId?: string) => {
    const response = await page.request.post("/api/agents", {
      data: workspaceId === undefined ? {} : { workspaceId },
    })
    expect(response.status()).toBe(201)
  }
  await made()
  const started = await page.request.post("/api/workspaces", { data: { name: "Tidewater" } })
  team = ((await started.json()) as { workspace: { id: string } }).workspace.id
  await made(team)
  const { agents } = (await (await page.request.get("/api/agents")).json()) as {
    agents: { id: string; workspaceId: string }[]
  }
  teams = agents.filter((agent) => agent.workspaceId === team).map((agent) => agent.id)
  own = agents.filter((agent) => agent.workspaceId !== team).map((agent) => agent.id)
  expect([own.length, teams.length]).toEqual([2, 1])

  // The app opens on the first run until it is over. They are signed in, so it is not for them.
  await asDesktopApp(page)
  await page.goto("/welcome")
  await page.waitForURL(/\/a\/[^/]+\/c\/\d+/)
  await expect(page.locator("[data-welcome]")).toHaveCount(0)

  // Their own workspace is the one they were in, so it is the one offered first.
  const dialog = question(page)
  await expect(dialog).toContainText("sawyers-air")
  await expect(dialog.getByRole("radio", { name: /Personal/ })).toBeChecked()
  await expect(
    dialog.getByText("It stays yours: only you decide which Doods use it."),
  ).toBeVisible()
  // Nothing else on the page puts it away: it is asked once.
  await page.keyboard.press("Escape")
  await expect(dialog).toBeVisible()

  await dialog.getByRole("radio", { name: /^Tidewater/ }).check()
  await expect(dialog.getByText(/It becomes Tidewater’s/)).toBeVisible()
  await dialog.getByRole("button", { name: "Yes, work here" }).click()
  await expect(dialog.getByRole("status")).toContainText("sawyers-air is paired.")
  await expect(dialog).toHaveCount(0)

  // The computer is the team's, with every Dood of the team and none of their own.
  const [computer] = await paired(page)
  expect(computer).toMatchObject({ name: "sawyers-air", workspaceId: team, readOnly: false })
  expect(computer!.agentIds).toEqual(teams)
  // The app was told the first run is over, and whether to open at sign-in.
  expect(await asked(page)).toEqual([
    { share: { readOnly: false } },
    { finish: { openAtLogin: true } },
  ])
})

test("told not now, the app is told so and nothing is paired", async ({ page }) => {
  await signIn(page)
  const before = (await paired(page)).length
  await asDesktopApp(page)
  await page.goto("/")
  const dialog = question(page)
  await dialog.getByRole("checkbox", { name: /^Open Do Computer when I sign in/ }).click()
  await dialog.getByRole("button", { name: "Not now" }).click()
  await expect(dialog).toHaveCount(0)
  expect(await asked(page)).toEqual([{ finish: { openAtLogin: false } }])
  expect(await paired(page)).toHaveLength(before)
})

test("asked for their own workspace, every Dood of theirs is given it, to read", async ({
  page,
}) => {
  await signIn(page)
  await asDesktopApp(page)
  await page.goto("/")
  const dialog = question(page)
  await dialog.getByRole("radio", { name: /Personal/ }).check()
  await dialog.getByRole("button", { name: "Only read files" }).click()
  await expect(dialog.getByRole("status")).toContainText("is paired, read-only.")
  await expect(dialog).toHaveCount(0)
  const mine = (await paired(page)).find((computer) => computer.workspaceId !== team)
  expect(mine).toMatchObject({ readOnly: true })
  expect([...mine!.agentIds].sort()).toEqual([...own].sort())
})

/** Send a message in the chat that is open, and resolve with where the page said it was written. */
async function sentFrom(page: Page, text: string): Promise<unknown> {
  const sending = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      /\/chats\/[^/]+\/messages$/.test(new URL(request.url()).pathname),
  )
  await composer(page).fill(text)
  await page.keyboard.press("Enter")
  const { from } = (await sending).postDataJSON() as { from?: unknown }
  // It was taken, and answered.
  await expect(page.getByText(`You said: ${text}`)).toBeVisible()
  return from
}

test("a message written in the app says which computer it was written on, and one in a browser only what kind", async ({
  page,
  browser,
  baseURL,
}) => {
  await signIn(page)
  const mine = (await paired(page)).find((computer) => computer.workspaceId !== team)!
  await asDesktopApp(page, mine.id)
  await page.goto("/")
  await page.waitForURL(/\/a\/[^/]+\/c\/\d+/)
  expect(await sentFrom(page, "what is on my screen")).toMatchObject({
    app: "desktop",
    computerId: mine.id,
  })

  // A browser cannot tell which computer it is on. It says what it calls itself.
  const context = await browser.newContext({
    baseURL,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  })
  const elsewhere = await context.newPage()
  await signIn(elsewhere)
  expect(await sentFrom(elsewhere, "and from here")).toEqual({ app: "browser", device: "Mac" })
  await context.close()
})

test("someone with an account says so before the egg has said hello, and is signed straight in", async ({
  page,
}) => {
  await asDesktopApp(page)
  await page.goto("/welcome")
  await page.getByRole("button", { name: "I already have an account" }).click()
  // The egg is down at once, and its hello is never said.
  const you = await card(page, /^Have we met before\? Tell me who you are and I’ll know\.$/)
  await expect(you.getByLabel("Your name")).toHaveCount(0)
  await you.getByLabel("Email").fill(owner.email)
  await you.getByLabel("Password").fill(owner.password)
  await you.getByRole("button", { name: "Sign in" }).click()
  // No Dood of theirs comes out of the egg: they are where they left off, and asked there.
  await page.waitForURL(/\/a\/[^/]+\/c\/\d+/)
  await expect(page.locator("[data-welcome]")).toHaveCount(0)
  await expect(question(page)).toBeVisible()
})
