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
import { type ChildProcess, execFileSync, spawn } from "node:child_process"
import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { nodeBrowserIO } from "@do-computer/computers/browser"
import { DaemonCore } from "@do-computer/computers/daemon"
import { fakeScreen } from "@do-computer/computers/fake-screen"
import { nodeDaemonIO, shownPath } from "@do-computer/computers/node"
import {
  PING_FRAME,
  PONG_FRAME,
  REVOKED_CLOSE_CODE,
  SUPERSEDED_CLOSE_CODE,
} from "@do-computer/protocol"
import WebSocket from "ws"
import { parseArguments } from "./args.ts"
import { BROWSER_ENV, type DaemonEvent, formatEvent, SCREEN_ENV } from "./events.ts"
import { POLL_EAGER_MS, pollDelay } from "./pairing.ts"
import { appScreen } from "./screen.ts"
import { serviceFile } from "./service.ts"
import { supervise } from "./supervisor.ts"
import { RESTART_EXIT_CODE, restorePrevious, update } from "./update.ts"

declare const DAEMON_VERSION: string
const VERSION = typeof DAEMON_VERSION === "string" ? DAEMON_VERSION : "dev"

/**
 * Set by an app that runs the daemon as a part of itself: the daemon then also says how things
 * stand in lines the app can read, and stops when the app does, which it knows by its input
 * closing.
 */
const EMBEDDED = process.env.DC_DAEMON_EMBEDDED === "1"
/** Set when the Node running this is an Electron app's, which is one only while this is set. */
const RUN_AS_NODE = process.env.ELECTRON_RUN_AS_NODE
/** What it takes to run this daemon's Node again, as Node. */
const nodeEnv = () =>
  RUN_AS_NODE === undefined ? undefined : { ...process.env, ELECTRON_RUN_AS_NODE: RUN_AS_NODE }

/**
 * Set by the app when its owner lets agents use the screen, which only the app can reach. A
 * daemon run by hand has none for them, except the pretend one asked for when trying things.
 */
const SCREEN = EMBEDDED && process.env[SCREEN_ENV] === "1"
const FAKE_SCREEN = process.env.DC_DAEMON_FAKE_SCREEN === "1"
/** Set to `0` by the app when its owner switched the browser off there. */
const BROWSER_OFF = process.env[BROWSER_ENV] === "0"

const HOME = os.homedir()
/** The home directory as the agent is told it: on Windows, written the way its shell writes it. */
const SHOWN_HOME = shownPath(HOME)
const CONFIG_DIR = process.env.DC_DAEMON_DIR ?? path.join(HOME, ".durable-computer")
const CONFIG_PATH = path.join(CONFIG_DIR, "daemon.json")
const AUDIT_PATH = path.join(CONFIG_DIR, "audit.log")
const LOG_PATH = path.join(CONFIG_DIR, "daemon.log")
const UPDATE_PATH = path.join(CONFIG_DIR, "update.json")

const PING_INTERVAL_MS = 30_000
const PONG_DEADLINE_MS = 15_000
const POLL_INTERVAL_MS = Number(process.env.DC_DAEMON_POLL_MS ?? POLL_EAGER_MS)
const MAX_BACKOFF_MS = 30_000
/** How often a connected daemon asks whether there is a newer one. It also asks on connecting. */
const UPDATE_EVERY_MS = Number(process.env.DC_DAEMON_UPDATE_MS ?? 6 * 60 * 60_000)
/** How long a new daemon waits for what the agent is doing here to end before it takes over. */
const UPDATE_IDLE_WAIT_MS = 15 * 60_000

type Config = {
  server: string
  computerId: string
  name: string
  token: string
  readOnly: boolean
  /** False when the owner switched updating off. Absent: it keeps itself up to date. */
  autoUpdate?: boolean
  /** False when the owner said agents may not use a browser here. Absent: they may. */
  browser?: boolean
}

/** What is remembered about updating: the version last installed, and one that would not start. */
type UpdateState = { installed?: string; bad?: string }

function loadUpdateState(): UpdateState {
  try {
    return JSON.parse(readFileSync(UPDATE_PATH, "utf8")) as UpdateState
  } catch {
    return {}
  }
}

function saveUpdateState(state: UpdateState): void {
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(UPDATE_PATH, `${JSON.stringify(state)}\n`)
}

