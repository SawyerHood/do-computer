import type { Actor, ActorHost, ActorNamespace, AppDatabase } from "./index.ts"

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
  let ready: Promise<void> | undefined
  const prepare = () =>
    (ready ??= host.sql.exec(
      `CREATE TABLE IF NOT EXISTS conformance_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
       CREATE TABLE IF NOT EXISTS conformance_alarms (fired_at INTEGER NOT NULL, pending INTEGER) STRICT`,
    ))
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
  }
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
