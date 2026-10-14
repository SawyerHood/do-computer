import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DEPLOYMENT_MODEL_ACCESS } from "@do-computer/agent"
import { personalWorkspaceId } from "@do-computer/protocol"
import type { ActorNamespace, AppDatabase } from "@do-computer/runtime"
import { openNodeAppDatabase } from "@do-computer/runtime/node"
import { beforeEach, describe, expect, it } from "vitest"
import { callDirectory, monthOf } from "./calls-directory.ts"
import { ConfigError, readConfig } from "./platform.ts"
import { migrateAppDatabase } from "./schema.ts"

const sawyer = { id: "sawyer", name: "Sawyer" }
const jon = { id: "jon", name: "Jon" }
const ADMINS = "sawyer@example.com"

/** What each keeper of sign-ins has, by its name and then by provider. */
let signedIn: Record<string, Record<string, unknown>>
let asked: string[]
let app: AppDatabase
let clock: number

const keepers = {
  get: (name: string) => ({
    fetch: async (request: Request) => {
      const provider = new URL(request.url).pathname.split("/").at(-1)!
      asked.push(`${name}/${provider}`)
      return Response.json({ credential: signedIn[name]?.[provider] ?? null })
    },
  }),
} as unknown as ActorNamespace

const settings = (env: Record<string, string> = {}) =>
  readConfig({ DC_ADMIN_EMAILS: ADMINS, ...env })
const directory = (env?: Record<string, string>) =>
  callDirectory(app, keepers, settings(env), () => clock)

const CODEX = { type: "oauth", access: "token-1", refresh: "r", expires: 0, accountId: "account-1" }
const KEY = { type: "api_key", key: "sk-1" }

beforeEach(async () => {
  const folder = mkdtempSync(join(tmpdir(), "dc-calls-web-"))
  ;({ app } = openNodeAppDatabase(join(folder, "app.sqlite")))
  await migrateAppDatabase(app)
  await app.run(
    "CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT, email TEXT, image TEXT, emailVerified INTEGER)",
  )
  for (const who of [sawyer, jon]) {
    await app.run(
      "INSERT INTO user (id, name, email, emailVerified) VALUES (?, ?, ?, 1)",
      who.id,
      who.name,
      `${who.id}@example.com`,
    )
  }
  await app.run(
    "INSERT INTO dc_agents (id, owner_id, workspace_id, created_at) VALUES ('agent-1', 'sawyer', NULL, 0)",
  )
  await app.run(
    "INSERT INTO dc_agents (id, owner_id, workspace_id, created_at) VALUES ('agent-2', 'sawyer', 'team-1', 0)",
  )
  signedIn = {}
  asked = []
  clock = Date.UTC(2026, 9, 14, 12)
})

describe("DC_CALLS and its limits", () => {
  it("keeps calls for admins unless told otherwise", () => {
    expect(readConfig({}).calls).toBe("admins")
    expect(readConfig({ DC_CALLS: "on" }).calls).toBe("on")
    expect(readConfig({ DC_CALLS: "off" }).calls).toBe("off")
    expect(() => readConfig({ DC_CALLS: "admin" })).toThrow(ConfigError)
    expect(() => readConfig({ DC_CALLS: "admin" })).toThrow(/DC_CALLS is "admin"/)
  })

  it("reads the lengths in minutes", () => {
    expect(readConfig({})).toMatchObject({
      callMinutes: 30,
      callMonthlyMinutes: 60,
      callScript: false,
    })
    expect(
      readConfig({ DC_CALL_MINUTES: "10", DC_CALL_MONTHLY_MINUTES: "0", DC_CALLS_SCRIPT: "1" }),
    ).toMatchObject({ callMinutes: 10, callMonthlyMinutes: 0, callScript: true })
    // What is not a number is as if unset, and a call is never no minutes long.
    expect(readConfig({ DC_CALL_MINUTES: "soon" }).callMinutes).toBe(30)
    expect(readConfig({ DC_CALL_MINUTES: "0" }).callMinutes).toBe(1)
  })
})

describe("who may call", () => {
  it("is the admins, where nothing says otherwise", async () => {
    signedIn[DEPLOYMENT_MODEL_ACCESS] = { openai: KEY }
    expect(await directory().allow("agent-1", jon)).toEqual({ refused: "admins" })
    expect(await directory().allow("agent-1", undefined)).toEqual({ refused: "admins" })
    expect(await directory().allow("agent-1", sawyer)).toMatchObject({
      pass: { dialect: "openai" },
    })
    // Nothing was asked of anyone's sign-ins for someone who may not call.
    asked = []
    await directory().allow("agent-1", jon)
    expect(asked).toEqual([])
  })

  it("is everyone, or nobody, where the deployment says", async () => {
    signedIn[DEPLOYMENT_MODEL_ACCESS] = { openai: KEY }
    expect(await directory({ DC_CALLS: "on" }).allow("agent-1", jon)).toMatchObject({
      pass: { dialect: "openai", paidBy: "server" },
    })
    expect(await directory({ DC_CALLS: "off" }).allow("agent-1", sawyer)).toEqual({
      refused: "off",
    })
  })

  it("does not take an address nobody vouched for as an admin's, where anyone can sign up", async () => {
    signedIn[DEPLOYMENT_MODEL_ACCESS] = { openai: KEY }
    await app.run("UPDATE user SET emailVerified = 0 WHERE id = 'sawyer'")
    expect(await directory({ DC_SIGNUP: "open" }).allow("agent-1", sawyer)).toEqual({
      refused: "admins",
    })
    expect(await directory().allow("agent-1", sawyer)).toMatchObject({ pass: {} })
  })
})

