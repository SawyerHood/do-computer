import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openNodeAppDatabase } from "@do-computer/runtime/node"
import { describe, expect, it } from "vitest"
import { migrateAppDatabase, readMeta } from "./schema.ts"

function database() {
  return openNodeAppDatabase(join(mkdtempSync(join(tmpdir(), "dc-schema-")), "app.sqlite")).app
}

/** The version of the schema at which a table is first there. */
async function versionAdding(table: string): Promise<number> {
  for (let version = 1; ; version++) {
    const app = database()
    await migrateAppDatabase(app, version)
    const there = await app.get("SELECT name FROM sqlite_master WHERE name = ?", table)
    if (there !== undefined) return version
    if (Number(await readMeta(app, "schema_version")) < version) {
      throw new Error(`No migration adds ${table}`)
    }
  }
}

describe("migrating the app database", () => {
  it("is done by several requests at once, each on its own", async () => {
    const app = database()
    await Promise.all([migrateAppDatabase(app), migrateAppDatabase(app), migrateAppDatabase(app)])
    const version = await readMeta(app, "schema_version")
    // Doing it again finds nothing left to do.
    await migrateAppDatabase(app)
    expect(await readMeta(app, "schema_version")).toBe(version)
    expect(Number(version)).toBeGreaterThan(0)
  })

  it("passes over a migration another request ran meanwhile", async () => {
    const app = database()
    let first = true
    const behind: typeof app = {
      ...app,
      batch: async (statements) => {
        if (first) {
          first = false
          // Another request gets there first, between this one reading the version and writing.
          await migrateAppDatabase(app)
        }
        return app.batch(statements)
      },
    }
    await migrateAppDatabase(behind)
    await expect(app.all("SELECT id FROM dc_agents")).resolves.toEqual([])
  })

  it("gives workspaces somewhere to keep what they choose, shown browsers by default", async () => {
    const latest = database()
    await migrateAppDatabase(latest)
    const version = Number(await readMeta(latest, "schema_version"))

    // A database from before workspaces chose anything, with a team and an agent in it.
    const app = database()
    await migrateAppDatabase(app, (await versionAdding("dc_workspace_settings")) - 1)
    await expect(app.all("SELECT * FROM dc_workspace_settings")).rejects.toThrow()
    await app.run(
      "INSERT INTO dc_workspaces (id, name, color, created_by, created_at) VALUES ('team', 'Tidewater', 'moss', 'sawyer', 1)",
    )
    await migrateAppDatabase(app)
    expect(await readMeta(app, "schema_version")).toBe(String(version))
    // Nothing is written for the workspaces there already: no row is a browser that is shown.
    await expect(app.all("SELECT * FROM dc_workspace_settings")).resolves.toEqual([])
    await expect(app.all("SELECT id FROM dc_workspaces")).resolves.toEqual([{ id: "team" }])
    await app.run("INSERT INTO dc_workspace_settings (workspace_id) VALUES ('personal:sawyer')")
    await expect(app.all("SELECT * FROM dc_workspace_settings")).resolves.toEqual([
      { workspace_id: "personal:sawyer", show_browser: 1 },
    ])
  })

  it("gives sites somewhere to be kept, and one place in a workspace one site", async () => {
    const app = database()
    await migrateAppDatabase(app, (await versionAdding("dc_sites")) - 1)
    await expect(app.all("SELECT * FROM dc_sites")).rejects.toThrow()
    await migrateAppDatabase(app)
    const share = (id: string, workspace: string) =>
      app.run(
        `INSERT INTO dc_sites (id, workspace_id, path, title, secret, created_at, updated_at)
         VALUES (?, ?, 'sites/plan', 'Plan', 's', 1, 1)`,
        id,
        workspace,
      )
    await share("a", "team")
    await share("b", "personal:sawyer")
    await expect(share("c", "team")).rejects.toThrow()
    // A site is the workspace's own until someone says otherwise.
    await expect(app.all("SELECT id, public FROM dc_sites ORDER BY id")).resolves.toEqual([
      { id: "a", public: 0 },
      { id: "b", public: 0 },
    ])
  })

  it("still fails when a migration cannot be run", async () => {
    const app = database()
    const broken: typeof app = {
      ...app,
      batch: async () => {
        throw new Error("no such luck")
      },
    }
    await expect(migrateAppDatabase(broken)).rejects.toThrow("no such luck")
  })
})
