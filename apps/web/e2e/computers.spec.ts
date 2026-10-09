import { type ChildProcess, spawn } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures.ts"
import {
  asOwner,
  closeSettings,
  composer,
  newChat,
  openSettings,
  openWorkspaceSettings,
  signIn,
  tool,
} from "./helpers.ts"

asOwner()

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
    // With one agent there is nothing to choose between: it is the one that gets the computer.
    await expect(page.getByRole("checkbox", { name: "Juniper" })).toBeChecked()
    await page.getByRole("button", { name: "Connect this computer" }).click()
    await expect(page.getByRole("heading", { name: "Connected" })).toBeVisible()

    await page.getByRole("link", { name: "See your computers" }).click()
    const card = page.getByRole("listitem").filter({ hasText: "test-laptop" })
    await expect(card.getByText("Online", { exact: true })).toBeVisible({ timeout: 15_000 })
    // It is the user's own, and says which agents can work on it.
    await expect(card.getByText("Belongs to")).toBeVisible()
    await expect(
      card.getByRole("button", { name: "Disconnect Juniper from test-laptop" }),
    ).toBeVisible()
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

  test("a command left running there is in the chat, is read as it prints, and can be stopped", async ({
    page,
  }) => {
    await signIn(page)
    await newChat(page)
    await composer(page).fill(
      '/tool bash {"command":"echo serving; sleep 2; echo a request; sleep 300","computer":"test-laptop","run_in_background":true}',
    )
    await page.keyboard.press("Enter")
    // It is where the agent started it, with its clock going, and counted above the message box.
    const chip = page.getByTestId("command-chip")
    await expect(chip).toContainText("echo serving; sleep 2; echo a request; sleep 300")
    await expect(chip).toContainText("test-laptop · in the background")
    await expect(page.getByRole("button", { name: "1 running" })).toBeVisible()
    // The agent is waiting on it, and says so in the sidebar.
    await expect(page.getByText("Waiting on echo serving")).toBeVisible()

    // The list leads to the command in the chat, opened on the end of what it has printed.
    await page.getByRole("button", { name: "1 running" }).click()
    const list = page.getByRole("list", { name: "Running in the background" })
    await expect(list.getByText("test-laptop ·")).toBeVisible()
    await list.getByTitle("Show what it is printing").click()
    const printing = page.getByLabel(/^What echo serving.* is printing$/)
    await expect(printing).toContainText("a request")

    // Stopping it is said in the chat, and it is no longer counted.
    await page
      .getByRole("button", { name: /^Stop echo serving/ })
      .first()
      .click()
    await expect(page.getByTestId("command-word")).toContainText("You stopped")
    await expect(chip).toContainText("test-laptop · stopped after")
    await expect(page.getByRole("button", { name: "1 running" })).toHaveCount(0)

    // One that ends by itself says how, with what it printed folded under that.
    await newChat(page)
    await composer(page).fill(
      '/tool bash {"command":"echo begun; sleep 3; echo built","computer":"test-laptop","run_in_background":true}',
    )
    await page.keyboard.press("Enter")
    const word = page.getByTestId("command-word")
    await expect(word).toContainText(/finished in \d+s on test-laptop/, { timeout: 20_000 })
    await word.getByRole("button", { name: "What it printed" }).click()
    await expect(word).toContainText("built")
    await expect(page.getByTestId("command-chip")).toContainText("test-laptop · finished in")
  })

  test("an agent that was not given the computer asks for it, and is let in from the chat", async ({
    page,
  }) => {
    await signIn(page)
    await openWorkspaceSettings(page, "Computers")
    const card = page.getByRole("listitem").filter({ hasText: "test-laptop" })
    await card.getByRole("button", { name: "Disconnect Juniper from test-laptop" }).click()
    await expect(card.getByText("None yet")).toHaveCount(0)
    await expect(
      card.getByRole("button", { name: "Connect an agent to test-laptop" }),
    ).toBeVisible()

    // The computer is still paired, and the agent can no longer touch it.
    await newChat(page)
    await tool(
      page,
      "bash",
      { command: "cat hello.txt", computer: "test-laptop" },
      'There is no computer named "test-laptop"',
    )
    // It can see that the computer is there, and whose it is.
    await tool(page, "computers", { action: "list" }, /test-laptop: Sawyer's, linux, online/)
    await tool(
      page,
      "computers",
      { action: "request", name: "test-laptop", reason: "to read hello.txt" },
      'Asked Sawyer whether you may use "test-laptop"',
    )

    // What it asked is waiting above the message box, for whoever the computer belongs to.
    const asked = page.getByRole("list", { name: "Computers it asked to use" })
    await expect(asked.getByText("asks to use the computer test-laptop")).toBeVisible()
    await expect(asked.getByText("to read hello.txt")).toBeVisible()
    // The user's own menu says so too, wherever in the app they are.
    await page.getByRole("button", { name: /settings and signing out$/ }).click()
    await expect(page.getByRole("menuitem", { name: "An agent asks for a computer" })).toBeVisible()
    await page.keyboard.press("Escape")
    await asked.getByRole("button", { name: "Allow", exact: true }).click()
    await expect(asked).toHaveCount(0)

    // The agent is told in the chat it asked from, and the computer is its to use.
    await expect(page.getByRole("log").getByText("Sawyer said yes to using")).toBeVisible()
    await expect(page.getByText(/You said: \[Sawyer said yes: you can now use/)).toBeVisible()
    await tool(
      page,
      "bash",
      { command: "cat hello.txt", computer: "test-laptop" },
      "a file on the user's laptop",
    )
    await openWorkspaceSettings(page, "Computers")
    await expect(
      card.getByRole("button", { name: "Disconnect Juniper from test-laptop" }),
    ).toBeVisible()
  })

  test("removing the computer cuts the daemon off", async ({ page }) => {
    await signIn(page)
    await openWorkspaceSettings(page, "Computers")
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

test.describe("the machines of a workspace", () => {
  type Listed = {
    id: string
    name: string
    kind: string
    access: "open" | "chosen"
    shareable: boolean
    agentIds: string[]
  }
  const agentIn = (page: Page) => page.url().match(/\/a\/([^/]+)/)![1]!
  const computersOf = async (page: Page) =>
    ((await (await page.request.get("/api/computers")).json()) as { computers: Listed[] }).computers
  /** The machines an agent can work on, leaving out the computers people paired. */
  const machinesOf = async (page: Page, agentId: string) =>
    (await computersOf(page)).filter(
      (computer) => computer.kind !== "paired" && computer.agentIds.includes(agentId),
    )

  /** Make another agent and land on it, leaving the first one as it is. */
  async function newAgent(page: Page): Promise<string> {
    const before = agentIn(page)
    await page.getByRole("button", { name: "New agent", exact: true }).click()
    await expect(page).not.toHaveURL(new RegExp(`/a/${before}`))
    await page.waitForURL(/\/a\/[^/]+\/c\/\d+/)
    return agentIn(page)
  }

  test("a new agent's built-in shell is listed with the computers, and is that agent's alone", async ({
    page,
  }) => {
    await signIn(page)
    const agentId = await newAgent(page)
    // Without any provider's key the built-in shell is what there is, and it cannot be shared.
    await expect.poll(async () => (await machinesOf(page, agentId)).length).toBe(1)
    const machine = (await machinesOf(page, agentId))[0]!
    expect(machine).toMatchObject({
      kind: "just-bash",
      access: "chosen",
      shareable: false,
      agentIds: [agentId],
    })
    // A name, so that its card is told from the first agent's.
    await page.request.patch(`/api/agents/${agentId}`, { data: { name: "Wren" } })
    await page.reload()

    await openWorkspaceSettings(page, "Computers")
    const card = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: machine.name, exact: true }) })
      .filter({ hasText: "Wren" })
    await expect(card).toHaveCount(1)
    await expect(card.getByText("Built-in shell", { exact: true })).toBeVisible()
    await expect(card.getByText("Wren", { exact: true })).toBeVisible()
    // There is no one to open it to, and no agent to connect or disconnect. Nor is it ever offline.
    await expect(card.getByRole("combobox")).toHaveCount(0)
    await expect(card.getByRole("button", { name: /^Connect an agent/ })).toHaveCount(0)
    await expect(card.getByRole("button", { name: /^Disconnect/ })).toHaveCount(0)
    await expect(card.getByText(/^(Online|Offline)$/)).toHaveCount(0)
    // This server has no kind of machine that can be added by hand.
    await expect(page.getByRole("button", { name: "Add a computer" })).toHaveCount(0)
    await closeSettings(page)

    // The agent's own page says what it can work on, and leads back here to change that.
    await openSettings(page, "Model and computer")
    const section = page.getByRole("region", { name: "Computers" })
    const usable = section.getByRole("list", { name: "Computers this agent can use" })
    await expect(usable.getByRole("listitem")).toHaveCount(1)
    await expect(usable).toContainText(machine.name)
    await expect(usable).toContainText("Built-in shell")
    await expect(section.getByRole("radio")).toHaveCount(0)
    await section.getByRole("button", { name: "Computers", exact: true }).click()
    await expect(
      page.getByRole("heading", { name: "Connect a computer of your own" }),
    ).toBeVisible()
    await closeSettings(page)

    // Deleting the agent takes the machine only it can use with it, unless that is unticked.
    await openSettings(page, "Move or delete")
    await page.getByRole("button", { name: "Delete agent…" }).click()
    await expect(page.getByRole("checkbox", { name: `Also delete ${machine.name}` })).toBeChecked()
    await page.getByLabel(/to confirm/).fill("Wren")
    await page.getByRole("button", { name: "Delete for good" }).click()
    await expect(page).not.toHaveURL(new RegExp(`/a/${agentId}`))
    await expect
      .poll(async () => (await computersOf(page)).map((computer) => computer.id))
      .not.toContain(machine.id)
  })

  test("the kind of computer an agent is given where there is none for it is set under Settings", async ({
    page,
  }) => {
    await signIn(page)
    await openWorkspaceSettings(page, "New agents")
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

    // A new agent is then given none. The ones that exist keep what they had.
    const first = agentIn(page)
    await closeSettings(page)
    const made = await newAgent(page)
    expect(await machinesOf(page, made)).toEqual([])
    expect((await machinesOf(page, first)).map((computer) => computer.kind)).toEqual(["just-bash"])
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
