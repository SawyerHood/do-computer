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

  test("an agent that was not given the computer asks for it, and is let in from the chat", async ({
    page,
  }) => {
    await signIn(page)
    await openWorkspaceSettings(page, "Computers")
    const card = page.getByRole("listitem").filter({ hasText: "test-laptop" })
    await card.getByRole("button", { name: "Disconnect Juniper from test-laptop" }).click()
    await expect(card.getByText("None yet")).toHaveCount(0)
    await expect(
      card.getByRole("combobox", { name: "Connect an agent to test-laptop" }),
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

test.describe("choosing a computer", () => {
  type AgentState = { computer: string | null }
  const agentIn = (page: Page) => page.url().match(/\/a\/([^/]+)/)![1]!
  const stateOf = async (page: Page, agentId: string) =>
    (await (await page.request.get(`/api/agents/${agentId}`)).json()) as AgentState

  /** Make another agent and land on it, leaving the first one as it is. */
  async function newAgent(page: Page): Promise<string> {
    const before = agentIn(page)
    await page.getByRole("button", { name: "New agent", exact: true }).click()
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

    await openSettings(page, "Model and computer")
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
    await closeSettings(page)
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

    // A new agent starts there. The ones that exist are where they were.
    const first = agentIn(page)
    await closeSettings(page)
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
