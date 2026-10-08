import { createHmac } from "node:crypto"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { SlackMessage } from "@durable-computer/agent"
import { personalWorkspaceId } from "@durable-computer/protocol"
import type { ActorNamespace } from "@durable-computer/runtime"
import { openNodeAppDatabase } from "@durable-computer/runtime/node"
import { describe, expect, it } from "vitest"
import { migrateAppDatabase } from "./schema.ts"
import {
  connectSlack,
  disconnectSlack,
  isFromSlack,
  messageOf,
  readSlackText,
  slackClient,
  slackDirectory,
  slackEvent,
  slackManifest,
  slackPieces,
  SlackRefusal,
  slackState,
  toSlackMarkup,
} from "./slack.ts"

const SECRET = "8f742231b10e8888abcd99yyyzzz85a5"
const TOKEN = "xoxb-good"
const AGENT = "agent-1"
const NOW = 1_700_000_000_000

/** A request as Slack signs it. */
function signed(body: string, secret = SECRET, at = NOW): Headers {
  const timestamp = String(Math.floor(at / 1000))
  const signature = createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")
  return new Headers({
    "x-slack-request-timestamp": timestamp,
    "x-slack-signature": `v0=${signature}`,
  })
}

type Call = { method: string; token: string | null; args: Record<string, string> }

/** Slack's Web API as a `fetch` stand-in: one workspace, a few people, one thread. */
function fakeSlack(answers: Record<string, (args: Record<string, string>) => object> = {}) {
  const calls: Call[] = []
  const people: Record<string, object> = {
    UJON: { name: "jon", profile: { display_name: "Jon", email: "Jon@Example.com" } },
    UDANA: { name: "dana", real_name: "Dana Whitfield", profile: { email: "dana@else.dev" } },
    UMAYA: { name: "maya", profile: { real_name: "Maya Okafor" } },
  }
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = String(input).split("/").at(-1)!
    const args = Object.fromEntries(new URLSearchParams(String(init?.body)))
    const token = new Headers(init?.headers).get("authorization")
    calls.push({ method, token, args })
    const answer = (value: object) => Response.json(value)
    if (token !== `Bearer ${TOKEN}`) return answer({ ok: false, error: "invalid_auth" })
    if (answers[method] !== undefined) return answer(answers[method](args))
    switch (method) {
      case "auth.test":
        return answer({
          ok: true,
          url: "https://tidewater.slack.com/",
          team: "Tidewater",
          team_id: "T1",
          user: "pip",
          user_id: "UBOT",
        })
      case "users.info":
        return people[args.user!] === undefined
          ? answer({ ok: false, error: "user_not_found" })
          : answer({ ok: true, user: people[args.user!] })
      case "conversations.info":
        return answer({ ok: true, channel: { name: "launch" } })
      case "chat.getPermalink":
        return answer({ ok: true, permalink: `https://tidewater.slack.com/p${args.message_ts}` })
      case "conversations.replies":
        return answer({
          ok: true,
          messages: [
            { user: "UJON", text: "<@UBOT> when is the launch?", ts: "100.000100" },
            { user: "UBOT", bot_id: "B1", text: "March 3.", ts: "101.000100" },
            { user: "UMAYA", text: "It moved, ask <@UDANA> &amp; see <#C9|leadership>", ts: "102" },
            { user: "UDANA", text: "<@UBOT> and where?", ts: "103.000100" },
          ],
        })
      default:
        return answer({ ok: true })
    }
  }) as typeof fetch
  return { fetch: fetcher, calls, methods: () => calls.map((call) => call.method) }
}

