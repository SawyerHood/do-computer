import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { personalWorkspaceId } from "@do-computer/protocol"
import type { ActorNamespace, AppDatabase } from "@do-computer/runtime"
import { openNodeAppDatabase } from "@do-computer/runtime/node"
import { describe, expect, it } from "vitest"
import { agentDirectory, agentsBeside, areBeside } from "./agent-directory.ts"
import { migrateAppDatabase } from "./schema.ts"

async function database(): Promise<AppDatabase> {
  const { app } = openNodeAppDatabase(
    join(mkdtempSync(join(tmpdir(), "dc-agent-directory-")), "app.sqlite"),
  )
  await migrateAppDatabase(app)
  return app
}

let made = 0
const agent = (db: AppDatabase, id: string, ownerId: string, workspaceId: string | null) =>
  db.run(
    "INSERT INTO dc_agents (id, owner_id, workspace_id, created_at) VALUES (?, ?, ?, ?)",
    id,
    ownerId,
    workspaceId,
    ++made,
  )

/** Agents that answer with their name and keep what they were handed. */
function fakeAgents(names: Record<string, string | null>) {
  const calls: { to: string; path: string; body: unknown }[] = []
  const answers = new Map<string, Response>()
  const namespace: ActorNamespace = {
    get: (to) => ({
      fetch: async (request: Request) => {
        const path = new URL(request.url).pathname
        if (request.method === "GET") {
          return names[to] === undefined
            ? Response.json({ error: "Agent is not initialized" }, { status: 409 })
            : Response.json({ agent: { id: to, name: names[to], tagline: null } })
        }
        calls.push({ to, path, body: await request.json() })
        return answers.get(path)?.clone() ?? Response.json({ threadId: "7", ok: true })
      },
    }),
  } as ActorNamespace
  return { namespace, calls, answers }
}

describe("the agents an agent can write to", () => {
  it("are the others in its workspace: one person's own, or a team's", async () => {
    const db = await database()
    await agent(db, "mine-1", "sawyer", personalWorkspaceId("sawyer"))
    await agent(db, "mine-2", "sawyer", personalWorkspaceId("sawyer"))
    // From before agents had a workspace: it is in its owner's own.
    await agent(db, "mine-old", "sawyer", null)
    await agent(db, "theirs", "maya", personalWorkspaceId("maya"))
    await agent(db, "team-1", "sawyer", "team-a")
    await agent(db, "team-2", "maya", "team-a")

    expect(await agentsBeside(db, "mine-1")).toEqual(["mine-2"])
    expect(await agentsBeside(db, "team-1")).toEqual(["team-2"])
    expect(await agentsBeside(db, "theirs")).toEqual([])
    expect(await agentsBeside(db, "nobody")).toEqual([])

    expect(await areBeside(db, "mine-1", "mine-2")).toBe(true)
    expect(await areBeside(db, "team-2", "team-1")).toBe(true)
    // Made by the same person, and still not in the same place.
    expect(await areBeside(db, "mine-1", "team-1")).toBe(false)
    expect(await areBeside(db, "mine-1", "theirs")).toBe(false)
    expect(await areBeside(db, "mine-1", "mine-1")).toBe(false)
    expect(await areBeside(db, "mine-1", "nobody")).toBe(false)
  })

  it("are looked up each time something is handed over", async () => {
    const db = await database()
    await agent(db, "ada", "sawyer", "team-a")
    await agent(db, "bo", "maya", "team-a")
    await agent(db, "egg", "maya", "team-a")
    await agent(db, "cy", "maya", "team-b")
    const { namespace, calls, answers } = fakeAgents({ ada: "Ada", bo: "Bo", cy: "Cy" })
    const directory = agentDirectory(db, () => namespace)
    const message = { id: "m1", chatId: "3", text: "Hello.", from: "Ada" }
    const reply = {
      id: "r1",
      chatId: "3",
      threadId: "7",
      outcome: "reported" as const,
      text: "Hi.",
      from: "Bo",
    }

    // One that cannot be asked its name is left out, and the rest are still listed.
    expect(await directory.list("ada")).toEqual([{ id: "bo", name: "Bo", tagline: null }])
    expect(await directory.send("ada", "bo", message)).toMatchObject({ threadId: "7" })
    expect(await directory.reply("bo", "ada", reply)).toBe(true)
    expect(calls).toEqual([
      { to: "bo", path: "/peers/ada/message", body: message },
      { to: "ada", path: "/peers/bo/reply", body: reply },
    ])

    // An agent somewhere else is not reached, whatever id is asked for.
    expect(await directory.send("ada", "cy", message)).toBeUndefined()
    expect(await directory.reply("cy", "ada", reply)).toBe(false)
    // Nor is one that has since been moved.
    await db.run("UPDATE dc_agents SET workspace_id = ? WHERE id = ?", "team-b", "bo")
    expect(await directory.send("ada", "bo", message)).toBeUndefined()
    expect(await directory.reply("bo", "ada", reply)).toBe(false)
    expect(calls).toHaveLength(2)

    // The chat that asked is gone: there is nowhere for the answer to go. Anything else that
    // goes wrong is worth another try.
    await db.run("UPDATE dc_agents SET workspace_id = ? WHERE id = ?", "team-a", "bo")
    answers.set("/peers/bo/reply", Response.json({ error: "Chat not found" }, { status: 404 }))
    expect(await directory.reply("bo", "ada", reply)).toBe(false)
    answers.set("/peers/bo/reply", Response.json({ error: "Busy" }, { status: 500 }))
    await expect(directory.reply("bo", "ada", reply)).rejects.toThrow("Busy")
  })
})
