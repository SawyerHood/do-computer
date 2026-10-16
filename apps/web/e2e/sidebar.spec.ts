import type { Locator, Page } from "@playwright/test"
import { expect, test } from "./fixtures.ts"
import { asOwner, closeSettings, composer, openSettings, signIn } from "./helpers.ts"

asOwner()

type Listed = { id: string; name: string | null; latest?: { kind: string; text: string } }

const listed = async (page: Page) =>
  ((await (await page.request.get("/api/agents")).json()) as { agents: Listed[] }).agents

/** An agent with a name, out of its egg, made without going to it. */
async function make(page: Page, name: string, workspaceId?: string): Promise<string> {
  const made = await page.request.post("/api/agents", {
    data: workspaceId === undefined ? {} : { workspaceId },
  })
  const { agent } = (await made.json()) as { agent: { id: string } }
  await page.request.patch(`/api/agents/${agent.id}`, { data: { name, hatched: true } })
  return agent.id
}

/** Say something to an agent from somewhere other than this page, and wait for its answer. */
async function sayElsewhere(page: Page, agentId: string, text: string) {
  const chat = (await (await page.request.post(`/api/agents/${agentId}/chats/main`)).json()) as {
    id: string
  }
  await page.request.post(`/api/agents/${agentId}/chats/${chat.id}/messages`, {
    data: { text, requestId: crypto.randomUUID() },
  })
  await expect
    .poll(async () => (await listed(page)).find((agent) => agent.id === agentId)?.latest?.text)
    .toContain(`You said: ${text}`)
}

const agents = (page: Page) => page.getByRole("navigation", { name: "Doods" })
const row = (page: Page, name: string) => agents(page).getByRole("link", { name })

/** The names of the agents under one heading, from the top row down. */
async function namesIn(page: Page, section: Locator): Promise<(string | null)[]> {
  const names = new Map((await listed(page)).map((agent) => [agent.id, agent.name]))
  const addresses = await section
    .getByRole("link")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""))
  return addresses.map((address) => names.get(address.split("/")[2] ?? "") ?? null)
}

/** Take a row up with the mouse and let it go where another one is. */
async function drag(page: Page, from: Locator, to: Locator) {
  const start = (await from.boundingBox())!
  const end = (await to.boundingBox())!
  const x = start.x + start.width / 2
  await page.mouse.move(x, start.y + start.height / 2)
  await page.mouse.down()
  await page.mouse.move(x, start.y + start.height / 2 + 12, { steps: 4 })
  await page.mouse.move(x, end.y + end.height / 2, { steps: 12 })
  await page.mouse.up()
}

test("an agent's row says the latest from it, and marks what has not been looked at", async ({
  page,
}) => {
  await signIn(page)
  // With only one's own agents there is nothing to tell apart: they are under no name.
  await expect(agents(page).getByRole("heading", { name: "Doods" })).toBeVisible()
  await expect(agents(page).getByRole("region")).toHaveCount(1)

  await composer(page).fill("Where is the invoice?")
  await composer(page).press("Enter")
  await expect(page.getByRole("main").getByText("You said: Where is the invoice?")).toBeVisible()
  // The row has it as it is said, with when.
  await expect(row(page, "Juniper")).toContainText("You said: Where is the invoice?")
  await expect(row(page, "Juniper").locator("time")).toBeVisible()
  // What is on screen is being looked at: nothing of its is new.
  await expect(row(page, "Juniper").getByRole("img", { name: "Something new" })).toHaveCount(0)

  // Another agent, looked at once and then left.
  const bramble = await make(page, "Bramble")
  await page.reload()
  await row(page, "Bramble").click()
  await page.waitForURL(new RegExp(`/a/${bramble}/c/\\d+`))
  await expect(composer(page)).toBeVisible()
  await row(page, "Juniper").click()
  await expect(composer(page)).toHaveAttribute("placeholder", "Message Juniper")

  // Something comes from it while another agent is open, and its row has it as it comes:
  // nothing is loaded again. The one last heard from is first.
  await sayElsewhere(page, bramble, "The numbers are in")
  await expect(row(page, "Bramble")).toContainText("You said: The numbers are in")
  await expect(row(page, "Bramble").getByRole("img", { name: "Something new" })).toBeVisible()
  await expect(agents(page).getByRole("link").first()).toContainText("Bramble")

  // Looking at it is what takes the mark away, and it stays away.
  await row(page, "Bramble").click()
  await page.waitForURL(new RegExp(`/a/${bramble}/c/\\d+`))
  await expect(row(page, "Bramble").getByRole("img", { name: "Something new" })).toHaveCount(0)
  await row(page, "Juniper").click()
  await expect(composer(page)).toHaveAttribute("placeholder", "Message Juniper")
  await page.reload()
  await expect(row(page, "Bramble")).toContainText("You said: The numbers are in")
  await expect(row(page, "Bramble").getByRole("img", { name: "Something new" })).toHaveCount(0)
})

