/**
 * The Do Computer daemon. Run it on one of your own machines to let one of your agents work
 * there.
 *
 * The first run pairs: it prints a code and a link, you confirm while signed in and choose the
 * agent, and the daemon receives a token of its own. After that it keeps one outbound WebSocket
 * open; while that is connected, the agent can run commands and read and write files here.
 * Everything it does is printed and appended to an audit log. Stop the daemon to cut it off, or
 * remove the computer in the app.
 */
import { execFileSync } from "node:child_process"
import { appendFileSync, chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { DaemonCore } from "@durable-computer/computers/daemon"
import { nodeDaemonIO } from "@durable-computer/computers/node"
import {
  PING_FRAME,
  PONG_FRAME,
  REVOKED_CLOSE_CODE,
  SUPERSEDED_CLOSE_CODE,
} from "@durable-computer/protocol"
import WebSocket from "ws"
import { parseArguments } from "./args.ts"
import { serviceFile } from "./service.ts"

declare const DAEMON_VERSION: string
const VERSION = typeof DAEMON_VERSION === "string" ? DAEMON_VERSION : "dev"

const HOME = os.homedir()
const CONFIG_DIR = process.env.DC_DAEMON_DIR ?? path.join(HOME, ".durable-computer")
const CONFIG_PATH = path.join(CONFIG_DIR, "daemon.json")
const AUDIT_PATH = path.join(CONFIG_DIR, "audit.log")
const LOG_PATH = path.join(CONFIG_DIR, "daemon.log")

const PING_INTERVAL_MS = 30_000
const PONG_DEADLINE_MS = 15_000
const POLL_INTERVAL_MS = Number(process.env.DC_DAEMON_POLL_MS ?? 3_000)
const MAX_BACKOFF_MS = 30_000

type Config = { server: string; computerId: string; name: string; token: string; readOnly: boolean }

const log = (message: string) => console.log(`[${new Date().toISOString()}] ${message}`)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function loadConfig(): Config | undefined {
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Partial<Config>
    if (parsed.server && parsed.computerId && parsed.token && parsed.name) {
      return { readOnly: false, ...parsed } as Config
    }
  } catch {
    // Missing or unreadable: not paired.
  }
  return undefined
}

function saveConfig(config: Config): void {
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  chmodSync(CONFIG_PATH, 0o600)
}

