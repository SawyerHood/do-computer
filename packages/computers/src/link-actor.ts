import {
  type HelloFrame,
  parseFrame,
  REVOKED_CLOSE_CODE,
  SUPERSEDED_CLOSE_CODE,
} from "@do-computer/protocol"
import type { Actor, ActorHost } from "@do-computer/runtime"
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
  refused: 403,
  permission_denied: 403,
  too_large: 413,
}

const json = (value: unknown, status = 200) => Response.json(value, { status })
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A daemon that was told to update is not told again for this long. */
const TELL_EVERY_MS = 60_000
/** How long something that needs a newer daemon waits for the daemon to become one. */
const UPDATE_WAIT_MS = 20_000

export type LinkActorOptions = LinkCoreOptions & {
  /**
   * The daemon this deployment serves. With it, a daemon that is another is told to update
   * when it connects and whenever something is asked of it. Without it, only when something
   * is asked of it that it cannot do.
   */
  readonly daemonVersion?: () => Promise<string | undefined>
  readonly updateWaitMs?: number
}

/**
 * Holds one paired computer's connection and turns requests from an agent into frames to its
 * daemon. One actor per computer; it trusts its callers, which are the gateway (for the daemon's
 * socket, after checking its token) and agent actors.
 */
export function createComputerLinkActor(host: ActorHost, options?: LinkActorOptions): Actor {
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

  let toldAt = 0
  /** Tell the daemon to look for a newer one now. Resolves with whether it was there to tell. */
  const tell = (): boolean => {
    toldAt = host.now()
    return host.sockets()[0]?.send(JSON.stringify({ t: "update" })) ?? false
  }
  /** Tell a daemon that keeps itself up to date, and is not the one served, to catch up. */
  const tellIfBehind = async (hello: LinkStatus["hello"]) => {
    if (hello?.updates !== true || host.now() - toldAt < TELL_EVERY_MS) return
    const served = await options?.daemonVersion?.().catch(() => undefined)
    if (served !== undefined && hello.version !== served) tell()
  }
  /**
   * See that the daemon can do `ability`, which a newer one can. One that keeps itself up to
   * date is told to, and waited for: it is back in about a second unless the agent has it
   * busy. Resolves with why not, where it still cannot.
   */
  const able = async (
    ability: "jobs" | "screen" | "browser" | "signIn" | "pay",
  ): Promise<string | undefined> => {
    let hello = (await status()).hello
    // A daemon that knows of a thing says whether it may be used, and answers for itself why
    // not. One that says nothing of it is from before there was such a thing.
    const knows = (said: LinkStatus["hello"]) =>
      ability === "jobs" || ability === "signIn" || ability === "pay"
        ? said?.[ability] === true
        : said?.[ability] !== undefined
    if (knows(hello)) return undefined
    if (hello?.updates !== true || !tell()) {
      return "The program that connects this computer is too old for that, and does not update itself. Whoever the computer belongs to can run the install command from Computers there again."
    }
    const until = host.now() + (options?.updateWaitMs ?? UPDATE_WAIT_MS)
    while (host.now() < until) {
      await sleep(100)
      hello = (await status()).hello
      if (knows(hello) && host.sockets().length > 0) return undefined
    }
    return "The program that connects this computer is updating itself to be able to do that, and is not back yet. Try again in a minute."
  }

  return {
    async fetch(request) {
      await prepare()
      const url = new URL(request.url)
      try {
        if (request.method === "GET" && url.pathname === "/status") return json(await status())
        if (request.method !== "POST") return json({ error: "Not found" }, 404)
        // Being used is when being behind matters.
        if (url.pathname !== "/revoke" && url.pathname !== "/update") {
          void tellIfBehind((await status()).hello)
        }
        switch (url.pathname) {
          case "/update": {
            // Someone looked and saw that it is behind. Only one that updates itself is told.
            const hello = (await status()).hello
            return json({ told: hello?.updates === true && tell() })
          }
          case "/exec":
            return json(await core.exec(...execArguments(await request.json())))
          case "/job": {
            // A daemon from before there were jobs would not answer at all. One that is not
            // there is another matter, and is said to be offline as for anything else.
            if (host.sockets().length === 0) {
              throw new RemoteError("offline", "The computer is offline.")
            }
            const lacking = await able("jobs")
            if (lacking !== undefined) return json({ error: lacking, code: "unsupported" }, 409)
            return json({ value: await core.job(await request.json()) })
          }
          case "/screen":
          case "/browser": {
            const what = url.pathname === "/screen" ? "screen" : "browser"
            if (host.sockets().length === 0) {
              throw new RemoteError("offline", "The computer is offline.")
            }
            const asked = (await request.json()) as Record<string, unknown>
            // Signing in with a saved login is newer than the browser: one from before it
            // would not answer, and must never be sent a password it does not know to keep quiet.
            const signsIn = what === "browser" && (asked.op === "front" || asked.op === "sign_in")
            // Paying with a saved card is newer still, and a card is no more to be sent to one
            // that would not know to keep quiet about it.
            const pays = what === "browser" && asked.op === "pay"
            const lacking =
              (await able(what)) ??
              (signsIn ? await able("signIn") : pays ? await able("pay") : undefined)
            if (lacking !== undefined) return json({ error: lacking, code: "unsupported" }, 409)
            return json({ value: await core.use({ ...asked, t: what } as never) })
          }
          case "/fs":
            return json({ value: await core.fs(await request.json()) })
          case "/image": {
            if (host.sockets().length === 0) {
              throw new RemoteError("offline", "The computer is offline.")
            }
            // Not waited for to update, as a job is: the picture is read as it is meanwhile.
            if ((await status()).hello?.images !== true) {
              return json(
                { error: "This computer's program cannot prepare pictures.", code: "unsupported" },
                409,
              )
            }
            return json({ value: await core.image(await request.json()) })
          }
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
        // It asks for itself when it connects. This is for when that look did not get through.
        toldAt = 0
        await tellIfBehind(info)
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
