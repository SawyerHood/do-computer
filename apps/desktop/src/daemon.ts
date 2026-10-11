import { type ChildProcess, execFile, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import {
  type AppAnswer,
  type AppCall,
  BROWSER_ENV,
  parseCall,
  parseEvent,
  SCREEN_ENV,
} from "@durable-computer/daemon/events"
import { after, type Sharing } from "./status.ts"

/** How many lines of what the daemon said are kept to show. */
const KEPT_LINES = 200
/** How long the daemon has to stop by itself before it is killed. */
const STOP_AFTER_MS = 3_000
const MAX_RESTART_MS = 60_000

/**
 * Put the daemon the app came with where it can be run and can replace itself, and say where
 * that is.
 *
 * The daemon keeps itself up to date from the server it is paired with, so the file is left
 * alone once it is there. It is written again only when the app brings a daemon it did not
 * bring before: a newer app.
 */
export function seedDaemon(bundled: string, dir: string): string {
  const script = path.join(dir, "bin", "daemon.cjs")
  const mark = path.join(dir, "bin", "seeded")
  const bundle = readFileSync(bundled)
  const sum = createHash("sha256").update(bundle).digest("hex")
  let seeded: string | undefined
  try {
    seeded = readFileSync(mark, "utf8").trim()
  } catch {
    // Never seeded.
  }
  if (!existsSync(script) || seeded !== sum) {
    mkdirSync(path.dirname(script), { recursive: true })
    writeFileSync(script, bundle, { mode: 0o755 })
    writeFileSync(mark, `${sum}\n`)
  }
  return script
}

export type RunnerOptions = {
  /** The daemon's file, as `seedDaemon` left it. */
  readonly script: string
  /** Where the daemon keeps its credentials and its logs. Its own, apart from a daemon run by hand. */
  readonly dir: string
  /** The program that runs the daemon: this app, as Node. */
  readonly node: string
  /** The environment commands on this computer run in. */
  readonly env: () => NodeJS.ProcessEnv
  readonly onChange: () => void
  /** The computer was removed in the app, so the owner no longer shares it. */
  readonly onRevoked: () => void
  /**
   * What agents may use here besides files and commands, asked each time the daemon starts:
   * the daemon tells the server what it can do once, as it connects.
   */
  readonly abilities?: () => { screen: boolean; browser: boolean }
  /** Something the daemon asks of the app: to use the screen, which only the app can. */
  readonly onCall?: (call: AppCall) => Promise<AppAnswer>
}

/**
 * Runs the daemon as a process of its own for as long as this computer is shared, and keeps
 * track of what it says. A process of its own because the daemon replaces itself when the
 * server has a newer one, which a part of this app could not.
 */
export class DaemonRunner {
  sharing: Sharing = { state: "off" }
  /** What the daemon said lately, for its owner to read. */
  readonly lines: string[] = []
  /** When the daemon last said anything, which it does with every command an agent runs. */
  heard = 0
  readonly #options: RunnerOptions
  #child: ChildProcess | undefined
  /** What it was last started with, to start it again with. Undefined: it is meant to be off. */
  #wanted: { server: string; readOnly: boolean } | undefined
  #restart: ReturnType<typeof setTimeout> | undefined
  #failures = 0

  constructor(options: RunnerOptions) {
    this.#options = options
  }

  get running(): boolean {
    return this.#wanted !== undefined
  }

  start(server: string, readOnly: boolean): void {
    if (this.#wanted !== undefined) return
    this.#wanted = { server, readOnly }
    this.#failures = 0
    this.#spawn()
  }

  /** Stop the daemon. Resolves when it is gone. */
  async stop(): Promise<void> {
    this.#wanted = undefined
    clearTimeout(this.#restart)
    const child = this.#child
    this.#set({ state: "off" })
    if (child === undefined || child.exitCode !== null) return
    await new Promise<void>((resolve) => {
      const kill = setTimeout(() => child.kill(), STOP_AFTER_MS)
      child.once("exit", () => {
        clearTimeout(kill)
        resolve()
      })
      // The daemon ends when this closes. That is also how it ends if the app is killed.
      child.stdin?.end()
    })
  }

  /** Start the daemon again as it was started, if it is meant to be running: with what agents may use now. */
  async restart(): Promise<void> {
    const wanted = this.#wanted
    if (wanted === undefined) return
    await this.stop()
    this.start(wanted.server, wanted.readOnly)
  }

  /** Forget this computer's credentials, so that sharing it again pairs it anew. */
  async forget(): Promise<void> {
    await this.stop()
    await new Promise<void>((resolve) => {
      execFile(
        this.#options.node,
        [this.#options.script, "--unpair"],
        { env: this.#env(), timeout: 20_000, windowsHide: true },
        () => resolve(),
      )
    })
  }

  #env(): NodeJS.ProcessEnv {
    const abilities = this.#options.abilities?.()
    return {
      ...this.#options.env(),
      ELECTRON_RUN_AS_NODE: "1",
      DC_DAEMON_DIR: this.#options.dir,
      DC_DAEMON_EMBEDDED: "1",
      ...(abilities?.screen === true ? { [SCREEN_ENV]: "1" } : {}),
      ...(abilities?.browser === false ? { [BROWSER_ENV]: "0" } : {}),
    }
  }

  #set(sharing: Sharing): void {
    this.sharing = sharing
    this.#options.onChange()
  }

  #say(line: string): void {
    this.lines.push(line)
    if (this.lines.length > KEPT_LINES) this.lines.splice(0, this.lines.length - KEPT_LINES)
  }

  #spawn(): void {
    const wanted = this.#wanted
    if (wanted === undefined) return
    this.#set({ state: "starting" })
    const child = spawn(
      this.#options.node,
      [this.#options.script, wanted.server, ...(wanted.readOnly ? ["--read-only"] : [])],
      { env: this.#env(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    )
    this.#child = child
    // Closing the input is how the daemon is told to stop. All that is written to it is the
    // answers to what it asked, a line each.
    child.stdin?.on("error", () => {})
    const asked = (call: AppCall) => {
      const answering =
        this.#options.onCall?.(call) ??
        Promise.resolve<AppAnswer>({
          id: call.id,
          error: { refused: true, message: "This computer does not let agents use its screen." },
        })
      void answering
        .catch((error: unknown): AppAnswer => ({
          id: call.id,
          error: {
            refused: false,
            message: error instanceof Error ? error.message : String(error),
          },
        }))
        .then((answer) => {
          // A daemon that has gone since has nobody waiting, and the one after it never asked.
          if (this.#child !== child || child.stdin?.writable !== true) return
          child.stdin.write(`${JSON.stringify({ ...answer, id: call.id })}\n`)
        })
    }
    let last: "revoked" | "superseded" | undefined
    const read = (stream: NodeJS.ReadableStream | null, calls: boolean) => {
      let rest = ""
      stream?.setEncoding("utf8")
      stream?.on("data", (chunk: string) => {
        this.heard = Date.now()
        const lines = (rest + chunk).split(/\r?\n/)
        rest = lines.pop() ?? ""
        for (const line of lines) {
          if (line === "") continue
          // A call carries what an agent typed, and is no news to the owner: it is not kept.
          const call = calls ? parseCall(line) : undefined
          if (call !== undefined) {
            asked(call)
            continue
          }
          const event = parseEvent(line)
          if (event === undefined) {
            this.#say(line)
            continue
          }
          if (event.event === "connected") this.#failures = 0
          if (event.event === "revoked" || event.event === "superseded") last = event.event
          this.sharing = after(this.sharing, event)
        }
        this.#options.onChange()
      })
    }
    read(child.stdout, true)
    read(child.stderr, false)
    child.on("error", (error) => this.#say(`Could not start the daemon: ${error.message}`))
    child.on("close", () => {
      if (this.#child !== child) return
      this.#child = undefined
      if (this.#wanted === undefined) return
      if (last === "revoked") {
        this.#wanted = undefined
        this.#set({ state: "off" })
        return this.#options.onRevoked()
      }
      // Starting again would take the connection back from the other daemon, and it from this.
      if (last === "superseded") return this.#set({ state: "stopped", why: "superseded" })
      const delay = Math.min(2_000 * 2 ** this.#failures++, MAX_RESTART_MS)
      const detail = this.lines.at(-1)
      this.#set({ state: "stopped", why: "failed", ...(detail === undefined ? {} : { detail }) })
      this.#restart = setTimeout(() => this.#spawn(), delay)
    })
  }
}
