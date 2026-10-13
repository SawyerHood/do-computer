import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import {
  type NodeSqliteDatabase,
  openNodeSqliteDatabase,
} from "@earendil-works/pi-durable/storage/sqlite/node"
import type {
  Actor,
  ActorFactory,
  ActorHost,
  ActorNamespace,
  ActorSocket,
  ActorStub,
  AppDatabase,
  BlobStore,
  SocketAutoResponse,
  SqlValue,
} from "../index.ts"
import { checkSocketNote } from "../index.ts"
import { FileBlobStore } from "./blobs.ts"

export { FileBlobStore } from "./blobs.ts"
export { chromePreviewer, findChrome } from "./preview.ts"

/** Longest delay `setTimeout` takes; a later alarm is re-armed when this one fires. */
const MAX_TIMER_MS = 2_147_483_647
const RETRY_BASE_MS = 2_000
const RETRY_MAX_MS = 60_000

export type NodeActorNamespaceOptions = {
  /** Directory holding one SQLite file per actor, and the alarm index. */
  readonly directory: string
  readonly factory: ActorFactory
  /** Blob storage for the actor named `name`. */
  readonly blobs: (name: string) => BlobStore
  readonly now?: () => number
  /** Receives alarm failures; an alarm that fails is retried with backoff. */
  readonly onError?: (error: unknown, name: string) => void
  /** Answered here without calling the actor, as a Durable Object does while hibernating. */
  readonly socketAutoResponse?: SocketAutoResponse
}

/** The part of a `ws` WebSocket the namespace uses, so this package does not depend on `ws`. */
export interface SocketLike {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  on(event: "message", listener: (data: unknown, isBinary: boolean) => void): unknown
  on(event: "close", listener: (code: number, reason: unknown) => void): unknown
  on(event: "error", listener: (error: unknown) => void): unknown
}

const SOCKET_OPEN = 1

type Instance = {
  readonly actor: Actor
  readonly database: NodeSqliteDatabase
}

type Alarm = {
  timer: ReturnType<typeof setTimeout> | undefined
  /** The pending wake-up. Null while its handler runs, unless the handler set a new one. */
  at: number | null
  firing: boolean
  failures: number
}

/**
 * Hosts actors in this process: one SQLite file each, loaded on first use.
 *
 * Alarms are recorded in an index database before they are armed, so a restart re-arms them with
 * `start()`. An alarm stays recorded until its handler resolves, which makes delivery at-least-once
 * across crashes, the same guarantee a Durable Object alarm gives.
 */
export class NodeActorNamespace implements ActorNamespace {
  readonly #options: NodeActorNamespaceOptions
  readonly #instances = new Map<string, Promise<Instance>>()
  readonly #alarms = new Map<string, Alarm>()
  readonly #sockets = new Map<string, Map<string, { like: SocketLike; socket: ActorSocket }>>()
  #socketCounter = 0
  readonly #index: DatabaseSync
  #closed = false

