import { createHmac } from "node:crypto"
import { createServer, type IncomingMessage } from "node:http"

export const BOT_TOKEN = "xoxb-e2e-token"
export const SIGNING_SECRET = "e2e-signing-secret"
export const BOT_USER = "UBOT"

type Call = { method: string; args: Record<string, string> }

/**
 * Slack's Web API for the browser tests, at the address the server under test was told to find
 * Slack at: one workspace, two people and a bot. `people` says who each of them is; someone
 * whose address is an account's here is one of the agent's people.
 */
export async function startFakeSlack(
  address: string,
  people: Record<string, { name: string; email: string }>,
) {
  const calls: Call[] = []
  const server = createServer((request, response) => {
    void (async () => {
      const method = (request.url ?? "").split("/").at(-1)!
      const args = Object.fromEntries(new URLSearchParams(await read(request)))
      calls.push({ method, args })
      const answer = (value: object) => {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify(value))
      }
      if (request.headers.authorization !== `Bearer ${BOT_TOKEN}`) {
        return answer({ ok: false, error: "invalid_auth" })
      }
      switch (method) {
        case "auth.test":
          return answer({
            ok: true,
            url: "https://tidewater.slack.com/",
            team: "Tidewater",
            team_id: "T1",
            user: "juniper",
            user_id: BOT_USER,
          })
        case "users.info": {
          const person = people[args.user ?? ""]
          return person === undefined
            ? answer({ ok: false, error: "user_not_found" })
            : answer({
                ok: true,
                user: { profile: { real_name: person.name, email: person.email } },
              })
        }
        case "conversations.info":
          return answer({ ok: true, channel: { name: "launch" } })
        case "chat.getPermalink":
          return answer({
            ok: true,
            permalink: `https://tidewater.slack.com/archives/${args.channel}/p${args.message_ts}`,
          })
        default:
          return answer({ ok: true })
      }
    })()
  })
  const { hostname, port } = new URL(address)
  await new Promise<void>((resolve) => server.listen(Number(port), hostname, resolve))
  return {
    calls,
    /** What the bot has posted, in order: where, and its words. */
    posts: () =>
      calls
        .filter((call) => call.method === "chat.postMessage")
        .map((call) => ({ thread: call.args.thread_ts, text: call.args.text ?? "" })),
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

async function read(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString("utf8")
}

let events = 0

/**
 * Something said to the bot in a channel, as Slack would send it: signed with the app's secret.
 * Without `thread` it starts a thread; with one, it is said in that thread.
 */
export function mention(
  user: string,
  text: string,
  thread?: string,
  secret = SIGNING_SECRET,
): { body: string; headers: Record<string, string>; ts: string } {
  events += 1
  const ts = `17000000${String(events).padStart(2, "0")}.000100`
  const body = JSON.stringify({
    type: "event_callback",
    team_id: "T1",
    event_id: `Ev${events}`,
    event: {
      type: "app_mention",
      user,
      text: `<@${BOT_USER}> ${text}`,
      ts,
      channel: "C1",
      ...(thread === undefined ? {} : { thread_ts: thread }),
    },
  })
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")
  return {
    body,
    headers: {
      "content-type": "application/json",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": `v0=${signature}`,
    },
    ts,
  }
}
