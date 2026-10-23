import { getPlatform } from "#platform"
import {
  BOX_EVERY_MS,
  type CreatureOwn,
  type CreatureState,
  hasEverything,
  parseOutfit,
  rollItem,
  wearItem,
} from "@do-computer/protocol"
import type { AppDatabase } from "@do-computer/runtime"
import { callAgent, fail, json } from "./agents.ts"
import type { AgentAccess } from "./teams.ts"

/**
 * A workspace's wardrobe, which every one of its Doods wears from. A box turns up for them six
 * hours after their last was opened, one of the workspace's own waiting at most, and any of them
 * can open it; besides it wait the boxes that treats on Doods' own pages filled. What a box holds
 * is something the wardrobe does not have yet, and once it is in, every Dood there can wear it,
 * two at once if they like. Kept here and not by an agent, since it is no one agent's.
 */
export type Wardrobe = Pick<CreatureState, "boxes" | "shared" | "nextBoxAt" | "owned" | "foundBy">

type Row = { boxes: number; shared: number; next_box_at: number | null; version: number }
type ItemRow = { item_id: string; found_by: string | null }

/** How many times a box is tried again that another was opened beside. */
const TRIES = 8

const every = () => Math.max(1, getPlatform().config.boxEveryMs ?? BOX_EVERY_MS)

/** What an agent's creature keeps of its own, and what it had found before there was a wardrobe. */
type AgentCreature = CreatureOwn & { before?: { owned: string[]; shared: number } }

async function agentCreature(agentId: string): Promise<AgentCreature | undefined> {
  const response = await callAgent(agentId, "/creature").catch(() => undefined)
  return response?.ok ? ((await response.json()) as AgentCreature) : undefined
}

const readRow = (db: AppDatabase, workspaceId: string) =>
  db.get<Row>(
    "SELECT boxes, shared, next_box_at, version FROM dc_wardrobes WHERE workspace_id = ?",
    workspaceId,
  )

const readItems = (db: AppDatabase, workspaceId: string) =>
  db.all<ItemRow>(
    "SELECT item_id, found_by FROM dc_wardrobe_items WHERE workspace_id = ? ORDER BY found_at, rowid",
    workspaceId,
  )

/**
 * Make the workspace's wardrobe if it has none, with a box waiting, as a welcome. Into it goes
 * whatever its Doods had found each for itself before there were wardrobes, with the first of
 * them to have found a thing as who found it, and the boxes other people's treats had made them.
 */
async function ensure(db: AppDatabase, workspaceId: string, now: number): Promise<void> {
  if ((await readRow(db, workspaceId)) !== undefined) return
  const agents = await db.all<{ id: string }>(
    "SELECT id FROM dc_agents WHERE workspace_id = ? ORDER BY created_at",
    workspaceId,
  )
  const found = new Map<string, string>()
  let shared = 0
  for (const { id } of agents) {
    const before = (await agentCreature(id))?.before
    if (before === undefined) continue
    shared += before.shared
    for (const item of before.owned) {
      if (wearItem(item) !== undefined && !found.has(item)) found.set(item, id)
    }
  }
  // Two requests can get here at once: whichever is first makes it, and the other adds nothing.
  await db.batch([
    {
      sql: `INSERT OR IGNORE INTO dc_wardrobes (workspace_id, boxes, shared, next_box_at, version, created_at)
              VALUES (?, ?, ?, NULL, 0, ?)`,
      params: [workspaceId, 1 + shared, shared, now],
    },
    ...[...found].map(([item, agentId], order) => ({
      sql: `INSERT OR IGNORE INTO dc_wardrobe_items (workspace_id, item_id, found_by, found_at)
              VALUES (?, ?, ?, ?)`,
      params: [workspaceId, item, agentId, now + order],
    })),
  ])
}

/**
 * A box turns up six hours after the last was opened, and the workspace has one of its own
 * waiting at most: the wait for the next starts when that one is opened. Nothing wakes for a box:
 * one that has come due is counted when the wardrobe is next looked at. One that has no wait
 * going has it start then, and a wait longer than the whole of one is cut to it.
 */