async function fresh() {
  const { app } = openNodeAppDatabase(join(mkdtempSync(join(tmpdir(), "dc-slack-")), "app.sqlite"))
  await migrateAppDatabase(app)
  // The part of Better Auth's table that this reads.
  await app.run("CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT, email TEXT, image TEXT)")
  await app.run("INSERT INTO user (id, name, email) VALUES ('sawyer', 'Sawyer', 's@example.com')")
  await app.run("INSERT INTO user (id, name, email) VALUES ('jon', 'Jon', 'jon@example.com')")
  await app.run("INSERT INTO user (id, name, email) VALUES ('dana', 'Dana', 'dana@else.dev')")
  await app.run(
    "INSERT INTO dc_workspaces (id, name, color, created_by, created_at) VALUES ('team', 'Tidewater', 'teal', 'sawyer', 1)",
  )
  for (const id of ["sawyer", "jon"]) {
    await app.run(
      "INSERT INTO dc_members (workspace_id, user_id, role, created_at) VALUES ('team', ?, 'member', 1)",
      id,
    )
  }
  await app.run(
    "INSERT INTO dc_agents (id, owner_id, workspace_id, created_at) VALUES (?, 'sawyer', 'team', 1)",
    AGENT,
  )
  return app
}

/** The agents, as a list of what each was handed. */
function agents(status = 200) {
  const handed: { agentId: string; message: SlackMessage }[] = []
  const namespace: ActorNamespace = {
    get: (agentId) => ({
      fetch: async (request) => {
        expect(new URL(request.url).pathname).toBe("/slack/message")
        handed.push({ agentId, message: (await request.json()) as SlackMessage })
        return Response.json({ chatId: "1" }, { status })
      },
    }),
  }
  return { namespace, handed }
}

const event = (change: object = {}, id = "Ev1") =>
  JSON.stringify({
    type: "event_callback",
    team_id: "T1",
    event_id: id,
    event: {
      type: "app_mention",
      user: "UJON",
      text: "<@UBOT> when is the launch?",
      ts: "100.000100",
      channel: "C1",
      ...change,
    },
  })

const post = (body: string, headers = signed(body)) =>
  new Request("https://app.example/api/slack/events/agent-1", { method: "POST", headers, body })

describe("a request from Slack", () => {
  it("is known by its signature, and only for a few minutes", async () => {
    const body = '{"type":"event_callback"}'
    expect(await isFromSlack(SECRET, signed(body), body, NOW)).toBe(true)
    expect(await isFromSlack(SECRET, signed(body), `${body} `, NOW)).toBe(false)
    expect(await isFromSlack(SECRET, signed(body, "another secret"), body, NOW)).toBe(false)
    expect(await isFromSlack(SECRET, signed(body), body, NOW + 6 * 60_000)).toBe(false)
    expect(await isFromSlack(SECRET, new Headers(), body, NOW)).toBe(false)
    // The example in Slack's own documentation.
    const theirs =
      "token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c"
    const headers = new Headers({
      "x-slack-request-timestamp": "1531420618",
      "x-slack-signature": "v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503",
    })
    expect(await isFromSlack(SECRET, headers, theirs, 1531420618_000)).toBe(true)
  })
})

describe("what was written in Slack", () => {
  it("is read as words: names for ids, and the mention of the agent left out", () => {
    const names = new Map([["U1", "Maya"]])
    expect(readSlackText("<@UBOT>  what did <@U1> say in <#C1|launch>?", names, "UBOT")).toBe(
      "what did @Maya say in #launch?",
    )
    expect(readSlackText("see <https://a.example/x|the doc> or <https://b.example>", names)).toBe(
      "see the doc (https://a.example/x) or https://b.example",
    )
    expect(readSlackText("<!here> 1 &lt; 2 &amp;&amp; <@U9>", names)).toBe("@here 1 < 2 && @U9")
  })

  it("is one of two things an agent hears: a mention, or a direct message from a person", () => {
    const of = (change: object) => messageOf(JSON.parse(event(change)), "UBOT")
    expect(of({})).toEqual({
      id: "Ev1",
      channel: "C1",
      direct: false,
      // A mention outside a thread starts one under itself.
      thread: "100.000100",
      ts: "100.000100",
      user: "UJON",
      text: "<@UBOT> when is the launch?",
    })
    expect(of({ thread_ts: "90.1" })?.thread).toBe("90.1")
    const direct = { type: "message", channel_type: "im", channel: "D1" }
    expect(of(direct)).toMatchObject({ direct: true, thread: null, channel: "D1" })
    expect(of({ ...direct, thread_ts: "90.1" })?.thread).toBe("90.1")
    // A message in a channel that does not mention it is not for it.
    expect(of({ type: "message", channel_type: "channel" })).toBeUndefined()
    // Its own words, another app's, and an edit are not something said to it.
    expect(of({ ...direct, user: "UBOT" })).toBeUndefined()
    expect(of({ ...direct, bot_id: "B2" })).toBeUndefined()
    expect(of({ ...direct, subtype: "message_changed" })).toBeUndefined()
    expect(of({ ...direct, subtype: "file_share" })).toBeDefined()
  })
})

