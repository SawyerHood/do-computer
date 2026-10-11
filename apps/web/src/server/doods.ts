import { getPlatform } from "#platform"
import {
  type CreatureState,
  type Dood,
  DOOD_PATS_MAX,
  isDoodColor,
  isDoodSeed,
  keptFrom,
  type MadeDood,
  type Outfit,
  parseDoodName,
  personalWorkspaceId,
  TREATS_PER_BOX,
} from "@durable-computer/protocol"
import { callAgent, fail, json, makeAgent } from "./agents.ts"
import type { SessionUser } from "./auth.ts"
import { isDeploymentAdmin } from "./model-access.ts"
import { sha256 } from "./teams.ts"

/**
 * Doods: creatures hatched by people with no account, on a page anyone can open, and what
 * becomes of one when somebody claims it. Everything here but claiming is asked by strangers,
 * so nothing here reaches an agent except a treat for one whose owner made the Dood theirs.
 */

type Row = {
  id: string
  name: string
  color: string
  seed: string
  outfit: string
  key_hash: string
  owner_id: string | null
  agent_id: string | null
  pats: number
  treats: number
  joy: number
  banked: number
  created_at: number
}

/** How many Doods someone signed in may have that are not agents yet. */
const MAX_UNWOKEN = 5
const DAY_MS = 24 * 60 * 60_000

const rowOf = (id: string) => getPlatform().db.get<Row>("SELECT * FROM dc_doods WHERE id = ?", id)

function outfitOf(row: Row): Outfit {
  try {
    return JSON.parse(row.outfit) as Outfit
  } catch {
    return {}
  }
}

const shown = (row: Row): Dood => ({
  id: row.id,
  name: row.name,
  avatar: { color: row.color, seed: row.seed },
  outfit: outfitOf(row),
  pats: row.pats,
  treats: row.treats,
  claimed: row.owner_id !== null,
  ...(row.owner_id === null ? {} : { joy: row.joy }),
})

function randomId(bytes: number): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes))
  return [...raw].map((byte) => (byte % 36).toString(36)).join("")
}