test("its creature is marked while it works, and while it waits for an answer", async ({
  page,
}) => {
  await signIn(page)
  // An agent that is not the one on screen, at work for a few seconds: its row says so while
  // it is, and stops saying so when it is done, with nothing asked for meanwhile.
  const bramble = (await listed(page)).find((agent) => agent.name === "Bramble")!.id
  const asked: string[] = []
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/agents") asked.push(request.method())
  })
  const chat = (await (await page.request.post(`/api/agents/${bramble}/chats/main`)).json()) as {
    id: string
  }
  await page.request.post(`/api/agents/${bramble}/chats/${chat.id}/messages`, {
    data: { text: '/tool bash {"command":"sleep 3; echo rested"}', requestId: crypto.randomUUID() },
  })
  await expect(row(page, "Bramble").getByRole("img", { name: "Working" })).toBeVisible()
  await expect(row(page, "Bramble")).toContainText("The tool returned: rested", {
    timeout: 15_000,
  })
  await expect(row(page, "Bramble").getByRole("img", { name: "Working" })).toHaveCount(0)
  expect(asked).toEqual([])

  await composer(page).fill('/tool bash {"command":"sleep 2; echo slept"}')
  await composer(page).press("Enter")
  await expect(row(page, "Juniper").getByRole("img", { name: "Working" })).toBeVisible()
  await expect(page.getByRole("log").getByText("slept", { exact: true })).toBeVisible()
  await expect(row(page, "Juniper").getByRole("img", { name: "Working" })).toHaveCount(0)

  // Told to ask first, it stops and waits, and its row says that it has.
  await openSettings(page, "Permissions")
  await page
    .getByRole("group", { name: "Run commands" })
    .getByRole("button", { name: "Ask first" })
    .click()
  await closeSettings(page)
  await composer(page).fill('/tool bash {"command":"echo asked-first"}')
  await composer(page).press("Enter")
  const waiting = page.getByRole("list", { name: "Waiting for your OK" })
  await expect(waiting.getByText("echo asked-first")).toBeVisible()
  await expect(row(page, "Juniper").getByRole("img", { name: "Waiting on someone" })).toBeVisible()
  await expect(row(page, "Juniper")).toContainText("Run commands")
  await waiting.getByRole("button", { name: "Allow once" }).click()
  await expect(row(page, "Juniper").getByRole("img", { name: "Waiting on someone" })).toHaveCount(0)
})

test("someone in a team has each workspace's agents under its name, which folds them away", async ({
  page,
}) => {
  await signIn(page)
  const made = await page.request.post("/api/workspaces", {
    data: { name: "Tidewater", color: "teal" },
  })
  const { workspace } = (await made.json()) as { workspace: { id: string } }
  const scout = await make(page, "Scout", workspace.id)
  await page.reload()

  const mine = agents(page).getByRole("region", { name: "Personal" })
  const team = agents(page).getByRole("region", { name: "Tidewater" })
  await expect(agents(page).getByRole("heading", { name: "Doods" })).toHaveCount(0)
  await expect(mine.getByRole("link", { name: "Juniper" })).toBeVisible()
  await expect(team.getByRole("link", { name: "Scout" })).toBeVisible()
  await expect(mine.getByRole("link", { name: "Scout" })).toHaveCount(0)

  // An agent is made in the workspace whose heading was used.
  await team.getByRole("button", { name: "New Dood in Tidewater" }).click()
  await page.waitForURL((url) => /\/c\/\d+$/.test(url.pathname) && !url.pathname.includes(scout))
  await expect(team.getByRole("link")).toHaveCount(2)
  await row(page, "Juniper").click()
  await expect(composer(page)).toHaveAttribute("placeholder", "Message Juniper")

  // Folded, the team's agents are put away, and it still says that one has something new.
  await row(page, "Scout").click()
  await page.waitForURL(new RegExp(`/a/${scout}/c/\\d+`))
  await row(page, "Juniper").click()
  await expect(composer(page)).toHaveAttribute("placeholder", "Message Juniper")
  await sayElsewhere(page, scout, "September is in")
  const fold = team.getByRole("button", { name: "Tidewater", exact: true })
  await fold.click()
  await expect(fold).toHaveAttribute("aria-expanded", "false")
  await expect(team.getByRole("link")).toHaveCount(0)
  // It stays folded, and the other workspace is as it was.
  await page.reload()
  await expect(fold).toHaveAttribute("aria-expanded", "false")
  await expect(team.getByRole("link")).toHaveCount(0)
  await expect(team.getByRole("img", { name: "Something new" })).toBeVisible()
  await expect(mine.getByRole("link", { name: "Juniper" })).toBeVisible()
  await fold.click()
  await expect(team.getByRole("link", { name: "Scout" })).toContainText("You said: September is in")
})

