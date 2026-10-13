import {
  cardBrand,
  cardDigits,
  isCardNumber,
  MAX_CARD_HOLDER_CHARS,
  MAX_LOGIN_NAME_CHARS,
  MAX_POSTAL_CODE_CHARS,
  MAX_SAVED_CARDS,
  type PayWith,
  type SavedCard,
  type SavedCardsState,
  type SaveCardRequest,
} from "@do-computer/protocol"
import type { ActorHost, ActorStub } from "@do-computer/runtime"
import { type Caller, readCaller } from "./caller.ts"
import { ask, type Sealer, VaultRefusal } from "./vault.ts"

/**
 * The cards a workspace keeps for its agents to pay with, beside its logins and kept the same
 * way: a card's number is sealed before it is written, and opened only when an agent of the
 * workspace is about to pay with it. Its security code is never kept. Whoever says a card may
 * be used types the code then, and it goes to the computer that pays and nowhere else.
 */

type Row = {
  id: string
  name: string
  holder: string
  brand: string | null
  last4: string
  exp_month: number
  exp_year: number
  postal: string
  sealed: string
  key_id: string
  by_id: string | null
  by_name: string | null
  at: number
  used_at: number | null
  used_by: string | null
}

const COLUMNS =
  "id, name, holder, brand, last4, exp_month, exp_year, postal, sealed, key_id, by_id, by_name, at, used_at, used_by"

const json = (value: unknown, status = 200) => Response.json(value, { status })

/** One line of at most `limit` characters, or empty where nothing was given. */
function optional(value: unknown, limit: number, what: string): string {
  if (value === undefined || value === null) return ""
  if (typeof value !== "string" || value.length > limit || /[\r\n\0]/.test(value)) {
    throw new VaultRefusal(400, `${what} is one line of at most ${limit} characters.`)
  }
  return value.trim().replace(/\s+/g, " ")
}

/** A whole number from `least` to `most`, or a refusal saying what was wanted. */
function whole(value: unknown, least: number, most: number, what: string): number {
  const number = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value
  if (typeof number !== "number" || !Number.isInteger(number) || number < least || number > most) {
    throw new VaultRefusal(400, what)
  }
  return number
}

