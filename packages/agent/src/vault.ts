import {
  type ChangeLoginRequest,
  MAX_LOGIN_NAME_CHARS,
  MAX_LOGIN_SITES,
  MAX_PASSWORD_CHARS,
  MAX_SAVED_LOGINS,
  MAX_USERNAME_CHARS,
  type SavedLogin,
  type SavedLoginsState,
  type SaveLoginRequest,
  type SignInWith,
  siteHost,
} from "@do-computer/protocol"
import type { ActorHost, ActorStub } from "@do-computer/runtime"
import { type Caller, CALLER_HEADER, encodeCaller, readCaller } from "./caller.ts"

/**
 * The logins a workspace keeps for its agents to sign in with, in the database of the actor
 * that keeps its sign-ins to model providers. A password is sealed before it is written, with a
 * key made for this workspace from a secret of the deployment's, and opened in one place only:
 * when an agent of the workspace is about to sign in with it. Nothing else reads it back, and
 * no route a person can reach hands it out.
 *
 * Sealing keeps a password from whoever comes by the database alone: a copy of it, a backup, a
 * query run against it. It does not keep it from whoever runs the server, who has the key too.
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder()
/** Never changed: it is part of what the key is made from. */
const SALT = encoder.encode("do-computer saved logins v1")
/** A sealed password is padded to a multiple of this, so that its length says little. */
const PAD_BYTES = 64

const json = (value: unknown, status = 200) => Response.json(value, { status })

/** Something asked of the vault that cannot be done, with the reason, as opposed to a bug. */
export class VaultRefusal extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message)
  }
}

const hex = (bytes: Uint8Array) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")

function toBase64(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/**
 * Seals and opens what one workspace keeps. The key is derived from the deployment's secret
 * and the workspace's name, so one workspace's rows open in no other; `id` names the key
 * without giving anything of it away, and is kept with each row to tell one sealed with a key
 * the deployment no longer has from one that was tampered with.
 */
export class Sealer {
  readonly id: string
  readonly #key: CryptoKey
  readonly #scope: string

  private constructor(key: CryptoKey, id: string, scope: string) {
    this.#key = key
    this.id = id
    this.#scope = scope
  }

  static async for(secret: string, scope: string): Promise<Sealer> {
    const material = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, [
      "deriveKey",
      "deriveBits",
    ])
    const derive = (info: string) => ({
      name: "HKDF",
      hash: "SHA-256",
      salt: SALT,
      info: encoder.encode(info),
    })
    const key = await crypto.subtle.deriveKey(
      derive(`key\n${scope}`),
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    )
    const id = hex(
      new Uint8Array(await crypto.subtle.deriveBits(derive(`id\n${scope}`), material, 64)),
    )
    return new Sealer(key, id, scope)
  }

  /** Seal `text` as what is kept under `label`. It opens under that label alone. */
  async seal(label: string, text: string): Promise<string> {
    const value = encoder.encode(text)
    const padded = new Uint8Array(Math.ceil((value.length + 2) / PAD_BYTES) * PAD_BYTES)
    new DataView(padded.buffer).setUint16(0, value.length)
    padded.set(value, 2)
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const sealed = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: encoder.encode(`${this.#scope}\n${label}`) },
        this.#key,
        padded,
      ),
    )
    const out = new Uint8Array(iv.length + sealed.length)
    out.set(iv)
    out.set(sealed, iv.length)
    return toBase64(out)
  }

  /** What was sealed under `label`, or undefined where it does not open: wrong key, or changed. */
  async open(label: string, sealed: string): Promise<string | undefined> {
    try {
      const bytes = fromBase64(sealed)
      const padded = new Uint8Array(
        await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: bytes.subarray(0, 12),
            additionalData: encoder.encode(`${this.#scope}\n${label}`),
          },
          this.#key,
          bytes.subarray(12),
        ),
      )
      const length = new DataView(padded.buffer).getUint16(0)
      if (length > padded.length - 2) return undefined
      return decoder.decode(padded.subarray(2, 2 + length))
    } catch {
      return undefined
    }
  }
}

