import { getPlatform } from "#platform"
import type { AppDatabase } from "@durable-computer/runtime"
import type { SessionUser } from "./auth.ts"
import { sendEmail } from "./email.ts"
import { readMeta } from "./schema.ts"
import { isInvited } from "./teams.ts"

/**
 * The waiting list (`DC_SIGNUP=waitlist`). Anyone may make an account. Those who could have
 * made one by invitation use the app: whoever was here before there was a list, the first
 * account, the addresses the deployment names, and people asked into a team. Everyone else has
 * an account and nothing more until someone lets them in, or the deployment is opened.
 *
 * Being let in is what is written down, so that whatever goes wrong leaves someone waiting and
 * never lets them in.
 */

const SINCE_KEY = "waitlist_since"

type Known = { since?: number; in: Set<string> }
/** What has been found out about each database, for as long as this process has it. */
const known = new WeakMap<AppDatabase, Known>()
const knownOf = (db: AppDatabase): Known => {
  let found = known.get(db)
  if (found === undefined) known.set(db, (found = { in: new Set() }))
  return found
}

/** When this deployment first had a waiting list. Every account from before it is let in. */
async function waitlistSince(db: AppDatabase): Promise<number> {
  const state = knownOf(db)
  if (state.since !== undefined) return state.since
  let kept = await readMeta(db, SINCE_KEY)
  if (kept === undefined) {
    // Whichever request is first to say so is the one all of them go by.
    await db.run(
      "INSERT INTO dc_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING",
      SINCE_KEY,
      String(Date.now()),
    )
    kept = await readMeta(db, SINCE_KEY)
  }
  return (state.since = Number(kept))
}

/** When an account was made. One that does not say is taken as new. */
const madeAt = (user: SessionUser): number => {
  const at = new Date(user.createdAt ?? Number.NaN).getTime()
  return Number.isNaN(at) ? Number.POSITIVE_INFINITY : at
}

/**
 * Whether an address can be taken as its account's own. Where accounts are by invitation it
 * can. Where anyone can make one, whoever signed up with an address first would otherwise be
 * taken for its owner: there it has to be known to be theirs, as a social sign-in says, or
 * the account has to be from before anyone could.
 */
export function vouchedFor(user: SessionUser): boolean {
  const { config, db } = getPlatform()
  if (config.signup === "invite" || user.emailVerified === true) return true
  if (config.signup !== "waitlist") return false
  const since = knownOf(db).since
  return since !== undefined && madeAt(user) < since
}

async function letIn(db: AppDatabase, userId: string, by: string | null): Promise<void> {
  await db.run(
    "INSERT INTO dc_admitted (user_id, admitted_at, admitted_by) VALUES (?, ?, ?) ON CONFLICT (user_id) DO NOTHING",
    userId,
    Date.now(),
    by,
  )
}

/** Whether someone signed in is still on the waiting list, and so may not use the app. */
export async function isWaiting(user: SessionUser): Promise<boolean> {
  const { config, db } = getPlatform()
  if (config.signup !== "waitlist") return false
  const state = knownOf(db)
  if (state.in.has(user.id)) return false
  const since = await waitlistSince(db)
  const waiting = await stillWaiting(db, user, since)
  if (!waiting) state.in.add(user.id)
  return waiting
}

async function stillWaiting(db: AppDatabase, user: SessionUser, since: number): Promise<boolean> {
  const { config } = getPlatform()
  if (madeAt(user) < since) return false
  const email = user.email.toLowerCase()
  const named = config.adminEmails.includes(email) || config.allowedEmails.includes(email)
  if (named && vouchedFor(user)) return false
  const row = await db.get<{ user_id: string }>(
    "SELECT user_id FROM dc_admitted WHERE user_id = ?",
    user.id,
  )
  if (row !== undefined) return false
  // The first account of a deployment is its owner's.
  const first = await db.get<{ id: string }>("SELECT id FROM user ORDER BY createdAt, id LIMIT 1")
  const member = await db.get<{ user_id: string }>(
    "SELECT user_id FROM dc_members WHERE user_id = ? LIMIT 1",
    user.id,
  )
  if (first?.id === user.id || member !== undefined || (await isInvited(db, { email }))) {
    await letIn(db, user.id, null)
    return false
  }
  return true
}

