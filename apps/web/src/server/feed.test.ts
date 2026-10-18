import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { encodeCaller, CALLER_HEADER } from "@do-computer/agent"
import { type FeedEvent, personalWorkspaceId } from "@do-computer/protocol"
import type { ActorHost, ActorNamespace, ActorSocket, AppDatabase } from "@do-computer/runtime"
import { openNodeAppDatabase } from "@do-computer/runtime/node"
import { beforeEach, describe, expect, it } from "vitest"
import { tellPeopleOfAgent, tellPerson, typingIn } from "./feed.ts"
import { createFeedActor, createLiveActor } from "./presence-actor.ts"
import { migrateAppDatabase } from "./schema.ts"

let db: AppDatabase
/** What each feed was told, by the name of the actor it is. */
let told: Record<string, FeedEvent[]>
const feeds: ActorNamespace = {
  get: (name) => ({
    fetch: async (request) => {
      ;(told[name] ??= []).push((await request.json()) as FeedEvent)
      return Response.json({ ok: true })
    },
  }),
}

beforeEach(async () => {
  db = openNodeAppDatabase(join(mkdtempSync(join(tmpdir(), "dc-feed-")), "app.sqlite")).app
  await migrateAppDatabase(db)
  told = {}
  for (const [userId, role] of [
    ["sawyer", "owner"],
    ["maya", "member"],
  ] as const) {
    await db.run(
      "INSERT INTO dc_members (workspace_id, user_id, role, created_at) VALUES ('team-a', ?, ?, 1)",
      userId,
      role,
    )
  }
  await db.run(
    "INSERT INTO dc_agents (id, owner_id, workspace_id, created_at) VALUES ('shared', 'sawyer', 'team-a', 1)",
  )
  await db.run(
    "INSERT INTO dc_agents (id, owner_id, workspace_id, created_at) VALUES ('mine', 'sawyer', ?, 2)",
    personalWorkspaceId("sawyer"),
  )
})

describe("what an agent is up to is told to the people it works for", () => {
  const latest = { kind: "reply" as const, at: 5, text: "Done." }

  it("tells everyone in a team's agent's team, each on a feed of their own", async () => {
    await tellPeopleOfAgent(db, feeds, { agentId: "shared", latest, working: false, asking: false })
    const event = { type: "agent", agentId: "shared", latest, working: false, asking: false }
    expect(told).toEqual({ "personal:sawyer": [event], "personal:maya": [event] })
  })

  it("tells only its owner of an agent of their own, and nobody of one that is gone", async () => {
    await tellPeopleOfAgent(db, feeds, { agentId: "mine", working: true, asking: false })
    expect(told).toEqual({
      "personal:sawyer": [{ type: "agent", agentId: "mine", working: true, asking: false }],
    })
    await tellPeopleOfAgent(db, feeds, { agentId: "deleted", working: true, asking: false })
    expect(Object.keys(told)).toEqual(["personal:sawyer"])
  })

  it("never fails what caused it", async () => {
    const down: ActorNamespace = {
      get: () => ({ fetch: () => Promise.reject(new Error("unreachable")) }),
    }
    await expect(
      tellPerson(down, "sawyer", { type: "seen", agentId: "mine", seenAt: 1 }),
    ).resolves.toBeUndefined()
  })
})

describe("whether someone is typing in an agent's chat", () => {
  /** A team's presence that says who is where, and the names of the actors it was asked. */
  function presence(here: unknown[]) {
    const asked: string[] = []
    const namespace: ActorNamespace = {
      get: (name) => ({
        fetch: async () => {
          asked.push(name)
          return Response.json({ here })
        },
      }),
    }
    return { namespace, asked }
  }
  const someone = (more: object) => ({
    userId: "maya",
    agentId: "shared",
    chatId: "7",
    typing: true,
    ...more,
  })

  it("asks a team's presence, and is so only for someone typing in that very chat", async () => {
    const team = presence([someone({})])
    expect(await typingIn(db, team.namespace, "shared", "7")).toBe(true)
    expect(team.asked).toEqual(["team-a"])
    expect(await typingIn(db, team.namespace, "shared", "8")).toBe(false)
    const idle = presence([someone({ typing: false }), someone({ agentId: "other" })])
    expect(await typingIn(db, idle.namespace, "shared", "7")).toBe(false)
  })

  it("is never so in a personal workspace, whose presence is not asked", async () => {
    const team = presence([someone({ agentId: "mine" })])
    expect(await typingIn(db, team.namespace, "mine", "7")).toBe(false)
    expect(await typingIn(db, team.namespace, "deleted", "7")).toBe(false)
    expect(team.asked).toEqual([])
  })

  it("is not so where presence cannot be asked", async () => {
    const down: ActorNamespace = {
      get: () => ({ fetch: () => Promise.reject(new Error("unreachable")) }),
    }
    expect(await typingIn(db, down, "shared", "7")).toBe(false)
    const refusing: ActorNamespace = {
      get: () => ({ fetch: async () => new Response("no", { status: 500 }) }),
    }
    expect(await typingIn(db, refusing, "shared", "7")).toBe(false)
  })
})

describe("a person's feed", () => {
  /** A stand-in for the runtime: the sockets attached, and what each was sent. */
  function hosted(name: string) {
    const sent: Record<string, string[]> = {}
    const closed: Record<string, number | undefined> = {}
    const open: ActorSocket[] = []
    const socket = (id: string): ActorSocket => ({
      id,
      note: undefined,
      keep: () => {},
      send: (data) => ((sent[id] ??= []).push(data), true),
      close: (code) => void (closed[id] = code),
    })
    const host = { name, sockets: () => open } as unknown as ActorHost
    return { host, sent, closed, open, socket }
  }
  const tell = (event: FeedEvent) =>
    new Request("http://feed/tell", { method: "POST", body: JSON.stringify(event) })

  it("passes what it is told to every tab that is connected, as it came", async () => {
    const { host, sent, open, socket } = hosted("personal:sawyer")
    const feed = createFeedActor(host)
    open.push(socket("one"), socket("two"))
    const event: FeedEvent = { type: "seen", agentId: "mine", seenAt: 7 }
    expect((await feed.fetch(tell(event))).status).toBe(200)
    expect(sent).toEqual({ one: [JSON.stringify(event)], two: [JSON.stringify(event)] })
    // It has no other address.
    expect((await feed.fetch(new Request("http://feed/"))).status).toBe(404)
  })

  it("turns away a socket the gateway did not say who is behind", async () => {
    const { host, closed, socket } = hosted("personal:sawyer")
    const feed = createFeedActor(host)
    await feed.socketOpen?.(socket("anon"), new Request("http://feed/"))
    expect(closed).toEqual({ anon: 4401 })
    const known = new Request("http://feed/", {
      headers: { [CALLER_HEADER]: encodeCaller({ id: "sawyer", name: "Sawyer" }) },
    })
    await feed.socketOpen?.(socket("mine"), known)
    expect(closed).toEqual({ anon: 4401 })
  })

  it("is what is at a personal workspace's presence address, and a team's is its presence", async () => {
    const mine = createLiveActor(hosted("personal:sawyer").host)
    expect((await mine.fetch(tell({ type: "seen", agentId: "mine", seenAt: 1 }))).status).toBe(200)
    // A team's actor keeps who is where, and has no such address.
    expect(createLiveActor(hosted("team-a").host).socketMessage).toBeDefined()
    expect(mine.socketMessage).toBeUndefined()
  })
})
