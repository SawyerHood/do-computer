import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createModelAccessActor, DEPLOYMENT_MODEL_ACCESS } from "@do-computer/agent"
import {
  type ModelLogin,
  type ModelProvidersState,
  personalWorkspaceId,
} from "@do-computer/protocol"
import type { AppDatabase } from "@do-computer/runtime"
import { fileBlobs, NodeActorNamespace, openNodeAppDatabase } from "@do-computer/runtime/node"
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

const { answerModelLogin, listModelProviders, startModelLogin } = await import("./model-access.ts")
const { deploymentModels, offersModel, workspaceModels } = await import("./models.ts")
const { everyoneIsAdmin } = await import("./passwords-directory.ts")
const { createWorkspace } = await import("./teams.ts")

/** A model no provider's list has, as a deployment's settings would name it. */
const ADDED = "anthropic/claude-new-1"
const ENV = {
  DC_EXTRA_MODELS: `${ADDED}[1m]=claude-opus-5-5`,
  DC_ADMIN_EMAILS: "sawyer@example.com, maya@example.com",
}

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

let app: AppDatabase
let namespace: NodeActorNamespace
/** A team of the two admins, and one that has Jon in it as well. */
let admins: string
let mixed: string

beforeEach(async () => {
  const directory = mkdtempSync(join(tmpdir(), "dc-extra-models-web-"))
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
  world.db = app
  world.env = { ...ENV }
  const config = readConfig(world.env)
  namespace = new NodeActorNamespace({
    directory: join(directory, "model-access"),
    blobs: () => fileBlobs(join(directory, "blobs")),
    // As the platform makes them: the providers pi really has, and the models the settings add.
    factory: (host) =>
      createModelAccessActor(host, {
        extraModels: config.extraModels,
        showsExtraModels: () => everyoneIsAdmin(app, config, host.name),
      }),
  })
  world.modelAccess = namespace
  admins = await createWorkspace(app, { ...sawyer, image: null } as never, { name: "Admins" })
  mixed = await createWorkspace(app, { ...sawyer, image: null } as never, { name: "Mixed" })
  for (const [workspaceId, who] of [
    [admins, maya],
    [mixed, maya],
    [mixed, jon],
  ] as const) {
    await app.run(
      "INSERT INTO dc_members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'member', 0)",
      workspaceId,
      who.id,
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

/** Sign a workspace in to Anthropic with a key, as `who`. Keeping a key needs no network. */
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
}

const counted = async (who: SessionUser, workspaceId: string) =>
  (
    (await (await listModelProviders(who, workspaceId)).json()) as ModelProvidersState
  ).providers.find((provider) => provider.id === "anthropic")!.signedIn!.models

describe("a model the deployment's settings add", () => {
  it("is read from DC_EXTRA_MODELS", () => {
    expect(readConfig({}).extraModels).toEqual([])
    expect(
      readConfig({ DC_EXTRA_MODELS: ` ${ADDED}[1m] , openrouter/acme/new-2,` }).extraModels,
    ).toEqual([`${ADDED}[1m]`, "openrouter/acme/new-2"])
  })

  it("is offered where an admin signed their own workspace in to its provider", async () => {
    const mine = personalWorkspaceId(sawyer.id)
    // Not before the workspace is signed in to anything.
    expect(await offersModel(ADDED, mine)).toBe(false)
    await signIn(sawyer, mine)
    const offered = (await workspaceModels(mine)).find((option) => option.id === ADDED)
    const opus = (await workspaceModels(mine)).find(
      (option) => option.id === "anthropic/claude-opus-5-5",
    )!
    // Named as it was written, holding a million tokens, and otherwise as the model it names.
    expect(offered).toEqual({
      ...opus,
      id: ADDED,
      name: "claude-new-1",
      contextWindow: 1_000_000,
      recommended: undefined,
    })
    // A team of admins alone is offered it too.
    await signIn(maya, admins)
    expect(await offersModel(ADDED, admins)).toBe(true)
    expect(await counted(maya, admins)).toBe(await counted(sawyer, mine))
  })

  it("is not shown to anyone else, signed in to the same provider", async () => {
    const mine = personalWorkspaceId(sawyer.id)
    const theirs = personalWorkspaceId(jon.id)
    for (const [who, workspaceId] of [
      [sawyer, mine],
      [jon, theirs],
      [sawyer, mixed],
    ] as const) {
      await signIn(who, workspaceId)
    }
    expect(await offersModel(ADDED, theirs)).toBe(false)
    // A team with someone in it who is no admin: what its Doods run on, that person sees.
    expect(await offersModel(ADDED, mixed)).toBe(false)
    expect(await counted(jon, theirs)).toBe((await counted(sawyer, mine)) - 1)
    expect(await counted(sawyer, mixed)).toBe(await counted(jon, theirs))
    // Everything else the provider has is offered to them as it is to an admin.
    const ids = async (workspaceId: string) =>
      (await workspaceModels(workspaceId)).map((option) => option.id)
    expect(await ids(theirs)).toEqual((await ids(mine)).filter((id) => id !== ADDED))

    // The moment the other person leaves, the team is one of admins alone.
    await app.run("DELETE FROM dc_members WHERE workspace_id = ? AND user_id = ?", mixed, jon.id)
    expect(await offersModel(ADDED, mixed)).toBe(true)
  })

  it("is not offered by the deployment's own sign-in, which is everyone's", async () => {
    await signIn(sawyer, DEPLOYMENT_MODEL_ACCESS)
    const offered = (await deploymentModels()).options.map((option) => option.id)
    expect(offered).toContain("anthropic/claude-opus-5-5")
    expect(offered).not.toContain(ADDED)
    // Not to an admin either, until their own workspace is signed in.
    expect(await offersModel(ADDED, personalWorkspaceId(sawyer.id))).toBe(false)
  })
})
