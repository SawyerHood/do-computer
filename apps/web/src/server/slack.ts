import type {
  SlackContext,
  SlackDirectory,
  SlackMessage,
  SlackSender,
} from "@durable-computer/agent"
import {
  BodyTooLarge,
  type ConnectSlackRequest,
  declaredTooLarge,
  readLimited,
  type SlackApp,
  type SlackState,
} from "@durable-computer/protocol"
import type { ActorNamespace, AppDatabase } from "@durable-computer/runtime"
import { peopleOfAgent } from "./teams.ts"

/**
 * An agent in Slack, as rows in the app database and calls to Slack. Nothing here knows about
 * requests' sessions or the platform, so that it can be tested against a database and a stand-in
 * for Slack, and so that it can run where the agent does, which is not always where requests are
 * served.
 *
 * An agent is put in Slack as an app of its own, made by whoever adds it: the bot there has the
 * agent's name. What Slack hears said to it is sent to `/api/slack/events/<agent>`, signed with
 * the app's secret. The app's token never leaves this file: an agent posts through the directory.
 */

export const SLACK_API_URL = "https://slack.com/api"
/** How far a request's own time may be from now. Slack's own advice: an older one is a replay. */
const MAX_SKEW_SECONDS = 5 * 60
/** A message with a markdown block can carry this much; longer answers go in several. */
const MAX_POST_CHARS = 11_000
/** How much of a thread is read to tell an agent what was said before it was spoken to. */
const MAX_THREAD_MESSAGES = 50
/** The most Slack sends about one message, with room to spare. */
const MAX_EVENT_BYTES = 1024 * 1024
/** How many people's names are looked up for one message. The rest are called by their id. */
const MAX_NAMES = 8

export type SlackDeps = {
  /** Where Slack's Web API is. Only a test's stand-in is anywhere else. */
  apiUrl?: string | undefined
  fetch?: typeof fetch
  now?: () => number
}

/** A problem with what someone asked for, answered with its status and words. */
export class SlackRefusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

type AppRow = {
  agent_id: string
  team_id: string
  team_name: string
  team_url: string | null
  bot_user_id: string
  bot_name: string
  bot_token: string
  signing_secret: string
  client_id: string | null
  client_secret: string | null
  created_by: string
  created_at: number
}

const appOf = (db: AppDatabase, agentId: string) =>
  db.get<AppRow>("SELECT * FROM dc_slack_apps WHERE agent_id = ?", agentId)

/** What Slack answers a Web API call with: `ok`, and then either the result or why not. */
type Answer = { ok: boolean; error?: string } & Record<string, unknown>

/** Slack's reasons that mean the app can no longer act at all, or not in that place. */
const GONE = new Set([
  "invalid_auth",
  "account_inactive",
  "token_revoked",
  "token_expired",
  "not_authed",
  "channel_not_found",
  "is_archived",
  "not_in_channel",
  "thread_not_found",
])

/**
 * Call a method of Slack's Web API as an app. Arguments go as a form, which every method takes.
 * Rejects when Slack cannot be reached or asks to be left alone for a while; otherwise resolves
 * with what it said, which may be that the call failed.
 */
async function slack(
  deps: SlackDeps,
  token: string,
  method: string,
  args: Record<string, string | undefined>,
): Promise<Answer> {
  const form = new URLSearchParams()
  for (const [key, value] of Object.entries(args)) if (value !== undefined) form.set(key, value)
  const response = await (deps.fetch ?? fetch)(`${deps.apiUrl ?? SLACK_API_URL}/${method}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  })
  if (response.status === 429 || response.status >= 500) {
    throw new Error(`Slack answered ${response.status} to ${method}`)
  }
  const answer = (await response.json().catch(() => undefined)) as Answer | undefined
  if (answer === undefined || typeof answer.ok !== "boolean") {
    throw new Error(`Slack's answer to ${method} could not be read`)
  }
  if (answer.error === "ratelimited") throw new Error(`Slack is limiting calls to ${method}`)
  return answer
}

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("")

/**
 * Whether a request is Slack's: it is signed with the app's secret over its time and its body,
 * and its time is close to now, so that a request someone recorded cannot be played again later.
 */
