import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createModelAccessActor, vault } from "@do-computer/agent"
import {
  personalWorkspaceId,
  type SavedLogin,
  type SavedLoginsState,
  type WorkspaceSummary,
} from "@do-computer/protocol"
import type { AppDatabase } from "@do-computer/runtime"
import { fileBlobs, NodeActorNamespace, openNodeAppDatabase } from "@do-computer/runtime/node"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SessionUser } from "./auth.ts"
import { ConfigError, readConfig } from "./platform.ts"
import { migrateAppDatabase } from "./schema.ts"

/** What stands in for the platform: a real database, and real actors keeping the logins. */
const world = vi.hoisted(() => ({
  db: undefined as unknown,
  modelAccess: undefined as unknown,
  env: {} as Record<string, string>,
}))

vi.mock("#platform", () => ({
  getPlatform: () => ({
    target: "node",
    config: readConfig(world.env),
    db: world.db,
    modelAccess: world.modelAccess,
  }),
}))

const {
  changeSavedLogin,
  listSavedCards,
  listSavedLogins,
  removeSavedCard,
  removeSavedLogin,
  saveCard,
  saveLogin,
} = await import("./passwords.ts")
const { hasSaved, hasSavedLogins, savedDirectory, withSavedLogins } =
  await import("./passwords-directory.ts")
const { createWorkspace, listWorkspaces } = await import("./teams.ts")

const PASSWORD = "a password nobody is shown"

const person = (id: string, verified = true): SessionUser =>
  ({
    id,
    name: id[0]!.toUpperCase() + id.slice(1),
    email: `${id}@example.com`,
    emailVerified: verified,
  }) as SessionUser
const sawyer = person("sawyer")
const maya = person("maya")
const jon = person("jon")
const ADMINS = "sawyer@example.com, Maya@Example.com"

let app: AppDatabase
let namespace: NodeActorNamespace
/** A team of the two admins, and one that has Jon in it as well. */
let admins: string
let mixed: string

const join2 = (workspaceId: string, who: SessionUser, role = "member") =>
  app.run(
    "INSERT INTO dc_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, 0)",
    workspaceId,
    who.id,
    role,
  )

beforeEach(async () => {
  const directory = mkdtempSync(join(tmpdir(), "dc-passwords-web-"))
  ;({ app } = openNodeAppDatabase(join(directory, "app.sqlite")))
  await migrateAppDatabase(app)
  await app.run(
    "CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT, email TEXT, image TEXT, emailVerified INTEGER)",
  )
  for (const who of [sawyer, maya, jon]) {
    await app.run(
      "INSERT INTO user (id, name, email, emailVerified) VALUES (?, ?, ?, 1)",
      who.id,
      who.name,
      who.email,
    )
  }
  namespace = new NodeActorNamespace({
    directory: join(directory, "model-access"),
    blobs: () => fileBlobs(join(directory, "blobs")),
    factory: (host) => createModelAccessActor(host, { providers: () => [], vaultKey: "a key" }),
  })
  world.db = app
  world.modelAccess = namespace
  world.env = { DC_ADMIN_EMAILS: ADMINS }
  admins = await createWorkspace(app, { ...sawyer, image: null } as never, { name: "Admins" })
  await join2(admins, maya, "admin")
  mixed = await createWorkspace(app, { ...sawyer, image: null } as never, { name: "Everyone" })
  await join2(mixed, maya)
  await join2(mixed, jon)
})

afterEach(async () => {
  await namespace.close().catch(() => {})
})