async function post<T>(server: string, route: string, body: unknown): Promise<T> {
  const response = await fetch(`${server}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const failure = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(failure.error ?? `${route} answered ${response.status}`)
  }
  return (await response.json()) as T
}

async function pair(server: string, readOnly: boolean, name: string | undefined): Promise<Config> {
  for (;;) {
    const started = await post<{ code: string; pollToken: string; verifyUrl: string }>(
      server,
      "/api/computers/pair/start",
      { name, hostname: os.hostname(), platform: process.platform, home: HOME, readOnly },
    )
    log("This computer is not paired yet.")
    log(`Open ${started.verifyUrl}`)
    log(`and confirm the code ${started.code} while signed in. Waiting…`)
    for (;;) {
      await sleep(POLL_INTERVAL_MS)
      const result = await post<{
        status: "pending" | "approved" | "expired"
        computerId?: string
        name?: string
        token?: string
      }>(server, "/api/computers/pair/poll", { pollToken: started.pollToken }).catch(
        () => undefined,
      )
      if (result === undefined || result.status === "pending") continue
      if (result.status === "expired") {
        log("That code expired. Starting over.")
        break
      }
      const config: Config = {
        server,
        computerId: result.computerId!,
        name: result.name!,
        token: result.token!,
        readOnly,
      }
      saveConfig(config)
      log(`Paired as "${config.name}"${readOnly ? " (read-only)" : ""}.`)
      return config
    }
  }
}

function audit(entry: Record<string, unknown>): void {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true })
    appendFileSync(AUDIT_PATH, `${JSON.stringify(entry)}\n`)
  } catch {
    // The audit log must never stop the work it records.
  }
  const what =
    entry.kind === "exec"
      ? `ran (exit ${String(entry.exitCode)}, ${String(entry.ms)} ms): ${String(entry.command).slice(0, 200)}`
      : entry.kind === "refused"
        ? `refused to ${String(entry.what)}`
        : entry.kind === "job"
          ? `started: ${String(entry.command).slice(0, 200)}`
          : entry.kind === "job_stop"
            ? "stopped a command it had started"
            : `${String(entry.kind)} ${String(entry.path ?? "")}`
  log(what)
}

/** Keep one connection open for as long as the process lives. Resolves when it should exit. */
async function run(config: Config): Promise<void> {
  const url = `${config.server.replace(/^http/, "ws")}/api/computers/connect`
  let socket: WebSocket | undefined
  const core = new DaemonCore(
    nodeDaemonIO({ home: HOME, audit }),
    (frame) => {
      if (socket?.readyState !== WebSocket.OPEN) return false
      socket.send(frame)
      return true
    },
    { readOnly: config.readOnly },
  )

  let attempt = 0
  for (;;) {
    const closed = await new Promise<number>((resolve) => {
      const current = new WebSocket(url, { headers: { authorization: `Bearer ${config.token}` } })
      socket = current
      let pongDue: ReturnType<typeof setTimeout> | undefined
      const ping = setInterval(() => {
        if (current.readyState !== WebSocket.OPEN) return
        current.send(PING_FRAME)
        // No answer means the connection is dead even if the socket has not noticed.
        pongDue = setTimeout(() => current.terminate(), PONG_DEADLINE_MS)
      }, PING_INTERVAL_MS)
      const done = (code: number) => {
        clearInterval(ping)
        clearTimeout(pongDue)
        resolve(code)
      }
      current.on("open", () => {
        attempt = 0
        log(`Connected to ${config.server} as "${config.name}".`)
        current.send(
          JSON.stringify({
            t: "hello",
            platform: process.platform,
            hostname: os.hostname(),
            home: HOME,
            readOnly: config.readOnly,
            version: VERSION,
            jobs: true,
          }),
        )
        core.onOpen()
      })
      current.on("message", (data, isBinary) => {
        if (isBinary) return
        const text = data.toString()
        if (text === PONG_FRAME) {
          clearTimeout(pongDue)
          return
        }
        core.onFrame(text)
      })
      current.on("close", (code) => done(code))
      current.on("unexpected-response", (_request, response) => {
        // The server answered the upgrade with an HTTP error: 401 means the token is no good.
        done(response.statusCode === 401 ? REVOKED_CLOSE_CODE : 1006)
        current.terminate()
      })
      current.on("error", () => {
        // A close event follows, or already resolved this attempt.
      })
    })

    if (closed === REVOKED_CLOSE_CODE) {
      log("This computer was removed from your account. Forgetting its credentials.")
      rmSync(CONFIG_PATH, { force: true })
      return
    }
    if (closed === SUPERSEDED_CLOSE_CODE) {
      log("Another daemon connected as this computer. Exiting so the two do not fight.")
      return
    }
    const delay = Math.min(1_000 * 2 ** attempt++, MAX_BACKOFF_MS)
    log(`Disconnected. Reconnecting in ${Math.round(delay / 1000)}s.`)
    await sleep(delay)
  }
}

function installService(args: string[]): void {
  const script = path.resolve(process.argv[1]!)
  const service = serviceFile({
    platform: process.platform,
    home: HOME,
    node: process.execPath,
    script,
    args,
    logFile: LOG_PATH,
  })
  if (service === undefined) {
    log("Running as a service is supported on Linux (systemd) and macOS (launchd).")
    process.exitCode = 1
    return
  }
  mkdirSync(path.dirname(service.path), { recursive: true })
  writeFileSync(service.path, service.content)
  for (const command of service.enable) {
    try {
      execFileSync(command[0]!, command.slice(1), { stdio: "ignore" })
    } catch {
      // `launchctl unload` fails the first time; the load after it is what matters.
    }
  }
  log(`Installed ${service.path}. The daemon now starts by itself.`)
}

const USAGE = `Usage: durable-computer-daemon <server-url> [options]

  --read-only         Let the agent read files here but not run commands or change anything
  --name <name>       What the agent should call this computer (default: the hostname)
  --install-service   After pairing, keep the daemon running in the background
  --unpair            Forget this computer's credentials and exit
  --version
`

async function main(): Promise<void> {
  const asked = parseArguments(process.argv.slice(2))
  if (asked.version) return void console.log(VERSION)
  if (asked.help) return void console.log(USAGE)
  if (asked.unpair) {
    rmSync(CONFIG_PATH, { force: true })
    return log("Forgot this computer's credentials. Remove it in the app to finish.")
  }

  let config = loadConfig()
  if (config === undefined) {
    if (asked.server === undefined) return void console.log(USAGE)
    config = await pair(asked.server, asked.readOnly, asked.name)
  } else if (asked.readOnly && !config.readOnly) {
    // The owner tightened access since pairing; honor it from now on.
    config = { ...config, readOnly: true }
    saveConfig(config)
  }
  if (asked.installService) return installService([config.server])
  await run(config)
}

main().catch((error) => {
  log(`Stopped: ${(error as Error)?.message ?? error}`)
  process.exitCode = 1
})
