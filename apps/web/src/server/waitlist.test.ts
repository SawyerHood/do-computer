import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AppDatabase } from "@durable-computer/runtime"
import { openNodeAppDatabase } from "@durable-computer/runtime/node"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SessionUser } from "./auth.ts"
import { readConfig } from "./platform.ts"
import { migrateAppDatabase } from "./schema.ts"

const world = vi.hoisted(() => ({ db: undefined as unknown, env: {} as Record<string, string> }))

vi.mock("#platform", () => ({
  getPlatform: () => ({ target: "node", config: readConfig(world.env), db: world.db }),
}))

const { admit, isWaiting, letInByInvitation, listWaiting, vouchedFor, waitlistSince } =
  await import("./waitlist.ts")
const { isDeploymentAdmin } = await import("./model-access.ts")

let app: AppDatabase
let clock = 0

/** Someone makes an account, a moment after whoever did last; or so many seconds ago. */
async function account(id: string, verified = false, ago?: number): Promise<SessionUser> {
  const createdAt = new Date(Date.now() + (ago === undefined ? ++clock : -ago) * 1000)
  const email = `${id}@example.com`
  await app.run(
    "INSERT INTO user (id, name, email, createdAt) VALUES (?, ?, ?, ?)",
    id,
    id,
    email,
    createdAt.toISOString(),
  )
  return { id, name: id, email, emailVerified: verified, createdAt }
}

beforeEach(async () => {
  const directory = mkdtempSync(join(tmpdir(), "dc-waitlist-"))
  app = openNodeAppDatabase(join(directory, "app.sqlite")).app
  await migrateAppDatabase(app)
  await app.run("CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT, email TEXT, createdAt TEXT)")
  world.db = app
  world.env = { DC_SIGNUP: "waitlist" }
  clock = 0
})

describe("the waiting list", () => {
  it("is nobody's wait where the deployment has none", async () => {
    const ada = await account("ada")
    for (const signup of ["invite", "open"]) {
      world.env = { DC_SIGNUP: signup }
      expect(await isWaiting(ada)).toBe(false)
      expect(await listWaiting()).toEqual({ people: [], total: 0 })
    }
  })

  it("lets in whoever was here before there was one, and the first to come after", async () => {
    // Accounts from when sign-up was by invitation.
    const old = await account("old", false, 20)
    const older = await account("older", false, 30)
    await waitlistSince(app)
    expect(await isWaiting(old)).toBe(false)
    expect(await isWaiting(older)).toBe(false)
    // Whoever comes now waits, though they are not the first account there is.
    expect(await isWaiting(await account("ada"))).toBe(true)
  })

  it("has its first account as its owner, and everyone after waiting", async () => {
    await waitlistSince(app)
    const owner = await account("owner")
    const ada = await account("ada")
    const tomas = await account("tomas")
    expect(await isWaiting(owner)).toBe(false)
    expect(await isWaiting(ada)).toBe(true)
    expect(await isWaiting(tomas)).toBe(true)
    const { people, total } = await listWaiting()
    expect(total).toBe(2)
    expect(people.map((person) => person.id)).toEqual(["ada", "tomas"])
    expect(people[0]).toMatchObject({ name: "ada", email: "ada@example.com", dood: null })
  })

  it("reads when an account was made where its session does not say", async () => {
    await account("owner", false, 40)
    const old = await account("old", false, 30)
    await waitlistSince(app)
    const ada = await account("ada")
    expect(await isWaiting({ ...old, createdAt: undefined })).toBe(false)
    expect(await isWaiting({ ...ada, createdAt: undefined })).toBe(true)
    // An account there is no record of is taken as new.
    expect(await isWaiting({ ...ada, id: "nobody", createdAt: undefined })).toBe(true)
  })

  it("lets someone in for good once whoever looks after it says so", async () => {
    await waitlistSince(app)
    const owner = await account("owner")
    const ada = await account("ada")
    await app.run(
      `INSERT INTO dc_doods (id, name, color, seed, outfit, key_hash, owner_id, created_at)
       VALUES ('d1', 'Mossy', 'moss', 'abcd1234', '{}', 'x', 'ada', 1)`,
    )
    expect((await listWaiting()).people[0]?.dood).toEqual({
      id: "d1",
      name: "Mossy",
      color: "moss",
      seed: "abcd1234",
    })
    expect(await admit("nobody", owner)).toBe(false)
    expect(await admit(ada.id, owner)).toBe(true)
    expect(await isWaiting(ada)).toBe(false)
    expect(await listWaiting()).toEqual({ people: [], total: 0 })
    // Another process, which has kept nothing, finds the same written down.
    world.db = { ...app }
    expect(await isWaiting(ada)).toBe(false)
  })

  it("lets in the people a team has asked to join, and those who have", async () => {
    await waitlistSince(app)
    await account("owner")
    const invited = await account("invited")
    const joined = await account("joined")
    const linked = await account("linked")
    await app.run(
      `INSERT INTO dc_invitations (id, workspace_id, email, role, token_hash, invited_by, created_at, expires_at)
       VALUES ('i1', 'w1', ?, 'member', 'h1', 'owner', 0, ?)`,
      invited.email,
      Date.now() + 60_000,
    )
    await app.run(
      "INSERT INTO dc_members (workspace_id, user_id, role, created_at) VALUES ('w1', ?, 'member', 0)",
      joined.id,
    )
    expect(await isWaiting(invited)).toBe(false)
    expect(await isWaiting(joined)).toBe(false)
    // Someone who came by a link that names nobody waits until they have taken it up.
    expect(await isWaiting(linked)).toBe(true)
    await letInByInvitation(linked.id)
    expect(await isWaiting(linked)).toBe(false)
    expect((await listWaiting()).total).toBe(0)
  })

  it("lets in the addresses the deployment names, once they are known to be theirs", async () => {
    world.env = {
      DC_SIGNUP: "waitlist",
      DC_ADMIN_EMAILS: "boss@example.com",
      DC_ALLOWED_EMAILS: "friend@example.com",
    }
    await waitlistSince(app)
    await account("owner")
    // Anyone can sign up with any address: one that only says it is theirs waits like the rest,
    // and has no say in the deployment.
    const claimed = await account("boss")
    expect(await isWaiting(claimed)).toBe(true)
    expect(vouchedFor(claimed)).toBe(false)
    expect(isDeploymentAdmin(claimed)).toBe(false)
    const proven = { ...claimed, emailVerified: true }
    expect(await isWaiting(proven)).toBe(false)
    expect(isDeploymentAdmin(proven)).toBe(true)
    expect(await isWaiting({ ...(await account("friend")), emailVerified: true })).toBe(false)
    // Neither is shown as waiting, whatever they have proven.
    expect((await listWaiting()).people).toEqual([])
  })

  it("takes the first account for its owner, however it was made", async () => {
    world.env = { DC_SIGNUP: "waitlist", DC_ADMIN_EMAILS: "owner@example.com" }
    await waitlistSince(app)
    const owner = await account("owner")
    expect(await isWaiting(owner)).toBe(false)
    expect(isDeploymentAdmin(owner)).toBe(true)
  })
})
