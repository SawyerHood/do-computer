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
