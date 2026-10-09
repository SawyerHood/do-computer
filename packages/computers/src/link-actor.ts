import {
  type HelloFrame,
  parseFrame,
  REVOKED_CLOSE_CODE,
  SUPERSEDED_CLOSE_CODE,
} from "@durable-computer/protocol"
import type { Actor, ActorHost } from "@durable-computer/runtime"
import { LinkCore, type LinkCoreOptions, RemoteError, type RemoteErrorCode } from "./link-core.ts"

/** What the link knows about its computer between requests. */
export type LinkStatus = {
  online: boolean
  lastSeenAt: number | null
  hello: Omit<HelloFrame, "t"> | null
}

const STATUS: Partial<Record<RemoteErrorCode, number>> = {
  offline: 503,
  timeout: 504,
  not_found: 404,
  read_only: 403,
  permission_denied: 403,
  too_large: 413,
}

const json = (value: unknown, status = 200) => Response.json(value, { status })

/**
 * Holds one paired computer's connection and turns requests from an agent into frames to its
 * daemon. One actor per computer; it trusts its callers, which are the gateway (for the daemon's
 * socket, after checking its token) and agent actors.
 */
export function createComputerLinkActor(host: ActorHost, options?: LinkCoreOptions): Actor {
  // Only one socket is ever kept, so "the socket" is whichever is open.
  const core = new LinkCore((frame) => host.sockets()[0]?.send(frame) ?? false, options)
  let ready: Promise<void> | undefined
  const prepare = () =>
    (ready ??= host.sql.exec(
      "CREATE TABLE IF NOT EXISTS dc_link (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT",
    ))
  const get = async (key: string) =>
    (await host.sql.get<{ value: string }>("SELECT value FROM dc_link WHERE key = ?", key))?.value
  const set = (key: string, value: string) =>
    host.sql.run(
      "INSERT INTO dc_link (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      key,
      value,
    )
  const seen = () => set("last_seen", String(host.now()))

  const status = async (): Promise<LinkStatus> => {
    const [lastSeen, hello] = [await get("last_seen"), await get("hello")]
    return {
      online: host.sockets().length > 0,
      lastSeenAt: lastSeen === undefined ? null : Number(lastSeen),
      hello: hello === undefined ? null : JSON.parse(hello),
    }
  }

  return {
    async fetch(request) {
      await prepare()
      const url = new URL(request.url)
      try {
        if (request.method === "GET" && url.pathname === "/status") return json(await status())
        if (request.method !== "POST") return json({ error: "Not found" }, 404)
        switch (url.pathname) {
          case "/exec":
            return json(await core.exec(...execArguments(await request.json())))
          case "/job": {
            // A daemon from before there were jobs would not answer at all. One that is not
            // there is another matter, and is said to be offline as for anything else.
            if (host.sockets().length === 0) {
              throw new RemoteError("offline", "The computer is offline.")
            }
            if ((await status()).hello?.jobs !== true) {
              return json(
                {
                  error:
                    "The program that connects this computer is too old to keep a command running.",
                  code: "unsupported",
                },
                409,
              )
            }
            return json({ value: await core.job(await request.json()) })
          }
          case "/fs":
            return json({ value: await core.fs(await request.json()) })
          case "/read": {
            const { path } = (await request.json()) as { path: string }
            const bytes = await core.readFile(path)
            return new Response(bytes.slice().buffer, {
              headers: { "content-type": "application/octet-stream" },
            })
          }
          case "/write": {
            const path = url.searchParams.get("path")
            if (path === null) return json({ error: "path is required" }, 400)
            await core.writeFile(path, new Uint8Array(await request.arrayBuffer()))
            return json({ ok: true })
          }
          case "/revoke": {
            await set("revoked", "1")
            for (const socket of host.sockets()) {
              socket.send(JSON.stringify({ t: "revoked" }))
              socket.close(REVOKED_CLOSE_CODE, "This computer was removed")
            }
            return json({ ok: true })
          }
          default:
            return json({ error: "Not found" }, 404)
        }
      } catch (error) {
        if (error instanceof RemoteError) {
          return json({ error: error.message, code: error.code }, STATUS[error.code] ?? 502)
        }
        throw error
      }
    },

    async alarm() {},

    async socketOpen(socket) {
      await prepare()
      if ((await get("revoked")) === "1") {
        socket.send(JSON.stringify({ t: "revoked" }))
        socket.close(REVOKED_CLOSE_CODE, "This computer was removed")
        return
      }
      // A new connection from the same computer replaces any older one.
      for (const other of host.sockets()) {
        if (other.id !== socket.id)
          other.close(SUPERSEDED_CLOSE_CODE, "Replaced by a newer connection")
      }
      await seen()
    },

    async socketMessage(_socket, data) {
      await prepare()
      const hello = parseFrame<HelloFrame>(data)
      if (hello?.t === "hello") {
        const { t: _t, ...info } = hello
        await set("hello", JSON.stringify(info))
        await seen()
        return
      }
      core.onFrame(data)
    },

    async socketClose() {
      await prepare()
      await seen()
    },
  }
}

function execArguments(
  input: unknown,
): [string, { cwd?: string; env?: Record<string, string>; timeoutMs?: number }] {
  const { command, cwd, env, timeoutMs } = input as {
    command: string
    cwd?: string
    env?: Record<string, string>
    timeoutMs?: number
  }
  return [command, { cwd, env, timeoutMs }]
}
