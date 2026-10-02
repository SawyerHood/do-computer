import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openNodeAppDatabase } from "@durable-computer/runtime/node"
import { describe, expect, it } from "vitest"
import {
  isExpoPushToken,
  notifyOwner,
  preview,
  registerPushToken,
  sendPush,
  unregisterPushToken,
} from "./push.ts"
import { migrateAppDatabase } from "./schema.ts"

async function database() {
  const { app } = openNodeAppDatabase(join(mkdtempSync(join(tmpdir(), "dc-push-")), "app.sqlite"))
  await migrateAppDatabase(app)
  return app
}

const message = { title: "Juniper", body: "Done.", data: { agentId: "a1", chatId: "4" } }

describe("push notifications", () => {
  it("recognizes Expo push tokens and nothing else", () => {
    expect(isExpoPushToken("ExponentPushToken[abc123]")).toBe(true)
    expect(isExpoPushToken("ExpoPushToken[abc-123_x]")).toBe(true)
    expect(isExpoPushToken("https://example.com")).toBe(false)
    expect(isExpoPushToken(42)).toBe(false)
  })

  it("makes a one-line preview out of Markdown", () => {
    expect(preview("# Report\n\nAll **good**.\n```sh\nls\n```\nBye")).toBe("Report All good. Bye")
    expect(preview("x".repeat(400)).length).toBe(180)
  })

  it("sends to every device of the user, and only that user", async () => {
    const db = await database()
    await registerPushToken(db, "user-1", "ExpoPushToken[phone]", "ios")
    await registerPushToken(db, "user-1", "ExpoPushToken[tablet]", "android")
    await registerPushToken(db, "user-2", "ExpoPushToken[other]", "ios")
    let sent: { to: string; title: string; data: unknown }[] = []
    const delivered = await sendPush(db, "user-1", message, async (_url, init) => {
      sent = JSON.parse(String(init?.body))
      return Response.json({ data: sent.map(() => ({ status: "ok" })) })
    })
    expect(delivered).toBe(2)
    expect(sent.map((entry) => entry.to).sort()).toEqual([
      "ExpoPushToken[phone]",
      "ExpoPushToken[tablet]",
    ])
    expect(sent[0]).toMatchObject({ title: "Juniper", data: { agentId: "a1", chatId: "4" } })
  })

  it("forgets a device the push service says is gone", async () => {
    const db = await database()
    await registerPushToken(db, "user-1", "ExpoPushToken[old]", "ios")
    await registerPushToken(db, "user-1", "ExpoPushToken[new]", "ios")
    const reply = async (_url: unknown, init?: RequestInit) => {
      const batch = JSON.parse(String(init?.body)) as { to: string }[]
      return Response.json({
        data: batch.map((entry) =>
          entry.to === "ExpoPushToken[old]"
            ? { status: "error", details: { error: "DeviceNotRegistered" } }
            : { status: "ok" },
        ),
      })
    }
    expect(await sendPush(db, "user-1", message, reply as typeof fetch)).toBe(1)
    expect(await db.all("SELECT token FROM dc_push_tokens")).toEqual([
      { token: "ExpoPushToken[new]" },
    ])
  })

  it("moves a device to the account that registers it last, and lets only its owner remove it", async () => {
    const db = await database()
    await registerPushToken(db, "user-1", "ExpoPushToken[shared]", "ios")
    await registerPushToken(db, "user-2", "ExpoPushToken[shared]", "ios")
    await unregisterPushToken(db, "user-1", "ExpoPushToken[shared]")
    expect(await db.all("SELECT user_id FROM dc_push_tokens")).toEqual([{ user_id: "user-2" }])
    await unregisterPushToken(db, "user-2", "ExpoPushToken[shared]")
    expect(await db.all("SELECT user_id FROM dc_push_tokens")).toEqual([])
  })

  it("never throws, whatever the push service does", async () => {
    const db = await database()
    await registerPushToken(db, "user-1", "ExpoPushToken[phone]", "ios")
    const failing = async () => {
      throw new TypeError("network down")
    }
    expect(await sendPush(db, "user-1", message, failing as typeof fetch)).toBe(0)
    expect(
      await sendPush(db, "user-1", message, async () => new Response("no", { status: 500 })),
    ).toBe(0)
  })

  it("addresses an agent's owner, titled with the agent's name", async () => {
    const db = await database()
    await db.run("INSERT INTO dc_agents (id, owner_id, created_at) VALUES ('a1', 'user-1', 1)")
    await registerPushToken(db, "user-1", "ExpoPushToken[phone]", "ios")
    let sent: { title: string; body: string }[] = []
    const capture = async (_url: unknown, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body))
      return Response.json({ data: [{ status: "ok" }] })
    }
    await notifyOwner(
      db,
      "a1",
      "Juniper",
      { heading: "Morning brief", text: "Two meetings.", chatId: "7" },
      capture as typeof fetch,
    )
    expect(sent).toMatchObject([{ title: "Juniper", body: "Morning brief: Two meetings." }])
    sent = []
    await notifyOwner(
      db,
      "unknown-agent",
      null,
      { text: "x", chatId: null },
      capture as typeof fetch,
    )
    expect(sent).toEqual([])
  })
})
