import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createModelAccessActor } from "@durable-computer/agent"
import {
  type ModelLogin,
  type ModelOption,
  type ModelProvidersState,
  personalWorkspaceId,
} from "@durable-computer/protocol"
import { fileBlobs, NodeActorNamespace, openNodeAppDatabase } from "@durable-computer/runtime/node"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SessionUser } from "./auth.ts"
import { readConfig } from "./platform.ts"
import { migrateAppDatabase } from "./schema.ts"

/** What stands in for the platform: a real database, and real actors keeping the sign-ins. */
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
  answerModelLogin,
  getModelLogin,
  listModelProviders,
  removeModelSignInsOf,
  signOutOfModelProvider,
  startModelLogin,
} = await import("./model-access.ts")
const { defaultModelIn, listModels, workspaceModels } = await import("./models.ts")
const { defaultModelFor, updateSettings } = await import("./settings.ts")
const { createWorkspace } = await import("./teams.ts")

const person = (id: string): SessionUser =>
  ({
    id,
    name: id[0]!.toUpperCase() + id.slice(1),
    email: `${id}@example.com`,
    emailVerified: true,
  }) as SessionUser
const sawyer = person("sawyer")
const maya = person("maya")
const jon = person("jon")
const stranger = person("stranger")

let namespace: NodeActorNamespace
let team: string

beforeEach(async () => {
  const directory = mkdtempSync(join(tmpdir(), "dc-model-access-web-"))
  const { app } = openNodeAppDatabase(join(directory, "app.sqlite"))
  await migrateAppDatabase(app)
  await app.run("CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT, email TEXT, image TEXT)")
  for (const who of [sawyer, maya, jon]) {
    await app.run(
      "INSERT INTO user (id, name, email) VALUES (?, ?, ?)",
      who.id,
      who.name,
      who.email,
    )
  }
  namespace = new NodeActorNamespace({
    directory: join(directory, "model-access"),
    blobs: () => fileBlobs(join(directory, "blobs")),
    // The providers pi really has. Keeping a key for one needs no network.
    factory: (host) => createModelAccessActor(host),
  })
  world.db = app
  world.modelAccess = namespace
  world.env = {}
  // Sawyer's team, with Maya an admin of it and Jon a member.
  team = await createWorkspace(app, { ...sawyer, image: null } as never, { name: "Team" })
  for (const [who, role] of [
    [maya, "admin"],
    [jon, "member"],
  ] as const) {
    await app.run(
      "INSERT INTO dc_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, 0)",
      team,
      who.id,
      role,
    )
  }
})

afterEach(async () => {
  await namespace.close().catch(() => {})
})

const post = (body?: unknown) =>
  new Request("http://app/", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  })

/** Sign a workspace in to the provider with a key, as `who`. */
async function signIn(who: SessionUser, workspaceId: string) {
  const started = await startModelLogin(
    who,
    post({ providerId: "anthropic", type: "api_key" }),
    workspaceId,
  )
  expect(started.status).toBe(201)
  const { login } = (await started.json()) as { login: ModelLogin }
  const answered = await answerModelLogin(
    who,
    post({ promptId: login.prompt!.id, value: "sk-ant-test" }),
    workspaceId,
    login.id,
  )
  expect(((await answered.json()) as { login: ModelLogin }).login.status).toBe("done")
  return login
}

const signedIn = async (who: SessionUser, workspaceId: string) =>
  (
    (await (await listModelProviders(who, workspaceId)).json()) as ModelProvidersState
  ).providers.find((provider) => provider.id === "anthropic")!.signedIn

