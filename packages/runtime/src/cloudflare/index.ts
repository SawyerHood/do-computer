import { DurableObject } from "cloudflare:workers"
import {
  ACTOR_NAME_HEADER,
  type Actor,
  type ActorHost,
  type ActorNamespace,
  type AppDatabase,
  type ActorSocket,
  type BlobStore,
  checkSocketNote,
  type SocketAutoResponse,
  type SqlValue,
} from "../index.ts"
import { DurableObjectSqliteDatabase } from "@earendil-works/pi-durable/storage/sqlite/cloudflare"
import { R2BlobStore } from "./blobs.ts"

export { R2BlobStore } from "./blobs.ts"
export { browserRunPreviewer } from "./preview.ts"
// `SqliteDatabase` over a Durable Object's SQLite storage is pi-durable's own. A transaction is
// `storage.transaction()`, since Durable Object SQL refuses `BEGIN`, and statements that are not
// part of it wait behind it.
export { DurableObjectSqliteDatabase } from "@earendil-works/pi-durable/storage/sqlite/cloudflare"

const NAME_KEY = "dc:actor-name"

export type DurableActorOptions<Env> = {
  /** Build the actor once its host is ready. Called at most once per object instance. */
  create(host: ActorHost, env: Env): Actor
  /** Blob storage for the actor named `name`. */
  blobs(env: Env, name: string): BlobStore
  /** Answered by the runtime while the object hibernates. */
  socketAutoResponse?: SocketAutoResponse
}

type Attachment = { id?: string; note?: string } | null

/**
 * Wrap a hibernatable WebSocket; its id and its note live in the attachment, which survives
 * hibernation.
 */
function actorSocket(socket: WebSocket): ActorSocket {
  const id = (socket.deserializeAttachment() as Attachment)?.id ?? ""
  return {
    id,
    // Read each time: another wrapper of the same socket may have kept something since.
    get note() {
      return (socket.deserializeAttachment() as Attachment)?.note
    },
    keep: (note) => {
      checkSocketNote(note)
      socket.serializeAttachment({ id, note })
    },
    send: (data) => {
      try {
        socket.send(data)
        return true
      } catch {
        return false
      }
    },
    close: (code, reason) => {
      try {
        socket.close(code, reason)
      } catch {
        // Already closed.
      }
    },
  }
}

/**
 * Durable Object class hosting one `Actor`.
 *
 * A Durable Object cannot always read the name it was addressed by, so the stub from
 * `durableObjectNamespace()` sends it in a header and the object stores it for alarm wake-ups.
 */
