import type { Actor, ActorHost, ActorNamespace, AppDatabase, SocketAutoResponse } from "./index.ts"

/** The auto-response conformance hosts must be configured with. */
export const CONFORMANCE_AUTO_RESPONSE: SocketAutoResponse = { request: "ping", response: "pong" }

/** The parts of a Vitest- or Jest-compatible runner the suites use. */
export type TestRunner = {
  describe(name: string, body: () => void): void
  it(name: string, body: () => Promise<void>, timeout?: number): void
  expect(value: unknown): {
    toBe(expected: unknown): void
    toEqual(expected: unknown): void
    toBeGreaterThanOrEqual(expected: number): void
  }
}

const json = (value: unknown, status = 200) => Response.json(value, { status })

/**
 * Actor that exposes its host over HTTP, so the same checks can drive a Durable Object through a
 * stub and a Node actor in process.
 */
export function conformanceActor(host: ActorHost): Actor {
  const born = crypto.randomUUID()
  let ready: Promise<void> | undefined
  const prepare = () =>
    (ready ??= host.sql.exec(
      `CREATE TABLE IF NOT EXISTS conformance_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
       CREATE TABLE IF NOT EXISTS conformance_alarms (fired_at INTEGER NOT NULL, pending INTEGER) STRICT`,
    ))
  const remember = (key: string, value: string) =>
    host.sql.run(
      "INSERT INTO conformance_kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      key,
      value,
    )
  const read = async (key: string) =>
    (await host.sql.get<{ value: string }>("SELECT value FROM conformance_kv WHERE key = ?", key))
      ?.value

  return {
    async fetch(request) {
      await prepare()
      const url = new URL(request.url)
      const key = url.searchParams.get("key") ?? "key"
      switch (url.pathname) {
        case "/name":
          return json({ name: host.name })
        case "/put":
          await host.sql.run(
            "INSERT INTO conformance_kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            key,
            url.searchParams.get("value") ?? "",
          )
          return json({ ok: true })
        case "/get":
          return json({ value: (await read(key)) ?? null })
        case "/transaction": {
          // Writes inside a transaction, then commits or rejects, with unrelated work racing it.
          const fail = url.searchParams.get("fail") === "1"
          let racing: Promise<string | undefined> | undefined
          let error: string | undefined
          try {
            await host.sql.transaction(async (transaction) => {
              await transaction.run(
                "INSERT INTO conformance_kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                key,
                "inside",
              )
              // Must queue behind the transaction and observe its outcome, not its middle.
              racing = read(key)
              await Promise.resolve()
              if (fail) throw new Error("rejected")
            })
          } catch (caught) {
            error = (caught as Error).message
          }
          return json({ error: error ?? null, raced: (await racing) ?? null })
        }
        case "/types": {
          await host.sql.exec(
            "CREATE TABLE IF NOT EXISTS conformance_types (i INTEGER, r REAL, t TEXT, b BLOB, n TEXT)",
          )
          await host.sql.run("DELETE FROM conformance_types")
          await host.sql.run(
            "INSERT INTO conformance_types (i, r, t, b, n) VALUES (?, ?, ?, ?, ?)",
            42,
            1.5,
            "text",
            new Uint8Array([1, 2, 3]),
            null,
          )
          const row = await host.sql.get<{
            i: number
            r: number
            t: string
            b: Uint8Array
            n: null
          }>("SELECT i, r, t, b, n FROM conformance_types")
          return json({
            i: row?.i,
            r: row?.r,
            t: row?.t,
            b: row?.b instanceof Uint8Array ? [...row.b] : "not bytes",
            n: row?.n,
          })
        }
        case "/destroy":
          await host.destroy()
          return json({ ok: true })
        case "/alarm/set": {
          const delay = Number(url.searchParams.get("in") ?? "0")
          await host.setAlarm(host.now() + delay)
          return json({ pending: await host.getAlarm() })
        }
        case "/alarm/clear":
          await host.setAlarm(null)
          return json({ pending: await host.getAlarm() })
        case "/alarm/pending":
          return json({ pending: await host.getAlarm() })
        case "/alarm/fired":
          return json({
            fired: await host.sql.all<{ fired_at: number; pending: number | null }>(
              "SELECT fired_at, pending FROM conformance_alarms ORDER BY rowid",
            ),
          })
        case "/blob/put":
          await host.blobs.put(key, new Uint8Array(await request.arrayBuffer()), {
            contentType: request.headers.get("content-type") ?? undefined,
          })
          return json({ ok: true })
        case "/blob/get": {
          const object = await host.blobs.get(key)
          if (object === undefined) return json({ found: false })
          return json({
            found: true,
            size: object.size,
            contentType: object.contentType ?? null,
            bytes: [...(await object.bytes())],
          })
        }
        case "/blob/list":
          return json({
            keys: (await host.blobs.list(url.searchParams.get("prefix") ?? "")).map((o) => o.key),
          })
        case "/blob/delete":
          await host.blobs.delete(key)
          return json({ ok: true })
        case "/sockets":
          return json({ count: host.sockets().length })
        case "/born":
          // Different each time the actor is made: it tells one loading of it from the next.
          return json({ born })
        case "/stream": {
          const encoder = new TextEncoder()
          let count = 0
          return new Response(
            new ReadableStream<Uint8Array>({
              async pull(controller) {
                if (count === 3) return controller.close()
                await new Promise((resolve) => setTimeout(resolve, 10))
                controller.enqueue(encoder.encode(`data: ${count++}\n\n`))
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          )
        }
        default:
          return json({ error: "not found" }, 404)
      }
    },
    async alarm() {
      await prepare()
      await host.sql.run(
        "INSERT INTO conformance_alarms (fired_at, pending) VALUES (?, ?)",
        host.now(),
        await host.getAlarm(),
      )
    },
    async socketOpen(socket, request) {
      const tag = new URL(request.url).searchParams.get("tag") ?? ""
      socket.send(`open:${host.name}:${tag}:${host.sockets().length}`)
    },
    async socketMessage(socket, data) {
      await prepare()
      await remember("last-message", data)
      if (data === "close-others") {
        for (const other of host.sockets())
          if (other.id !== socket.id) other.close(4002, "superseded")
        socket.send("closed-others")
      } else if (data.startsWith("broadcast:")) {
        for (const each of host.sockets()) each.send(data.slice("broadcast:".length))
      } else if (data.startsWith("keep:")) {
        socket.keep(data.slice("keep:".length))
        socket.send("kept")
      } else if (data === "notes") {
        // As the host lists them, which is how an actor that was unloaded finds them again.
        const notes = host.sockets().map((each) => each.note ?? "-")
        socket.send(`notes:${notes.sort().join(",")}`)
      } else {
        socket.send(`echo:${data}`)
      }
    },
    async socketClose(_socket, code) {
      await prepare()
      await remember("last-close", String(code))
    },
  }
}

/** A WebSocket as a test holds it: the client end of a connection to a conformance actor. */
export type TestSocket = {
  send(data: string): void
  close(code?: number): void
  /** The next message, in order. */
  next(): Promise<string>
  /** Resolves with the close code once the server closes the socket. */
  closed: Promise<number>
}

export type SocketConformanceOptions = HostConformanceOptions & {
  /** Open a socket to the actor named `name`; `tag` must reach it in the request URL. */
  connect(name: string, tag: string): Promise<TestSocket>
}

/** Socket behavior every `ActorHost` must have. */
export function registerSocketConformance(
  runner: TestRunner,
  label: string,
  options: SocketConformanceOptions,
): void {
  const { describe, it, expect } = runner
  describe(`${label}: actor sockets`, () => {
    it("attaches a socket, with the request that opened it, and exchanges messages", async () => {
      const name = options.uniqueName()
      const socket = await options.connect(name, "first")
      expect(await socket.next()).toBe(`open:${name}:first:1`)
      socket.send("hello")
      expect(await socket.next()).toBe("echo:hello")
      expect(await call(options.namespace(), name, "/get?key=last-message")).toEqual({
        value: "hello",
      })
      socket.close(1000)
    })

    it("answers the keep-alive message without involving the actor", async () => {
      const name = options.uniqueName()
      const socket = await options.connect(name, "")
      await socket.next()
      socket.send("before")
      await socket.next()
      socket.send("ping")
      expect(await socket.next()).toBe("pong")
      expect(await call(options.namespace(), name, "/get?key=last-message")).toEqual({
        value: "before",
      })
      socket.close(1000)
    })

    it("lists open sockets, reaches each, and lets the actor close the others", async () => {
      const name = options.uniqueName()
      const first = await options.connect(name, "a")
      await first.next()
      const second = await options.connect(name, "b")
      expect(await second.next()).toBe(`open:${name}:b:2`)
      expect(await call(options.namespace(), name, "/sockets")).toEqual({ count: 2 })
      second.send("broadcast:to-all")
      expect(await first.next()).toBe("to-all")
      expect(await second.next()).toBe("to-all")
      second.send("close-others")
      expect(await second.next()).toBe("closed-others")
      expect(await first.closed).toBe(4002)
      await until(
        async () =>
          (await call<{ count: number }>(options.namespace(), name, "/sockets")).count === 1,
      )
      second.close(1000)
    })

    it("keeps a note with each socket, for the actor to find it by", async () => {
      const name = options.uniqueName()
      const first = await options.connect(name, "a")
      await first.next()
      const second = await options.connect(name, "b")
      await second.next()
      first.send("notes")
      expect(await first.next()).toBe("notes:-,-")
      first.send("keep:one")
      expect(await first.next()).toBe("kept")
      second.send("keep:two")
      expect(await second.next()).toBe("kept")
      second.send("notes")
      expect(await second.next()).toBe("notes:one,two")
      // What is kept takes the place of what was.
      first.send("keep:three")
      expect(await first.next()).toBe("kept")
      first.send("notes")
      expect(await first.next()).toBe("notes:three,two")
      first.close(1000)
      second.close(1000)
    })

    it("tells the actor when a socket closes", async () => {
      const name = options.uniqueName()
      const socket = await options.connect(name, "")
      await socket.next()
      socket.close(4321)
      await until(
        async () =>
          (await call<{ value: string | null }>(options.namespace(), name, "/get?key=last-close"))
            .value === "4321",
      )
      expect(await call(options.namespace(), name, "/sockets")).toEqual({ count: 0 })
    })
  })
}

export type HostConformanceOptions = {
  /** A namespace whose actors are `conformanceActor`. */
  namespace(): ActorNamespace
  /** A name no other test uses. */
  uniqueName(): string
}

async function call<T>(
  namespace: ActorNamespace,
  name: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await namespace.get(name).fetch(new Request(`http://actor${path}`, init))
  return (await response.json()) as T
}

async function until(check: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for a condition")
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

/** Behavior every `ActorHost` must have, checked through an `ActorNamespace`. */
export function registerHostConformance(
  runner: TestRunner,
  label: string,
  options: HostConformanceOptions,
): void {
  const { describe, it, expect } = runner
  describe(`${label}: actor host`, () => {
    it("gives each actor its name and its own database", async () => {
      const namespace = options.namespace()
      const [a, b] = [options.uniqueName(), options.uniqueName()]
      expect((await call<{ name: string }>(namespace, a, "/name")).name).toBe(a)
      await call(namespace, a, "/put?key=k&value=from-a")
      await call(namespace, b, "/put?key=k&value=from-b")
      expect((await call<{ value: string }>(namespace, a, "/get?key=k")).value).toBe("from-a")
      expect((await call<{ value: string }>(namespace, b, "/get?key=k")).value).toBe("from-b")
    })

    it("commits a transaction and queues unrelated work behind it", async () => {
      const namespace = options.namespace()
      const name = options.uniqueName()
      const result = await call<{ error: string | null; raced: string | null }>(
        namespace,
        name,
        "/transaction?key=t",
      )
      expect(result.error).toBe(null)
      expect(result.raced).toBe("inside")
      expect((await call<{ value: string }>(namespace, name, "/get?key=t")).value).toBe("inside")
    })

    it("rolls a rejected transaction back", async () => {
      const namespace = options.namespace()
      const name = options.uniqueName()
      await call(namespace, name, "/put?key=t&value=before")
      const result = await call<{ error: string | null; raced: string | null }>(
        namespace,
        name,
        "/transaction?key=t&fail=1",
      )
      expect(result.error).toBe("rejected")
      expect(result.raced).toBe("before")
      expect((await call<{ value: string }>(namespace, name, "/get?key=t")).value).toBe("before")
    })

    it("round-trips every value type", async () => {
      const result = await call(options.namespace(), options.uniqueName(), "/types")
      expect(result).toEqual({ i: 42, r: 1.5, t: "text", b: [1, 2, 3], n: null })
    })

    it("fires an alarm once, with no alarm pending inside the handler", async () => {
      const namespace = options.namespace()
      const name = options.uniqueName()
      const set = await call<{ pending: number | null }>(namespace, name, "/alarm/set?in=50")
      expect(typeof set.pending).toBe("number")
      type Fired = { fired: { fired_at: number; pending: number | null }[] }
      await until(async () => (await call<Fired>(namespace, name, "/alarm/fired")).fired.length > 0)
      await new Promise((resolve) => setTimeout(resolve, 150))
      const { fired } = await call<Fired>(namespace, name, "/alarm/fired")
      expect(fired.length).toBe(1)
      expect(fired[0]?.pending).toBe(null)
      expect(
        (await call<{ pending: number | null }>(namespace, name, "/alarm/pending")).pending,
      ).toBe(null)
    })

    it("replaces and clears alarms", async () => {
      const namespace = options.namespace()
      const name = options.uniqueName()
      await call(namespace, name, "/alarm/set?in=60000")
      const cleared = await call<{ pending: number | null }>(namespace, name, "/alarm/clear")
      expect(cleared.pending).toBe(null)
      await call(namespace, name, "/alarm/set?in=60000")
      await call(namespace, name, "/alarm/set?in=50")
      type Fired = { fired: unknown[] }
      await until(async () => (await call<Fired>(namespace, name, "/alarm/fired")).fired.length > 0)
      expect((await call<Fired>(namespace, name, "/alarm/fired")).fired.length).toBe(1)
    })

    it("deletes everything an actor has when it is destroyed", async () => {
      const namespace = options.namespace()
      const [name, other] = [options.uniqueName(), options.uniqueName()]
      const body = new Uint8Array([1, 2, 3])
      for (const actor of [name, other]) {
        await call(namespace, actor, "/put?key=k&value=kept")
        await call(namespace, actor, "/blob/put?key=library/a.bin", { method: "POST", body })
      }
      await call(namespace, name, "/alarm/set?in=100")

      await call(namespace, name, "/destroy")

      // The same name is a new, empty actor: no rows, no blobs, and the alarm never fires.
      expect((await call<{ value: string | null }>(namespace, name, "/get?key=k")).value).toBe(null)
      expect(await call(namespace, name, "/blob/list?prefix=")).toEqual({ keys: [] })
      expect(
        (await call<{ pending: number | null }>(namespace, name, "/alarm/pending")).pending,
      ).toBe(null)
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect((await call<{ fired: unknown[] }>(namespace, name, "/alarm/fired")).fired).toEqual([])
      // And nobody else's.
      expect((await call<{ value: string }>(namespace, other, "/get?key=k")).value).toBe("kept")
      expect(await call(namespace, other, "/blob/list?prefix=")).toEqual({
        keys: ["library/a.bin"],
      })
    })

    it("stores, lists and deletes blobs", async () => {
      const namespace = options.namespace()
      const name = options.uniqueName()
      const body = new Uint8Array([0, 255, 7])
      await call(namespace, name, "/blob/put?key=library/a%20b.bin", {
        method: "POST",
        body,
        headers: { "content-type": "application/x-test" },
      })
      await call(namespace, name, "/blob/put?key=library/c.txt", { method: "POST", body })
      await call(namespace, name, "/blob/put?key=other/d.txt", { method: "POST", body })
      expect(await call(namespace, name, "/blob/get?key=library/a%20b.bin")).toEqual({
        found: true,
        size: 3,
        contentType: "application/x-test",
        bytes: [0, 255, 7],
      })
      expect(await call(namespace, name, "/blob/list?prefix=library/")).toEqual({
        keys: ["library/a b.bin", "library/c.txt"],
      })
      await call(namespace, name, "/blob/delete?key=library/c.txt")
      expect(await call(namespace, name, "/blob/get?key=library/c.txt")).toEqual({ found: false })
    })

    it("streams a response body through the stub", async () => {
      const response = await options
        .namespace()
        .get(options.uniqueName())
        .fetch(new Request("http://actor/stream"))
      expect(await response.text()).toBe("data: 0\n\ndata: 1\n\ndata: 2\n\n")
    })
  })
}

/** Behavior every `AppDatabase` must have. */
export function registerAppDatabaseConformance(
  runner: TestRunner,
  label: string,
  open: () => Promise<AppDatabase>,
): void {
  const { describe, it, expect } = runner
  describe(`${label}: app database`, () => {
    it("runs statements and reads rows", async () => {
      const db = await open()
      await db.run("DROP TABLE IF EXISTS things")
      await db.run("CREATE TABLE things (id TEXT PRIMARY KEY, n INTEGER, data BLOB)")
      await db.run("INSERT INTO things (id, n, data) VALUES (?, ?, ?)", "a", 1, new Uint8Array([9]))
      await db.run("INSERT INTO things (id, n, data) VALUES (?, ?, ?)", "b", 2, null)
      expect(await db.get<{ n: number }>("SELECT n FROM things WHERE id = ?", "a")).toEqual({
        n: 1,
      })
      expect(await db.get("SELECT n FROM things WHERE id = ?", "missing")).toBe(undefined)
      expect(await db.all<{ id: string }>("SELECT id FROM things ORDER BY id")).toEqual([
        { id: "a" },
        { id: "b" },
      ])
    })

    it("applies a batch atomically", async () => {
      const db = await open()
      await db.run("DROP TABLE IF EXISTS things")
      await db.run("CREATE TABLE things (id TEXT PRIMARY KEY)")
      await db.batch([
        { sql: "INSERT INTO things (id) VALUES (?)", params: ["a"] },
        { sql: "INSERT INTO things (id) VALUES (?)", params: ["b"] },
      ])
      let failed = false
      try {
        await db.batch([
          { sql: "INSERT INTO things (id) VALUES (?)", params: ["c"] },
          { sql: "INSERT INTO things (id) VALUES (?)", params: ["a"] },
        ])
      } catch {
        failed = true
      }
      expect(failed).toBe(true)
      expect((await db.all("SELECT id FROM things")).length).toBe(2)
    })
  })
}
