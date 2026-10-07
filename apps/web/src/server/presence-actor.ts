import { readCaller } from "@durable-computer/agent"
import type { Presence, PresenceEvent, PresenceUpdate } from "@durable-computer/protocol"
import type { Actor, ActorHost } from "@durable-computer/runtime"

type Row = {
  socket: string
  user_id: string
  agent_id: string | null
  chat_id: string | null
  typing: number
}

const MAX_ID_CHARS = 100
const id = (value: unknown): string | null =>
  typeof value === "string" && value !== "" && value.length <= MAX_ID_CHARS ? value : null

/**
 * Who in a team is where, right now. One actor per team. Each open tab of each member holds a
 * WebSocket here and says which agent and chat it has open; every change is sent to all of them.
 *
 * Where each socket is lives in the actor's database and not in memory, because a runtime may
 * unload the actor while its sockets stay connected. The actor trusts its gateway, which has
 * checked that the caller is in the team.
 */
export function createPresenceActor(host: ActorHost): Actor {
  let ready: Promise<void> | undefined
  const prepare = () =>
    (ready ??= host.sql.exec(
      `CREATE TABLE IF NOT EXISTS dc_here (
        socket TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        agent_id TEXT,
        chat_id TEXT,
        typing INTEGER NOT NULL
      ) STRICT`,
    ))

  /** Everyone here. Rows whose socket has gone, as after a restart, are swept up on the way. */
  const here = async (closing?: string): Promise<Presence[]> => {
    const open = new Set(host.sockets().map((socket) => socket.id))
    if (closing !== undefined) open.delete(closing)
    const rows = await host.sql.all<Row>("SELECT * FROM dc_here ORDER BY rowid")
    const present: Presence[] = []
    for (const row of rows) {
      if (!open.has(row.socket)) {
        await host.sql.run("DELETE FROM dc_here WHERE socket = ?", row.socket)
        continue
      }
      present.push({
        userId: row.user_id,
        agentId: row.agent_id,
        chatId: row.chat_id,
        typing: row.typing === 1,
      })
    }
    return present
  }

  const send = (event: PresenceEvent, except?: string) => {
    const frame = JSON.stringify(event)
    for (const socket of host.sockets()) if (socket.id !== except) socket.send(frame)
  }

  return {
    async fetch(request) {
      await prepare()
      const { pathname } = new URL(request.url)
      if (request.method === "GET" && pathname === "/") {
        return Response.json({ here: await here() })
      }
      // Something about the team changed. Its open tabs fetch it again.
      if (request.method === "POST" && pathname === "/changed") {
        send({ type: "changed" })
        return Response.json({ ok: true })
      }
      // Someone is no longer in the team: their tabs are let go.
      if (request.method === "POST" && pathname === "/remove") {
        const { userId } = (await request.json().catch(() => ({}))) as { userId?: unknown }
        const rows = await host.sql.all<Row>(
          "SELECT * FROM dc_here WHERE user_id = ?",
          String(userId),
        )
        const theirs = new Set(rows.map((row) => row.socket))
        for (const socket of host.sockets()) {
          if (theirs.has(socket.id)) socket.close(4403, "No longer in this team")
        }
        await host.sql.run("DELETE FROM dc_here WHERE user_id = ?", String(userId))
        send({ type: "presence", here: await here() })
        return Response.json({ ok: true })
      }
      return Response.json({ error: "Not found" }, { status: 404 })
    },

    async alarm() {},

    async socketOpen(socket, request) {
      await prepare()
      const caller = readCaller(request)
      if (caller === undefined) {
        socket.close(4401, "Sign in first")
        return
      }
      await host.sql.run(
        `INSERT INTO dc_here (socket, user_id, agent_id, chat_id, typing) VALUES (?, ?, NULL, NULL, 0)
         ON CONFLICT (socket) DO UPDATE SET user_id = excluded.user_id, agent_id = NULL,
           chat_id = NULL, typing = 0`,
        socket.id,
        caller.id,
      )
      send({ type: "presence", here: await here() })
    },

    async socketMessage(socket, data) {
      await prepare()
      let update: PresenceUpdate
      try {
        update = JSON.parse(data) as PresenceUpdate
      } catch {
        return
      }
      if (update === null || typeof update !== "object") return
      const agentId = id(update.agentId)
      const chatId = agentId === null ? null : id(update.chatId)
      await host.sql.run(
        "UPDATE dc_here SET agent_id = ?, chat_id = ?, typing = ? WHERE socket = ?",
        agentId,
        chatId,
        chatId !== null && update.typing === true ? 1 : 0,
        socket.id,
      )
      send({ type: "presence", here: await here() })
    },

    async socketClose(socket) {
      await prepare()
      await host.sql.run("DELETE FROM dc_here WHERE socket = ?", socket.id)
      send({ type: "presence", here: await here(socket.id) }, socket.id)
    },
  }
}