export async function isFromSlack(
  secret: string,
  headers: Headers,
  body: string,
  now: number,
): Promise<boolean> {
  const timestamp = headers.get("x-slack-request-timestamp") ?? ""
  const signature = headers.get("x-slack-signature") ?? ""
  if (!/^\d+$/.test(timestamp) || !signature.startsWith("v0=")) return false
  if (Math.abs(now / 1000 - Number(timestamp)) > MAX_SKEW_SECONDS) return false
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const expected = `v0=${hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`v0:${timestamp}:${body}`)))}`
  // Compared in full whatever differs, so that how long it takes says nothing of where.
  let difference = expected.length ^ signature.length
  for (let index = 0; index < expected.length; index++) {
    difference |= expected.charCodeAt(index) ^ (signature.charCodeAt(index) || 0)
  }
  return difference === 0
}

/**
 * What someone wrote in Slack, as words. Slack sends mentions, channels and links as markup
 * around ids; `names` says what each id is called. A mention of `self`, the agent, is left out:
 * it is how the message was addressed, not part of what it says.
 */
export function readSlackText(
  text: string,
  names: ReadonlyMap<string, string>,
  self?: string,
): string {
  return text
    .replace(/<@([A-Z0-9]+)(?:\|([^>]*))?>/g, (_all, id: string, label?: string) =>
      id === self ? "" : `@${names.get(id) ?? (label || id)}`,
    )
    .replace(/<#([A-Z0-9]+)(?:\|([^>]*))?>/g, (_all, id: string, label?: string) =>
      label ? `#${label}` : `#${id}`,
    )
    .replace(/<!(?:subteam\^[A-Z0-9]+\|)?@?([^>|]+)(?:\|[^>]*)?>/g, "@$1")
    .replace(/<((?:https?:|mailto:)[^>|]+)\|([^>]+)>/g, "$2 ($1)")
    .replace(/<((?:https?:|mailto:)[^>]+)>/g, "$1")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
}

/**
 * Markdown as Slack's own lighter markup, for the plain text every message also carries: it is
 * what a notification shows, and what is shown where a markdown block cannot be.
 */
export function toSlackMarkup(markdown: string): string {
  return markdown
    .split(/(```[\s\S]*?```)/)
    .map((part, index) =>
      // Code is left exactly as it was written.
      index % 2 === 1
        ? part
        : part
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replace(/!?\[([^\]]+)\]\((https?:[^)\s]+)\)/g, "<$2|$1>")
            .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
            .replace(/\*\*([^*\n]+)\*\*/g, "*$1*")
            .replace(/__([^_\n]+)__/g, "*$1*")
            .replace(/~~([^~\n]+)~~/g, "~$1~")
            .replace(/^(\s*)[-*]\s+/gm, "$1• "),
    )
    .join("")
}

/** An answer in pieces short enough to post, broken between paragraphs where it can be. */
export function slackPieces(text: string, limit = MAX_POST_CHARS): string[] {
  const pieces: string[] = []
  let rest = text.trim()
  while (rest.length > limit) {
    const window = rest.slice(0, limit)
    const at = [window.lastIndexOf("\n\n"), window.lastIndexOf("\n"), window.lastIndexOf(" ")].find(
      (index) => index > limit / 2,
    )
    const cut = at ?? limit
    pieces.push(rest.slice(0, cut).trimEnd())
    rest = rest.slice(cut).trimStart()
  }
  if (rest !== "") pieces.push(rest)
  return pieces
}

/**
 * What the agent's connector may do as whoever signs in: everything Slack's MCP server offers,
 * since signing in to it asks for all of that, and Slack refuses what an app does not list.
 */
const USER_SCOPES = [
  "canvases:read",
  "canvases:write",
  "channels:history",
  "channels:read",
  "channels:write",
  "chat:write",
  "emoji:read",
  "files:read",
  "files:write",
  "groups:history",
  "groups:read",
  "groups:write",
  "im:history",
  "im:read",
  "im:write",
  "lists:read",
  "lists:write",
  "mpim:history",
  "mpim:read",
  "mpim:write",
  "reactions:read",
  "reactions:write",
  "search:read.files",
  "search:read.im",
  "search:read.mpim",
  "search:read.private",
  "search:read.public",
  "search:read.users",
  "users:read",
  "users:read.email",
]

