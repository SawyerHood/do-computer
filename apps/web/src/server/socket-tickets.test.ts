import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openNodeAppDatabase } from "@do-computer/runtime/node"
import { afterEach, describe, expect, it, vi } from "vitest"
import { readConfig } from "./platform.ts"

const ORIGIN = "http://dc.test"
const CLIENT = "http://127.0.0.1:8766"

/** The platform: a deployment of its own on disk, with one client app from elsewhere. */
const world = vi.hoisted(() => ({ opened: undefined as unknown }))
vi.mock("#platform", () => ({
  getPlatform: () => {
    const { database, app } = world.opened as ReturnType<typeof openNodeAppDatabase>
    return {
      target: "node",
      config: readConfig({
        DC_BASE_URL: ORIGIN,
        DC_AUTH_SECRET: "a secret that is long enough for this test",
        DC_CLIENT_ORIGINS: CLIENT,
        DC_SIGNUP: "open",
        DC_SANDBOX: "just-bash",
      }),
      db: app,
      authDatabase: database,
    }
  },
}))
world.opened = openNodeAppDatabase(join(mkdtempSync(join(tmpdir(), "dc-tickets-")), "app.sqlite"))

const { getAuth, socketUser } = await import("./auth.ts")
const { MOST_TICKETS, SOCKET_TICKET_SECONDS } = await import("./socket-tickets.ts")

const ask = async (path: string, init: { headers?: Record<string, string>; body?: unknown }) =>
  (await getAuth()).handler(
    new Request(`${ORIGIN}/api/auth${path}`, {
      method: "POST",
      headers: { origin: CLIENT, "content-type": "application/json", ...init.headers },
      body: JSON.stringify(init.body ?? {}),
    }),
  )

let made = 0
/** Someone signs up from the client app, which keeps the session it is handed. */
async function person() {
  const email = `person-${++made}@example.com`
  const response = await ask("/sign-up/email", {
    body: { name: "Ada", email, password: "correct horse battery" },
  })
  expect(response.status).toBe(200)
  const bearer = response.headers.get("set-auth-token")!
  const cookie = response.headers
    .getSetCookie()
    .map((line) => line.split(";")[0]!)
    .join("; ")
  const { user } = (await response.json()) as { user: { id: string } }
  return { id: user.id, bearer, cookie }
}

async function tickets(bearer: string, count?: number): Promise<string[]> {
  const response = await ask("/socket/tickets", {
    headers: { authorization: `Bearer ${bearer}` },
    body: count === undefined ? {} : { count },
  })
  expect(response.status).toBe(200)
  return ((await response.json()) as { tickets: string[] }).tickets
}

