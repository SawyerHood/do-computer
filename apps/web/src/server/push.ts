import type { AppDatabase } from "@do-computer/runtime"
import { readMeta, writeMeta } from "./schema.ts"
import { peopleOfAgent } from "./teams.ts"
import {
  sendWebPush,
  vapidKeys,
  vapidSubject,
  type WebPushResult,
  type WebPushSubscription,
} from "./web-push.ts"

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
/** Expo accepts up to this many messages per request. */
const BATCH = 100
const MAX_BODY_CHARS = 180

export type PushMessage = {
  title: string
  body: string
  /** Where tapping the notification should lead. */
  data: { agentId: string; chatId: string | null }
}

type Ticket = { status: "ok" } | { status: "error"; details?: { error?: string } }

/** A registered device. A browser's row holds its subscription: the address is its token. */
type Row = { token: string; p256dh: string | null; auth: string | null }

const SUBJECT_META_KEY = "vapid_subject"

/** The page a notification is about, for a browser to open. */
const pageOf = ({ agentId, chatId }: PushMessage["data"]) =>
  chatId === null ? `/a/${agentId}` : `/a/${agentId}/c/${chatId}`

/** Send to browsers, each through its own push service, forgetting the ones that are gone. */
async function sendToBrowsers(
  db: AppDatabase,
  rows: readonly Row[],
  notice: { title: string; body: string; url: string },
  fetcher: typeof fetch,
): Promise<WebPushResult[]> {
  if (rows.length === 0) return []
  const vapid = {
    ...(await vapidKeys(db)),
    subject: (await readMeta(db, SUBJECT_META_KEY)) ?? vapidSubject(undefined),
  }
  const payload = JSON.stringify(notice)
  return Promise.all(
    rows.map(async (row) => {
      const result = await sendWebPush(
        { endpoint: row.token, p256dh: row.p256dh!, auth: row.auth! },
        payload,
        vapid,
        fetcher,
      )
      if (result === "gone") await db.run("DELETE FROM dc_push_tokens WHERE token = ?", row.token)
      return result
    }),
  )
}

export const isExpoPushToken = (token: unknown): token is string =>
  typeof token === "string" && /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token)

/** One line of plain text short enough for a notification. */
export function preview(text: string): string {
  const flat = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
  return flat.length > MAX_BODY_CHARS ? `${flat.slice(0, MAX_BODY_CHARS - 1).trimEnd()}…` : flat
}

/**
 * Send a notification to every device a user registered: phones with the app through Expo's push
 * service, browsers through their own. Devices a service reports as no longer registered are
 * forgotten. Failures are swallowed: a notification is a courtesy, and must never fail the work
 * that triggered it.
 */
export async function sendPush(
  db: AppDatabase,
  userId: string,
  message: PushMessage,
  fetcher: typeof fetch = fetch,
): Promise<number> {
  try {
    const all = await db.all<Row>(
      "SELECT token, p256dh, auth FROM dc_push_tokens WHERE user_id = ?",
      userId,
    )
    const browsers = all.filter((row) => row.p256dh !== null)
    const rows = all.filter((row) => row.p256dh === null)
    const notice = { title: message.title, body: message.body, url: pageOf(message.data) }
    const sent = await sendToBrowsers(db, browsers, notice, fetcher).catch(() => [])
    let delivered = sent.filter((result) => result === "sent").length
    for (let offset = 0; offset < rows.length; offset += BATCH) {
      const tokens = rows.slice(offset, offset + BATCH).map((row) => row.token)
      const response = await fetcher(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(
          tokens.map((to) => ({
            to,
            title: message.title,
            body: message.body,
            data: message.data,
            sound: "default",
          })),
        ),
      })
      if (!response.ok) continue
      const { data } = (await response.json()) as { data?: Ticket[] }
      for (const [index, ticket] of (data ?? []).entries()) {
        if (ticket.status === "ok") delivered++
        else if (ticket.details?.error === "DeviceNotRegistered") {
          await db.run("DELETE FROM dc_push_tokens WHERE token = ?", tokens[index]!)
        }
      }
    }
    return delivered
  } catch {
    return 0
  }
}

/**
 * Notify the people an agent works for. Where it knows who it is answering, only they hear of
 * it, as long as they can still reach the agent; otherwise its owner does, or everyone in its team.
 */
export async function notifyPeople(
  db: AppDatabase,
  agentId: string,
  agentName: string | null,
  message: { heading?: string; text: string; chatId: string | null; userId?: string },
  fetcher?: typeof fetch,
): Promise<void> {
  const people = await peopleOfAgent(db, agentId).catch((): string[] => [])
  const to =
    message.userId !== undefined && people.includes(message.userId) ? [message.userId] : people
  const body = preview(message.text)
  for (const userId of to) {
    await sendPush(
      db,
      userId,
      {
        title: agentName ?? "Your Dood",
        body: message.heading ? `${message.heading}: ${body}` : body,
        data: { agentId, chatId: message.chatId },
      },
      fetcher,
    )
  }
}

export async function registerPushToken(
  db: AppDatabase,
  userId: string,
  token: string,
  platform: string,
): Promise<void> {
  // A device that changes hands is re-registered to its new account.
  await db.run(
    `INSERT INTO dc_push_tokens (token, user_id, platform, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform`,
    token,
    userId,
    platform,
    Date.now(),
  )
}

/**
 * Keep a browser's subscription, for the account signed in to it now. `origin` is the app's
 * address as that browser knows it, which push services are told is who is sending.
 */
export async function registerBrowser(
  db: AppDatabase,
  userId: string,
  subscription: WebPushSubscription,
  origin: string,
): Promise<void> {
  await db.run(
    `INSERT INTO dc_push_tokens (token, user_id, platform, created_at, p256dh, auth)
     VALUES (?, ?, 'web', ?, ?, ?)
     ON CONFLICT (token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform,
       p256dh = excluded.p256dh, auth = excluded.auth`,
    subscription.endpoint,
    userId,
    Date.now(),
    subscription.p256dh,
    subscription.auth,
  )
  const subject = vapidSubject(origin)
  if ((await readMeta(db, SUBJECT_META_KEY)) !== subject) {
    await writeMeta(db, SUBJECT_META_KEY, subject)
  }
}

/** Send one browser of a user's a notification that says notifications work. */
export async function sendTestPush(
  db: AppDatabase,
  userId: string,
  endpoint: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const rows = await db.all<Row>(
    `SELECT token, p256dh, auth FROM dc_push_tokens
     WHERE token = ? AND user_id = ? AND p256dh IS NOT NULL`,
    endpoint,
    userId,
  )
  const notice = {
    title: "Do Computer",
    body: "Notifications are on. This is what one looks like.",
    url: "/",
  }
  const [result] = await sendToBrowsers(db, rows, notice, fetcher).catch(() => [])
  return result === "sent"
}

export async function unregisterPushToken(
  db: AppDatabase,
  userId: string,
  token: string,
): Promise<void> {
  await db.run("DELETE FROM dc_push_tokens WHERE token = ? AND user_id = ?", token, userId)
}