describe("an agent's answer", () => {
  it("is turned into Slack's own markup for the text beside it", () => {
    expect(
      toSlackMarkup(
        "## Open\n- **Pricing** & [the doc](https://a.example/x)\n```\nlet a = **b** < c\n```",
      ),
    ).toBe("*Open*\n• *Pricing* &amp; <https://a.example/x|the doc>\n```\nlet a = **b** < c\n```")
  })

  it("is posted in pieces when it is long, broken between paragraphs", () => {
    expect(slackPieces("short")).toEqual(["short"])
    const pieces = slackPieces(`${"a".repeat(60)}\n\n${"b".repeat(60)}\n\n${"c".repeat(30)}`, 100)
    expect(pieces).toEqual(["a".repeat(60), `${"b".repeat(60)}\n\n${"c".repeat(30)}`])
    expect(slackPieces("x".repeat(250), 100).map((piece) => piece.length)).toEqual([100, 100, 50])
  })
})

describe("putting an agent in Slack", () => {
  it("fills in Slack's page for making the app: its name, what it may do, where events go", async () => {
    const manifest = slackManifest("Pip the 2nd!", "https://app.example", AGENT)
    expect(manifest.display_information.name).toBe("Pip the 2nd!")
    expect(manifest.features.bot_user.display_name).toBe("pip-the-2nd")
    expect(manifest.settings.event_subscriptions).toEqual({
      request_url: "https://app.example/api/slack/events/agent-1",
      bot_events: ["app_mention", "message.im"],
    })
    expect(manifest.oauth_config.redirect_urls).toEqual([
      "https://app.example/api/connectors/callback",
    ])
    expect(slackManifest(null, "https://app.example", AGENT).features.bot_user.display_name).toBe(
      "do-computer",
    )
    const db = await fresh()
    const state = await slackState(db, AGENT, "Pip", "https://app.example")
    expect(state.app).toBeNull()
    const url = new URL(state.createUrl)
    expect(url.origin + url.pathname).toBe("https://api.slack.com/apps")
    expect(JSON.parse(url.searchParams.get("manifest_json")!)).toEqual(
      slackManifest("Pip", "https://app.example", AGENT),
    )
  })

  it("tries the token on Slack, and keeps what Slack says of it and none of the secrets in view", async () => {
    const db = await fresh()
    const slack = fakeSlack()
    const deps = { fetch: slack.fetch, now: () => NOW }
    const refused = (input: object) =>
      connectSlack(db, deps, AGENT, "sawyer", input).then(
        () => undefined,
        (error) => (error instanceof SlackRefusal ? error.status : error),
      )
    expect(await refused({ botToken: "xoxp-a-user-token", signingSecret: SECRET })).toBe(400)
    expect(await refused({ botToken: TOKEN })).toBe(400)
    expect(await refused({ botToken: TOKEN, signingSecret: SECRET, clientId: "1.2" })).toBe(400)
    expect(await refused({ botToken: "xoxb-wrong", signingSecret: SECRET })).toBe(400)
    expect((await slackState(db, AGENT, "Pip", "https://app.example")).app).toBeNull()

    const app = await connectSlack(db, deps, AGENT, "sawyer", {
      botToken: ` ${TOKEN} `,
      signingSecret: SECRET,
    })
    expect(app).toEqual({
      team: "Tidewater",
      teamUrl: "https://tidewater.slack.com/",
      bot: "pip",
      hasClient: false,
      connectedAt: NOW,
    })
    const state = await slackState(db, AGENT, "Pip", "https://app.example")
    expect(state.app).toEqual(app)
    expect(JSON.stringify(state)).not.toContain(TOKEN)
    expect(JSON.stringify(state)).not.toContain(SECRET)
    expect(await slackClient(db, AGENT)).toBeUndefined()

    // Adding it again replaces what was there, and can bring what the connector signs in with.
    await connectSlack(db, deps, AGENT, "sawyer", {
      botToken: TOKEN,
      signingSecret: SECRET,
      clientId: "1.2",
      clientSecret: "shh",
    })
    expect((await slackState(db, AGENT, "Pip", "https://app.example")).app?.hasClient).toBe(true)
    expect(await slackClient(db, AGENT)).toEqual({ clientId: "1.2", clientSecret: "shh" })

    await disconnectSlack(db, AGENT)
    expect((await slackState(db, AGENT, "Pip", "https://app.example")).app).toBeNull()
  })
})

