import type { Browser, Page } from "@playwright/test"
import { expect, test } from "./fixtures.ts"
import { composer, owner, signUp } from "./helpers.ts"

// The first account on the server is the owner's. Sign-up there is by invitation, so the second
// person here can only get in by being asked to a team.
const maya = { name: "Maya Okafor", email: "maya@example.com", password: "correct horse battery" }

async function fill(page: Page, account: { name?: string; email: string; password: string }) {
  if (account.name !== undefined) await page.getByLabel("Name").fill(account.name)
  await page.getByLabel("Email").fill(account.email)
  await page.getByLabel("Password").fill(account.password)
}

async function open(browser: Browser, baseURL: string | undefined) {
  const context = await browser.newContext({ baseURL, colorScheme: "dark" })
  await context.addInitScript(() => localStorage.setItem("dc-chat-list", "open"))
  return context.newPage()
}

test.describe.configure({ mode: "serial" })

let sawyer: Page
let her: Page
let team = ""
let link = ""
let agentId = ""
let chatPath = ""

test.beforeAll(async ({ browser, baseURL }) => {
  sawyer = await open(browser, baseURL)
  her = await open(browser, baseURL)
  await signUp(sawyer)
  await sawyer.waitForURL(/\/a\/[^/]+\/c\/\d+/)
})

test.afterAll(async () => {
  await sawyer.context().close()
  await her.context().close()
})

test("a team is started from the workspace menu, with someone asked to join", async () => {
  await sawyer.getByRole("button", { name: /Switch workspace/ }).click()
  await sawyer.getByRole("menuitem", { name: "New team" }).click()
  await sawyer.getByLabel("Team name").fill("Tidewater")
  await sawyer.getByLabel("Who to invite").fill(maya.email)
  const made = sawyer.waitForResponse(
    (response) =>
      response.url().endsWith("/api/workspaces") && response.request().method() === "POST",
  )
  await sawyer.getByRole("button", { name: "Create team" }).click()
  const body = (await (await made).json()) as {
    workspace: { id: string }
    invited: { invitations: { link: string; emailed: boolean }[] }
  }
  team = body.workspace.id
  link = new URL(body.invited.invitations[0]!.link).pathname
  // No mail is set up on this server, so the sender is told to pass the link on.
  await expect(sawyer.getByText("No email was sent from here. Send them the link.")).toBeVisible()
  await sawyer.getByRole("button", { name: "Go to Tidewater" }).click()
  await expect(sawyer.getByRole("heading", { name: "Tidewater", level: 1 })).toBeVisible()
  await expect(sawyer.getByText("1 person · 0 agents")).toBeVisible()
})

test("the invitation lets them sign up where sign-up is by invitation, and join", async () => {
  // Before being asked, the address could not have signed up here at all.
  await her.goto(link)
  await expect(her.getByRole("heading", { name: "Sawyer invited you to Tidewater" })).toBeVisible()
  await her.getByRole("link", { name: "Create an account" }).click()
  await fill(her, maya)
  await her.getByRole("button", { name: "Create account" }).click()
  // Signing up brings them back to the invitation, which they can now answer.
  await her.waitForURL(new RegExp(`${link}$`))
  await her.getByRole("button", { name: "Join Tidewater" }).click()
  await expect(her.getByRole("heading", { name: "Tidewater", level: 1 })).toBeVisible()
  await expect(her.getByText("2 people · 0 agents")).toBeVisible()
  // The link is spent.
  expect((await her.request.get(`/api/invitations/${link.split("/").at(-1)}`)).status()).toBe(404)
  // And the one who asked sees them arrive without reloading.
  await expect(sawyer.getByText("2 people · 0 agents")).toBeVisible()
})