type Row = {
  id: string
  name: string
  username: string
  sites: string
  sealed: string
  key_id: string
  by_id: string | null
  by_name: string | null
  at: number
  changed_at: number
  used_at: number | null
  used_by: string | null
}

const COLUMNS =
  "id, name, username, sites, sealed, key_id, by_id, by_name, at, changed_at, used_at, used_by"

export type VaultOptions = {
  /** The deployment's secret that passwords are sealed with. Absent: none can be kept. */
  readonly key?: string | undefined
}

/** One line of text of at most `limit` characters, or undefined for anything else. */
function line(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined
  const text = value.trim()
  if (text === "" || text.length > limit || /[\r\n\0]/.test(text)) return undefined
  return text
}

function nameOf(value: unknown): string {
  const name = line(value, MAX_LOGIN_NAME_CHARS)
  if (name === undefined) {
    throw new VaultRefusal(400, `Give it a name of at most ${MAX_LOGIN_NAME_CHARS} characters.`)
  }
  return name.replace(/\s+/g, " ")
}

function usernameOf(value: unknown): string {
  const username = line(value, MAX_USERNAME_CHARS)
  if (username === undefined)
    throw new VaultRefusal(400, "Give the username or email it signs in as.")
  return username
}

/** A password is kept exactly as it was typed: spaces at either end are part of it. */
function passwordOf(value: unknown): string {
  if (
    typeof value !== "string" ||
    value === "" ||
    value.length > MAX_PASSWORD_CHARS ||
    /[\r\n\0]/.test(value)
  ) {
    throw new VaultRefusal(
      400,
      `Give a password of one line and at most ${MAX_PASSWORD_CHARS} characters.`,
    )
  }
  return value
}

function sitesOf(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new VaultRefusal(400, "Say which site it is for, such as github.com.")
  }
  const sites: string[] = []
  for (const entry of value) {
    const site = typeof entry === "string" ? siteHost(entry) : null
    if (site === null) {
      throw new VaultRefusal(
        400,
        `"${String(entry).slice(0, 80)}" is not a site. Give its name, such as github.com.`,
      )
    }
    if (!sites.includes(site)) sites.push(site)
  }
  if (sites.length > MAX_LOGIN_SITES) {
    throw new VaultRefusal(400, `A login can be for at most ${MAX_LOGIN_SITES} sites.`)
  }
  return sites
}

/**
 * The part of the workspace's actor that keeps its saved logins. `route` answers what is asked
 * under `passwords`, and resolves with undefined for anything that is not the vault's.
 */