describe("what Slack sends", () => {
  it("is answered with its own word when Slack tries the address, even before the secret is here", async () => {
    const db = await fresh()
    const { namespace } = agents()
    const body = JSON.stringify({ type: "url_verification", challenge: "abc123" })
    const early = await slackEvent(db, namespace, post(body, new Headers()), AGENT, NOW)
    expect(await early.json()).toEqual({ challenge: "abc123" })
    // An agent there is no record of has no address.
    expect((await slackEvent(db, namespace, post(body), "nobody", NOW)).status).toBe(404)
    // Once the secret is here, it is asked of this request too.
    await connectSlack(db, { fetch: fakeSlack().fetch }, AGENT, "sawyer", {
      botToken: TOKEN,
      signingSecret: SECRET,
    })
    expect((await slackEvent(db, namespace, post(body, new Headers()), AGENT, NOW)).status).toBe(
      401,
    )
    expect(await (await slackEvent(db, namespace, post(body), AGENT, NOW)).json()).toEqual({
      challenge: "abc123",
    })
  })

  it("reaches the agent only when Slack signed it, and only when it is something said to it", async () => {
    const db = await fresh()
    const { namespace, handed } = agents()
    // Not in Slack: there is no secret to check it against.
    expect((await slackEvent(db, namespace, post(event()), AGENT, NOW)).status).toBe(404)
    await connectSlack(db, { fetch: fakeSlack().fetch }, AGENT, "sawyer", {
      botToken: TOKEN,
      signingSecret: SECRET,
    })
    const forged = post(event(), signed(event(), "not the secret"))
    expect((await slackEvent(db, namespace, forged, AGENT, NOW)).status).toBe(401)
    const stale = post(event(), signed(event(), SECRET, NOW - 10 * 60_000))
    expect((await slackEvent(db, namespace, stale, AGENT, NOW)).status).toBe(401)
    expect(handed).toEqual([])

    expect((await slackEvent(db, namespace, post(event()), AGENT, NOW)).status).toBe(200)
    expect(handed).toEqual([
      {
        agentId: AGENT,
        message: {
          id: "Ev1",
          channel: "C1",
          direct: false,
          thread: "100.000100",
          ts: "100.000100",
          user: "UJON",
          text: "<@UBOT> when is the launch?",
        },
      },
    ])
    // The agent's own words coming back, and what is not a message at all, are let go.
    const own = event({ user: "UBOT" }, "Ev2")
    expect((await slackEvent(db, namespace, post(own), AGENT, NOW)).status).toBe(200)
    const other = JSON.stringify({ type: "app_rate_limited", team_id: "T1" })
    expect((await slackEvent(db, namespace, post(other), AGENT, NOW)).status).toBe(200)
    expect(handed).toHaveLength(1)
    // Anyone can write to the address, so more than Slack would ever send is not read.
    const huge = "x".repeat(1024 * 1024 + 1)
    expect((await slackEvent(db, namespace, post(huge), AGENT, NOW)).status).toBe(413)
  })

  it("is sent again by Slack when the agent failed on it, and not when the agent refused it", async () => {
    const db = await fresh()
    await connectSlack(db, { fetch: fakeSlack().fetch }, AGENT, "sawyer", {
      botToken: TOKEN,
      signingSecret: SECRET,
    })
    expect((await slackEvent(db, agents(500).namespace, post(event()), AGENT, NOW)).status).toBe(
      503,
    )
    expect((await slackEvent(db, agents(400).namespace, post(event()), AGENT, NOW)).status).toBe(
      200,
    )
  })
})