/** What the bot needs: to hear itself spoken to, read the thread it is in, and answer there. */
const BOT_SCOPES = [
  "app_mentions:read",
  "channels:history",
  "channels:read",
  "chat:write",
  "groups:history",
  "groups:read",
  "im:history",
  "mpim:history",
  "reactions:write",
  "users:read",
  "users:read.email",
]

export const slackEventsUrl = (origin: string, agentId: string) =>
  `${origin}/api/slack/events/${encodeURIComponent(agentId)}`

/**
 * The Slack app an agent is in Slack as, as Slack's "create an app" page takes it: its name, what
 * it may do, and where Slack sends what is said to it. Everything in it is filled in for the
 * person, who only chooses a workspace.
 */
export function slackManifest(agentName: string | null, origin: string, agentId: string) {
  const name = (agentName ?? "").trim() || "Do Computer"
  const handle =
    name
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "agent"
  return {
    display_information: {
      name: name.slice(0, 35),
      description: `${name.slice(0, 35)}, an agent on Do Computer`,
    },
    features: {
      bot_user: { display_name: handle, always_online: true },
      // So that it can be written to directly, as well as mentioned in a channel.
      app_home: {
        home_tab_enabled: false,
        messages_tab_enabled: true,
        messages_tab_read_only_enabled: false,
      },
    },
    oauth_config: {
      redirect_urls: [`${origin}/api/connectors/callback`],
      scopes: { bot: BOT_SCOPES, user: USER_SCOPES },
    },
    settings: {
      event_subscriptions: {
        request_url: slackEventsUrl(origin, agentId),
        bot_events: ["app_mention", "message.im"],
      },
      // What lets the connector sign in to Slack's MCP server as this app.
      is_mcp_enabled: true,
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  }
}

const summaryOf = (row: AppRow): SlackApp => ({
  team: row.team_name,
  teamUrl: row.team_url,
  bot: row.bot_name,
  hasClient: row.client_id !== null && row.client_secret !== null,
  connectedAt: row.created_at,
})

/** An agent's place in Slack, and what is needed to put it there. */
export async function slackState(
  db: AppDatabase,
  agentId: string,
  agentName: string | null,
  origin: string,
): Promise<SlackState> {
  const row = await appOf(db, agentId)
  return {
    app: row === undefined ? null : summaryOf(row),
    createUrl: `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(
      JSON.stringify(slackManifest(agentName, origin, agentId)),
    )}`,
    eventsUrl: slackEventsUrl(origin, agentId),
    redirectUrl: `${origin}/api/connectors/callback`,
  }
}

/**
 * Put an agent in Slack as the app these are the credentials of. The token is tried on Slack
 * first, which also says which workspace it is for and what the bot is called there.
 */
export async function connectSlack(
  db: AppDatabase,
  deps: SlackDeps,
  agentId: string,
  userId: string,
  input: Partial<ConnectSlackRequest> | null,
): Promise<SlackApp> {
  const field = (value: unknown) => (typeof value === "string" ? value.trim() : "")
  const botToken = field(input?.botToken)
  const signingSecret = field(input?.signingSecret)
  const clientId = field(input?.clientId)
  const clientSecret = field(input?.clientSecret)
  if (!botToken.startsWith("xoxb-")) {
    throw new SlackRefusal(
      400,
      "The bot token begins with xoxb-. It is under OAuth & Permissions on the app's page in Slack, once the app is installed.",
    )
  }
  if (signingSecret === "" || signingSecret.length > 200) {
    throw new SlackRefusal(
      400,
      "The signing secret is under Basic Information on the app's page in Slack.",
    )
  }
  if ((clientId === "") !== (clientSecret === "")) {
    throw new SlackRefusal(400, "The client ID and the client secret go together: give both.")
  }
  let answer: Answer
  try {
    answer = await slack(deps, botToken, "auth.test", {})
  } catch {
    throw new SlackRefusal(502, "Slack could not be reached to try the bot token. Try again.")
  }
  if (!answer.ok || typeof answer.user_id !== "string" || typeof answer.team_id !== "string") {
    throw new SlackRefusal(
      400,
      `Slack did not accept that bot token${answer.error ? ` (${answer.error})` : ""}.`,
    )
  }
  const row: AppRow = {
    agent_id: agentId,
    team_id: answer.team_id,
    team_name: typeof answer.team === "string" ? answer.team : "Slack",
    team_url: typeof answer.url === "string" ? answer.url : null,
    bot_user_id: answer.user_id,
    bot_name: typeof answer.user === "string" ? answer.user : "bot",
    bot_token: botToken,
    signing_secret: signingSecret,
    client_id: clientId === "" ? null : clientId,
    client_secret: clientSecret === "" ? null : clientSecret,
    created_by: userId,
    created_at: (deps.now ?? Date.now)(),
  }
  await db.run(
    `INSERT INTO dc_slack_apps (agent_id, team_id, team_name, team_url, bot_user_id, bot_name,
       bot_token, signing_secret, client_id, client_secret, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (agent_id) DO UPDATE SET team_id = excluded.team_id,
       team_name = excluded.team_name, team_url = excluded.team_url,
       bot_user_id = excluded.bot_user_id, bot_name = excluded.bot_name,
       bot_token = excluded.bot_token, signing_secret = excluded.signing_secret,
       client_id = excluded.client_id, client_secret = excluded.client_secret,
       created_by = excluded.created_by, created_at = excluded.created_at`,
    row.agent_id,
    row.team_id,
    row.team_name,
    row.team_url,
    row.bot_user_id,
    row.bot_name,
    row.bot_token,
    row.signing_secret,
    row.client_id,
    row.client_secret,
    row.created_by,
    row.created_at,
  )
  return summaryOf(row)
}

/** Take an agent out of Slack. What was said there stays readable in the app. */
export async function disconnectSlack(db: AppDatabase, agentId: string): Promise<void> {
  await db.run("DELETE FROM dc_slack_apps WHERE agent_id = ?", agentId)
}

/** The id and secret the Slack connector signs in with, where the agent's app has them. */
export async function slackClient(
  db: AppDatabase,
  agentId: string,
): Promise<{ clientId: string; clientSecret: string } | undefined> {
  const row = await appOf(db, agentId)
  return row === undefined || row.client_id === null || row.client_secret === null
    ? undefined
    : { clientId: row.client_id, clientSecret: row.client_secret }
}

/** One event as Slack sends it, as far as this reads it. */
type SlackEvent = {
  type?: string
  subtype?: string
  channel?: string
  channel_type?: string
  user?: string
  bot_id?: string
  text?: string
  ts?: string
  thread_ts?: string
}

/**
 * The message an event is, if it is something said to the agent by a person: a mention in a
 * channel, or a direct message. The agent's own words, other apps', edits and the like are not.
 */
export function messageOf(
  payload: { event_id?: unknown; event?: SlackEvent },
  botUserId: string,
): SlackMessage | undefined {
  const event = payload.event
  if (event === undefined || typeof payload.event_id !== "string") return undefined
  const direct = event.type === "message" && event.channel_type === "im"
  if (event.type !== "app_mention" && !direct) return undefined
  // A file shared with words is a message; anything else with a subtype is an edit or a notice.
  if (event.subtype !== undefined && event.subtype !== "file_share") return undefined
  if (event.bot_id !== undefined || event.user === undefined || event.user === botUserId) {
    return undefined
  }
  if (typeof event.channel !== "string" || typeof event.ts !== "string") return undefined
  return {
    id: payload.event_id,
    channel: event.channel,
    direct,
    // A mention outside a thread starts one, under itself. A direct message is answered in the
    // run of the conversation unless it was itself in a thread.
    thread: event.thread_ts ?? (direct ? null : event.ts),
    ts: event.ts,
    user: event.user,
    text: typeof event.text === "string" ? event.text : "",
  }
}

/**
 * Take in what Slack sent for an agent. Slack wants its answer within three seconds and sends
 * again when it does not get one, so this resolves once the agent has the message, not once it
 * has answered, and the agent takes a message it was told of twice as one.
 */
export async function slackEvent(
  db: AppDatabase,
  agents: ActorNamespace,
  request: Request,
  agentId: string,
  now = Date.now(),
): Promise<Response> {
  const known = await db.get<{ id: string }>("SELECT id FROM dc_agents WHERE id = ?", agentId)
  if (known === undefined) return new Response("Not found", { status: 404 })
  // Anyone can write to this address, so what they send is read only up to a limit.
  let body: string
  try {
    if (declaredTooLarge(request.headers, MAX_EVENT_BYTES)) throw new BodyTooLarge(MAX_EVENT_BYTES)
    body = new TextDecoder().decode(await readLimited(request.body, MAX_EVENT_BYTES))
  } catch (error) {
    return error instanceof BodyTooLarge
      ? new Response("Too large", { status: 413 })
      : new Response("Bad request", { status: 400 })
  }
  let payload: { type?: string; challenge?: unknown; event?: SlackEvent }
  try {
    payload = JSON.parse(body)
  } catch {
    return new Response("Bad request", { status: 400 })
  }
  const row = await appOf(db, agentId)
  // Slack tries the address when the app is made, before its secret can have been pasted here.
  // Saying its own word back gives nothing away, so that one request is answered unsigned.
  if (payload?.type === "url_verification" && typeof payload.challenge === "string") {
    if (row !== undefined && !(await isFromSlack(row.signing_secret, request.headers, body, now))) {
      return new Response("Unauthorized", { status: 401 })
    }
    return Response.json({ challenge: payload.challenge })
  }
  if (row === undefined) return new Response("Not found", { status: 404 })
  if (!(await isFromSlack(row.signing_secret, request.headers, body, now))) {
    return new Response("Unauthorized", { status: 401 })
  }
  const ok = () => Response.json({ ok: true })
  if (payload?.type !== "event_callback") return ok()
  const message = messageOf(payload, row.bot_user_id)
  if (message === undefined) return ok()
  const response = await agents.get(agentId).fetch(
    new Request("http://agent/slack/message", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message),
    }),
  )
  // A message the agent could not make sense of will not read better a second time. One it
  // failed on might, and Slack sends again when told so.
  return response.status >= 500 ? new Response("Try again", { status: 503 }) : ok()
}

