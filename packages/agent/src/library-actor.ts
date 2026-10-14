import {
  encodeSse,
  type LibrarySocketMessage,
  SSE_HEADERS,
  SSE_HEARTBEAT,
} from "@do-computer/protocol"
import type { Actor, ActorHost, ActorSocket } from "@do-computer/runtime"
import { routeLibrary, routeLibraryView } from "./library-routes.ts"
import {
  type Deleted,
  type Entry,
  LibraryConflict,
  type LibraryDocs,
  LibraryError,
  type LibrarySecrets,
  type LibraryState,
  LibraryStore,
  type NewLibraryFile,
  type Who,
} from "./library-store.ts"
import type { Base } from "./library-sync.ts"
import { isInherited } from "./own.ts"

/** The header in which the gateway names the agent a request about a library came through. */
export const LIBRARY_AGENT_HEADER = "x-dc-agent"
/**
 * The header in which the gateway names what a site shares: the page or the folder of the
 * library that is its root. What is asked for is the rest of the address.
 */
export const LIBRARY_SITE_HEADER = "x-dc-site"
/** The header that carries what a file is, where the body is its content. */
export const LIBRARY_FILE_HEADER = "x-dc-file"

const SSE_HEARTBEAT_MS = 15_000

const json = (value: unknown, status = 200) => Response.json(value, { status })

/**
 * A library's record in the database of the actor that keeps it: a row for each file, so that
 * no row grows with the library. It is read once and kept in memory, which is safe because the
 * actor is the only writer.
 */
function sqlDocs(host: ActorHost): LibraryDocs {
  let ready: Promise<void> | undefined
  let state: LibraryState | undefined
  let secrets: LibrarySecrets | undefined
  const prepare = () =>
    (ready ??= (async () => {
      await host.sql.exec(
        `CREATE TABLE IF NOT EXISTS dc_library_files (
          id TEXT PRIMARY KEY, deleted INTEGER NOT NULL, json TEXT NOT NULL
        ) STRICT`,
      )
      await host.sql.exec(
        "CREATE TABLE IF NOT EXISTS dc_library_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT",
      )
      await host.sql.exec(
        "CREATE TABLE IF NOT EXISTS dc_library_bases (computer TEXT PRIMARY KEY, json TEXT NOT NULL) STRICT",
      )
    })())
  const load = async (): Promise<LibraryState> => {
    if (state !== undefined) return state
    await prepare()
    const loaded: LibraryState = { files: {}, deleted: {} }
    const rows = await host.sql.all<{ id: string; deleted: number; json: string }>(
      "SELECT id, deleted, json FROM dc_library_files",
    )
    for (const row of rows) {
      if (isInherited(row.id)) continue
      if (row.deleted === 1) loaded.deleted![row.id] = JSON.parse(row.json) as Deleted
      else loaded.files[row.id] = JSON.parse(row.json) as Entry
    }
    state = loaded
    return loaded
  }
  const loadSecrets = async (): Promise<LibrarySecrets> => {
    if (secrets !== undefined) return secrets
    await prepare()
    const rows = await host.sql.all<{ key: string; value: string }>(
      "SELECT key, value FROM dc_library_meta",
    )
    const found = new Map(rows.map((row) => [row.key, row.value]))
    secrets = { secret: found.get("secret") ?? "", rev: Number(found.get("rev") ?? "0") }
    return secrets
  }
  const setMeta = (key: string, value: string) =>
    host.sql.run(
      "INSERT INTO dc_library_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      key,
      value,
    )
  return {
    read: load,
    async change(change) {
      const before = await load()
      const draft = structuredClone(before) as LibraryState
      const result = await change(draft)
      const rows = (from: LibraryState) =>
        new Map<string, string>([
          ...Object.entries(from.files).map(
            ([id, entry]) => [id, `0${JSON.stringify(entry)}`] as [string, string],
          ),
          ...Object.entries(from.deleted ?? {}).map(
            ([id, entry]) => [id, `1${JSON.stringify(entry)}`] as [string, string],
          ),
        ])
      const [was, is] = [rows(before), rows(draft)]
      for (const id of was.keys()) {
        if (!is.has(id)) await host.sql.run("DELETE FROM dc_library_files WHERE id = ?", id)
      }
      for (const [id, row] of is) {
        if (was.get(id) === row) continue
        await host.sql.run(
          `INSERT INTO dc_library_files (id, deleted, json) VALUES (?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET deleted = excluded.deleted, json = excluded.json`,
          id,
          Number(row[0]),
          row.slice(1),
        )
      }
      draft.deleted ??= {}
      state = draft
      return result
    },
    readPrivate: loadSecrets,
    async changePrivate(change) {
      const kept = await loadSecrets()
      const draft = { ...kept }
      const result = change(draft)
      if (draft.secret !== kept.secret) await setMeta("secret", draft.secret)
      if (draft.rev !== kept.rev) await setMeta("rev", String(draft.rev ?? 0))
      secrets = draft
      return result
    },
    async base(computer) {
      await prepare()
      const row = await host.sql.get<{ json: string }>(
        "SELECT json FROM dc_library_bases WHERE computer = ?",
        computer,
      )
      return row === undefined ? undefined : (JSON.parse(row.json) as Record<string, Base>)
    },
    async setBase(computer, base) {
      await prepare()
      if (base === undefined) {
        await host.sql.run("DELETE FROM dc_library_bases WHERE computer = ?", computer)
        return
      }
      await host.sql.run(
        `INSERT INTO dc_library_bases (computer, json) VALUES (?, ?)
         ON CONFLICT (computer) DO UPDATE SET json = excluded.json`,
        computer,
        JSON.stringify(base),
      )
    },
  }
}