describe("what an agent is told of a message", () => {
  const message: SlackMessage = {
    id: "Ev9",
    channel: "C1",
    direct: false,
    thread: "100.000100",
    ts: "103.000100",
    user: "UDANA",
    text: "<@UBOT> and where?",
  }

  it("is who wrote it, where, and what others said in the thread before", async () => {
    const db = await fresh()
    const slack = fakeSlack()
    const deps = { fetch: slack.fetch }
    const directory = slackDirectory(db, deps)
    expect(await directory.describe(AGENT, message, null)).toBeUndefined()
    await connectSlack(db, deps, AGENT, "sawyer", { botToken: TOKEN, signingSecret: SECRET })

    const told = await directory.describe(AGENT, message, null)
    expect(told).toEqual({
      // Dana has an account here, and is not one of this agent's people.
      from: { id: "UDANA", name: "Dana Whitfield" },
      text: "and where?",
      channelName: "launch",
      url: "https://tidewater.slack.com/p100.000100",
      // The agent's own answer is left out: it has that already. So is the message itself.
      earlier: [
        { name: "Jon", text: "@pip when is the launch?" },
        { name: "Maya Okafor", text: "It moved, ask @Dana Whitfield & see #leadership" },
      ],
    })
    // Having been given the thread up to a point, it is told only what came after.
    const later = await directory.describe(AGENT, message, "101.000100")
    expect(later?.earlier.map((said) => said.name)).toEqual(["Maya Okafor"])
    expect(slack.calls.findLast((call) => call.method === "conversations.replies")?.args).toEqual({
      channel: "C1",
      ts: "100.000100",
      oldest: "101.000100",
      limit: "50",
    })
  })

  it("names someone as one of its people by their email address, whatever its case", async () => {
    const db = await fresh()
    const deps = { fetch: fakeSlack().fetch }
    await connectSlack(db, deps, AGENT, "sawyer", { botToken: TOKEN, signingSecret: SECRET })
    const first = { ...message, user: "UJON", thread: "100.000100", ts: "100.000100" }
    const told = await slackDirectory(db, deps).describe(AGENT, first, null)
    expect(told?.from).toEqual({ id: "UJON", name: "Jon", userId: "jon" })
    // The first message of a thread has nothing before it, and Slack is not asked.
    expect(told?.earlier).toEqual([])

    // In someone's own workspace, the only one of its people is that person.
    await db.run(
      "INSERT INTO dc_agents (id, owner_id, workspace_id, created_at) VALUES ('solo', 'dana', ?, 1)",
      personalWorkspaceId("dana"),
    )
    await connectSlack(db, deps, "solo", "dana", { botToken: TOKEN, signingSecret: SECRET })
    const solo = slackDirectory(db, deps)
    expect((await solo.describe("solo", first, null))?.from.userId).toBeUndefined()
    expect((await solo.describe("solo", message, null))?.from.userId).toBe("dana")
  })

  it("still arrives when Slack will not say who or where", async () => {
    const db = await fresh()
    const failing = () => ({ ok: false, error: "missing_scope" })
    const slack = fakeSlack({
      "users.info": failing,
      "conversations.info": failing,
      "chat.getPermalink": failing,
      "conversations.replies": failing,
    })
    await connectSlack(db, { fetch: slack.fetch }, AGENT, "sawyer", {
      botToken: TOKEN,
      signingSecret: SECRET,
    })
    expect(await slackDirectory(db, { fetch: slack.fetch }).describe(AGENT, message, null)).toEqual(
      {
        from: { id: "UDANA", name: "Someone" },
        text: "and where?",
        channelName: null,
        url: null,
        earlier: [],
      },
    )
  })
})