export function createVault(host: ActorHost, options: VaultOptions = {}) {
  let ready: Promise<void> | undefined
  let sealing: Promise<Sealer> | undefined

  const prepare = () =>
    (ready ??= host.sql.exec(
      `CREATE TABLE IF NOT EXISTS dc_saved_logins (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL, sites TEXT NOT NULL,
        sealed TEXT NOT NULL, key_id TEXT NOT NULL, by_id TEXT, by_name TEXT,
        at INTEGER NOT NULL, changed_at INTEGER NOT NULL, used_at INTEGER, used_by TEXT
      ) STRICT`,
    ))

  const sealer = (): Promise<Sealer> => {
    const { key } = options
    if (key === undefined || key === "") {
      throw new VaultRefusal(
        503,
        "This deployment has nothing to keep passwords safe with. Whoever runs it has to set DC_SECRETS_KEY or DC_AUTH_SECRET.",
        "no_key",
      )
    }
    return (sealing ??= Sealer.for(key, host.name))
  }

  const rows = async (): Promise<Row[]> => {
    await prepare()
    return host.sql.all<Row>(
      `SELECT ${COLUMNS} FROM dc_saved_logins ORDER BY name COLLATE NOCASE, at`,
    )
  }

  const find = async (id: string): Promise<Row> => {
    await prepare()
    const row = await host.sql.get<Row>(`SELECT ${COLUMNS} FROM dc_saved_logins WHERE id = ?`, id)
    if (row === undefined) throw new VaultRefusal(404, "There is no such saved login.", "gone")
    return row
  }

  const shown = (row: Row, keyId: string | undefined): SavedLogin => ({
    id: row.id,
    name: row.name,
    username: row.username,
    sites: JSON.parse(row.sites) as string[],
    addedBy: row.by_id === null ? null : { id: row.by_id, name: row.by_name ?? "" },
    addedAt: row.at,
    changedAt: row.changed_at,
    usedAt: row.used_at,
    usedBy: row.used_by,
    ...(keyId !== undefined && row.key_id !== keyId ? { unreadable: true as const } : {}),
  })

  /** The key's name, where there is a key: without one nothing can be read, and nothing says so. */
  const keyId = async (): Promise<string | undefined> =>
    options.key === undefined || options.key === "" ? undefined : (await sealer()).id

  /** A name no other login has: the one asked for, or that with a number after it. */
  const unused = (wanted: string, taken: readonly Row[], except?: string): string => {
    const names = new Set(
      taken.filter((row) => row.id !== except).map((row) => row.name.toLowerCase()),
    )
    if (!names.has(wanted.toLowerCase())) return wanted
    for (let n = 2; ; n++) {
      const suffix = ` (${n})`
      const name = `${wanted.slice(0, MAX_LOGIN_NAME_CHARS - suffix.length)}${suffix}`
      if (!names.has(name.toLowerCase())) return name
    }
  }

  const save = async (input: SaveLoginRequest, by: Caller | undefined): Promise<SavedLogin> => {
    const username = usernameOf(input.username)
    const password = passwordOf(input.password)
    const sites = sitesOf(input.sites)
    const all = await rows()
    if (all.length >= MAX_SAVED_LOGINS) {
      throw new VaultRefusal(
        409,
        `A workspace keeps at most ${MAX_SAVED_LOGINS} logins. Remove one first.`,
      )
    }
    const key = await sealer()
    const id = `l${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`
    const now = host.now()
    const row: Row = {
      id,
      name: unused(nameOf(input.name), all),
      username,
      sites: JSON.stringify(sites),
      sealed: await key.seal(id, password),
      key_id: key.id,
      by_id: by?.id ?? null,
      by_name: by?.name ?? null,
      at: now,
      changed_at: now,
      used_at: null,
      used_by: null,
    }
    await host.sql.run(
      `INSERT INTO dc_saved_logins (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id,
      row.name,
      row.username,
      row.sites,
      row.sealed,
      row.key_id,
      row.by_id,
      row.by_name,
      row.at,
      row.changed_at,
      row.used_at,
      row.used_by,
    )
    return shown(row, key.id)
  }

  const change = async (id: string, input: ChangeLoginRequest): Promise<SavedLogin> => {
    const row = await find(id)
    const key = await sealer()
    if (input.name !== undefined) row.name = unused(nameOf(input.name), await rows(), id)
    if (input.username !== undefined) row.username = usernameOf(input.username)
    if (input.sites !== undefined) row.sites = JSON.stringify(sitesOf(input.sites))
    if (input.password !== undefined) {
      row.sealed = await key.seal(id, passwordOf(input.password))
      row.key_id = key.id
      row.changed_at = host.now()
    }
    await host.sql.run(
      `UPDATE dc_saved_logins SET name = ?, username = ?, sites = ?, sealed = ?, key_id = ?,
       changed_at = ? WHERE id = ?`,
      row.name,
      row.username,
      row.sites,
      row.sealed,
      row.key_id,
      row.changed_at,
      id,
    )
    return shown(row, key.id)
  }

  /** What an agent signs in with, opened for this one use, which is written down. */
  const use = async (id: string, agent: string): Promise<SignInWith> => {
    const row = await find(id)
    const key = await sealer()
    const password = row.key_id === key.id ? await key.open(id, row.sealed) : undefined
    if (password === undefined) {
      throw new VaultRefusal(
        409,
        `The password kept for "${row.name}" can no longer be read: the deployment's key was changed after it was saved. Someone has to give it again, under Passwords in the workspace's settings.`,
        "unreadable",
      )
    }
    await host.sql.run(
      "UPDATE dc_saved_logins SET used_at = ?, used_by = ? WHERE id = ?",
      host.now(),
      agent.slice(0, 80),
      id,
    )
    return {
      name: row.name,
      username: row.username,
      password,
      sites: JSON.parse(row.sites) as string[],
    }
  }

  const route = async (
    request: Request,
    segments: readonly string[],
  ): Promise<Response | undefined> => {
    const [what, id, action] = segments
    if (what !== "passwords") return undefined
    const method = request.method
    const body = async () =>
      ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
    try {
      if (id === undefined) {
        if (method === "GET") {
          const key = await keyId()
          const state: SavedLoginsState = { logins: (await rows()).map((row) => shown(row, key)) }
          return json(state)
        }
        if (method === "POST") {
          const login = await save((await body()) as SaveLoginRequest, readCaller(request))
          return json({ login }, 201)
        }
      } else if (action === undefined) {
        if (method === "PATCH") return json({ login: await change(id, await body()) })
        if (method === "DELETE") {
          await find(id)
          await host.sql.run("DELETE FROM dc_saved_logins WHERE id = ?", id)
          return json({ ok: true })
        }
      } else if (action === "use" && method === "POST") {
        // Only ever asked by an agent of the workspace, through its host. The gateway has no
        // route here.
        const agent = (await body()).agent
        return json({ login: await use(id, typeof agent === "string" ? agent : "A Dood") })
      }
    } catch (error) {
      if (error instanceof VaultRefusal) {
        return json({ error: error.message, code: error.code }, error.status)
      }
      throw error
    }
    return json({ error: "Not found" }, 404)
  }

  return { route }
}

/** The actor that keeps an agent's workspace's logins, or undefined where it has none to use. */
export type VaultAccess = () => Promise<ActorStub | undefined>

/** Asked of a workspace's vault and answered with an error: what it said, to be told on. */
export class VaultError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message)
  }
}

async function ask<T>(
  actor: ActorStub,
  path: string,
  init?: RequestInit & { by?: Caller },
): Promise<T> {
  const { by, ...rest } = init ?? {}
  const response = await actor.fetch(
    new Request(`http://vault/passwords${path}`, {
      ...rest,
      headers: {
        "content-type": "application/json",
        ...(by === undefined ? {} : { [CALLER_HEADER]: encodeCaller(by) }),
      },
    }),
  )
  const answer = (await response.json().catch(() => ({}))) as T & { error?: string; code?: string }
  if (!response.ok) {
    throw new VaultError(
      answer.error ?? `The saved logins could not be read (${response.status}).`,
      answer.code,
    )
  }
  return answer
}

/** What an agent asks of its workspace's vault. */
export const vault = {
  list: async (actor: ActorStub): Promise<SavedLogin[]> =>
    (await ask<SavedLoginsState>(actor, "")).logins,
  save: async (actor: ActorStub, input: SaveLoginRequest, by: Caller | undefined) =>
    (
      await ask<{ login: SavedLogin }>(actor, "", {
        method: "POST",
        body: JSON.stringify(input),
        ...(by === undefined ? {} : { by }),
      })
    ).login,
  /** The login itself, password and all, for the one sign-in it is about to be used for. */
  use: async (actor: ActorStub, id: string, agent: string): Promise<SignInWith> =>
    (
      await ask<{ login: SignInWith }>(actor, `/${encodeURIComponent(id)}/use`, {
        method: "POST",
        body: JSON.stringify({ agent }),
      })
    ).login,
}
