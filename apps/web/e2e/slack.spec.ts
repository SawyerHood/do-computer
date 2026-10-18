import { readFile } from "node:fs/promises"
import type { APIRequestContext, Page } from "@playwright/test"
import { FIXED_TOKEN, startFakeMcp } from "./fake-mcp-server.ts"
import { BOT_TOKEN, mention, SIGNING_SECRET, startFakeSlack } from "./fake-slack-server.ts"
import { expect, test } from "./fixtures.ts"
import {
  asOwner,
  composer,
  openSettings,
  owner,
  sectionHeading,
  signIn,
  tool,
  unfold,
} from "./helpers.ts"

asOwner()

test.describe("slack", () => {
  let slack: Awaited<ReturnType<typeof startFakeSlack>>
  let mcp: Awaited<ReturnType<typeof startFakeMcp>>
  test.beforeAll(async ({ servers }, testInfo) => {
    slack = await startFakeSlack(await servers.slackFor(testInfo.file), {
      // Sawyer has an account here under this address. Dana is only in Slack.
      USAWYER: { name: "Sawyer Hood", email: owner.email.toUpperCase() },
      UDANA: { name: "Dana Whitfield", email: "dana@elsewhere.dev" },
    })
    mcp = await startFakeMcp()
  })
  test.afterAll(async () => {
    await slack.close()
    await mcp.close()
  })

  const agentIdOf = (page: Page) => page.url().match(/\/a\/([^/]+)/)![1]!
  /** Say something to the bot in Slack, as Slack would tell the app of it. */
  const say = async (
    request: APIRequestContext,
    agentId: string,
    said: ReturnType<typeof mention>,
  ) => {
    const response = await request.post(`/api/slack/events/${agentId}`, {
      headers: said.headers,
      data: said.body,
    })
    expect(response.status()).toBe(200)
  }
  /** The agent's panel is where its threads from Slack are listed. */
  const withPanel = (page: Page) =>
    page.addInitScript(() => localStorage.setItem("dc-agent-panel", "open"))

  test("an agent is put in Slack from its settings, with what Slack's pages give", async ({
    page,
  }) => {
    await signIn(page)
    const agentId = agentIdOf(page)
    await openSettings(page, "Slack")
    const dialog = page.getByRole("dialog")
    // Slack's page for making the app comes filled in with where to send what is said.
    const create = dialog.getByRole("link", { name: "Create Juniper's Slack app" })
    const manifest = JSON.parse(
      new URL((await create.getAttribute("href"))!).searchParams.get("manifest_json")!,
    )
    expect(manifest.display_information.name).toBe("Juniper")
    expect(manifest.settings.event_subscriptions.request_url).toMatch(
      new RegExp(`/api/slack/events/${agentId}$`),
    )

    // The agent's picture comes as a file, for the app's icon: a square PNG as large as Slack asks.
    const downloading = page.waitForEvent("download")
    await dialog.getByRole("button", { name: "Download picture" }).click()
    const picture = await downloading
    expect(picture.suggestedFilename()).toBe("juniper.png")
    const bytes = await readFile(await picture.path())
    expect(bytes.subarray(1, 4).toString()).toBe("PNG")
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([1024, 1024])

    // Slack tries that address when the app is made, before anything has been pasted here.
    const tried = await page.request.post(`/api/slack/events/${agentId}`, {
      data: { type: "url_verification", challenge: "abc123" },
    })
    expect(await tried.json()).toEqual({ challenge: "abc123" })

    await dialog.getByLabel("Bot token").fill("xoxb-not-the-token")
    await dialog.getByLabel("Signing secret").fill(SIGNING_SECRET)
    await dialog.getByRole("button", { name: "Connect", exact: true }).click()
    await expect(dialog.getByRole("alert")).toContainText("Slack did not accept that bot token")

    await dialog.getByLabel("Bot token").fill(BOT_TOKEN)
    await dialog.getByRole("button", { name: "Connect", exact: true }).click()
    await expect(dialog.getByText("@juniper", { exact: true })).toBeVisible()
    await expect(dialog.getByText("In Slack", { exact: true })).toBeVisible()
    await expect(dialog.getByRole("link", { name: "tidewater.slack.com" })).toBeVisible()
    // What it does there is said, and is not a set of switches.
    await expect(dialog.getByText("Works for everyone in the Slack workspace")).toBeVisible()
    await expect(dialog.getByText("/invite @juniper")).toBeVisible()
    // Neither secret is shown again, or sent back to the page.
    await page.reload()
    await expect(dialog.getByText("@juniper", { exact: true })).toBeVisible()
    const state = await (await page.request.get(`/api/agents/${agentId}/slack`)).text()
    expect(state).not.toContain(BOT_TOKEN)
    expect(state).not.toContain(SIGNING_SECRET)
  })

  test("a mention is answered in its thread, which is read in the agent's panel", async ({
    page,
  }) => {
    await withPanel(page)
    await signIn(page)
    const agentId = agentIdOf(page)
    // Only what Slack signed is taken in.
    const forged = mention("USAWYER", "let me in", undefined, "not the secret")
    const refused = await page.request.post(`/api/slack/events/${agentId}`, {
      headers: forged.headers,
      data: forged.body,
    })
    expect(refused.status()).toBe(401)
    // And only Slack may hand the agent a message: the app's own users cannot.
    for (const path of ["slack/message", "chats%2F..%2Fslack%2Fmessage"]) {
      const direct = await page.request.post(`/api/agents/${agentId}/${path}`, { data: {} })
      expect(direct.status()).toBe(404)
    }

    const first = mention("USAWYER", "when is the launch?")
    await say(page.request, agentId, first)
    await expect.poll(() => slack.posts()).toHaveLength(1)
    expect(slack.posts()[0]).toMatchObject({ thread: first.ts })
    expect(slack.posts()[0]!.text).toContain("You said: when is the launch?")

    // The thread is one of the agent's conversations, listed in its panel and not in the sidebar.
    // They are folded under their heading until they are asked for, which says how they stand.
    await expect(sectionHeading(page, "From Slack")).toHaveText(/From Slack\s*Answered\s*1/)
    await unfold(page, "From Slack")
    const threads = page.getByRole("list", { name: "From Slack" })
    const row = threads.getByRole("link", { name: /when is the launch\?/ })
    await expect(row).toContainText("#launch · answered")
    const mainChat = page.url()
    await row.click()
    await expect(page.getByRole("link", { name: "Main chat", exact: true })).toBeVisible()
    const transcript = page.getByRole("log")
    await expect(transcript.getByText("when is the launch?", { exact: true })).toBeVisible()
    // Whoever wrote it is one of the agent's people, and is shown as who they are here.
    await expect(transcript.getByText("Sawyer Hood")).toBeVisible()
    await expect(transcript.getByText("in Slack", { exact: true })).toBeVisible()
    await expect(transcript.getByText(/You said: when is the launch\?/)).toBeVisible()
    // It is read here and written in from Slack: there is no box to write in.
    await expect(page.getByText("This conversation is in Slack.")).toBeVisible()
    await expect(composer(page)).toHaveCount(0)
    await expect(page.getByRole("link", { name: "Open in Slack" }).first()).toHaveAttribute(
      "href",
      `https://tidewater.slack.com/archives/C1/p${first.ts}`,
    )

    // More in the same thread carries on the same conversation, on the page as it happens.
    await say(page.request, agentId, mention("USAWYER", "and where?", first.ts))
    await expect(transcript.getByText(/You said: and where\?/)).toBeVisible()
    await expect.poll(() => slack.posts()).toHaveLength(2)
    await expect(threads.getByRole("link")).toHaveCount(1)

    // The main chat holds none of it.
    await page.getByRole("link", { name: "Main chat", exact: true }).click()
    await expect(page).toHaveURL(mainChat)
    await expect(page.getByRole("log").getByText("when is the launch?")).toHaveCount(0)
  })

  test("anyone in the Slack workspace is worked for alike, and the agent writes there unasked", async ({
    page,
  }) => {
    await withPanel(page)
    await signIn(page)
    const agentId = agentIdOf(page)
    const added = await page.request.post(`/api/agents/${agentId}/connectors`, {
      data: { name: "Sums", url: `${mcp.origin}/token/mcp`, token: FIXED_TOKEN },
    })
    expect(added.status()).toBe(201)
    const before = slack.posts().length

    // Dana has no account here. The agent uses its connector for her as it would for anyone,
    // and nothing waits for an OK.
    await say(page.request, agentId, mention("UDANA", '/tool sums__add {"a":19,"b":23}'))
    await expect.poll(() => slack.posts().at(-1)?.text).toContain("sum is 42")
    expect(slack.posts()).toHaveLength(before + 1)
    await unfold(page, "From Slack")
    const threads = page.getByRole("list", { name: "From Slack" })
    await threads.getByRole("link", { name: /sums__add/ }).click()
    const transcript = page.getByRole("log")
    await expect(transcript.getByText("Dana Whitfield")).toBeVisible()
    await expect(transcript.getByText("in Slack", { exact: true })).toBeVisible()
    await expect(page.getByRole("list", { name: "Waiting for your OK" })).toHaveCount(0)

    // From its main chat the agent goes to Slack itself: it sees where it has been added, and
    // writes there as the bot, outside any thread.
    await page.getByRole("link", { name: "Main chat", exact: true }).click()
    await tool(page, "slack", { action: "channels" }, /#launch/)
    await tool(
      page,
      "slack",
      { action: "post", channel: "#launch", text: "Shipping at **noon**." },
      /Posted in #launch\./,
    )
    expect(slack.posts().at(-1)).toEqual({
      channel: "C1",
      thread: undefined,
      text: "Shipping at *noon*.",
    })
    // A channel it has not been added to is not written in, and it is told how to be added.
    await tool(
      page,
      "slack",
      { action: "post", channel: "#general", text: "hello" },
      /You are not in #general\. Someone there has to add you first/,
    )
    expect(slack.posts()).toHaveLength(before + 2)
  })

  test("a file attached in Slack reaches the library, and one the agent sends reaches Slack", async ({
    page,
  }) => {
    await withPanel(page)
    await signIn(page)
    const agentId = agentIdOf(page)
    const before = slack.posts().length
    const first = mention("USAWYER", "keep this for me", undefined, undefined, [
      { name: "notes.txt", url: slack.notes },
    ])
    await say(page.request, agentId, first)
    await expect.poll(() => slack.posts()).toHaveLength(before + 1)
    // The message says what came with it, and the file is in the library, whole.
    await unfold(page, "From Slack")
    const row = page
      .getByRole("list", { name: "From Slack" })
      .getByRole("link", { name: /keep this for me/ })
    await row.click()
    await expect(
      page
        .getByRole("log")
        .getByRole("list", { name: "Sent files" })
        .getByText("notes.txt")
        .first(),
    ).toBeVisible()
    const { files } = (await (await page.request.get(`/api/agents/${agentId}/library`)).json()) as {
      files: { id: string; name: string; source: string }[]
    }
    const kept = files.find((file) => file.name === "notes.txt")
    expect(kept).toMatchObject({ source: "user" })
    const content = await page.request.get(`/api/agents/${agentId}/library/${kept!.id}`)
    expect(await content.text()).toBe("the notes from Slack")

    // The agent makes a file and sends it: it is put in the thread, and shown here too.
    const write = '/tool write {"path":"report.txt","content":"all of it"}'
    await say(page.request, agentId, mention("USAWYER", write, first.ts))
    await expect.poll(() => slack.posts()).toHaveLength(before + 2)
    await say(
      page.request,
      agentId,
      mention("USAWYER", '/tool send {"text":"Here it is.","files":["report.txt"]}', first.ts),
    )
    await expect
      .poll(() => slack.uploads)
      .toEqual([{ name: "report.txt", thread: first.ts, text: "all of it" }])
    await expect.poll(() => slack.posts()).toHaveLength(before + 3)
    await expect(page.getByRole("log").getByText("report.txt").first()).toBeVisible()
  })

  test("taken out of Slack, it no longer hears what is said there", async ({ page }) => {
    await withPanel(page)
    await signIn(page)
    const agentId = agentIdOf(page)
    await openSettings(page, "Slack")
    const dialog = page.getByRole("dialog")
    // Its picture is still to be had once it is there, for an app that was made without one.
    await expect(
      dialog.getByRole("region", { name: "Its picture" }).getByRole("button", {
        name: "Download picture",
      }),
    ).toBeVisible()
    await dialog.getByRole("button", { name: "Remove from Slack" }).click()
    await expect(dialog.getByRole("button", { name: "Connect", exact: true })).toBeVisible()
    const said = mention("USAWYER", "anyone there?")
    const response = await page.request.post(`/api/slack/events/${agentId}`, {
      headers: said.headers,
      data: said.body,
    })
    expect(response.status()).toBe(404)
    // What was said before can still be read.
    await page.keyboard.press("Escape")
    await unfold(page, "From Slack")
    await expect(page.getByRole("list", { name: "From Slack" }).getByRole("link")).toHaveCount(3)
  })
})