/** Someone joined a team: whoever asked them in has let them in. */
export async function letInByInvitation(userId: string): Promise<void> {
  const { config, db } = getPlatform()
  if (config.signup !== "waitlist") return
  await letIn(db, userId, null)
}

export type WaitingPerson = {
  id: string
  name: string
  email: string
  /** When they made their account, in milliseconds. */
  joinedAt: number
  /** The Dood they hatched or claimed, if they have one. */
  dood: { id: string; name: string; color: string; seed: string } | null
}

type PersonRow = {
  id: string
  name: string
  email: string
  createdAt: string | number
  dood_id: string | null
  dood_name: string | null
  dood_color: string | null
  dood_seed: string | null
}

/** How many of the list one page of it shows. */
const PAGE = 200

/** Everyone waiting, longest first, and how many there are in all. */
export async function listWaiting(): Promise<{ people: WaitingPerson[]; total: number }> {
  const { config, db } = getPlatform()
  if (config.signup !== "waitlist") return { people: [], total: 0 }
  const since = await waitlistSince(db)
  // Accounts are kept with the time they were made as text or as a number, by the database.
  const from = [new Date(since).toISOString(), since]
  const named = [...new Set([...config.adminEmails, ...config.allowedEmails])]
  const where = `WHERE ((typeof(u.createdAt) = 'text' AND u.createdAt >= ?)
                 OR (typeof(u.createdAt) <> 'text' AND u.createdAt >= ?))
       AND NOT EXISTS (SELECT 1 FROM dc_admitted a WHERE a.user_id = u.id)
       AND NOT EXISTS (SELECT 1 FROM dc_members m WHERE m.user_id = u.id)
       ${named.length === 0 ? "" : `AND lower(u.email) NOT IN (${named.map(() => "?").join(", ")})`}`
  const rows = await db.all<PersonRow>(
    `SELECT u.id, u.name, u.email, u.createdAt,
            d.id AS dood_id, d.name AS dood_name, d.color AS dood_color, d.seed AS dood_seed
       FROM user u
       LEFT JOIN dc_doods d ON d.id = (
         SELECT id FROM dc_doods WHERE owner_id = u.id ORDER BY created_at LIMIT 1)
     ${where}
     ORDER BY u.createdAt, u.id LIMIT ${PAGE}`,
    ...from,
    ...named,
  )
  const count = await db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM user u ${where}`,
    ...from,
    ...named,
  )
  // The first account is the owner's and waits for nobody, though nothing says so until they
  // next come.
  const first = await db.get<{ id: string }>("SELECT id FROM user ORDER BY createdAt, id LIMIT 1")
  const people = rows
    .filter((row) => row.id !== first?.id)
    .map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      joinedAt: new Date(row.createdAt).getTime(),
      dood:
        row.dood_id === null
          ? null
          : { id: row.dood_id, name: row.dood_name!, color: row.dood_color!, seed: row.dood_seed! },
    }))
  return { people, total: Math.max(people.length, (count?.n ?? 0) - (rows.length - people.length)) }
}

/**
 * Let someone in off the list, and tell them where the deployment can send mail. Resolves false
 * when there is no such account.
 */
export async function admit(userId: string, by: SessionUser): Promise<boolean> {
  const { config, db } = getPlatform()
  const person = await db.get<{ email: string; name: string }>(
    "SELECT email, name FROM user WHERE id = ?",
    userId,
  )
  if (person === undefined) return false
  const before = await db.get<{ user_id: string }>(
    "SELECT user_id FROM dc_admitted WHERE user_id = ?",
    userId,
  )
  await letIn(db, userId, by.id)
  if (before === undefined && config.baseUrl !== undefined) {
    const dood = await db.get<{ name: string }>(
      "SELECT name FROM dc_doods WHERE owner_id = ? AND agent_id IS NULL ORDER BY created_at LIMIT 1",
      userId,
    )
    await sendEmail(config, {
      to: person.email,
      subject: dood === undefined ? "You're in: Do Computer" : `${dood.name} is ready for you`,
      text: `${dood === undefined ? "Your place on the waiting list has come up." : `Your place on the waiting list has come up, and ${dood.name} is waiting.`}\n\nSign in at ${config.baseUrl}\n`,
    })
  }
  return true
}
