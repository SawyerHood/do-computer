import type { LibraryFile } from "@durable-computer/protocol"
import type { ActorStub } from "@durable-computer/runtime"
import { LIBRARY_FILE_HEADER } from "./library-actor.ts"
import {
  type Deleted,
  type Entry,
  type LibraryBackend,
  LibraryConflict,
  LibraryError,
  type LibraryPass,
} from "./library-store.ts"
import type { Base } from "./library-sync.ts"

/** A library kept by an actor of its own, as an agent uses it. */
export type RemoteLibrary = LibraryBackend & {
  /** Move a file in from a library the agent had to itself: one of its contents, then its record. */
  takeBytes(id: string, rev: number, bytes: Uint8Array, contentType: string): Promise<void>
  take(
    id: string,
    entry: Entry | Deleted,
    options: { folder?: string; agentId?: string },
  ): Promise<void>
  takeBase(computer: string, base: Record<string, Base>): Promise<void>
  /** Call `changed` whenever what is kept changes, until the returned function is called. */
  watch(changed: () => void): () => void
}

const part = encodeURIComponent

/** The library behind `stub`, which is the actor of a workspace's library. */
export function remoteLibrary(stub: ActorStub): RemoteLibrary {
  const call = async (path: string, init?: RequestInit): Promise<Response> => {
    const response = await stub.fetch(new Request(`http://library/rpc/${path}`, init))
    if (response.ok) return response
    const failure = (await response.json().catch(() => ({}))) as { error?: string; code?: string }
    const message = failure.error ?? `The library answered with an error (${response.status}).`
    if (failure.code === "conflict") throw new LibraryConflict(message)
    if (response.status === 400) throw new LibraryError(message)
    throw new Error(message)
  }
  const get = async <T>(path: string): Promise<T> => (await (await call(path)).json()) as T
  const post = async <T>(path: string, body: unknown = {}): Promise<T> =>
    (await (
      await call(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    ).json()) as T
  return {
    rev: async () => (await get<{ rev: number }>("rev")).rev,
    list: async () => (await get<{ files: LibraryFile[] }>("list")).files,
    stored: async () =>
      new Map(
        (
          await get<{ stored: [string, { id: string; rev: number; hash: string | undefined }][] }>(
            "stored",
          )
        ).stored,
      ),
    async bytes(file) {
      const response = await stub.fetch(
        new Request(`http://library/rpc/bytes/${part(file.id)}/${file.rev}`),
      )
      if (response.status === 404) return undefined
      if (!response.ok) throw new Error(`The library answered with an error (${response.status}).`)
      return new Uint8Array(await response.arrayBuffer())
    },
    async add({ bytes, ...meta }) {
      const response = await call("add", {
        method: "POST",
        headers: { [LIBRARY_FILE_HEADER]: part(JSON.stringify(meta)) },
        body: bytes.slice().buffer,
      })
      return (await response.json()) as LibraryFile
    },
    async write(id, bytes, by, options = {}) {
      const query = new URLSearchParams({ by })
      if (options.ifRev !== undefined) query.set("ifRev", String(options.ifRev))
      if (options.pass !== undefined) query.set("pass", options.pass)
      const response = await call(`write/${part(id)}?${query}`, {
        method: "PUT",
        body: bytes.slice().buffer,
      })
      return (await response.json()) as LibraryFile
    },
    move: (id, to, options = {}) => post<LibraryFile>(`move/${part(id)}`, { to, ...options }),
    remove: async (id, by, options = {}) =>
      (await post<{ removed: boolean }>(`remove/${part(id)}`, { by, ...options })).removed,
    async beginPass(computer) {
      const answer = await post<LibraryPass | { busy: true }>(`pass/${part(computer)}`)
      return "busy" in answer ? undefined : answer
    },
    renewPass: async (computer, pass) => {
      await post(`pass/${part(computer)}/${part(pass)}/renew`)
    },
    endPass: (computer, pass, base) =>
      post<{ rev: number; clean: boolean }>(`pass/${part(computer)}/${part(pass)}/end`, { base }),
    async takeBytes(id, rev, bytes, contentType) {
      await call(`take/${part(id)}/${rev}`, {
        method: "PUT",
        headers: { "content-type": contentType },
        body: bytes.slice().buffer,
      })
    },
    take: async (id, entry, options) => {
      await post(`take/${part(id)}`, { entry, ...options })
    },
    takeBase: async (computer, base) => {
      await post(`base/${part(computer)}`, { base })
    },
    watch(changed) {
      let stopped = false
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
      void (async () => {
        const response = await stub.fetch(new Request("http://library/events"))
        if (!response.ok || response.body === null) return
        reader = response.body.getReader()
        if (stopped) return void (await reader.cancel())
        const decoder = new TextDecoder()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) return
          // Each event is written whole, and there is only one kind worth telling of.
          if (decoder.decode(value, { stream: true }).includes('"changed"')) changed()
        }
        // The stream ended, here or there. Whoever is watching the agent reads again on its own.
      })().catch(() => {})
      return () => {
        stopped = true
        void reader?.cancel().catch(() => {})
      }
    },
  }
}