/** A body of JSON no larger than a Dood's could be, or nothing. */
async function small(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text().catch(() => "")
  if (text.length > 2_000) return {}
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * Hatch one. Anyone may. Someone signed in has made it theirs by doing so; anyone else is given
 * a key, which is what says later that it was they who hatched it.
 */
export async function makeDood(request: Request, user: SessionUser | undefined): Promise<Response> {
  const { db } = getPlatform()
  const input = await small(request)
  const name = parseDoodName(input.name)
  if (name === undefined) return fail(400, "Give it a name of letters and numbers.", "bad_name")
  if (!isDoodColor(input.color) || !isDoodSeed(input.seed)) {
    return fail(400, "That is not how a Dood looks.")
  }
  const kept = input.item === undefined ? undefined : keptFrom(input.seed, input.item)
  if (input.item !== undefined && kept === undefined) {
    return fail(400, "That was not in its present.")
  }
  if (user !== undefined) {
    const mine = await db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM dc_doods WHERE owner_id = ? AND agent_id IS NULL",
      user.id,
    )
    if ((mine?.n ?? 0) >= MAX_UNWOKEN) {
      return fail(409, "You have a few Doods waiting already. Claim one of those.")
    }
  }
  const id = randomId(10)
  const key = randomId(24)
  const outfit: Outfit = kept === undefined ? {} : { [kept.slot]: kept.id }
  await db.run(
    `INSERT INTO dc_doods (id, name, color, seed, outfit, key_hash, owner_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    name,
    input.color,
    input.seed,
    JSON.stringify(outfit),
    await sha256(key),
    user?.id ?? null,
    Date.now(),
  )
  const row = await rowOf(id)
  return json({ dood: shown(row!), key } satisfies MadeDood, 201)
}

export async function getDood(id: string): Promise<Response> {
  const row = await rowOf(id)
  return row === undefined ? fail(404, "There is no such Dood.") : json({ dood: shown(row) })
}

/** The Dood a page is about, for the page's own title. Undefined where there is none. */
export async function doodNamed(id: string): Promise<Dood | undefined> {
  const row = await rowOf(id)
  return row === undefined ? undefined : shown(row)
}

/** It was stroked: so many times, by one person, since they last said. */
export async function patDood(id: string, request: Request): Promise<Response> {
  const { db } = getPlatform()
  const { pats } = await small(request)
  const count =
    typeof pats === "number" && Number.isInteger(pats) ? Math.min(DOOD_PATS_MAX, pats) : 0
  if (count > 0) await db.run("UPDATE dc_doods SET pats = pats + ? WHERE id = ?", count, id)
  return getDood(id)
}

/** Where a request is from, as far as that is known, in a form that says nothing of where. */
async function giverOf(request: Request): Promise<string> {
  const { config } = getPlatform()
  const address =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  return (await sha256(`${config.authSecret ?? ""}:${address}`)).slice(0, 32)
}

/**
 * Someone gave it a treat. One a day from each place that asks. A Dood nobody has claimed only
 * counts it. One that is someone's eats it toward their next present: at once where it is
 * their agent, and kept for the day it becomes one where it is not yet.
 */
export async function treatDood(id: string, request: Request): Promise<Response> {
  const { db } = getPlatform()
  const row = await rowOf(id)
  if (row === undefined) return fail(404, "There is no such Dood.")
  const day = Math.floor(Date.now() / DAY_MS)
  const giver = await giverOf(request)
  const given = await db.get<{ day: number }>(
    "SELECT day FROM dc_dood_treats WHERE dood_id = ? AND giver = ? AND day = ?",
    id,
    giver,
    day,
  )
  if (given !== undefined) {
    return fail(409, "It has had its treat from you today. Come back tomorrow.", "treat_given")
  }
  await db.batch([
    {
      sql: "INSERT INTO dc_dood_treats (dood_id, giver, day) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
      params: [id, giver, day],
    },
    { sql: "DELETE FROM dc_dood_treats WHERE dood_id = ? AND day < ?", params: [id, day] },
    { sql: "UPDATE dc_doods SET treats = treats + 1 WHERE id = ?", params: [id] },
  ])
  if (row.agent_id !== null) {
    const creature = await gift(row.agent_id, { treats: 1 })
    if (creature !== undefined) {
      await db.run("UPDATE dc_doods SET joy = ? WHERE id = ?", creature.joy, id)
    }
  } else if (row.owner_id !== null) {
    await db.run(
      "UPDATE dc_doods SET banked = banked + 1, joy = (joy + 1) % ? WHERE id = ?",
      TREATS_PER_BOX,
      id,
    )
  }
  return getDood(id)
}

async function gift(
  agentId: string,
  given: { treats?: number; item?: string },
): Promise<CreatureState | undefined> {
  const response = await callAgent(agentId, "/gifts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(given),
  }).catch(() => undefined)
  return response?.ok ? ((await response.json()) as CreatureState) : undefined
}

/** Make it theirs: the key says it was they who hatched it. */
export async function claimDood(
  id: string,
  request: Request,
  user: SessionUser,
): Promise<Response> {
  const { db } = getPlatform()
  const row = await rowOf(id)
  if (row === undefined) return fail(404, "There is no such Dood.")
  if (row.owner_id !== null && row.owner_id !== user.id) {
    return fail(409, "Someone has claimed this Dood already.", "claimed")
  }
  if (row.owner_id === null) {
    const { key } = await small(request)
    if (typeof key !== "string" || (await sha256(key)) !== row.key_hash) {
      return fail(403, "Only whoever hatched it can claim it, from where they hatched it.")
    }
    // Only if nobody has in the meantime.
    await db.run("UPDATE dc_doods SET owner_id = ? WHERE id = ? AND owner_id IS NULL", user.id, id)
    const now = await rowOf(id)
    if (now?.owner_id !== user.id)
      return fail(409, "Someone has claimed this Dood already.", "claimed")
  }
  return getDood(id)
}

/** The Dood someone has that is not an agent yet: the first they made theirs. */
export async function waitingDood(userId: string): Promise<Dood | undefined> {
  const row = await getPlatform().db.get<Row>(
    "SELECT * FROM dc_doods WHERE owner_id = ? AND agent_id IS NULL ORDER BY created_at LIMIT 1",
    userId,
  )
  return row === undefined ? undefined : shown(row)
}

/**
 * Their Dood becomes their agent: named and looking as it does, wearing what it wore, and fed
 * what it was given while it waited. Asked again, it answers with the agent it became.
 */
export async function wakeDood(id: string, user: SessionUser): Promise<Response> {
  const { db } = getPlatform()
  const row = await rowOf(id)
  if (row === undefined || row.owner_id !== user.id) return fail(404, "There is no such Dood.")
  if (row.agent_id !== null) return json({ agentId: row.agent_id })
  const made = await makeAgent(user.id, personalWorkspaceId(user.id))
  if ("error" in made) return fail(made.status, made.error)
  const agentId = made.agent.id
  // Whichever request got here first is the one whose agent it is.
  await db.run("UPDATE dc_doods SET agent_id = ? WHERE id = ? AND agent_id IS NULL", agentId, id)
  const named = await callAgent(agentId, "/", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: row.name,
      avatar: { color: row.color, seed: row.seed },
      user: `Their name is ${user.name}.`,
      hatched: true,
    }),
  })
  if (!named.ok) return fail(502, "Your Dood could not be woken. Try again.")
  const worn = Object.values(outfitOf(row))[0]
  const creature = await gift(agentId, {
    treats: row.banked,
    ...(worn === undefined ? {} : { item: worn }),
  })
  await db.run("UPDATE dc_doods SET banked = 0, joy = ? WHERE id = ?", creature?.joy ?? row.joy, id)
  return json({ agentId }, 201)
}

/**
 * An agent that was a Dood changed how it is known: its page says the same from then on.
 * Nothing happens for an agent that never was one.
 */
export async function followAgent(
  agentId: string,
  now: { name?: string | null; avatar?: { color: string; seed?: string } | null; outfit?: Outfit },
): Promise<void> {
  const { db } = getPlatform()
  const row = await db.get<Row>("SELECT * FROM dc_doods WHERE agent_id = ?", agentId)
  if (row === undefined) return
  await db.run(
    "UPDATE dc_doods SET name = ?, color = ?, seed = ?, outfit = ? WHERE id = ?",
    parseDoodName(now.name) ?? row.name,
    now.avatar?.color ?? row.color,
    now.avatar?.seed ?? row.seed,
    now.outfit === undefined ? row.outfit : JSON.stringify(now.outfit),
    row.id,
  )
}

/** Take one down. For whoever runs the deployment, about a name that should not be on it. */
export async function removeDood(id: string, user: SessionUser): Promise<Response> {
  if (!isDeploymentAdmin(user)) return fail(404, "Not found")
  const { db } = getPlatform()
  await db.batch([
    { sql: "DELETE FROM dc_doods WHERE id = ?", params: [id] },
    { sql: "DELETE FROM dc_dood_treats WHERE dood_id = ?", params: [id] },
  ])
  return json({ ok: true })
}