test("an agent made in the team is everyone's, and an agent of one's own is not", async () => {
  const mine = sawyer.url()
  await sawyer.getByRole("button", { name: "New agent for the team" }).click()
  await sawyer.waitForURL((url) => /\/a\/[^/]+\/c\/\d+$/.test(url.pathname) && url.href !== mine)
  chatPath = new URL(sawyer.url()).pathname
  agentId = chatPath.split("/")[2]!
  // The sidebar says which workspace the agent is in.
  await expect(sawyer.getByRole("button", { name: /^Workspace: Tidewater/ })).toBeVisible()

  expect((await her.request.get(`/api/agents/${agentId}`)).status()).toBe(200)
  const { agents } = (await (await sawyer.request.get("/api/agents")).json()) as {
    agents: { id: string; workspaceId: string }[]
  }
  const personal = agents.find((agent) => agent.workspaceId.startsWith("personal:"))!
  expect((await her.request.get(`/api/agents/${personal.id}`)).status()).toBe(404)
  expect((await her.request.get(`/api/agents/${personal.id}/chats/1`)).status()).toBe(404)

  // Moved to his own workspace the team's agent is his alone; moved back, it is everyone's again.
  const move = (page: Page, workspaceId: string) =>
    page.request.post(`/api/agents/${agentId}/move`, { data: { workspaceId } })
  expect((await move(sawyer, personal.workspaceId)).status()).toBe(200)
  expect((await her.request.get(`/api/agents/${agentId}`)).status()).toBe(404)
  expect((await move(sawyer, team)).status()).toBe(200)
  expect((await her.request.get(`/api/agents/${agentId}`)).status()).toBe(200)
  // A member cannot take a team's agent for herself.
  const { user } = (await (await her.request.get("/api/me")).json()) as { user: { id: string } }
  expect((await move(her, `personal:${user.id}`)).status()).toBe(403)
  expect((await sawyer.request.get(`/api/agents/${agentId}`)).status()).toBe(200)
})

test("two people talk to the agent in one chat, and each sees who said what", async () => {
  await her.goto(chatPath)
  await composer(sawyer).fill("What is still open on the launch checklist?")
  await composer(sawyer).press("Enter")
  // She sees his message as his, with his name, and the agent's answer to it.
  const hers = her.getByRole("log")
  await expect(
    hers.getByText("What is still open on the launch checklist?", { exact: true }),
  ).toBeVisible()
  await expect(hers.getByRole("img", { name: "Sawyer" })).toBeVisible()
  await expect(
    hers.getByText("You said: What is still open on the launch checklist?"),
  ).toBeVisible()

  await composer(her).fill("And who owns the status page?")
  await composer(her).press("Enter")
  const his = sawyer.getByRole("log")
  await expect(his.getByText("You said: And who owns the status page?")).toBeVisible()
  await expect(his.getByRole("img", { name: "Maya Okafor" })).toBeVisible()
  // His own message has no face on it: it is the one in the color of his own.
  await expect(his.getByRole("img", { name: "Sawyer" })).toHaveCount(0)
})

test("each sees the other in the chat, and when they are writing", async () => {
  const here = sawyer.getByRole("region", { name: "Here now" })
  await expect(here.getByRole("img", { name: "Maya Okafor" })).toBeVisible()
  // In the list of agents, her face is on the chat she has open.
  const chats = sawyer.getByRole("navigation", { name: "Chats" })
  await expect(chats.getByRole("img", { name: "Maya Okafor" })).toBeVisible()

  await composer(her).pressSequentially("I am writing")
  await expect(sawyer.getByRole("status").filter({ hasText: "Maya is typing" })).toBeVisible()
  await composer(her).fill("")
  await expect(sawyer.getByRole("status").filter({ hasText: "Maya is typing" })).toHaveCount(0)

  // When she goes elsewhere she is no longer in the chat.
  await her.goto(`/a/${agentId}/automations`)
  await expect(here.getByRole("img", { name: "Maya Okafor" })).toHaveCount(0)
  // From there the sidebar says where he is, and leads to it.
  await expect(
    her.getByRole("region", { name: "Who is in Tidewater" }).getByRole("link", { name: /Sawyer/ }),
  ).toBeVisible()
})

/** What a daemon does when it starts: ask to be paired, and get a code for someone to confirm. */
async function pairingCode(page: Page, name: string): Promise<string> {
  const response = await page.request.post("/api/computers/pair/start", {
    data: { name, hostname: `${name}.local`, platform: "darwin", home: `/Users/${name}` },
  })
  return ((await response.json()) as { code: string }).code
}

type Listed = { id: string; name: string; workspaceId: string; agentIds: string[] }
const computersOf = async (page: Page) =>
  ((await (await page.request.get("/api/computers")).json()) as { computers: Listed[] }).computers

