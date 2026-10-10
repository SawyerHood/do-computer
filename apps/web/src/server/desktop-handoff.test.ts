import { DatabaseSync } from "node:sqlite"
import { betterAuth } from "better-auth"
import { getMigrations } from "better-auth/db/migration"
import { afterEach, describe, expect, it, vi } from "vitest"
import { NO_SHARED_SCHEMA_CHECK, seedAuthStores } from "./auth-guard.ts"
import { DESKTOP_TOKEN_REFUSED, DESKTOP_TOKEN_SECONDS, desktopHandoff } from "./desktop-handoff.ts"

seedAuthStores()

const ORIGIN = "http://localhost"

/** A deployment of its own, set up as the app sets Better Auth up, with one account signed in. */
async function deployment() {
  const database = new DatabaseSync(":memory:")
  const options = {
    secret: "a secret that is long enough for this test",
    baseURL: ORIGIN,
    database: database as never,
    emailAndPassword: { enabled: true },
    advanced: NO_SHARED_SCHEMA_CHECK,
    plugins: [desktopHandoff()],
  }
  await (await getMigrations(options)).runMigrations()
  const auth = betterAuth(options)
  const signedUp = await auth.api.signUpEmail({
    body: { name: "Sawyer", email: "owner@example.com", password: "correct horse battery" },
    asResponse: true,
  })
  return { auth, database, browser: cookies(signedUp) }
}

/** The cookies a response sets, as the next request would send them. */
function cookies(response: Response): Headers {
  const sent = response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0]!)
    .join("; ")
  return new Headers({ cookie: sent, origin: ORIGIN })
}

type Auth = Awaited<ReturnType<typeof deployment>>["auth"]

/** Ask over HTTP, as the page does. */
const post = (auth: Auth, path: string, headers: Headers, body?: unknown) =>
  auth.handler(
    new Request(`${ORIGIN}/api/auth${path}`, {
      method: "POST",
      headers: { ...Object.fromEntries(headers), "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    }),
  )

async function token(auth: Auth, browser: Headers): Promise<string> {
  const response = await post(auth, "/desktop/token", browser)
  expect(response.status).toBe(200)
  return ((await response.json()) as { token: string }).token
}

describe("signing in to the desktop app through the browser", () => {
  afterEach(() => vi.useRealTimers())

  it("gives the app a session of its own for whoever is signed in in the browser", async () => {
    const { auth, database, browser } = await deployment()
    const handed = await token(auth, browser)
    expect(handed).toMatch(/^[A-Za-z0-9_-]{32}$/)
    // What is kept is not the token.
    const kept = database.prepare("SELECT identifier, value FROM verification").all()
    expect(kept).toHaveLength(1)
    expect(JSON.stringify(kept)).not.toContain(handed)

    const exchanged = await post(auth, "/desktop/session", new Headers(), { token: handed })
    expect(exchanged.status).toBe(200)
    expect(await exchanged.json()).toEqual({ ok: true })
    const app = cookies(exchanged)
    expect(app.get("cookie")).toContain("session_token=")

    const inBrowser = await auth.api.getSession({ headers: browser })
    const inApp = await auth.api.getSession({ headers: app })
    expect(inApp?.user.email).toBe("owner@example.com")
    expect(inApp?.user.id).toBe(inBrowser?.user.id)
    expect(inApp?.session.id).not.toBe(inBrowser?.session.id)

    // Signing out of the app leaves the browser signed in.
    await auth.api.signOut({ headers: app })
    expect(await auth.api.getSession({ headers: app })).toBeNull()
    expect((await auth.api.getSession({ headers: browser }))?.user.id).toBe(inBrowser?.user.id)
  })

  it("takes a token once", async () => {
    const { auth, database, browser } = await deployment()
    const handed = await token(auth, browser)
    expect((await post(auth, "/desktop/session", new Headers(), { token: handed })).status).toBe(
      200,
    )
    const again = await post(auth, "/desktop/session", new Headers(), { token: handed })
    expect(again.status).toBe(400)
    expect(((await again.json()) as { message: string }).message).toBe(DESKTOP_TOKEN_REFUSED)
    expect(again.headers.getSetCookie()).toEqual([])
    expect(database.prepare("SELECT count(*) AS n FROM session").get()).toEqual({ n: 2 })
  })

  it("gives one session when a token is used twice at once", async () => {
    const { auth, browser } = await deployment()
    const handed = await token(auth, browser)
    const both = await Promise.all([
      post(auth, "/desktop/session", new Headers(), { token: handed }),
      post(auth, "/desktop/session", new Headers(), { token: handed }),
    ])
    expect(both.map((response) => response.status).sort()).toEqual([200, 400])
  })

  it("refuses a token that is too old, and one it never made", async () => {
    const { auth, database, browser } = await deployment()
    vi.useFakeTimers({ toFake: ["Date"] })
    const handed = await token(auth, browser)
    vi.setSystemTime(Date.now() + DESKTOP_TOKEN_SECONDS * 1000 + 1)
    const late = await post(auth, "/desktop/session", new Headers(), { token: handed })
    expect(late.status).toBe(400)
    expect(((await late.json()) as { message: string }).message).toBe(DESKTOP_TOKEN_REFUSED)
    // It is gone all the same.
    expect(database.prepare("SELECT count(*) AS n FROM verification").get()).toEqual({ n: 0 })

    const unknown = await post(auth, "/desktop/session", new Headers(), { token: "x".repeat(32) })
    expect(unknown.status).toBe(400)
    expect((await post(auth, "/desktop/session", new Headers(), {})).status).toBe(400)
  })

  it("gives no token to someone who is not signed in", async () => {
    const { auth, database } = await deployment()
    const response = await post(auth, "/desktop/token", new Headers({ origin: ORIGIN }))
    expect(response.status).toBe(401)
    expect(database.prepare("SELECT count(*) AS n FROM verification").get()).toEqual({ n: 0 })
  })
})