/** The part of a workspace's vault that keeps its cards. Answers what is asked under `cards`. */
export function createCardVault(
  host: ActorHost,
  sealer: () => Promise<Sealer>,
  keyId: () => Promise<string | undefined>,
) {
  let ready: Promise<void> | undefined
  const prepare = () =>
    (ready ??= host.sql.exec(
      `CREATE TABLE IF NOT EXISTS dc_saved_cards (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, holder TEXT NOT NULL, brand TEXT,
        last4 TEXT NOT NULL, exp_month INTEGER NOT NULL, exp_year INTEGER NOT NULL,
        postal TEXT NOT NULL, sealed TEXT NOT NULL, key_id TEXT NOT NULL, by_id TEXT,
        by_name TEXT, at INTEGER NOT NULL, used_at INTEGER, used_by TEXT
      ) STRICT`,
    ))

  const rows = async (): Promise<Row[]> => {
    await prepare()
    return host.sql.all<Row>(`SELECT ${COLUMNS} FROM dc_saved_cards ORDER BY at`)
  }

  const find = async (id: string): Promise<Row> => {
    await prepare()
    const row = await host.sql.get<Row>(`SELECT ${COLUMNS} FROM dc_saved_cards WHERE id = ?`, id)
    if (row === undefined) throw new VaultRefusal(404, "There is no such saved card.", "gone")
    return row
  }

  const shown = (row: Row, key: string | undefined): SavedCard => ({
    id: row.id,
    name: row.name,
    holder: row.holder,
    brand: row.brand,
    last4: row.last4,
    expMonth: row.exp_month,
    expYear: row.exp_year,
    postalCode: row.postal,
    addedBy: row.by_id === null ? null : { id: row.by_id, name: row.by_name ?? "" },
    addedAt: row.at,
    usedAt: row.used_at,
    usedBy: row.used_by,
    ...(key !== undefined && row.key_id !== key ? { unreadable: true as const } : {}),
  })

  const save = async (input: SaveCardRequest, by: Caller | undefined): Promise<SavedCard> => {
    const digits = cardDigits(typeof input.number === "string" ? input.number : "")
    if (!isCardNumber(digits)) {
      throw new VaultRefusal(400, "That is not a card number: check it against the card.")
    }
    const expMonth = whole(input.expMonth, 1, 12, "Give the month the card runs out, 1 to 12.")
    const said = whole(input.expYear, 0, 2100, "Give the year the card runs out.")
    // A year of two digits is this century's.
    const expYear = said < 100 ? 2000 + said : said
    const now = new Date(host.now())
    const months = (expYear - now.getUTCFullYear()) * 12 + (expMonth - 1 - now.getUTCMonth())
    if (months < 0) throw new VaultRefusal(400, "That card has run out.")
    if (months > 30 * 12) throw new VaultRefusal(400, "Give the year the card runs out.")
    const holder = optional(input.holder, MAX_CARD_HOLDER_CHARS, "The name on the card")
    const postal = optional(input.postalCode, MAX_POSTAL_CODE_CHARS, "The postal code")
    const brand = cardBrand(digits)
    const last4 = digits.slice(-4)
    const name =
      optional(input.name, MAX_LOGIN_NAME_CHARS, "Its name") || `${brand ?? "Card"} ending ${last4}`
    const all = await rows()
    if (all.length >= MAX_SAVED_CARDS) {
      throw new VaultRefusal(
        409,
        `A workspace keeps at most ${MAX_SAVED_CARDS} cards. Remove one first.`,
      )
    }
    const key = await sealer()
    const id = `c${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`
    const row: Row = {
      id,
      name,
      holder,
      brand,
      last4,
      exp_month: expMonth,
      exp_year: expYear,
      postal,
      sealed: await key.seal(id, digits),
      key_id: key.id,
      by_id: by?.id ?? null,
      by_name: by?.name ?? null,
      at: host.now(),
      used_at: null,
      used_by: null,
    }
    await host.sql.run(
      `INSERT INTO dc_saved_cards (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id,
      row.name,
      row.holder,
      row.brand,
      row.last4,
      row.exp_month,
      row.exp_year,
      row.postal,
      row.sealed,
      row.key_id,
      row.by_id,
      row.by_name,
      row.at,
      row.used_at,
      row.used_by,
    )
    return shown(row, key.id)
  }

  /** A card as an agent pays with it, opened for this one use, which is written down. No code: it is not kept. */
  const use = async (id: string, agent: string): Promise<Omit<PayWith, "code">> => {
    const row = await find(id)
    const key = await sealer()
    const number = row.key_id === key.id ? await key.open(id, row.sealed) : undefined
    if (number === undefined) {
      throw new VaultRefusal(
        409,
        `The number kept for "${row.name}" can no longer be read: the deployment's key was changed after it was saved. Someone has to remove the card and add it again, under Passwords in the workspace's settings.`,
        "unreadable",
      )
    }
    await host.sql.run(
      "UPDATE dc_saved_cards SET used_at = ?, used_by = ? WHERE id = ?",
      host.now(),
      agent.slice(0, 80),
      id,
    )
    return {
      name: row.name,
      holder: row.holder,
      number,
      expMonth: row.exp_month,
      expYear: row.exp_year,
      postalCode: row.postal,
    }
  }

  /** Answers a request under `cards`: `id` and `action` are what follows it in the path. */
  const route = async (
    request: Request,
    id: string | undefined,
    action: string | undefined,
  ): Promise<Response> => {
    const method = request.method
    const body = async () =>
      ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
    if (id === undefined) {
      if (method === "GET") {
        const key = await keyId()
        const state: SavedCardsState = { cards: (await rows()).map((row) => shown(row, key)) }
        return json(state)
      }
      if (method === "POST") {
        const card = await save((await body()) as unknown as SaveCardRequest, readCaller(request))
        return json({ card }, 201)
      }
    } else if (action === undefined && method === "DELETE") {
      await find(id)
      await host.sql.run("DELETE FROM dc_saved_cards WHERE id = ?", id)
      return json({ ok: true })
    } else if (action === "use" && method === "POST") {
      // Only ever asked by an agent of the workspace, through its host. The gateway has no
      // route here.
      const agent = (await body()).agent
      return json({ card: await use(id, typeof agent === "string" ? agent : "A Dood") })
    }
    return json({ error: "Not found" }, 404)
  }

  return { route }
}

/** What an agent asks of its workspace's vault about cards. */
export const cardVault = {
  list: async (actor: ActorStub): Promise<SavedCard[]> =>
    (await ask<SavedCardsState>(actor, "/cards")).cards,
  /** The card itself, number and all, for the one payment it is about to be used for. */
  use: async (actor: ActorStub, id: string, agent: string): Promise<Omit<PayWith, "code">> =>
    (
      await ask<{ card: Omit<PayWith, "code"> }>(actor, `/cards/${encodeURIComponent(id)}/use`, {
        method: "POST",
        body: JSON.stringify({ agent }),
      })
    ).card,
}