test("a team's computer is anyone's in the team to connect, and a teammate's own is asked for", async () => {
  // He pairs a computer for the team, and gives it to no agent yet.
  await sawyer.goto(`/pair?code=${await pairingCode(sawyer, "team-mini")}`)
  await sawyer.getByRole("radio", { name: /^Tidewater/ }).check()
  await sawyer.getByRole("button", { name: "Connect this computer" }).click()
  await expect(sawyer.getByRole("heading", { name: "Connected" })).toBeVisible()
  await expect(sawyer.getByText(/No agent can use it yet/)).toBeVisible()

  // She did not pair it, but it is her team's: she sees it, and connects the team's agent.
  await her.getByRole("button", { name: /settings and signing out$/ }).click()
  await her.getByRole("menuitem", { name: /Workspace settings/ }).click()
  await her.getByRole("dialog").getByRole("button", { name: "Computers", exact: true }).click()
  const mini = her.getByRole("listitem").filter({ hasText: "team-mini" })
  await expect(mini.getByText("paired by Sawyer")).toBeVisible()
  await expect(mini.getByRole("button", { name: "Remove team-mini" })).toHaveCount(0)
  await mini.getByRole("combobox", { name: "Connect an agent to team-mini" }).selectOption(agentId)
  await expect(mini.getByRole("button", { name: /^Disconnect .* from team-mini$/ })).toBeVisible()

  // A computer of her own is hers alone: he does not see it, and the team's agent cannot use it.
  const code = await pairingCode(her, "mayas-mac")
  expect((await her.request.post("/api/computers/pair/confirm", { data: { code } })).status()).toBe(
    201,
  )
  expect((await computersOf(sawyer)).map((computer) => computer.name)).not.toContain("mayas-mac")

  // The agent can see that it is there, though, and ask her for it.
  await sawyer.goto(chatPath)
  await composer(sawyer).fill('/tool computers {"action":"list"}')
  await composer(sawyer).press("Enter")
  const his = sawyer.getByRole("log")
  await expect(
    his.getByText(/team-mini: belongs to the team Tidewater, darwin, offline\. You can use it\./),
  ).toBeVisible()
  await expect(
    his.getByText(/mayas-mac: Maya Okafor's, darwin, offline\. You cannot use/),
  ).toBeVisible()
  await composer(sawyer).fill(
    '/tool computers {"action":"request","name":"mayas-mac","reason":"to check the build"}',
  )
  await composer(sawyer).press("Enter")
  await expect(his.getByText(/Asked Maya Okafor whether you may use "mayas-mac"/)).toBeVisible()
  // It is not his to give: he sees who it is waiting for.
  const waiting = sawyer.getByRole("list", { name: "Computers it asked to use" })
  await expect(waiting.getByText("Waiting for Maya Okafor to answer.")).toBeVisible()
  await expect(waiting.getByRole("button", { name: "Allow", exact: true })).toHaveCount(0)

  // She is asked where her computers are listed, and says yes.
  const asking = her.getByRole("list", { name: "Agents asking to use a computer" })
  await expect(asking.getByText("to check the build")).toBeVisible({ timeout: 15_000 })
  await asking.getByRole("button", { name: "Allow", exact: true }).click()
  await expect(asking).toHaveCount(0)
  await expect(his.getByText("Maya Okafor said yes to using")).toBeVisible()
  await expect(waiting).toHaveCount(0)
  const hers = (await computersOf(her)).find((computer) => computer.name === "mayas-mac")!
  expect(hers.agentIds).toEqual([agentId])
})

test("a member cannot run the team, and loses its agents when removed", async () => {
  // She can make agents and use them, but not invite, rename, or delete the team's agent.
  expect(
    (
      await her.request.post(`/api/workspaces/${team}/invitations`, {
        data: { who: ["x@example.com"] },
      })
    ).status(),
  ).toBe(403)
  expect(
    (await her.request.patch(`/api/workspaces/${team}`, { data: { name: "Hers" } })).status(),
  ).toBe(403)
  expect((await her.request.delete(`/api/agents/${agentId}`)).status()).toBe(403)

  await sawyer.goto(`/w/${team}/people`)
  sawyer.once("dialog", (dialog) => void dialog.accept())
  await sawyer.getByRole("button", { name: "Remove" }).click()
  await expect(sawyer.getByRole("heading", { name: "Members · 1" })).toBeVisible()
  expect((await her.request.get(`/api/agents/${agentId}`)).status()).toBe(404)
  expect((await her.request.get(`/api/agents/${agentId}/chats/1`)).status()).toBe(404)
  // Her own computer is still hers, and no longer serves the team's agent. The team's computer
  // stays with the team, out of her sight.
  expect((await computersOf(her)).map(({ name, agentIds }) => ({ name, agentIds }))).toEqual([
    { name: "mayas-mac", agentIds: [] },
  ])
  expect(
    (await computersOf(sawyer)).find((computer) => computer.name === "team-mini"),
  ).toMatchObject({ workspaceId: team, agentIds: [agentId] })
  // Her page lets go of the team's agent by itself, and leads back to what is hers.
  await expect(her.getByRole("heading", { name: "This agent could not be loaded" })).toBeVisible()
  await expect(her.getByRole("link", { name: "Back to your agents" })).toBeVisible()
})