export function createDurableActorClass<Env>(options: DurableActorOptions<Env>) {
  return class DurableActor extends DurableObject<Env> {
    #actor: Actor | undefined
    #database: DurableObjectSqliteDatabase | undefined
    /**
     * The alarm as this instance last set or read it: null for none, undefined where it is not
     * known (a new instance, or one whose alarm just fired). Every `setAlarm` is a row written,
     * and the actors set theirs at the end of every request, mostly to the time it already has.
     */
    #alarmAt: number | null | undefined

    constructor(ctx: DurableObjectState, env: Env) {
      super(ctx, env)
      const auto = options.socketAutoResponse
      if (auto !== undefined) {
        ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(auto.request, auto.response))
      }
    }

    #host(name: string): ActorHost {
      const storage = this.ctx.storage
      this.#database ??= new DurableObjectSqliteDatabase(storage)
      return {
        name,
        sql: this.#database,
        blobs: options.blobs(this.env, name),
        now: () => Date.now(),
        setAlarm: async (at) => {
          if (at === this.#alarmAt) return
          // Unknown until the write is done: a write that fails leaves it unknown.
          this.#alarmAt = undefined
          if (at === null) await storage.deleteAlarm()
          else await storage.setAlarm(at)
          this.#alarmAt = at
        },
        getAlarm: async () => {
          const at = await storage.getAlarm()
          this.#alarmAt = at
          return at
        },
        sockets: () =>
          this.ctx
            .getWebSockets()
            .filter((socket) => socket.readyState === WebSocket.OPEN)
            .map(actorSocket),
        destroy: async () => {
          for (const socket of this.ctx.getWebSockets()) {
            try {
              socket.close(1001, "This actor was deleted")
            } catch {
              // Already closed.
            }
          }
          const blobs = options.blobs(this.env, name)
          for (const object of await blobs.list("")) await blobs.delete(object.key)
          await storage.deleteAlarm()
          await storage.deleteAll()
          this.#alarmAt = null
          // The next request for this name builds a new actor on empty storage.
          this.#actor = undefined
          this.#database = undefined
        },
      }
    }

    async #load(request?: Request): Promise<Actor> {
      if (this.#actor !== undefined) return this.#actor
      let name = await this.ctx.storage.get<string>(NAME_KEY)
      if (name === undefined) {
        name = request?.headers.get(ACTOR_NAME_HEADER) ?? undefined
        if (name === undefined) throw new Error("Actor was reached without a name")
        await this.ctx.storage.put(NAME_KEY, name)
      }
      this.#actor ??= options.create(this.#host(name), this.env)
      return this.#actor
    }

    override async fetch(request: Request): Promise<Response> {
      const actor = await this.#load(request)
      const upgrading = request.headers.get("upgrade")?.toLowerCase() === "websocket"
      if (!upgrading || actor.socketOpen === undefined) return actor.fetch(request)
      const pair = new WebSocketPair()
      const client = pair[0]
      const server = pair[1]
      server.serializeAttachment({ id: crypto.randomUUID() })
      // Hibernatable: the object can be unloaded while the socket stays connected.
      this.ctx.acceptWebSocket(server)
      await actor.socketOpen(actorSocket(server), request)
      return new Response(null, { status: 101, webSocket: client })
    }

    override async webSocketMessage(
      socket: WebSocket,
      message: string | ArrayBuffer,
    ): Promise<void> {
      if (typeof message !== "string") return
      await (await this.#load()).socketMessage?.(actorSocket(socket), message)
    }

    override async webSocketClose(socket: WebSocket, code: number, reason: string): Promise<void> {
      await (await this.#load()).socketClose?.(actorSocket(socket), code, reason)
    }

    override async webSocketError(socket: WebSocket): Promise<void> {
      await (await this.#load()).socketClose?.(actorSocket(socket), 1006, "socket error")
    }

    override async alarm(): Promise<void> {
      // Spent by firing; one it sets again from here is written.
      this.#alarmAt = undefined
      await (await this.#load()).alarm()
    }
  }
}

/** `ActorNamespace` over a Durable Object namespace binding. */
export function durableObjectNamespace(binding: DurableObjectNamespace): ActorNamespace {
  return {
    get: (name) => ({
      fetch: (request) => {
        const headers = new Headers(request.headers)
        headers.set(ACTOR_NAME_HEADER, name)
        return binding.get(binding.idFromName(name)).fetch(new Request(request, { headers }))
      },
    }),
  }
}

function bindD1(value: SqlValue): unknown {
  return value instanceof Uint8Array ? value.slice().buffer : value
}

/** `AppDatabase` over a D1 binding. */
export function d1Database(database: D1Database): AppDatabase {
  const prepare = (sql: string, params: readonly SqlValue[]) =>
    database.prepare(sql).bind(...params.map(bindD1))
  return {
    run: async (sql, ...params) => {
      await prepare(sql, params).run()
    },
    get: async <T extends object>(sql: string, ...params: SqlValue[]) =>
      (await prepare(sql, params).first<T>()) ?? undefined,
    all: async <T extends object>(sql: string, ...params: SqlValue[]) =>
      (await prepare(sql, params).all<T>()).results,
    batch: async (statements) => {
      if (statements.length === 0) return
      await database.batch(statements.map(({ sql, params }) => prepare(sql, params ?? [])))
    },
  }
}

export function r2Blobs(bucket: R2Bucket, prefix = ""): BlobStore {
  return new R2BlobStore(bucket, prefix)
}