test("a person's feed is their own, and what they looked at on one tab is looked at on another", async ({
  page,
  context,
}) => {
  await signIn(page)
  // Nobody else's feed can be joined: the socket is refused.
  const refused = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const socket = new WebSocket(
          `${location.origin.replace(/^http/, "ws")}/api/presence/${encodeURIComponent("personal:someone-else")}`,
        )
        socket.onopen = () => resolve(false)
        socket.onerror = () => resolve(true)
      }),
  )
  expect(refused).toBe(true)

  // A second tab, on the other agent. Something comes from Bramble, which neither is looking at.
  const ids = Object.fromEntries((await listed(page)).map((agent) => [agent.name, agent.id]))
  await row(page, "Juniper").click()
  await expect(composer(page)).toHaveAttribute("placeholder", "Message Juniper")
  const other = await context.newPage()
  await other.goto(`/a/${ids.Juniper}`)
  await expect(composer(other)).toHaveAttribute("placeholder", "Message Juniper")
  await sayElsewhere(page, ids.Bramble!, "Both tabs hear this")
  await expect(row(page, "Bramble").getByRole("img", { name: "Something new" })).toBeVisible()
  await expect(row(other, "Bramble").getByRole("img", { name: "Something new" })).toBeVisible()
  // Looked at on one, it is no longer new on the other.
  await row(page, "Bramble").click()
  await expect(row(other, "Bramble").getByRole("img", { name: "Something new" })).toHaveCount(0)
  await other.close()
})