/** A socket's request, from `origin` (none for a client that is no page). */
const socket = (query: string, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/api/agents/a1/socket${query}`, {
    headers: { upgrade: "websocket", ...headers },
  })

const kept = async () =>
  (world.opened as ReturnType<typeof openNodeAppDatabase>).database
    .prepare("SELECT identifier, value FROM verification WHERE identifier LIKE 'socket-ticket:%'")
    .all()

describe("socket tickets", () => {
  afterEach(() => vi.useRealTimers())

  it("are given for the session a request carries, and none of them is kept", async () => {
    const ada = await person()
    const given = await tickets(ada.bearer, 3)
    expect(given).toHaveLength(3)
    expect(new Set(given).size).toBe(3)
    for (const ticket of given) expect(ticket).toMatch(/^[A-Za-z0-9_-]{32}$/)
    const rows = JSON.stringify(await kept())
    for (const ticket of given) expect(rows).not.toContain(ticket)
    // Nor is the session's token: only which session it is.
    expect(rows).not.toContain(ada.bearer.split(".")[0])
    expect(await tickets(ada.bearer)).toHaveLength(1)
  })

  it("open one socket each, as whoever asked for them", async () => {
    const ada = await person()
    const [ticket] = await tickets(ada.bearer)
    expect((await socketUser(socket(`?ticket=${ticket}`, { origin: CLIENT })))?.id).toBe(ada.id)
    expect(await socketUser(socket(`?ticket=${ticket}`, { origin: CLIENT }))).toBeUndefined()
  })

  it("open one socket between two that bring the same one at once", async () => {
    const ada = await person()
    const [ticket] = await tickets(ada.bearer)
    const both = await Promise.all([
      socketUser(socket(`?ticket=${ticket}`, { origin: CLIENT })),
      socketUser(socket(`?ticket=${ticket}`, { origin: CLIENT })),
    ])
    expect(both.filter((user) => user !== undefined)).toHaveLength(1)
  })

  it("are taken from the app, a client app it names and a client with no page, not from a page elsewhere", async () => {
    const ada = await person()
    const [a, b, c, d] = await tickets(ada.bearer, 4)
    expect(await socketUser(socket(`?ticket=${a}`, { origin: "http://evil.test" }))).toBeUndefined()
    // Turned away before it was used: it still opens a socket from the client app.
    expect((await socketUser(socket(`?ticket=${a}`, { origin: CLIENT })))?.id).toBe(ada.id)
    expect((await socketUser(socket(`?ticket=${b}`, { origin: ORIGIN })))?.id).toBe(ada.id)
    expect((await socketUser(socket(`?ticket=${c}`)))?.id).toBe(ada.id)
    expect(await socketUser(socket(`?ticket=${d}x`, { origin: CLIENT }))).toBeUndefined()
    expect(await socketUser(socket("?ticket=", { origin: CLIENT }))).toBeUndefined()
  })

  it("go when they are old, and with the session they were asked with", async () => {
    const ada = await person()
    const [late] = await tickets(ada.bearer, 2)
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(Date.now() + SOCKET_TICKET_SECONDS * 1000 + 1)
    expect(await socketUser(socket(`?ticket=${late}`, { origin: CLIENT }))).toBeUndefined()
    // Asking for more clears away every one that ran out, this test's and the others'.
    const [after] = await tickets(ada.bearer)
    expect(await kept()).toHaveLength(1)
    vi.useRealTimers()

    const out = await ask("/sign-out", { headers: { authorization: `Bearer ${ada.bearer}` } })
    expect(out.status).toBe(200)
    expect(await socketUser(socket(`?ticket=${after}`, { origin: CLIENT }))).toBeUndefined()
  })

  it("are given to nobody who is not signed in, and only a few at a time", async () => {
    const response = await ask("/socket/tickets", {})
    expect(response.status).toBe(401)
    const ada = await person()
    for (const count of [0, MOST_TICKETS + 1, 1.5, "2"]) {
      const refused = await ask("/socket/tickets", {
        headers: { authorization: `Bearer ${ada.bearer}` },
        body: { count },
      })
      expect(refused.status).toBe(400)
    }
    expect(await tickets(ada.bearer, MOST_TICKETS)).toHaveLength(MOST_TICKETS)
  })

  it("cannot be used up over HTTP: only the server does that", async () => {
    const ada = await person()
    const [ticket] = await tickets(ada.bearer)
    const response = await ask("/socket/redeem", { body: { ticket } })
    expect(response.status).toBe(404)
    expect((await socketUser(socket(`?ticket=${ticket}`, { origin: CLIENT })))?.id).toBe(ada.id)
  })
})

describe("a socket with no ticket", () => {
  it("is still taken on a cookie from the app itself only", async () => {
    const ada = await person()
    expect((await socketUser(socket("", { cookie: ada.cookie, origin: ORIGIN })))?.id).toBe(ada.id)
    expect(await socketUser(socket("", { cookie: ada.cookie, origin: CLIENT }))).toBeUndefined()
    expect(
      await socketUser(socket("", { cookie: ada.cookie, origin: "http://evil.test" })),
    ).toBeUndefined()
    // A bearer token is no ticket: a page cannot send one, and it never goes in a URL.
    expect(await socketUser(socket(`?ticket=${ada.bearer}`, { origin: CLIENT }))).toBeUndefined()
  })
})
