import { DatabaseSync } from "node:sqlite"
import { betterAuth } from "better-auth"
import { getMigrations } from "better-auth/db/migration"
import { afterEach, describe, expect, it, vi } from "vitest"
import { NO_SHARED_SCHEMA_CHECK, seedAuthStores } from "./auth-guard.ts"
import { desktopHandoff } from "./desktop-handoff.ts"
import { DEVICE_TOKEN_SECONDS, localOwner, NO_OWNER_YET, OWNER_REFUSED } from "./local-owner.ts"
import { LOCAL_OWNER_EMAIL } from "./platform.ts"

seedAuthStores()

const HERE = "http://127.0.0.1:4310"
const KEY = "the key only the app has"

/** A server as the desktop app runs one, or, with no key, as anyone else does. */
async function server({ ownerKey }: { ownerKey?: string } = { ownerKey: KEY }) {
  const database = new DatabaseSync(":memory:")
  const options = {
    secret: "a secret that is long enough for this test",
    baseURL: HERE,
    database: database as never,
    emailAndPassword: { enabled: true },
    advanced: NO_SHARED_SCHEMA_CHECK,
    plugins: [desktopHandoff(), localOwner(ownerKey)],
  }
  await (await getMigrations(options)).runMigrations()
  return { auth: betterAuth(options), database }
}

type Auth = Awaited<ReturnType<typeof server>>["auth"]

/** Ask as the app does: from no page, with no cookies. */
const post = (auth: Auth, path: string, body: unknown) =>
  auth.handler(
    new Request(`${HERE}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  )

/** The cookies a response sets, as the next request would send them. */
const cookies = (response: Response) =>
  new Headers({
    cookie: response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0]!)
      .join("; "),
  })

describe("the owner of a server the desktop app runs", () => {
  afterEach(() => vi.useRealTimers())

  it("is whoever the app says, from the first time it gives their name", async () => {
    const { auth, database } = await server()
    // Before anyone has said who they are there is nobody to sign in.
    const nobody = await post(auth, "/local/session", { key: KEY })
    expect(nobody.status).toBe(404)
    expect(((await nobody.json()) as { message: string }).message).toBe(NO_OWNER_YET)

    const first = await post(auth, "/local/session", { key: KEY, name: "  Sawyer  " })
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ ok: true, name: "Sawyer" })
    const session = await auth.api.getSession({ headers: cookies(first) })
    expect(session?.user).toMatchObject({ email: LOCAL_OWNER_EMAIL, name: "Sawyer" })

    // From then on the key alone signs the window in, as the same person whatever name is sent.
    const again = await post(auth, "/local/session", { key: KEY, name: "Somebody else" })
    expect(again.status).toBe(200)
    const later = await auth.api.getSession({ headers: cookies(again) })
    expect(later?.user.id).toBe(session?.user.id)
    expect(later?.user.name).toBe("Sawyer")
    expect(database.prepare("SELECT COUNT(*) AS n FROM user").get()).toEqual({ n: 1 })
  })

  it("is nobody without the key, and nobody at all on a server that was given none", async () => {
    const { auth, database } = await server()
    for (const body of [{ key: "a guess", name: "Mallory" }, { name: "Mallory" }, {}]) {
      const refused = await post(auth, "/local/session", body)
      expect(refused.status).toBeGreaterThanOrEqual(400)
      expect(refused.headers.getSetCookie()).toEqual([])
    }
    expect((await post(auth, "/local/token", { key: "a guess" })).status).toBe(403)
    expect(database.prepare("SELECT COUNT(*) AS n FROM user").get()).toEqual({ n: 0 })

    const elsewhere = await server({})
    for (const path of ["/local/session", "/local/token"]) {
      const refused = await post(elsewhere.auth, path, { key: KEY, name: "Mallory" })
      expect(refused.status).toBe(403)
      expect(((await refused.json()) as { message: string }).message).toBe(OWNER_REFUSED)
    }
  })

  it("signs another device in once, with a token the app asked for", async () => {
    const { auth, database } = await server()
    // There is no owner to sign a device in as until they have said who they are.
    expect((await post(auth, "/local/token", { key: KEY })).status).toBe(404)
    await post(auth, "/local/session", { key: KEY, name: "Sawyer" })

    const asked = await post(auth, "/local/token", { key: KEY })
    expect(asked.status).toBe(200)
    const { token, seconds } = (await asked.json()) as { token: string; seconds: number }
    expect(seconds).toBe(DEVICE_TOKEN_SECONDS)
    // What is kept is not the token.
    expect(JSON.stringify(database.prepare("SELECT * FROM verification").all())).not.toContain(
      token,
    )

    const phone = await post(auth, "/desktop/session", { token })
    expect(phone.status).toBe(200)
    const session = await auth.api.getSession({ headers: cookies(phone) })
    expect(session?.user.email).toBe(LOCAL_OWNER_EMAIL)
    expect((await post(auth, "/desktop/session", { token })).status).toBe(400)
  })

  it("gives a device as long as it says to use the token, and no longer", async () => {
    const { auth } = await server()
    await post(auth, "/local/session", { key: KEY, name: "Sawyer" })
    const { token } = (await (await post(auth, "/local/token", { key: KEY })).json()) as {
      token: string
    }
    vi.useFakeTimers({ now: Date.now() + (DEVICE_TOKEN_SECONDS + 1) * 1000, toFake: ["Date"] })
    expect((await post(auth, "/desktop/session", { token })).status).toBe(400)
  })
})