type SlackUser = { name: string; email: string | undefined }

/**
 * How an agent reaches Slack. It runs where the agent does, so it is handed the database instead
 * of finding the platform. Whether the agent is still in Slack is looked up each time.
 */
export function slackDirectory(db: AppDatabase, deps: SlackDeps = {}): SlackDirectory {
  const person = async (token: string, id: string): Promise<SlackUser | undefined> => {
    const answer = await slack(deps, token, "users.info", { user: id }).catch(() => undefined)
    const user = answer?.user as
      | {
          name?: string
          real_name?: string
          profile?: { display_name?: string; real_name?: string; email?: string }
        }
      | undefined
    if (answer?.ok !== true || user === undefined) return undefined
    return {
      name:
        user.profile?.display_name ||
        user.profile?.real_name ||
        user.real_name ||
        user.name ||
        "Someone",
      email: user.profile?.email?.toLowerCase(),
    }
  }

  /** The user of the app someone in Slack is, if they are one of the people the agent works for. */
  const memberWith = async (agentId: string, email: string | undefined) => {
    if (email === undefined || email === "") return undefined
    const people = await peopleOfAgent(db, agentId)
    if (people.length === 0) return undefined
    const found = await db.get<{ id: string }>(
      `SELECT id FROM user WHERE lower(email) = ? AND id IN (${people.map(() => "?").join(", ")})`,
      email,
      ...people,
    )
    return found?.id
  }

  return {
    async describe(agentId, message, after): Promise<SlackContext | undefined> {
      const row = await appOf(db, agentId)
      if (row === undefined) return undefined
      const token = row.bot_token
      // What others said in the thread before this: all of it the first time the agent is
      // spoken to there, and after that only what is new to it.
      const inThread = message.thread !== null && message.thread !== message.ts
      const [author, channel, link, replies] = await Promise.all([
        person(token, message.user),
        message.direct
          ? undefined
          : slack(deps, token, "conversations.info", { channel: message.channel }).catch(
              () => undefined,
            ),
        slack(deps, token, "chat.getPermalink", {
          channel: message.channel,
          message_ts: message.thread ?? message.ts,
        }).catch(() => undefined),
        inThread
          ? slack(deps, token, "conversations.replies", {
              channel: message.channel,
              ts: message.thread!,
              oldest: after ?? undefined,
              limit: String(MAX_THREAD_MESSAGES),
            }).catch(() => undefined)
          : undefined,
      ])
      const before = (
        replies?.ok === true && Array.isArray(replies.messages)
          ? (replies.messages as SlackEvent[])
          : []
      ).filter(
        (said) =>
          typeof said.ts === "string" &&
          typeof said.text === "string" &&
          said.text !== "" &&
          said.user !== row.bot_user_id &&
          Number(said.ts) < Number(message.ts) &&
          (after === null || Number(said.ts) > Number(after)),
      )
      // Everyone named in what is handed over: who spoke, and who was mentioned.
      const ids = new Set<string>()
      for (const said of before) if (said.user !== undefined) ids.add(said.user)
      for (const text of [message.text, ...before.map((said) => said.text ?? "")]) {
        for (const [, id] of text.matchAll(/<@([A-Z0-9]+)/g)) ids.add(id!)
      }
      ids.delete(message.user)
      ids.delete(row.bot_user_id)
      const names = new Map<string, string>([[row.bot_user_id, row.bot_name]])
      if (author !== undefined) names.set(message.user, author.name)
      await Promise.all(
        [...ids].slice(0, MAX_NAMES).map(async (id) => {
          const found = await person(token, id)
          if (found !== undefined) names.set(id, found.name)
        }),
      )
      const userId = await memberWith(agentId, author?.email)
      const from: SlackSender = {
        id: message.user,
        name: author?.name ?? "Someone",
        ...(userId === undefined ? {} : { userId }),
      }
      const named = (channel?.channel as { name?: string } | undefined)?.name
      return {
        from,
        text: readSlackText(message.text, names, row.bot_user_id),
        channelName: channel?.ok === true && typeof named === "string" ? named : null,
        url: link?.ok === true && typeof link.permalink === "string" ? link.permalink : null,
        earlier: before.map((said) => ({
          name: names.get(said.user ?? "") ?? "Someone",
          text: readSlackText(said.text ?? "", names),
        })),
      }
    },

    async post(agentId, place, text) {
      const row = await appOf(db, agentId)
      if (row === undefined) return false
      for (const piece of slackPieces(text)) {
        const to = { channel: place.channel, thread_ts: place.thread ?? undefined }
        const plain = toSlackMarkup(piece)
        // The words as markdown, which Slack draws as the agent wrote them, with the same in
        // its own markup beside it for a notification, and for a workspace that cannot draw it.
        let answer = await slack(deps, row.bot_token, "chat.postMessage", {
          ...to,
          text: plain,
          blocks: JSON.stringify([{ type: "markdown", text: piece }]),
        })
        if (!answer.ok && typeof answer.error === "string" && answer.error.startsWith("invalid_")) {
          if (GONE.has(answer.error)) return false
          answer = await slack(deps, row.bot_token, "chat.postMessage", { ...to, text: plain })
        }
        if (answer.ok) continue
        if (GONE.has(answer.error ?? "")) return false
        throw new Error(`Slack would not post the message: ${answer.error ?? "no reason given"}`)
      }
      return true
    },

    async working(agentId, place) {
      const row = await appOf(db, agentId)
      if (row === undefined) return
      const status = await slack(deps, row.bot_token, "assistant.threads.setStatus", {
        channel_id: place.channel,
        thread_ts: place.thread ?? place.ts,
        status: "is thinking…",
      })
      if (status.ok) return
      // Where Slack will not show an app as thinking, the message is marked as seen instead.
      await slack(deps, row.bot_token, "reactions.add", {
        channel: place.channel,
        timestamp: place.ts,
        name: "eyes",
      })
    },
  }
}