describe("which sign-in pays", () => {
  it("is the workspace's before the server's, and a subscription before a key", async () => {
    const mine = personalWorkspaceId("sawyer")
    signedIn[DEPLOYMENT_MODEL_ACCESS] = { "openai-codex": CODEX, openai: KEY }
    expect(await directory().allow("agent-1", sawyer)).toEqual({
      pass: { dialect: "codex", accessToken: "token-1", accountId: "account-1", paidBy: "server" },
      maxSeconds: 1_800,
      quietSeconds: 120,
    })
    signedIn[mine] = { openai: { type: "api_key", key: "sk-mine" } }
    expect(await directory().allow("agent-1", sawyer)).toMatchObject({
      pass: { dialect: "openai", apiKey: "sk-mine", paidBy: "workspace" },
    })
    signedIn[mine] = { "openai-codex": { ...CODEX, access: "token-mine" }, openai: KEY }
    expect(await directory().allow("agent-1", sawyer)).toMatchObject({
      pass: { dialect: "codex", accessToken: "token-mine", paidBy: "workspace" },
    })
    // A team's Dood asks the team, not the person.
    signedIn["team-1"] = { openai: { type: "api_key", key: "sk-team" } }
    expect(await directory().allow("agent-2", sawyer)).toMatchObject({
      pass: { apiKey: "sk-team", paidBy: "workspace" },
    })
  })

  it("is nothing that cannot place a call", async () => {
    // Signed in with ChatGPT the newer way: a token under `openai`, which no call route takes.
    signedIn[DEPLOYMENT_MODEL_ACCESS] = {
      openai: { type: "oauth", access: "a", refresh: "r", expires: 0 },
      anthropic: KEY,
      "openai-codex": { type: "oauth", access: "a", refresh: "r", expires: 0 },
    }
    expect(await directory().allow("agent-1", sawyer)).toEqual({ refused: "sign-in" })
    expect(await directory().allow("gone", sawyer)).toEqual({ refused: "sign-in" })
  })

  it("is a script where a test asks for one", async () => {
    const allowed = await directory({ DC_CALLS_SCRIPT: "1" }).allow("agent-1", sawyer)
    expect(allowed).toMatchObject({ pass: { dialect: "scripted", paidBy: "server" } })
    expect(asked).toEqual([])
  })
})

describe("the month's minutes", () => {
  it("are counted where the server pays, and run out", async () => {
    signedIn[DEPLOYMENT_MODEL_ACCESS] = { openai: KEY }
    const calls = directory({ DC_CALL_MONTHLY_MINUTES: "10" })
    expect(await calls.allow("agent-1", sawyer)).toMatchObject({ maxSeconds: 600 })
    await calls.spent("sawyer", 421)
    await calls.spent("sawyer", 0)
    await calls.spent(null, 500)
    // What is left of the month is the longest the next call can be.
    expect(await calls.allow("agent-1", sawyer)).toMatchObject({ maxSeconds: 179 })
    await calls.spent("sawyer", 179)
    expect(await calls.allow("agent-1", sawyer)).toEqual({ refused: "minutes" })
    expect(await app.all("SELECT * FROM dc_call_usage")).toEqual([
      { user_id: "sawyer", month: "2026-10", seconds: 600 },
    ])
    // A new month starts from nothing.
    clock = Date.UTC(2026, 10, 1)
    expect(monthOf(clock)).toBe("2026-11")
    expect(await calls.allow("agent-1", sawyer)).toMatchObject({ maxSeconds: 600 })
  })

  it("are not counted against a workspace that pays for itself, nor where there is no limit", async () => {
    signedIn[DEPLOYMENT_MODEL_ACCESS] = { openai: KEY }
    const none = directory({ DC_CALL_MONTHLY_MINUTES: "0", DC_CALL_MINUTES: "5" })
    await none.spent("sawyer", 100_000)
    expect(await none.allow("agent-1", sawyer)).toMatchObject({ maxSeconds: 300 })
    signedIn[personalWorkspaceId("sawyer")] = { openai: KEY }
    const limited = directory({ DC_CALL_MONTHLY_MINUTES: "1" })
    expect(await limited.allow("agent-1", sawyer)).toMatchObject({
      pass: { paidBy: "workspace" },
      maxSeconds: 1_800,
    })
  })
})