test("an agent is dragged to another place among its workspace's, and they stay as they were put", async ({
  page,
}) => {
  await signIn(page)
  await make(page, "Clover")
  await page.reload()
  const mine = agents(page).getByRole("region", { name: "Personal" })
  const team = agents(page).getByRole("region", { name: "Tidewater" })
  await expect(mine.getByRole("link")).toHaveCount(3)
  // Never put in order, they are the one last heard from first, and nothing offers to make
  // them so.
  const [first, second, third] = (await namesIn(page, mine)) as [string, string, string]
  expect(first).toBe("Clover")
  const menu = mine.getByRole("button", { name: "Personal: workspace menu" })
  await menu.click()
  await expect(page.getByRole("menuitem", { name: "Workspace settings" })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Sort by latest" })).toHaveCount(0)
  await page.keyboard.press("Escape")

  // The top one is taken to the bottom. It is not the one that is open, and letting it go
  // does not open it: the page is the one it was, and was not loaded again.
  const open = page.url()
  await page.evaluate(() => Object.assign(window, { stayed: true }))
  await drag(page, row(page, first), row(page, third))
  await expect.poll(() => namesIn(page, mine)).toEqual([second, third, first])
  expect(page.url()).toBe(open)
  expect(await page.evaluate(() => "stayed" in window)).toBe(true)
  // The other workspace's are not this one's to be put among.
  const others = await namesIn(page, team)
  await drag(page, row(page, second), team.getByRole("link").first())
  await expect.poll(() => namesIn(page, mine)).toEqual([third, first, second])
  expect(await namesIn(page, team)).toEqual(others)

  // They are as they were put when the page is loaded again, and hearing from the last of
  // them does not bring it to the top.
  await page.reload()
  await expect.poll(() => namesIn(page, mine)).toEqual([third, first, second])
  const ids = Object.fromEntries((await listed(page)).map((agent) => [agent.name, agent.id]))
  await sayElsewhere(page, ids[second]!, "Still where I was put")
  await expect(row(page, second)).toContainText("You said: Still where I was put")
  expect(await namesIn(page, mine)).toEqual([third, first, second])

  // One made since is above them. A row that is pressed and not moved is opened, as before.
  await make(page, "Dahlia")
  await page.reload()
  await expect.poll(() => namesIn(page, mine)).toEqual(["Dahlia", third, first, second])
  await row(page, first).click()
  await page.waitForURL(new RegExp(`/a/${ids[first]}/c/\\d+`))

  // Without a pointer: Space takes a row up, the arrows move it, and Space puts it down.
  await row(page, "Dahlia").focus()
  await page.keyboard.press("Space")
  await expect(page.getByText("Picked up Dahlia, 1 of 4.")).toHaveCount(1)
  await page.keyboard.press("ArrowDown")
  await expect(page.getByText("Dahlia is at 2 of 4.")).toHaveCount(1)
  await page.keyboard.press("Space")
  await expect.poll(() => namesIn(page, mine)).toEqual([third, "Dahlia", first, second])
  await expect(row(page, "Dahlia")).toBeFocused()

  // The order is given up from the workspace's menu, and it is the one last heard from first
  // again: the one made last, then the one at the bottom, which was the last to say anything.
  await menu.click()
  await page.getByRole("menuitem", { name: "Sort by latest" }).click()
  await expect.poll(async () => (await namesIn(page, mine)).slice(0, 2)).toEqual(["Dahlia", second])
  await menu.click()
  await expect(page.getByRole("menuitem", { name: "Workspace settings" })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Sort by latest" })).toHaveCount(0)
})

/** The ids of the agents under one heading, from the top row down. */
const idsIn = (section: Locator) =>
  section
    .getByRole("link")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")?.split("/")[2] ?? ""))

test("the order they were put in is the person's own on every browser, and a move in one is made in the other", async ({
  page,
  browser,
  baseURL,
}) => {
  await signIn(page)
  const mine = agents(page).getByRole("region", { name: "Personal" })
  await expect(mine.getByRole("link")).toHaveCount(4)
  const [first, second, , fourth] = (await namesIn(page, mine)) as string[]
  await drag(page, row(page, first!), row(page, fourth!))
  const put = await namesIn(page, mine)
  expect(put.at(-1)).toBe(first)
  await page.screenshot({ path: "test-results/dood-order-sidebar.png" })
  // It is the server's to keep, as soon as it has let go.
  await expect
    .poll(async () => {
      const kept = (await (await page.request.get("/api/agent-order")).json()) as {
        order: Record<string, string[]>
      }
      return Object.values(kept.order).some((ids) => ids.length === 4)
    })
    .toBe(true)

  // A browser that has never been used, signed in as the same person, has them as they were put.
  const context = await browser.newContext({ baseURL })
  const other = await context.newPage()
  await signIn(other)
  const theirs = agents(other).getByRole("region", { name: "Personal" })
  await expect.poll(() => namesIn(other, theirs)).toEqual(put)

  // Moved there, they are moved here too, without this page asking for anything again.
  await drag(other, row(other, second!), row(other, first!))
  const after = await namesIn(other, theirs)
  expect(after.at(-1)).toBe(second)
  await expect.poll(() => namesIn(page, mine)).toEqual(after)
  await page.screenshot({ path: "test-results/dood-order-sidebar-followed.png" })
  await context.close()
})

test("an order a browser kept before the server did is carried up to it once", async ({
  page,
  browser,
  baseURL,
}) => {
  await signIn(page)
  const team = agents(page).getByRole("region", { name: "Tidewater" })
  await expect(team.getByRole("link")).toHaveCount(2)
  const before = await idsIn(team)
  const workspaceId = (
    (await (await page.request.get("/api/workspaces")).json()) as {
      workspaces: { id: string; name: string }[]
    }
  ).workspaces.find((workspace) => workspace.name === "Tidewater")!.id
  const kept = [...before].reverse()

  // A browser from before, with the order it was put in kept in its own storage.
  const context = await browser.newContext({ baseURL })
  await context.addInitScript(
    ({ workspaceId, kept }) => {
      if (sessionStorage.getItem("planted") !== null) return
      sessionStorage.setItem("planted", "yes")
      localStorage.setItem("dc-agent-order", JSON.stringify({ [workspaceId]: kept }))
    },
    { workspaceId, kept },
  )
  const old = await context.newPage()
  await signIn(old)
  const theirs = agents(old).getByRole("region", { name: "Tidewater" })
  await expect.poll(() => idsIn(theirs)).toEqual(kept)
  // Carried up, it is let go there, and every other browser has it now.
  await expect.poll(() => old.evaluate(() => localStorage.getItem("dc-agent-order"))).toBeNull()
  await expect.poll(() => idsIn(team)).toEqual(kept)
  await old.reload()
  await expect.poll(() => idsIn(theirs)).toEqual(kept)
  await context.close()
})
