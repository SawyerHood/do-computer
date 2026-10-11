import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SiteError } from "@durable-computer/agent"
import { MAX_SITES_PER_WORKSPACE, personalWorkspaceId } from "@durable-computer/protocol"
import type { AppDatabase } from "@durable-computer/runtime"
import { openNodeAppDatabase } from "@durable-computer/runtime/node"
import { describe, expect, it } from "vitest"
import { migrateAppDatabase } from "./schema.ts"
import {
  changeSite,
  shareSite,
  siteById,
  siteDirectory,
  sitesOf,
  stopSite,
} from "./site-directory.ts"

async function database(): Promise<AppDatabase> {
  const app = openNodeAppDatabase(join(mkdtempSync(join(tmpdir(), "dc-sites-")), "app.sqlite")).app
  await migrateAppDatabase(app)
  return app
}

const TEAM = "team-1"

describe("a workspace's sites", () => {
  it("share a place in the library once, at an address nobody could guess", async () => {
    const db = await database()
    const site = await shareSite(db, TEAM, { path: "sites/plan", title: "Launch plan" })
    expect(site).toMatchObject({ path: "sites/plan", title: "Launch plan", public: false })
    expect(site.id).toMatch(/^[a-z2-9]{16}$/)
    // Shared again, it is the same site, with the new title where one is given.
    expect(await shareSite(db, TEAM, { path: "sites/plan" })).toEqual(site)
    const renamed = await shareSite(db, TEAM, { path: "sites/plan", title: "  The   plan " })
    expect(renamed).toMatchObject({ id: site.id, title: "The plan" })
    // Another workspace sharing a place of the same name has a site of its own.
    const other = await shareSite(db, "team-2", { path: "sites/plan", title: "Theirs" })
    expect(other.id).not.toBe(site.id)
    expect((await sitesOf(db, TEAM)).map((entry) => entry.id)).toEqual([site.id])
  })

  it("say who shared each one", async () => {
    const db = await database()
    const byAgent = await shareSite(db, TEAM, { path: "a.html", title: "A", agentId: "agent-1" })
    const byPerson = await shareSite(db, TEAM, { path: "b.html", title: "B", userId: "sawyer" })
    expect(byAgent).toMatchObject({ agentId: "agent-1", userId: null })
    expect(byPerson).toMatchObject({ agentId: null, userId: "sawyer" })
  })

  it("stop an address working at once when a public site is closed again", async () => {
    const db = await database()
    const site = await shareSite(db, TEAM, { path: "sites/plan", title: "Plan" })
    const secret = async () => (await siteById(db, site.id))!.secret
    const first = await secret()
    expect((await changeSite(db, TEAM, site.id, { public: true }))!.public).toBe(true)
    // Opening it to more people leaves the addresses it already gave out working.
    expect(await secret()).toBe(first)
    expect((await changeSite(db, TEAM, site.id, { title: "The plan" }))!.public).toBe(true)
    expect(await secret()).toBe(first)
    expect((await changeSite(db, TEAM, site.id, { public: false }))!.public).toBe(false)
    expect(await secret()).not.toBe(first)
  })

  it("are changed and stopped only by the workspace they belong to", async () => {
    const db = await database()
    const site = await shareSite(db, TEAM, { path: "sites/plan", title: "Plan" })
    expect(await changeSite(db, "team-2", site.id, { public: true })).toBeUndefined()
    expect(await stopSite(db, "team-2", site.id)).toBe(false)
    expect((await siteById(db, site.id))!.public).toBe(0)
    expect(await stopSite(db, TEAM, site.id)).toBe(true)
    expect(await siteById(db, site.id)).toBeUndefined()
    expect(await stopSite(db, TEAM, site.id)).toBe(false)
  })

  it("are no more than a workspace can have", async () => {
    const db = await database()
    for (let n = 0; n < MAX_SITES_PER_WORKSPACE; n++) {
      await shareSite(db, TEAM, { path: `p${n}.html`, title: `P${n}` })
    }
    await expect(shareSite(db, TEAM, { path: "one-more.html", title: "X" })).rejects.toThrow(
      SiteError,
    )
    // One that is shared already is still answered for.
    expect((await shareSite(db, TEAM, { path: "p0.html" })).title).toBe("P0")
  })
})

describe("an agent's sites", () => {
  it("are those of the workspace it is in now", async () => {
    const db = await database()
    await db.run(
      "INSERT INTO dc_agents (id, owner_id, workspace_id, created_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?)",
      ...["agent-1", "sawyer", TEAM, 1],
      ...["agent-2", "sawyer", personalWorkspaceId("sawyer"), 2],
    )
    const directory = siteDirectory(db)
    const site = await directory.publish("agent-1", { path: "sites/plan", title: "Plan" })
    expect(site.agentId).toBe("agent-1")
    expect(await directory.list("agent-1")).toEqual([site])
    // An agent of another workspace neither sees it nor can change it.
    expect(await directory.list("agent-2")).toEqual([])
    expect(await directory.setPublic("agent-2", site.id, true)).toBeUndefined()
    expect(await directory.remove("agent-2", site.id)).toBe(false)
    expect((await directory.setPublic("agent-1", site.id, true))!.public).toBe(true)
    // Moved to the other workspace, it has that one's sites, which are none.
    await db.run("UPDATE dc_agents SET workspace_id = ? WHERE id = ?", "team-2", "agent-1")
    expect(await directory.list("agent-1")).toEqual([])
    await expect(directory.list("nobody")).rejects.toThrow(SiteError)
  })
})
