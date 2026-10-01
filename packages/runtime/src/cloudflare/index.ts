import { DurableObject } from "cloudflare:workers"
import {
  ACTOR_NAME_HEADER,
  type Actor,
  type ActorHost,
  type ActorNamespace,
  type AppDatabase,
  type BlobStore,
  type SqlValue,
} from "../index.ts"
import { R2BlobStore } from "./blobs.ts"
import { DurableObjectSqliteDatabase } from "./sqlite.ts"

export { R2BlobStore } from "./blobs.ts"
export { DurableObjectSqliteDatabase } from "./sqlite.ts"

const NAME_KEY = "dc:actor-name"

export type DurableActorOptions<Env> = {
  /** Build the actor once its host is ready. Called at most once per object instance. */
  create(host: ActorHost, env: Env): Actor
  /** Blob storage for the actor named `name`. */
  blobs(env: Env, name: string): BlobStore
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

    #host(name: string): ActorHost {
      const storage = this.ctx.storage
      this.#database ??= new DurableObjectSqliteDatabase(storage)
      return {
        name,
        sql: this.#database,
        blobs: options.blobs(this.env, name),
        now: () => Date.now(),
        setAlarm: async (at) => {
          if (at === null) await storage.deleteAlarm()
          else await storage.setAlarm(at)
        },
        getAlarm: () => storage.getAlarm(),
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
      return (await this.#load(request)).fetch(request)
    }

    override async alarm(): Promise<void> {
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