describe("what an agent says in Slack", () => {
  const place = { channel: "C1", thread: "100.000100" }

  it("is posted to the thread as markdown, with plain words beside it", async () => {
    const db = await fresh()
    const slack = fakeSlack()
    const deps = { fetch: slack.fetch }
    const directory = slackDirectory(db, deps)
    expect(await directory.post(AGENT, place, "hello")).toBe(false)
    await connectSlack(db, deps, AGENT, "sawyer", { botToken: TOKEN, signingSecret: SECRET })
    expect(await directory.post(AGENT, place, "**March 3**, at the pier.")).toBe(true)
    expect(slack.calls.at(-1)).toMatchObject({
      method: "chat.postMessage",
      args: {
        channel: "C1",
        thread_ts: "100.000100",
        text: "*March 3*, at the pier.",
        blocks: JSON.stringify([{ type: "markdown", text: "**March 3**, at the pier." }]),
      },
    })
    // A direct message outside a thread is answered outside one.
    await directory.post(AGENT, { channel: "D1", thread: null }, "hi")
    expect(slack.calls.at(-1)?.args.thread_ts).toBeUndefined()
  })

  it("is posted as plain words where Slack will not take the markdown", async () => {
    const db = await fresh()
    const slack = fakeSlack({
      "chat.postMessage": (args) =>
        args.blocks === undefined ? { ok: true } : { ok: false, error: "invalid_blocks" },
    })
    const deps = { fetch: slack.fetch }
    await connectSlack(db, deps, AGENT, "sawyer", { botToken: TOKEN, signingSecret: SECRET })
    expect(await slackDirectory(db, deps).post(AGENT, place, "**hi**")).toBe(true)
    expect(slack.calls.slice(-2).map((call) => call.args.blocks === undefined)).toEqual([
      false,
      true,
    ])
  })

  it("is given up where the app is gone from there, and tried again where Slack is only busy", async () => {
    const db = await fresh()
    let error = "channel_not_found"
    const slack = fakeSlack({ "chat.postMessage": () => ({ ok: false, error }) })
    const deps = { fetch: slack.fetch }
    await connectSlack(db, deps, AGENT, "sawyer", { botToken: TOKEN, signingSecret: SECRET })
    const directory = slackDirectory(db, deps)
    expect(await directory.post(AGENT, place, "hi")).toBe(false)
    error = "token_revoked"
    expect(await directory.post(AGENT, place, "hi")).toBe(false)
    error = "ratelimited"
    await expect(directory.post(AGENT, place, "hi")).rejects.toThrow("limiting")
    error = "internal_error"
    await expect(directory.post(AGENT, place, "hi")).rejects.toThrow("internal_error")
  })

  it("is shown to be on its way, by a status where Slack has one and a mark where it has not", async () => {
    const db = await fresh()
    const slack = fakeSlack()
    const deps = { fetch: slack.fetch }
    await connectSlack(db, deps, AGENT, "sawyer", { botToken: TOKEN, signingSecret: SECRET })
    await slackDirectory(db, deps).working!(AGENT, { ...place, ts: "103.000100" })
    expect(slack.calls.at(-1)).toMatchObject({
      method: "assistant.threads.setStatus",
      args: { channel_id: "C1", thread_ts: "100.000100" },
    })
    const without = fakeSlack({
      "assistant.threads.setStatus": () => ({ ok: false, error: "missing_scope" }),
    })
    await slackDirectory(db, { fetch: without.fetch }).working!(AGENT, {
      channel: "D1",
      thread: null,
      ts: "103.000100",
    })
    expect(without.calls.map((call) => [call.method, call.args])).toEqual([
      [
        "assistant.threads.setStatus",
        expect.objectContaining({ channel_id: "D1", thread_ts: "103.000100" }),
      ],
      ["reactions.add", { channel: "D1", timestamp: "103.000100", name: "eyes" }],
    ])
  })
})