  constructor(options: NodeActorNamespaceOptions) {
    this.#options = options
    mkdirSync(options.directory, { recursive: true })
    this.#index = new DatabaseSync(join(options.directory, "_alarms.sqlite"))
    this.#index.exec("PRAGMA journal_mode = WAL")
    this.#index.exec(
      "CREATE TABLE IF NOT EXISTS alarms (name TEXT PRIMARY KEY, at INTEGER NOT NULL) STRICT",
    )
  }

  #now(): number {
    return this.#options.now?.() ?? Date.now()
  }

  get(name: string): ActorStub {
    return { fetch: async (request) => (await this.#load(name)).actor.fetch(request) }
  }

  /**
   * Attach an accepted WebSocket to the actor named `name`. The caller has already authenticated
   * `request`, the request that upgraded.
   */
  async connect(name: string, like: SocketLike, request: Request): Promise<void> {
    const { actor } = await this.#load(name)
    if (actor.socketOpen === undefined) {
      like.close(1011, "This actor does not accept sockets")
      return
    }
    const id = `s${++this.#socketCounter}`
    let note: string | undefined
    const socket: ActorSocket = {
      id,
      get note() {
        return note
      },
      keep: (next) => {
        checkSocketNote(next)
        note = next
      },
      send: (data) => {
        if (like.readyState !== SOCKET_OPEN) return false
        try {
          like.send(data)
          return true
        } catch {
          return false
        }
      },
      close: (code, reason) => like.close(code, reason),
    }
    let sockets = this.#sockets.get(name)
    if (sockets === undefined) this.#sockets.set(name, (sockets = new Map()))
    sockets.set(id, { like, socket })
    const report = (error: unknown) => this.#options.onError?.(error, name)
    const auto = this.#options.socketAutoResponse
    let closed = false
    // The actor is found again each time, and not kept from when the socket opened: it may
    // have been unloaded since, and it is whichever is loaded now that is told.
    const tell = (what: (actor: Actor) => void | Promise<void>) =>
      void this.#load(name)
        .then(({ actor }) => what(actor))
        .catch(report)
    const close = (code: number, reason: string) => {
      if (closed) return
      closed = true
      sockets.delete(id)
      if (!this.#closed) tell((actor) => actor.socketClose?.(socket, code, reason))
    }
    like.on("message", (data, isBinary) => {
      if (isBinary) return
      const text = typeof data === "string" ? data : String(data)
      if (auto !== undefined && text === auto.request) {
        socket.send(auto.response)
        return
      }
      tell((actor) => actor.socketMessage?.(socket, text))
    })
    like.on("close", (code, reason) => close(code, String(reason ?? "")))
    like.on("error", () => close(1006, "socket error"))
    await actor.socketOpen(socket, request)
  }

  /**
   * Unload the actor named `name` while its sockets stay connected, as a Durable Object that
   * hibernates is. The next request, alarm or socket message loads it again. For tests of what
   * an actor does when it comes back to sockets it has no memory of.
   */
  async evict(name: string): Promise<void> {
    const loading = this.#instances.get(name)
    if (loading === undefined) return
    this.#instances.delete(name)
    const instance = await loading
    try {
      await instance.actor.close?.()
    } finally {
      await instance.database.close()
    }
  }

  /** Re-arm every recorded alarm. Call once after constructing the namespace. */
  start(): void {
    const rows = this.#index.prepare("SELECT name, at FROM alarms").all() as {
      name: string
      at: number
    }[]
    for (const row of rows) {
      const alarm = this.#alarm(row.name)
      if (alarm.at === null) {
        alarm.at = row.at
        this.#arm(row.name, alarm)
      }
    }
  }

  /** Stop timers and close every database. Recorded alarms stay recorded. */
  async close(): Promise<void> {
    this.#closed = true
    for (const alarm of this.#alarms.values()) clearTimeout(alarm.timer)
    for (const sockets of this.#sockets.values()) {
      for (const { like } of sockets.values()) like.close(1001, "Server is shutting down")
    }
    const instances = await Promise.allSettled(this.#instances.values())
    for (const instance of instances) {
      if (instance.status !== "fulfilled") continue
      try {
        await instance.value.actor.close?.()
      } finally {
        await instance.value.database.close()
      }
    }
    this.#instances.clear()
    this.#index.close()
  }

  #load(name: string): Promise<Instance> {
    if (this.#closed) return Promise.reject(new Error("Actor namespace is closed"))
    let instance = this.#instances.get(name)
    if (instance === undefined) {
      instance = this.#open(name)
      this.#instances.set(name, instance)
      instance.catch(() => this.#instances.delete(name))
    }
    return instance
  }

  async #open(name: string): Promise<Instance> {
    const file = join(this.#options.directory, `${encodeURIComponent(name)}.sqlite`)
    const database = await openNodeSqliteDatabase(file)
    const host: ActorHost = {
      name,
      sql: database,
      blobs: this.#options.blobs(name),
      now: () => this.#now(),
      setAlarm: async (at) => this.#setAlarm(name, at),
      getAlarm: async () => this.#alarm(name).at,
      sockets: () =>
        [...(this.#sockets.get(name)?.values() ?? [])]
          .filter(({ like }) => like.readyState === SOCKET_OPEN)
          .map(({ socket }) => socket),
      destroy: async () => {
        const alarm = this.#alarms.get(name)
        if (alarm !== undefined) clearTimeout(alarm.timer)
        this.#alarms.delete(name)
        this.#index.prepare("DELETE FROM alarms WHERE name = ?").run(name)
        for (const { like } of this.#sockets.get(name)?.values() ?? []) {
          like.close(1001, "This actor was deleted")
        }
        this.#sockets.delete(name)
        // The next request for this name opens a new, empty actor.
        this.#instances.delete(name)
        await database.close()
        for (const suffix of ["", "-wal", "-shm", "-journal"]) {
          rmSync(`${file}${suffix}`, { force: true })
        }
        const blobs = this.#options.blobs(name)
        for (const object of await blobs.list("")) await blobs.delete(object.key)
      },
    }
    return { actor: this.#options.factory(host), database }
  }

  #alarm(name: string): Alarm {
    let alarm = this.#alarms.get(name)
    if (alarm === undefined) {
      alarm = { timer: undefined, at: null, firing: false, failures: 0 }
      this.#alarms.set(name, alarm)
    }
    return alarm
  }

  #setAlarm(name: string, at: number | null): void {
    const alarm = this.#alarm(name)
    alarm.at = at
    alarm.failures = 0
    clearTimeout(alarm.timer)
    alarm.timer = undefined
    if (at === null) {
      // While the handler runs its own row is still recorded; `#fire` removes it on success.
      if (!alarm.firing) this.#index.prepare("DELETE FROM alarms WHERE name = ?").run(name)
      return
    }
    this.#record(name, at)
    this.#arm(name, alarm)
  }

  #record(name: string, at: number): void {
    this.#index
      .prepare(
        "INSERT INTO alarms (name, at) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET at = excluded.at",
      )
      .run(name, at)
  }

  #arm(name: string, alarm: Alarm): void {
    if (this.#closed || alarm.at === null) return
    clearTimeout(alarm.timer)
    const delay = Math.min(Math.max(alarm.at - this.#now(), 0), MAX_TIMER_MS)
    alarm.timer = setTimeout(() => {
      alarm.timer = undefined
      if (alarm.at !== null && alarm.at > this.#now()) this.#arm(name, alarm)
      else void this.#fire(name, alarm)
    }, delay)
    // A pending alarm must not keep the process from exiting.
    alarm.timer.unref?.()
  }

  async #fire(name: string, alarm: Alarm): Promise<void> {
    if (this.#closed || alarm.firing) return
    const failures = alarm.failures
    alarm.firing = true
    alarm.at = null
    try {
      await (await this.#load(name)).actor.alarm()
      alarm.failures = 0
      // Delivered. Unless the handler set a new alarm, nothing is left to record.
      if (alarm.at === null) this.#index.prepare("DELETE FROM alarms WHERE name = ?").run(name)
    } catch (error) {
      this.#options.onError?.(error, name)
      // Retry unless the handler armed a new alarm before it failed.
      if (alarm.at === null && !this.#closed) {
        alarm.failures = failures + 1
        const backoff = Math.min(RETRY_BASE_MS * 2 ** failures, RETRY_MAX_MS)
        alarm.at = this.#now() + backoff
        this.#record(name, alarm.at)
      }
    } finally {
      alarm.firing = false
      if (alarm.at !== null && alarm.timer === undefined) this.#arm(name, alarm)
    }
  }
}

function bindNode(value: SqlValue): null | number | string | Uint8Array {
  return value
}

/** `AppDatabase` over one SQLite file, using Node's built-in `node:sqlite`. */
export function nodeAppDatabase(database: DatabaseSync): AppDatabase {
  const statement = (sql: string) => database.prepare(sql)
  return {
    run: async (sql, ...params) => {
      statement(sql).run(...params.map(bindNode))
    },
    get: async <T extends object>(sql: string, ...params: SqlValue[]) =>
      statement(sql).get(...params.map(bindNode)) as T | undefined,
    all: async <T extends object>(sql: string, ...params: SqlValue[]) =>
      statement(sql).all(...params.map(bindNode)) as T[],
    batch: async (statements) => {
      if (statements.length === 0) return
      database.exec("BEGIN IMMEDIATE")
      try {
        for (const { sql, params } of statements)
          statement(sql).run(...(params ?? []).map(bindNode))
        database.exec("COMMIT")
      } catch (error) {
        database.exec("ROLLBACK")
        throw error
      }
    },
  }
}

/** Open (or create) the app database file with the same durability settings as actor databases. */
export function openNodeAppDatabase(file: string): { database: DatabaseSync; app: AppDatabase } {
  const database = new DatabaseSync(file, { timeout: 5_000 })
  database.exec("PRAGMA journal_mode = WAL")
  database.exec("PRAGMA synchronous = NORMAL")
  database.exec("PRAGMA foreign_keys = ON")
  return { database, app: nodeAppDatabase(database) }
}

export function fileBlobs(directory: string): BlobStore {
  return new FileBlobStore(directory)
}