const log = (message: string) => console.log(`[${new Date().toISOString()}] ${message}`)
const tell = (event: DaemonEvent) => {
  if (EMBEDDED) console.log(formatEvent(event))
}
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
  const began = Date.now()
  for (;;) {
    const started = await post<{ code: string; pollToken: string; verifyUrl: string }>(
      server,
      "/api/computers/pair/start",
      { name, hostname: os.hostname(), platform: process.platform, home: SHOWN_HOME, readOnly },
    )
    log("This computer is not paired yet.")
    log(`Open ${started.verifyUrl}`)
    log(`and confirm the code ${started.code} while signed in. Waiting…`)
    tell({ event: "pairing", code: started.code, verifyUrl: started.verifyUrl })
    for (;;) {
      await sleep(pollDelay(Date.now() - began, POLL_INTERVAL_MS))
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
      tell({ event: "paired", name: config.name, computerId: config.computerId, readOnly })
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
          : entry.kind === "screen"
            ? `${String(entry.agent)} used the screen: ${String((entry.action as { do?: unknown })?.do)}`
            : entry.kind === "browser"
              ? `${String(entry.agent)} ran in a browser: ${String(entry.script).replace(/\s+/g, " ").slice(0, 200)}`
              : entry.kind === "job_stop"
                ? "stopped a command it had started"
                : `${String(entry.kind)} ${String(entry.path ?? "")}`
  log(what)
}

/** Keep one connection open for as long as the process lives. Resolves when it should exit. */
async function run(config: Config): Promise<void> {
  const url = `${config.server.replace(/^http/, "ws")}/api/computers/connect`
  let socket: WebSocket | undefined
  // The app answers for the screen on the daemon's input, which nothing else is written to.
  const screen = FAKE_SCREEN
    ? fakeScreen()
    : SCREEN
      ? appScreen((line) => console.log(line), process.stdin)
      : undefined
  // A computer that may only be read is not one to browse from.
  const browser =
    config.readOnly || config.browser === false || BROWSER_OFF
      ? undefined
      : nodeBrowserIO({ dir: path.join(CONFIG_DIR, "browser"), log })
  const core = new DaemonCore(
    {
      ...nodeDaemonIO({ home: HOME, audit }),
      ...(screen === undefined ? {} : { screen }),
      ...(browser === undefined ? {} : { browser }),
    },
    (frame) => {
      if (socket?.readyState !== WebSocket.OPEN) return false
      socket.send(frame)
      return true
    },
    // The server says there may be a newer daemon: look now, not at the next look.
    { readOnly: config.readOnly, onUpdate: () => void checkForUpdate() },
  )

  // A daemon run from its source has no version to compare, and nothing on disk to replace.
  const updating = config.autoUpdate !== false && VERSION !== "dev"
  let checking = false
  let passedOver = false
  const checkForUpdate = async () => {
    if (!updating || checking) return
    checking = true
    try {
      const state = loadUpdateState()
      const result = await update({
        server: config.server,
        current: VERSION,
        script: realpathSync(process.argv[1]!),
        node: process.execPath,
        env: nodeEnv(),
        bad: state.bad,
      })
      if (result.outcome === "skipped" && !passedOver) {
        passedOver = true
        log(`Staying on daemon ${VERSION}: the server's, ${result.version}, would not start here.`)
      }
      if (result.outcome !== "installed") return
      saveUpdateState({ ...state, installed: result.version })
      log(`Downloaded daemon ${result.version}, to replace ${result.from}.`)
      // Commands left running carry on by themselves. One the agent is waiting for would not.
      const until = Date.now() + UPDATE_IDLE_WAIT_MS
      while (core.busy && Date.now() < until) await sleep(1_000)
      process.exit(RESTART_EXIT_CODE)
    } catch (error) {
      log(`Could not update the daemon: ${(error as Error)?.message ?? error}`)
    } finally {
      checking = false
    }
  }
  if (updating) setInterval(() => void checkForUpdate(), UPDATE_EVERY_MS).unref()

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
        tell({
          event: "connected",
          name: config.name,
          computerId: config.computerId,
          readOnly: config.readOnly,
        })
        current.send(
          JSON.stringify({
            t: "hello",
            platform: process.platform,
            hostname: os.hostname(),
            home: SHOWN_HOME,
            readOnly: config.readOnly,
            version: VERSION,
            jobs: true,
            updates: updating,
            screen: screen !== undefined && !config.readOnly,
            browser: browser !== undefined,
          }),
        )
        core.onOpen()
        // A deployment that changed dropped this connection, so this is when to ask.
        void checkForUpdate()
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
      tell({ event: "revoked" })
      return
    }
    if (closed === SUPERSEDED_CLOSE_CODE) {
      log("Another daemon connected as this computer. Exiting so the two do not fight.")
      tell({ event: "superseded" })
      return
    }
    const delay = Math.min(1_000 * 2 ** attempt++, MAX_BACKOFF_MS)
    log(`Disconnected. Reconnecting in ${Math.round(delay / 1000)}s.`)
    tell({ event: "disconnected", retryMs: delay })
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
  --no-auto-update    Do not replace the daemon when the server has a newer one
  --auto-update       Do so again
  --no-browser        Do not let the agent use a browser here
  --browser           Let it again
  --unpair            Forget this computer's credentials and exit
  --version

The daemon keeps itself up to date: it asks the server it is paired with for a newer daemon
when it connects and every few hours, and restarts as that one.
`

/**
 * Run the daemon proper as a second process, and start it again when it has replaced itself.
 * This one stays as it was started, which is why it does so little.
 */
async function superviseSelf(): Promise<void> {
  const script = realpathSync(process.argv[1]!)
  let worker: ChildProcess | undefined
  let stopping = false
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      stopping = true
      worker?.kill(signal)
    })
  }
  process.exitCode = await supervise({
    work: () =>
      new Promise((resolve) => {
        worker = spawn(process.execPath, [script, ...process.argv.slice(2)], {
          stdio: "inherit",
          env: { ...process.env, DC_DAEMON_WORKER: "1" },
          windowsHide: true,
        })
        worker.on("error", () => resolve(1))
        worker.on("exit", (code, signal) =>
          resolve(code ?? 128 + (signal === null ? 0 : (os.constants.signals[signal] ?? 0))),
        )
      }),
    stopping: () => stopping,
    restore: () => restorePrevious(script),
    onBad: () => {
      const state = loadUpdateState()
      if (state.installed !== undefined) saveUpdateState({ ...state, bad: state.installed })
    },
    log,
  })
}

async function main(): Promise<void> {
  const asked = parseArguments(process.argv.slice(2))
  if (asked.version) return void console.log(VERSION)
  if (asked.help) return void console.log(USAGE)
  if (asked.unpair) {
    rmSync(CONFIG_PATH, { force: true })
    return log("Forgot this computer's credentials. Remove it in the app to finish.")
  }

  if (process.env.DC_DAEMON_WORKER !== "1" && VERSION !== "dev") return superviseSelf()
  // What the agent runs here inherits the daemon's environment, and is no worker of anything,
  // no part of an app, and not to be run as Node if it is an Electron app itself.
  delete process.env.DC_DAEMON_WORKER
  delete process.env.DC_DAEMON_EMBEDDED
  delete process.env.ELECTRON_RUN_AS_NODE
  if (EMBEDDED) {
    // The app holds the other end of this for as long as it runs, and never writes to it.
    process.stdin.on("end", () => process.exit(0))
    process.stdin.on("error", () => process.exit(0))
    process.stdin.resume()
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
  if (asked.autoUpdate !== undefined && asked.autoUpdate !== (config.autoUpdate !== false)) {
    // Said once, it holds until the owner says otherwise.
    config = { ...config, autoUpdate: asked.autoUpdate }
    saveConfig(config)
    log(
      asked.autoUpdate
        ? "The daemon keeps itself up to date."
        : "The daemon no longer updates itself.",
    )
  }
  if (asked.browser !== undefined && asked.browser !== (config.browser !== false)) {
    config = { ...config, browser: asked.browser }
    saveConfig(config)
    log(asked.browser ? "Agents may use a browser here." : "Agents may not use a browser here.")
  }
  if (asked.installService) return installService([config.server])
  await run(config)
}

main().catch((error) => {
  log(`Stopped: ${(error as Error)?.message ?? error}`)
  process.exitCode = 1
})