const bytesOf = async (request: Request) => new Uint8Array(await request.arrayBuffer())

/**
 * The library of a workspace: the files its agents make for the people in it, and the files
 * those people give them. One actor per workspace. It trusts its callers, which are the gateway,
 * after checking that someone may use an agent of the workspace, and those agents.
 */
export function createLibraryActor(host: ActorHost): Actor {
  const store = new LibraryStore({
    docs: sqlDocs(host),
    blobs: host.blobs,
    now: () => host.now(),
  })
  /** The open streams that are told when something changes. */
  const watchers = new Set<() => void>()
  /**
   * Say where the library stands, to one socket or to all of them. A socket does not keep the
   * library in memory as a stream does, so it is what a client follows it over. One that is
   * told a revision it already has does nothing.
   */
  const say = async (to: readonly ActorSocket[]) => {
    if (to.length === 0) return
    const frame = JSON.stringify({
      type: "at",
      rev: await store.rev(),
    } satisfies LibrarySocketMessage)
    for (const socket of to) socket.send(frame)
  }
  store.onChange = () => {
    for (const tell of watchers) tell()
    void say(host.sockets()).catch(() => {})
  }
  /**
   * Sockets that were here before this was, as when the library was put away and has come
   * back, are told where it stands: once, by whatever is asked of it first.
   */
  let greeted = false
  const greet = async () => {
    if (greeted) return
    greeted = true
    await say(host.sockets())
  }

  /** A stream that says when the library changed, for clients to read it again. */
  const events = (): Response => {
    let stop = () => {}
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const tell = () => controller.enqueue(encodeSse({ type: "changed" }))
        const heartbeat = setInterval(() => controller.enqueue(SSE_HEARTBEAT), SSE_HEARTBEAT_MS)
        watchers.add(tell)
        stop = () => {
          clearInterval(heartbeat)
          watchers.delete(tell)
        }
        controller.enqueue(encodeSse({ type: "ready" }))
      },
      cancel() {
        stop()
      },
    })
    return new Response(stream, { headers: SSE_HEADERS })
  }

  /** What an agent asks of the library: the calls of `LibraryBackend`, one address each. */
  const rpc = async (request: Request, segments: readonly string[]): Promise<Response> => {
    const [what, first, second, third] = segments
    const method = request.method
    if (method === "GET") {
      if (what === "rev") return json({ rev: await store.rev() })
      if (what === "list") return json({ files: await store.list() })
      if (what === "stored") return json({ stored: [...(await store.stored())] })
      if (what === "view") return json({ view: await store.viewToken() })
      if (what === "bytes" && first !== undefined && second !== undefined) {
        const bytes = await store.bytes({ id: first, rev: Number(second) })
        if (bytes === undefined) return json({ error: "Not found" }, 404)
        return new Response(bytes.slice().buffer, {
          headers: { "content-type": "application/octet-stream" },
        })
      }
    }
    if (method === "POST" && what === "add") {
      const meta = JSON.parse(
        decodeURIComponent(request.headers.get(LIBRARY_FILE_HEADER) ?? "%7B%7D"),
      ) as Omit<NewLibraryFile, "bytes">
      return json(await store.add({ ...meta, bytes: await bytesOf(request) }))
    }
    if (method === "PUT" && what === "write" && first !== undefined) {
      const query = new URL(request.url).searchParams
      const ifRev = query.get("ifRev")
      return json(
        await store.write(first, await bytesOf(request), (query.get("by") ?? "agent") as Who, {
          ifRev: ifRev === null ? undefined : Number(ifRev),
          pass: query.get("pass") ?? undefined,
        }),
      )
    }
    if (method === "POST" && what === "move" && first !== undefined) {
      const { to, exact, pass } = (await request.json()) as {
        to: string
        exact?: boolean
        pass?: string
      }
      return json(await store.move(first, to, { exact, pass }))
    }
    if (method === "POST" && what === "remove" && first !== undefined) {
      const { by, pass } = (await request.json()) as { by: Who; pass?: string }
      return json({ removed: await store.remove(first, by, { pass }) })
    }
    if (method === "POST" && what === "pass" && first !== undefined) {
      if (second === undefined) return json((await store.beginPass(first)) ?? { busy: true })
      if (third === "renew") {
        await store.renewPass(first, second)
        return json({ ok: true })
      }
      if (third === "end") {
        const { base } = (await request.json()) as { base?: Record<string, Base> }
        return json(await store.endPass(first, second, base))
      }
    }
    // A library that an agent had to itself, moving in.
    if (what === "take" && first !== undefined) {
      if (method === "PUT" && second !== undefined) {
        await store.takeBytes(
          first,
          Number(second),
          await bytesOf(request),
          request.headers.get("content-type") ?? "application/octet-stream",
        )
        return json({ ok: true })
      }
      if (method === "POST") {
        const { entry, folder, agentId } = (await request.json()) as {
          entry: Entry | Deleted
          folder?: string
          agentId?: string
        }
        await store.take(first, entry, { folder, agentId })
        return json({ ok: true })
      }
    }
    if (method === "POST" && what === "base" && first !== undefined) {
      const { base } = (await request.json()) as { base: Record<string, Base> }
      await store.takeBase(first, base)
      return json({ ok: true })
    }
    if (method === "DELETE" && what === "base" && first !== undefined) {
      await store.dropBase(first)
      return json({ ok: true })
    }
    return json({ error: "Not found" }, 404)
  }

  return {
    async socketOpen(socket) {
      // It is among those greeted, where it is the first thing to happen here.
      if (!greeted) return greet()
      await say([socket])
    },
    async fetch(request) {
      await greet()
      const url = new URL(request.url)
      let segments: string[]
      try {
        segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent)
      } catch {
        return json({ error: "Not found" }, 404)
      }
      // Segments become ids and names. One that every object inherits is never either of those.
      if (segments.some(isInherited)) return json({ error: "Not found" }, 404)
      try {
        if (segments[0] === "library") {
          const agentId = request.headers.get(LIBRARY_AGENT_HEADER) ?? undefined
          const response = await routeLibrary(store, request, segments.slice(1), agentId)
          if (response !== undefined) return response
        }
        if (segments[0] === "view") {
          // The page's own path is taken apart again there, as it was sent.
          const raw = url.pathname.split("/").filter(Boolean).slice(1)
          return await routeLibraryView(store, request, raw)
        }
        if (segments[0] === "site" && request.method === "GET") {
          // Only the gateway asks this, once it has decided the asker may open the site.
          const root = decodeURIComponent(request.headers.get(LIBRARY_SITE_HEADER) ?? "")
          if (root === "") return json({ error: "Not found" }, 404)
          const response = await store.site(root, segments.slice(1).join("/"), request)
          return response ?? json({ error: "Not found" }, 404)
        }
        if (segments[0] === "events" && request.method === "GET") return events()
        if (segments[0] === "rpc") return await rpc(request, segments.slice(1))
        if (segments[0] === "destroy" && request.method === "POST") {
          await store.empty()
          await host.destroy()
          return json({ ok: true })
        }
      } catch (error) {
        if (error instanceof LibraryConflict) {
          return json({ error: error.message, code: "conflict" }, 409)
        }
        if (error instanceof LibraryError) return json({ error: error.message }, 400)
        throw error
      }
      return json({ error: "Not found" }, 404)
    },
    async alarm() {},
  }
}
