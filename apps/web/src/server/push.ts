import type { AppDatabase } from "@durable-computer/runtime"
import { peopleOfAgent } from "./teams.ts"

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
 * Send a notification to every device a user registered, through Expo's push service. Tokens the
 * service reports as no longer registered are forgotten. Failures are swallowed: a notification
 * is a courtesy, and must never fail the work that triggered it.
 */
export async function sendPush(
  db: AppDatabase,
  userId: string,
  message: PushMessage,
  fetcher: typeof fetch = fetch,
): Promise<number> {
  try {
    const rows = await db.all<{ token: string }>(
      "SELECT token FROM dc_push_tokens WHERE user_id = ?",
      userId,
    )
    let delivered = 0
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
        title: agentName ?? "Your agent",
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

export async function unregisterPushToken(
  db: AppDatabase,
  userId: string,
  token: string,
): Promise<void> {
  await db.run("DELETE FROM dc_push_tokens WHERE token = ? AND user_id = ?", token, userId)
}
