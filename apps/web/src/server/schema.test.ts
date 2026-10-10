import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openNodeAppDatabase } from "@durable-computer/runtime/node"
import { describe, expect, it } from "vitest"
import { migrateAppDatabase, readMeta } from "./schema.ts"

function database() {
  return openNodeAppDatabase(join(mkdtempSync(join(tmpdir(), "dc-schema-")), "app.sqlite")).app
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
    await migrateAppDatabase(app, version - 1)
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
