/**
 * Do Computer itself, run by the app on this computer: the server the app would otherwise be
 * pointed at. It is the ordinary Node server with everything it imports packed into it (see
 * `build:packed` in apps/web), run as a process of its own with the app as Node, and it listens
 * on this computer alone.
 *
 * A process of its own because it reads its database and draws its pages as it goes, which in
 * the app's main one would hold up every window.
 */
import { type ChildProcess, spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import * as path from "node:path"

/** How the app's own server stands, as the app shows it. */
export type Serving =
  /** The app is not running one: it shows a server somewhere else. */
  | { state: "off" }
  | { state: "starting" }
  | { state: "running" }
  /** It stopped by itself, and is started again shortly. `detail` is the last thing it said. */
  | { state: "stopped"; detail?: string }

/** The port the server is given the first time, where nothing else has it. */
export const PREFERRED_PORT = 4310
/** How many ports after that one are tried before the system is asked for any. */
const PORTS_TRIED = 20
/** How many lines of what the server said are kept. */
const KEPT_LINES = 200
/** How long the server has to stop by itself before it is killed. */
const STOP_AFTER_MS = 4_000
const MAX_RESTART_MS = 60_000
/** How long a server has to say it is one, once started. */
const READY_AFTER_MS = 45_000

/** The address of the app's own server: on this computer, and reached from nowhere else. */
export const localAddress = (port: number) => `http://127.0.0.1:${port}`

/** Whether a port on this computer is free to listen on. */
function free(port: number): Promise<number | undefined> {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.once("error", () => resolve(undefined))
    probe.listen(port, "127.0.0.1", () => {
      const taken = (probe.address() as { port: number }).port
      probe.close(() => resolve(taken))
    })
  })
}

/**
 * A port for the server, chosen once and kept: the app's window, what it remembers there and
 * this computer's pairing all go by the address. The usual one where it is free, else one
 * near it, else whichever the system gives.
 */
export async function pickPort(preferred = PREFERRED_PORT): Promise<number> {
  for (let port = preferred; port < preferred + PORTS_TRIED; port++) {
    if ((await free(port)) !== undefined) return port
  }
  const any = await free(0)
  if (any === undefined) throw new Error("This computer has no port to listen on.")
  return any
}

/**
 * The secret that says the app is asking, made the first time and kept beside the server's
 * data. The server is given it as it starts, and signs in as its owner whoever sends it.
 */
export function ownerKey(dir: string): string {
  const file = path.join(dir, "owner-key")
  if (existsSync(file)) {
    const kept = readFileSync(file, "utf8").trim()
    if (kept !== "") return kept
  }
  mkdirSync(dir, { recursive: true })
  const key = randomBytes(32).toString("base64url")
  writeFileSync(file, `${key}\n`, { mode: 0o600 })
  return key
}

/** What the server is started with, besides what the app itself was. */
export function serverEnv(options: {
  port: number
  dir: string
  key: string
  /** The address other devices reach it at, when it is served to them. */
  reachedAt?: string | undefined
}): Record<string, string> {
  const here = localAddress(options.port)
  return {
    ELECTRON_RUN_AS_NODE: "1",
    PORT: String(options.port),
    HOST: "127.0.0.1",
    DC_DATA_DIR: options.dir,
    DC_OWNER_KEY: options.key,
    DC_STOP_WITH_INPUT: "1",
    // Links it hands out are to where every device can follow them. The app's own window is
    // still on this computer's address, which is then the server's other one.
    DC_BASE_URL: options.reachedAt ?? here,
    DC_ALSO_AT: options.reachedAt === undefined ? "" : here,
    // Whatever the shell the app was started from says about a deployment is about another.
    DC_SIGNUP: "invite",
    DC_LANDING: "",
    DC_ALLOWED_EMAILS: "",
  }
}

export type LocalServerOptions = {
  /** The server's one file, with its pages in a folder beside it. */
  readonly script: string
  /** The program that runs it: this app, as Node. */
  readonly node: string
  readonly port: number
  /** What it is started with, asked each time: where it is reached can change. */
  readonly env: () => NodeJS.ProcessEnv
  readonly onChange: () => void
}

/** Runs the server for as long as the app is its own, and keeps track of what it says. */
export class LocalServer {
  serving: Serving = { state: "off" }
  /** What the server said lately. */
  readonly lines: string[] = []
  readonly #options: LocalServerOptions
  #child: ChildProcess | undefined
  #wanted = false
  #restart: ReturnType<typeof setTimeout> | undefined
  #failures = 0

  constructor(options: LocalServerOptions) {
    this.#options = options
  }

  get address(): string {
    return localAddress(this.#options.port)
  }

  start(): void {
    if (this.#wanted) return
    this.#wanted = true
    this.#failures = 0
    this.#spawn()
  }

  /** Stop the server. Resolves when it is gone. */
  async stop(): Promise<void> {
    this.#wanted = false
    clearTimeout(this.#restart)
    const child = this.#child
    this.#child = undefined
    this.#set({ state: "off" })
    if (child === undefined || child.exitCode !== null) return
    await new Promise<void>((resolve) => {
      const kill = setTimeout(() => child.kill(), STOP_AFTER_MS)
      child.once("exit", () => {
        clearTimeout(kill)
        resolve()
      })
      // The server ends when this closes. That is also how it ends if the app is killed.
      child.stdin?.end()
    })
  }

  /** Start it again, with what it is started with now. */
  async restart(): Promise<void> {
    await this.stop()
    this.start()
  }

  /** Whether the server answers and says that it is one. */
  async healthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.address}/api/health`, {
        signal: AbortSignal.timeout(2_000),
      })
      return response.ok && ((await response.json()) as { ok?: unknown }).ok === true
    } catch {
      return false
    }
  }

  /** Resolves once the server answers, or with false when it has not in the time it has. */
  async ready(patience = READY_AFTER_MS): Promise<boolean> {
    const until = Date.now() + patience
    while (this.#wanted && Date.now() < until) {
      if (await this.healthy()) {
        if (this.serving.state !== "running") this.#set({ state: "running" })
        return true
      }
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    return false
  }

  #set(serving: Serving): void {
    this.serving = serving
    this.#options.onChange()
  }

  #say(line: string): void {
    this.lines.push(line)
    if (this.lines.length > KEPT_LINES) this.lines.splice(0, this.lines.length - KEPT_LINES)
  }

  #spawn(): void {
    if (!this.#wanted) return
    this.#set({ state: "starting" })
    const child = spawn(this.#options.node, [this.#options.script], {
      env: this.#options.env(),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    })
    this.#child = child
    child.stdin?.on("error", () => {})
    for (const stream of [child.stdout, child.stderr]) {
      let rest = ""
      stream?.setEncoding("utf8")
      stream?.on("data", (chunk: string) => {
        const lines = (rest + chunk).split(/\r?\n/)
        rest = lines.pop() ?? ""
        for (const line of lines) if (line !== "") this.#say(line)
      })
    }
    child.on("error", (error) => this.#say(`Could not start the server: ${error.message}`))
    child.on("close", () => {
      if (this.#child !== child) return
      this.#child = undefined
      if (!this.#wanted) return
      const delay = Math.min(1_000 * 2 ** this.#failures++, MAX_RESTART_MS)
      const detail = this.lines.at(-1)
      this.#set({ state: "stopped", ...(detail === undefined ? {} : { detail }) })
      this.#restart = setTimeout(() => this.#spawn(), delay)
    })
    // It is running once it answers, which it says to nobody: it is asked.
    void this.ready().then((answered) => {
      if (answered && this.#child === child) this.#failures = 0
    })
  }
}