async function boxDue(db: AppDatabase, workspaceId: string, now: number): Promise<void> {
  const row = await readRow(db, workspaceId)
  if (row === undefined) return
  const owned = (await readItems(db, workspaceId)).map((item) => item.item_id)
  // Once everything is found there is nothing for another box to hold.
  if (row.boxes > row.shared || hasEverything(owned)) return
  const long = row.next_box_at === null || row.next_box_at > now + every()
  if (!long && now < row.next_box_at!) return
  // Only if nothing changed since it was read; what did is looked at again the next time.
  await db.run(
    `UPDATE dc_wardrobes SET boxes = ?, next_box_at = ?, version = version + 1
      WHERE workspace_id = ? AND version = ?`,
    long ? row.boxes : row.boxes + 1,
    long ? now + every() : row.next_box_at,
    workspaceId,
    row.version,
  )
}

/** The workspace's wardrobe, made if it has none, with any box that has come due. */
export async function wardrobeOf(workspaceId: string): Promise<Wardrobe> {
  const { db } = getPlatform()
  const now = Date.now()
  await ensure(db, workspaceId, now)
  await boxDue(db, workspaceId, now)
  const row = (await readRow(db, workspaceId))!
  const items = await readItems(db, workspaceId)
  const shared = Math.min(row.shared, row.boxes)
  return {
    boxes: row.boxes,
    shared,
    // While a box of its own waits there is no next one to wait for.
    ...(row.boxes > shared || row.next_box_at === null ? {} : { nextBoxAt: row.next_box_at }),
    owned: items.map((item) => item.item_id),
    foundBy: Object.fromEntries(
      items.flatMap((item) => (item.found_by === null ? [] : [[item.item_id, item.found_by]])),
    ),
  }
}

/**
 * Open one of the workspace's boxes, from beside one of its Doods, which is who found what is in
 * it: something the wardrobe does not have yet, picked by chance. Its own box is opened before
 * any that treats made, and the wait for the next starts then. Undefined if there is none to
 * open. Two opened at once are each a thing of their own: one that finds the wardrobe changed
 * under it is drawn again.
 */
export async function openWardrobeBox(
  workspaceId: string,
  agentId: string,
  random: () => number = Math.random,
): Promise<string | undefined> {
  const { db } = getPlatform()
  const now = Date.now()
  await ensure(db, workspaceId, now)
  await boxDue(db, workspaceId, now)
  for (let attempt = 0; attempt < TRIES; attempt++) {
    const row = await readRow(db, workspaceId)
    if (row === undefined || row.boxes <= 0) return undefined
    const owned = (await readItems(db, workspaceId)).map((item) => item.item_id)
    const item = rollItem(owned, random)
    const unchanged = [workspaceId, row.version] as const
    if (item === undefined) {
      await db.run(
        "UPDATE dc_wardrobes SET boxes = 0, shared = 0, version = version + 1 WHERE workspace_id = ? AND version = ?",
        ...unchanged,
      )
      return undefined
    }
    const shared = Math.min(row.shared, row.boxes)
    const boxes = row.boxes - 1
    const nextShared = Math.min(shared, boxes)
    // The wait for the next starts as the workspace's own box is opened.
    const next = boxes === shared ? now + every() : row.next_box_at
    // Both, or neither if anything changed since it was read.
    const box = crypto.randomUUID()
    await db.batch([
      {
        sql: `INSERT OR IGNORE INTO dc_wardrobe_items (workspace_id, item_id, found_by, found_at, box)
                SELECT ?, ?, ?, ?, ? FROM dc_wardrobes WHERE workspace_id = ? AND version = ?`,
        params: [workspaceId, item.id, agentId, now, box, ...unchanged],
      },
      {
        sql: `UPDATE dc_wardrobes SET boxes = ?, shared = ?, next_box_at = ?, version = version + 1
                WHERE workspace_id = ? AND version = ?`,
        params: [boxes, nextShared, next, ...unchanged],
      },
    ])
    const put = await db.get<{ box: string | null }>(
      "SELECT box FROM dc_wardrobe_items WHERE workspace_id = ? AND item_id = ?",
      workspaceId,
      item.id,
    )
    if (put?.box === box) return item.id
  }
  throw new Error("The box could not be opened for others opening theirs. Try it again.")
}

/**
 * Tell every Dood of the workspace that its wardrobe changed, which tells whoever is watching
 * any of them to ask for its creature again: a box opened beside one is gone from beside the
 * rest, and what was in it is theirs too. A courtesy, so it never fails what caused it.
 */