describe("signing a workspace in to a model provider", () => {
  it("is for the people in it, and nobody else", async () => {
    for (const response of [
      await listModelProviders(stranger, team),
      await startModelLogin(stranger, post({ providerId: "anthropic", type: "api_key" }), team),
      await signOutOfModelProvider(stranger, team, "anthropic"),
      await listModelProviders(maya, personalWorkspaceId(sawyer.id)),
    ]) {
      expect(response.status).toBe(404)
    }
    expect(await signedIn(jon, team)).toBeNull()
  })

  it("can be done by any member, whose sign-in only they can finish", async () => {
    const started = await startModelLogin(
      jon,
      post({ providerId: "anthropic", type: "api_key" }),
      team,
    )
    const { login } = (await started.json()) as { login: ModelLogin }
    // Maya is in the team, and it is still not hers to read or to answer.
    const read = await getModelLogin(maya, new Request("http://app/"), team, login.id)
    expect(read.status).toBe(404)
    const answered = await answerModelLogin(
      maya,
      post({ promptId: login.prompt!.id, value: "sk-maya" }),
      team,
      login.id,
    )
    expect(answered.status).toBe(404)
    expect(await signedIn(jon, team)).toBeNull()

    await signIn(jon, team)
    expect(await signedIn(sawyer, team)).toMatchObject({ type: "api_key", by: "Jon" })
    // Each workspace is signed in apart from the others.
    expect(await signedIn(jon, personalWorkspaceId(jon.id))).toBeNull()
  })

  it("is undone by whoever signed in or by an admin, and by them leaving", async () => {
    await signIn(maya, team)
    expect((await signOutOfModelProvider(jon, team, "anthropic")).status).toBe(403)
    expect(await signedIn(jon, team)).not.toBeNull()
    // Whoever signed in can, whatever they are in the team.
    expect((await signOutOfModelProvider(maya, team, "anthropic")).status).toBe(200)
    expect(await signedIn(jon, team)).toBeNull()
    expect((await signOutOfModelProvider(maya, team, "anthropic")).status).toBe(404)

    await signIn(jon, team)
    expect((await signOutOfModelProvider(sawyer, team, "anthropic")).status).toBe(200)

    await signIn(jon, team)
    await removeModelSignInsOf(maya.id, team)
    expect(await signedIn(sawyer, team)).not.toBeNull()
    await removeModelSignInsOf(jon.id, team)
    expect(await signedIn(sawyer, team)).toBeNull()
  })
})

describe("the models of a workspace", () => {
  const ids = (models: ModelOption[]) => models.map((option) => option.id)
  const listed = async (who: SessionUser, query = "") =>
    listModels(who, new Request(`http://app/api/models${query}`))

  it("are the deployment's and those it is signed in to", async () => {
    expect(ids(await workspaceModels(team))).toEqual(["echo/echo-1"])
    await signIn(jon, team)
    const inTeamNow = ids(await workspaceModels(team))
    expect(inTeamNow.slice(0, 3)).toEqual([
      "echo/echo-1",
      "anthropic/claude-sonnet-5-5",
      "anthropic/claude-opus-5-5",
    ])
    expect(ids(await workspaceModels(personalWorkspaceId(jon.id)))).toEqual(["echo/echo-1"])

    const inTeam = await listed(maya, `?workspaceId=${encodeURIComponent(team)}`)
    expect(ids(((await inTeam.json()) as { models: ModelOption[] }).models)).toContain(
      "anthropic/claude-haiku-5-5",
    )
    expect((await listed(stranger, `?workspaceId=${encodeURIComponent(team)}`)).status).toBe(404)
    // With no workspace named: every model a person could choose somewhere.
    const forMaya = ((await (await listed(maya)).json()) as { models: ModelOption[] }).models
    expect(ids(forMaya)).toEqual(inTeamNow)
    const forStranger = ((await (await listed(stranger)).json()) as { models: ModelOption[] })
      .models
    expect(ids(forStranger)).toEqual(["echo/echo-1"])
  })

  it("decide what a new agent there starts on", async () => {
    const own = personalWorkspaceId(jon.id)
    // A deployment with no key has only its echo, until a workspace signs in to something real.
    expect(await defaultModelIn(team)).toBe("echo/echo-1")
    await signIn(jon, team)
    expect(await defaultModelIn(team)).toBe("anthropic/claude-sonnet-5-5")
    expect(await defaultModelIn(own)).toBe("echo/echo-1")

    // A person's own choice holds where it can be had, and gives way where it cannot.
    const patch = (model: string) =>
      updateSettings(
        jon,
        new Request("http://app/", {
          method: "PATCH",
          body: JSON.stringify({ defaultModel: model }),
        }),
      )
    expect((await patch("anthropic/claude-haiku-5-5")).status).toBe(200)
    expect(await defaultModelFor(jon.id, team)).toBe("anthropic/claude-haiku-5-5")
    expect(await defaultModelFor(jon.id, own)).toBe("echo/echo-1")
    expect((await patch("nobody/has-this")).status).toBe(400)
    // Someone who is in no workspace that offers a model cannot choose it.
    const other = await updateSettings(
      stranger,
      new Request("http://app/", {
        method: "PATCH",
        body: JSON.stringify({ defaultModel: "anthropic/claude-haiku-5-5" }),
      }),
    )
    expect(other.status).toBe(400)
  })

  it("leave the deployment's own default alone where it has a key", async () => {
    world.env = { OPENROUTER_API_KEY: "sk-or-test" }
    vi.resetModules()
    const fresh = await import("./models.ts")
    await signIn(jon, team)
    expect(await fresh.defaultModelIn(team)).toBe("openrouter/anthropic/claude-sonnet-5.5")
    const models = await fresh.workspaceModels(team)
    expect(models[0]!.id).toBe("openrouter/anthropic/claude-sonnet-5.5")
    expect(models.some((option) => option.id === "anthropic/claude-sonnet-5-5")).toBe(true)
  })
})
