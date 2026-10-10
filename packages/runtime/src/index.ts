export {
  BlockedAddressError,
  checkAddress,
  type Fetch,
  type GuardOptions,
  guardedFetch,
  isPrivateHost,
} from "./guarded-fetch.ts"
import type { SqliteDatabase } from "@earendil-works/pi-durable/storage/sqlite"

export type {
  SqliteDatabase,
  SqliteExecutor,
  SqliteValue,
} from "@earendil-works/pi-durable/storage/sqlite"
export { SerialQueue } from "./serial-queue.ts"

export type BlobMetadata = {
  readonly contentType?: string
}

export type BlobObject = {
  readonly key: string
  readonly size: number
  readonly contentType?: string
  readonly uploadedAt: number
}

/** Object storage for files that outlive a sandbox: library files, uploads, workspace saves. */
export interface BlobStore {
  put(key: string, data: Uint8Array, metadata?: BlobMetadata): Promise<void>
  get(key: string): Promise<(BlobObject & { bytes(): Promise<Uint8Array> }) | undefined>
  head(key: string): Promise<BlobObject | undefined>
  delete(key: string): Promise<void>
  /** Objects whose key starts with `prefix`, in key order. */
  list(prefix: string): Promise<BlobObject[]>
}

/**
 * What an actor gets from the runtime it lives in. Implemented once over a Durable Object and once
 * over a Node process; `registerHostConformance()` holds both to the same behavior.
 */
export interface ActorHost {
  /** The name the actor is addressed by. Stable for the life of its storage. */
  readonly name: string
  /** The actor's private database. One writer: this actor. */
  readonly sql: SqliteDatabase
  readonly blobs: BlobStore
  now(): number
  /**
   * Set or clear the actor's single wake-up. When it is due the runtime calls `Actor.alarm()`,
   * loading the actor first if it is not in memory, and retries a rejected call. Setting an alarm
   * replaces the previous one.
   */
  setAlarm(at: number | null): Promise<void>
  /** The pending wake-up, or null. Null inside `alarm()` unless a new one was set. */
  getAlarm(): Promise<number | null>
  /** WebSockets attached to this actor that are still open. */
  sockets(): ActorSocket[]
  /**
   * Delete everything this actor has: its database, its blobs, its alarm and its sockets. The
   * actor must have stopped using the database first, and must not use the host afterwards. The
   * name can be used again later and finds nothing.
   */
  destroy(): Promise<void>
}

/**
 * The actor's end of a WebSocket. A runtime may unload the actor while the socket stays open, so
 * an actor identifies a socket by `id`, never by object identity, and keeps no state on it.
 */
export interface ActorSocket {
  readonly id: string
  /**
   * What the actor last kept with the socket, or undefined. It stays with the socket for as
   * long as the socket is open, whether or not the actor stayed in memory meanwhile, which is
   * what lets an actor that was unloaded find out what each of its sockets was for.
   */
  readonly note: string | undefined
  /** Keep `note` with the socket, in place of what was kept. At most `MAX_SOCKET_NOTE_CHARS`. */
  keep(note: string): void
  /** False when the socket is no longer open and the message was not sent. */
  send(data: string): boolean
  close(code?: number, reason?: string): void
}

/** The most an actor can keep with a socket. A Durable Object allows sixteen kilobytes. */
export const MAX_SOCKET_NOTE_CHARS = 1_000

export function checkSocketNote(note: string): void {
  if (note.length > MAX_SOCKET_NOTE_CHARS) {
    throw new Error(`A socket's note can be at most ${MAX_SOCKET_NOTE_CHARS} characters`)
  }
}

export interface Actor {
  fetch(request: Request): Promise<Response>
  alarm(): Promise<void>
  /**
   * Stop work and release the host's database before the process exits. Only a runtime that
   * shuts down in order calls it; unfinished work must survive not being told.
   */
  close?(): Promise<void>
  /** A WebSocket was attached; `request` is the request that upgraded. Text frames only. */
  socketOpen?(socket: ActorSocket, request: Request): void | Promise<void>
  socketMessage?(socket: ActorSocket, data: string): void | Promise<void>
  socketClose?(socket: ActorSocket, code: number, reason: string): void | Promise<void>
}

/**
 * A fixed reply the runtime sends for a fixed message without involving the actor, so keep-alive
 * pings do not wake it.
 */
export type SocketAutoResponse = { readonly request: string; readonly response: string }

export type ActorFactory = (host: ActorHost) => Actor

export interface ActorStub {
  fetch(request: Request): Promise<Response>
}

/** Addresses actors by name. A Durable Object namespace on Cloudflare, an in-process map on Node. */
export interface ActorNamespace {
  get(name: string): ActorStub
}

export type SqlValue = null | number | string | Uint8Array

/**
 * The deployment-wide database (accounts, agents, sessions): D1 on Cloudflare, one SQLite file on
 * Node. Kept to what both can do; `batch` is the only atomic unit because D1 has no interactive
 * transactions.
 */
export interface AppDatabase {
  run(sql: string, ...params: SqlValue[]): Promise<void>
  get<T extends object>(sql: string, ...params: SqlValue[]): Promise<T | undefined>
  all<T extends object>(sql: string, ...params: SqlValue[]): Promise<T[]>
  /** Run every statement, or none. */
  batch(statements: readonly { sql: string; params?: readonly SqlValue[] }[]): Promise<void>
}

/** Header a gateway sets so an actor that cannot read its own name learns it. */
export const ACTOR_NAME_HEADER = "x-dc-actor-name"

export type { SqliteDatabase as ActorDatabase }