export async function tellWardrobeChanged(workspaceId: string): Promise<void> {
  const agents = await getPlatform()
    .db.all<{ id: string }>("SELECT id FROM dc_agents WHERE workspace_id = ?", workspaceId)
    .catch((): { id: string }[] => [])
  await Promise.all(
    agents.map(({ id }) =>
      callAgent(id, "/creature/wardrobe", { method: "POST" }).catch(() => undefined),
    ),
  )
}

/** Put things in the workspace's wardrobe that came from somewhere other than a box. */
export async function addToWardrobe(
  workspaceId: string,
  items: readonly string[],
  foundBy: string,
): Promise<void> {
  const known = items.filter((item) => wearItem(item) !== undefined)
  if (known.length === 0) return
  const { db } = getPlatform()
  const now = Date.now()
  await ensure(db, workspaceId, now)
  await db.batch([
    ...known.map((item) => ({
      sql: `INSERT OR IGNORE INTO dc_wardrobe_items (workspace_id, item_id, found_by, found_at)
              VALUES (?, ?, ?, ?)`,
      params: [workspaceId, item, foundBy, now],
    })),
    {
      sql: "UPDATE dc_wardrobes SET version = version + 1 WHERE workspace_id = ?",
      params: [workspaceId],
    },
  ])
  await tellWardrobeChanged(workspaceId)
}

/** Boxes that treats on a Dood's own page filled, for its workspace. */
export async function addSharedBoxes(workspaceId: string, count: number): Promise<void> {
  if (count <= 0) return
  const { db } = getPlatform()
  await ensure(db, workspaceId, Date.now())
  await db.run(
    `UPDATE dc_wardrobes SET boxes = boxes + ?, shared = shared + ?, version = version + 1
      WHERE workspace_id = ?`,
    count,
    count,
    workspaceId,
  )
  await tellWardrobeChanged(workspaceId)
}

/** Whether the workspace's wardrobe has everything there is, which is when treats fill no box. */
export async function wardrobeIsFull(workspaceId: string): Promise<boolean> {
  return hasEverything((await wardrobeOf(workspaceId)).owned)
}

/** An agent's creature, with its workspace's wardrobe. */
async function creatureOf(access: AgentAccess): Promise<CreatureState | undefined> {
  const own = await agentCreature(access.id)
  if (own === undefined) return undefined
  return {
    fed: own.fed,
    joy: own.joy,
    outfit: own.outfit,
    ...(await wardrobeOf(access.workspaceId)),
  }
}

const answer = async (access: AgentAccess) => {
  const creature = await creatureOf(access)
  return creature === undefined ? fail(502, "The Dood could not be reached.") : json(creature)
}

/**
 * `/api/agents/:id/creature…`: its creature, which the agent keeps what is its own of, and its
 * workspace's wardrobe, which is kept here. The agent's own routes for it are the gateway's.
 */
export async function creatureRoute(
  access: AgentAccess,
  route: readonly string[],
  method: string,
  body: ArrayBuffer | undefined,
): Promise<Response> {
  const [, what] = route
  if (route.length > 2) return fail(404, "Not found")
  if (what === undefined && method === "GET") return answer(access)
  if (what === "feed" && method === "POST") {
    const response = await callAgent(access.id, "/creature/feed", { method: "POST" })
    if (!response.ok) return response
    return answer(access)
  }
  if (what === "open" && method === "POST") {
    const item = await openWardrobeBox(access.workspaceId, access.id)
    if (item === undefined) return fail(409, "There is no box to open", "no_box")
    await tellWardrobeChanged(access.workspaceId)
    const creature = await creatureOf(access)
    if (creature === undefined) return fail(502, "The Dood could not be reached.")
    return json({ item, creature })
  }
  if (what === "outfit" && method === "PUT") {
    let input: { outfit?: unknown }
    try {
      input = JSON.parse(new TextDecoder().decode(body ?? new ArrayBuffer(0)))
    } catch {
      return fail(400, "That is not an outfit.")
    }
    const parsed = parseOutfit(input?.outfit, (await wardrobeOf(access.workspaceId)).owned)
    if ("error" in parsed) return fail(400, parsed.error)
    const response = await callAgent(access.id, "/creature/outfit", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outfit: parsed.outfit }),
    })
    if (!response.ok) return response
    return answer(access)
  }
  return fail(404, "Not found")
}