const request = (method: string, body?: unknown) =>
  new Request("http://app/", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const github = {
  name: "GitHub",
  username: "sawyer@example.com",
  password: PASSWORD,
  sites: ["github.com"],
}

async function saved(who: SessionUser, workspaceId: string): Promise<SavedLogin> {
  const response = await saveLogin(who, request("POST", github), workspaceId)
  expect(response.status).toBe(201)
  return ((await response.json()) as { login: SavedLogin }).login
}

const settings = (env: Record<string, string> = {}) =>
  readConfig({ DC_ADMIN_EMAILS: ADMINS, ...env })

describe("DC_SECRETS", () => {
  it("keeps saved logins for the admins unless it says otherwise", () => {
    expect(readConfig({}).secrets).toBe("admins")
    expect(readConfig({ DC_SECRETS: "" }).secrets).toBe("admins")
    expect(readConfig({ DC_SECRETS: "admins" }).secrets).toBe("admins")
    for (const on of ["on", "ON", "1", "true", "everyone"]) {
      expect(readConfig({ DC_SECRETS: on }).secrets).toBe("on")
    }
    for (const off of ["off", "OFF", "0", "false", "none"]) {
      expect(readConfig({ DC_SECRETS: off }).secrets).toBe("off")
    }
  })

  it("refuses a value it does not know, and does not take it for on", () => {
    expect(() => readConfig({ DC_SECRETS: "admin" })).toThrow(ConfigError)
    expect(() => readConfig({ DC_SECRETS: "yes" })).toThrow(/admins, on, off/)
  })

  it("seals with a key of its own where there is one, and with the session secret otherwise", () => {
    expect(readConfig({ DC_AUTH_SECRET: "sessions" }).secretsKey).toBe("sessions")
    expect(readConfig({ DC_AUTH_SECRET: "sessions", DC_SECRETS_KEY: "logins" }).secretsKey).toBe(
      "logins",
    )
    expect(readConfig({}).secretsKey).toBeUndefined()
  })
})

describe("which workspaces have saved logins", () => {
  it("is an admin's own, and a team of admins alone, where they are kept for admins", async () => {
    const config = settings()
    expect(await hasSavedLogins(app, config, personalWorkspaceId(sawyer.id))).toBe(true)
    expect(await hasSavedLogins(app, config, personalWorkspaceId(maya.id))).toBe(true)
    expect(await hasSavedLogins(app, config, admins)).toBe(true)
    // Jon is not an admin: nothing of his has them, and nor does a team he is in.
    expect(await hasSavedLogins(app, config, personalWorkspaceId(jon.id))).toBe(false)
    expect(await hasSavedLogins(app, config, mixed)).toBe(false)
    // Nor does a workspace there is not, or one of somebody there is no account of.
    expect(await hasSavedLogins(app, config, "no-such-team")).toBe(false)
    expect(await hasSavedLogins(app, config, personalWorkspaceId("nobody"))).toBe(false)
  })

  it("stops being one the moment someone who is not an admin joins", async () => {
    const config = settings()
    expect(await hasSavedLogins(app, config, admins)).toBe(true)
    await join2(admins, jon)
    expect(await hasSavedLogins(app, config, admins)).toBe(false)
  })

  it("is no workspace at all where nobody is named an admin", async () => {
    const config = readConfig({})
    expect(await hasSavedLogins(app, config, personalWorkspaceId(sawyer.id))).toBe(false)
    expect(await hasSavedLogins(app, config, admins)).toBe(false)
  })

  it("does not take an address nobody vouched for as an admin's, where anyone can sign up", async () => {
    await app.run("UPDATE user SET emailVerified = 0 WHERE id = ?", sawyer.id)
    const mine = personalWorkspaceId(sawyer.id)
    expect(await hasSavedLogins(app, settings({ DC_SIGNUP: "open" }), mine)).toBe(false)
    expect(await hasSavedLogins(app, settings({ DC_SIGNUP: "waitlist" }), mine)).toBe(false)
    // By invitation, whoever has the account was asked in under that address.
    expect(await hasSavedLogins(app, settings({ DC_SIGNUP: "invite" }), mine)).toBe(true)
    expect(await hasSavedLogins(app, settings(), mine)).toBe(true)
  })

  it("is every workspace where they are on for everyone, and none where they are off", async () => {
    for (const id of [personalWorkspaceId(jon.id), mixed, admins]) {
      expect(await hasSavedLogins(app, settings({ DC_SECRETS: "on" }), id)).toBe(true)
      expect(await hasSavedLogins(app, settings({ DC_SECRETS: "off" }), id)).toBe(false)
    }
  })

  it("marks the workspaces a person is shown as having them", async () => {
    const mark = async (who: SessionUser, env: Record<string, string> = {}) =>
      (
        await withSavedLogins(
          app,
          settings(env),
          await listWorkspaces(app, { ...who, image: null } as never),
        )
      ).map((workspace: WorkspaceSummary) => [workspace.name, workspace.savedLogins === true])
    expect(await mark(sawyer)).toEqual([
      ["Personal", true],
      ["Admins", true],
      ["Everyone", false],
    ])
    expect(await mark(jon)).toEqual([
      ["Personal", false],
      ["Everyone", false],
    ])
    expect(await mark(jon, { DC_SECRETS: "on" })).toEqual([
      ["Personal", true],
      ["Everyone", true],
    ])
    expect((await mark(sawyer, { DC_SECRETS: "off" })).every(([, has]) => has === false)).toBe(true)
  })
})

describe("where an agent finds its workspace's saved logins", () => {
  const agentIn = async (id: string, owner: SessionUser, workspaceId: string | null) =>
    app.run(
      "INSERT INTO dc_agents (id, owner_id, workspace_id, created_at) VALUES (?, ?, ?, 0)",
      id,
      owner.id,
      workspaceId,
    )

  it("is its workspace's vault where that has them, and nowhere otherwise", async () => {
    await agentIn("a-sawyer", sawyer, null)
    await agentIn("a-admins", sawyer, admins)
    await agentIn("a-mixed", sawyer, mixed)
    await agentIn("a-jon", jon, null)
    const find = savedDirectory(app, namespace, settings(), "passwords")
    expect(await find("a-sawyer")).toBeDefined()
    expect(await find("a-admins")).toBeDefined()
    expect(await find("a-mixed")).toBeUndefined()
    expect(await find("a-jon")).toBeUndefined()
    expect(await find("no-such-agent")).toBeUndefined()
    // What it is handed is the vault of that workspace and no other.
    const login = await saved(sawyer, admins)
    expect((await vault.list((await find("a-admins"))!)).map((entry) => entry.id)).toEqual([
      login.id,
    ])
    expect(await vault.list((await find("a-sawyer"))!)).toEqual([])
  })

  it("is nowhere for any agent where saved logins are off", async () => {
    await agentIn("a-sawyer", sawyer, null)
    const find = savedDirectory(app, namespace, settings({ DC_SECRETS: "off" }), "passwords")
    expect(await find("a-sawyer")).toBeUndefined()
  })

  it("is lost to a team's agents once someone who is not an admin is in it", async () => {
    await agentIn("a-admins", sawyer, admins)
    const find = savedDirectory(app, namespace, settings(), "passwords")
    expect(await find("a-admins")).toBeDefined()
    await join2(admins, jon)
    expect(await find("a-admins")).toBeUndefined()
  })
})

describe("the gateway to a workspace's saved logins", () => {
  it("lets an admin save one and see everything of it but the password", async () => {
    const login = await saved(sawyer, admins)
    expect(login).toMatchObject({ name: "GitHub", addedBy: { id: "sawyer", name: "Sawyer" } })
    const listed = await listSavedLogins(maya, admins)
    expect(listed.status).toBe(200)
    const text = await listed.text()
    expect((JSON.parse(text) as SavedLoginsState).logins).toHaveLength(1)
    expect(text).not.toContain(PASSWORD)
  })

  it("hands a password back through no route there is", async () => {
    const login = await saved(sawyer, admins)
    const changed = await changeSavedLogin(
      sawyer,
      request("PATCH", { password: "a new one", name: "GitHub (work)" }),
      admins,
      login.id,
    )
    const answers = [
      await (await listSavedLogins(sawyer, admins)).text(),
      await changed.text(),
      await (await removeSavedLogin(sawyer, admins, login.id)).text(),
    ]
    for (const answer of answers) {
      expect(answer).not.toContain(PASSWORD)
      expect(answer).not.toContain("a new one")
    }
  })

  it("answers as if there were no such thing to whoever is not in the workspace, or where it has none", async () => {
    const login = await saved(sawyer, admins)
    const every = async (who: SessionUser, workspaceId: string) => [
      (await listSavedLogins(who, workspaceId)).status,
      (await saveLogin(who, request("POST", github), workspaceId)).status,
      (await changeSavedLogin(who, request("PATCH", { name: "x" }), workspaceId, login.id)).status,
      (await removeSavedLogin(who, workspaceId, login.id)).status,
    ]
    // Jon is not in the team of admins.
    expect(await every(jon, admins)).toEqual([404, 404, 404, 404])
    // Nor may he have any of his own, or with the team he is in.
    expect(await every(jon, personalWorkspaceId(jon.id))).toEqual([404, 404, 404, 404])
    expect(await every(jon, mixed)).toEqual([404, 404, 404, 404])
    // An admin has none in a team that has someone else in it.
    expect(await every(sawyer, mixed)).toEqual([404, 404, 404, 404])
    // Nobody's workspace is reached by naming it.
    expect(await every(maya, personalWorkspaceId(sawyer.id))).toEqual([404, 404, 404, 404])
    // What was saved is still there, untouched.
    const { logins } = (await (await listSavedLogins(sawyer, admins)).json()) as SavedLoginsState
    expect(logins.map((entry) => entry.name)).toEqual(["GitHub"])
  })

  it("keeps what was saved, out of reach, while a workspace has lost them, and gives it back after", async () => {
    await saved(sawyer, admins)
    await join2(admins, jon)
    expect((await listSavedLogins(sawyer, admins)).status).toBe(404)
    await app.run("DELETE FROM dc_members WHERE workspace_id = ? AND user_id = ?", admins, jon.id)
    const { logins } = (await (await listSavedLogins(sawyer, admins)).json()) as SavedLoginsState
    expect(logins.map((entry) => entry.name)).toEqual(["GitHub"])
  })

  it("is shut to everyone where saved logins are off", async () => {
    await saved(sawyer, admins)
    world.env = { DC_ADMIN_EMAILS: ADMINS, DC_SECRETS: "off" }
    expect((await listSavedLogins(sawyer, admins)).status).toBe(404)
    expect((await saveLogin(sawyer, request("POST", github), admins)).status).toBe(404)
  })

  it("is open to anyone in a workspace where they are on for everyone", async () => {
    world.env = { DC_SECRETS: "on" }
    await saved(jon, mixed)
    expect((await listSavedLogins(maya, mixed)).status).toBe(200)
    // And still to nobody outside it.
    expect((await listSavedLogins(jon, admins)).status).toBe(404)
  })

  it("says what is wrong with a login that cannot be saved", async () => {
    const refused = await saveLogin(
      sawyer,
      request("POST", { ...github, sites: ["not a site"] }),
      admins,
    )
    expect(refused.status).toBe(400)
    expect(((await refused.json()) as { error: string }).error).toContain("is not a site")
  })
})

describe("cards", () => {
  const NUMBER = "4242424242424242"
  const visa = { number: "4242 4242 4242 4242", expMonth: 8, expYear: 2040, holder: "Sawyer Hood" }
  const withCards = { DC_ADMIN_EMAILS: ADMINS, DC_SECRET_KINDS: "passwords,cards" }

  it("are a kind a deployment names, and are not kept where it names passwords alone", () => {
    expect(readConfig({}).secretKinds).toEqual(["passwords"])
    expect(readConfig({ DC_SECRET_KINDS: "" }).secretKinds).toEqual(["passwords"])
    expect(readConfig({ DC_SECRET_KINDS: "passwords, Cards" }).secretKinds).toEqual([
      "passwords",
      "cards",
    ])
    expect(readConfig({ DC_SECRET_KINDS: "cards" }).secretKinds).toEqual(["cards"])
    expect(() => readConfig({ DC_SECRET_KINDS: "passwords,card" })).toThrow(ConfigError)
  })

  it("are had by the workspaces that have saved logins, once the deployment names them", async () => {
    const mine = personalWorkspaceId(sawyer.id)
    expect(await hasSaved(app, settings(), mine, "cards")).toBe(false)
    expect(await hasSaved(app, readConfig(withCards), mine, "cards")).toBe(true)
    expect(await hasSaved(app, readConfig(withCards), admins, "cards")).toBe(true)
    // Not by someone who is not an admin, nor by a team they are in.
    expect(await hasSaved(app, readConfig(withCards), personalWorkspaceId(jon.id), "cards")).toBe(
      false,
    )
    expect(await hasSaved(app, readConfig(withCards), mixed, "cards")).toBe(false)
    // Nor by anyone where all of it is off.
    expect(
      await hasSaved(app, readConfig({ ...withCards, DC_SECRETS: "off" }), mine, "cards"),
    ).toBe(false)
    // Named alone, they are kept without logins.
    const only = readConfig({ DC_ADMIN_EMAILS: ADMINS, DC_SECRET_KINDS: "cards" })
    expect(await hasSaved(app, only, mine, "cards")).toBe(true)
    expect(await hasSavedLogins(app, only, mine)).toBe(false)
    const marked = await withSavedLogins(
      app,
      readConfig(withCards),
      await listWorkspaces(app, { ...sawyer, image: null } as never),
    )
    expect(marked.map((workspace: WorkspaceSummary) => workspace.savedCards === true)).toEqual([
      true,
      true,
      false,
    ])
  })

  it("are found by an agent only where its workspace has them", async () => {
    await app.run(
      "INSERT INTO dc_agents (id, owner_id, workspace_id, created_at) VALUES ('a-sawyer', ?, NULL, 0)",
      sawyer.id,
    )
    expect(await savedDirectory(app, namespace, settings(), "cards")("a-sawyer")).toBeUndefined()
    expect(
      await savedDirectory(app, namespace, readConfig(withCards), "cards")("a-sawyer"),
    ).toBeDefined()
  })

  it("answer as if there were no such thing where the deployment does not name them", async () => {
    expect((await listSavedCards(sawyer, admins)).status).toBe(404)
    expect((await saveCard(sawyer, request("POST", visa), admins)).status).toBe(404)
  })

  it("are saved, listed with the last four digits and no more, and removed", async () => {
    world.env = withCards
    const made = await saveCard(sawyer, request("POST", visa), admins)
    expect(made.status).toBe(201)
    const listed = await listSavedCards(maya, admins)
    const text = await listed.text()
    const { cards } = JSON.parse(text) as { cards: { id: string; name: string; last4: string }[] }
    expect(cards).toMatchObject([{ name: "Visa ending 4242", last4: "4242" }])
    for (const answer of [await made.text(), text]) {
      expect(answer).not.toContain(NUMBER)
      expect(answer).not.toContain("4242 4242")
    }
    // Not for someone outside the workspace.
    expect((await listSavedCards(jon, admins)).status).toBe(404)
    expect((await removeSavedCard(jon, admins, cards[0]!.id)).status).toBe(404)
    expect((await removeSavedCard(sawyer, admins, cards[0]!.id)).status).toBe(200)
    expect(await (await listSavedCards(sawyer, admins)).json()).toEqual({ cards: [] })
  })

  it("say what is wrong with a number that is not a card's", async () => {
    world.env = withCards
    const refused = await saveCard(
      sawyer,
      request("POST", { ...visa, number: "1234 5678 9012 3456" }),
      admins,
    )
    expect(refused.status).toBe(400)
    expect(((await refused.json()) as { error: string }).error).toContain("not a card number")
  })
})
