import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, readFile, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { isAbsolute, join, relative } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import type { BrowserRan, LiveView, Shot, UsingAgent } from "@durable-computer/protocol"
import { VIEW_WAIT_MS } from "@durable-computer/protocol"
import type { BrowserIO } from "../daemon-core.ts"
import { UseState } from "../use.ts"
import { ensureDevBrowser } from "./binary.ts"
import { findChrome, findOwnBrowser, keptChromeArgs, listening, readDevToolsActivePort, supervise, type Supervised } from "./chrome.ts"
import { isJpeg, keepEnd, readFrames } from "./frames.ts"
import { createPreview, type Preview } from "./preview.ts"

export type NodeBrowserOptions = {
  /** A folder of the daemon's own to keep things in: the dev-browser binary, the profile of the browser kept for agents. */
  readonly dir: string
  readonly log?: (line: string) => void
}

/** How long the browser kept for agents stays open with no agent using it. */
const KEPT_IDLE_MS = 15 * 60_000
/** The most pictures one script hands back, and the largest any may be. */
const MAX_SHOTS = 10
const MAX_SHOT_BYTES = 4_000_000
/** The most dev-browser may print before it is taken to have run away. */
const MAX_PRINTED = 8_000_000

type Session = {
  ws: string
  port: number
  own: boolean
  /** The browser itself, where it is one this started. */
  chrome?: Supervised
  preview: Preview
}

const said = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * A browser on this computer for agents, run with dev-browser. It is the owner's own Chrome
 * where that is open and lets itself be used, and otherwise one without a window, kept for
 * agents with a profile of its own.
 */
export function nodeBrowserIO(options: NodeBrowserOptions): BrowserIO {
  const log = options.log ?? (() => {})
  const state = new UseState({ what: "the browser" })
  const seq = { n: 0 }
  const binDir = join(options.dir, "dev-browser")
  const home = join(binDir, "home")
  const profile = join(options.dir, "browser-profile")
  // A socket's path may be no longer than about a hundred bytes, and a folder for an app's
  // things can be deeper than that.
  const socket =
    join(home, "daemon.sock").length < 90
      ? join(home, "daemon.sock")
      : join(tmpdir(), `dc-browser-${createHash("sha1").update(home).digest("hex").slice(0, 12)}.sock`)
  let daemon: Supervised | undefined
  let session: Session | undefined
  let queue: Promise<unknown> = Promise.resolve()
  let idleTimer: NodeJS.Timeout | undefined
  /** True from `close` until an agent next uses the browser: nothing is shown of it meanwhile. */
  let released = false

  state.onChange(() => session?.preview.bump())

  /** What dev-browser and the browser are started with: little of this process's own, and a home apart from the owner's dev-browser. */
  function environment(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {}
    for (const key of ["PATH", "HOME", "USERPROFILE", "LANG", "LC_ALL", "TMPDIR", "TEMP", "TMP", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS", "DISPLAY", "WAYLAND_DISPLAY", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY"]) {
      if (process.env[key]) env[key] = process.env[key]
    }
    env.DEV_BROWSER_HOME = home
    env.DEV_BROWSER_SOCKET = socket
    return env
  }

  /** Run dev-browser to its end. Resolves with what it printed, and whether it had to be stopped. */
  function execute(binary: string, args: string[], limitMs: number): Promise<{ stdout: string; stderr: string; stopped: boolean }> {
    return new Promise((resolve, reject) => {
      const child = spawn(binary, args, { env: environment(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
      let stdout = ""
      let stderr = ""
      let stopped = false
      const stop = () => {
        stopped = true
        child.kill("SIGKILL")
      }
      const timer = setTimeout(stop, limitMs)
      child.stdout.setEncoding("utf8")
      child.stderr.setEncoding("utf8")
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk
        if (stdout.length > MAX_PRINTED) stop()
      })
      child.stderr.on("data", (chunk: string) => {
        stderr = (stderr + chunk).slice(-4_000)
      })
      child.once("error", (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.once("close", () => {
        clearTimeout(timer)
        resolve({ stdout, stderr, stopped })
      })
    })
  }

  /** Wait for a file that a program writes once it is ready, for as long as the program lives. */
  async function waitForFile(path: string, program: Supervised, what: string): Promise<string> {
    const until = Date.now() + 30_000
    for (;;) {
      const text = await readFile(path, "utf8").catch(() => null)
      if (text !== null && text.trim() !== "") return text
      if (!program.alive()) throw new Error(`${what} stopped as soon as it was started.`)
      if (Date.now() > until) throw new Error(`${what} did not start within thirty seconds.`)
      await delay(25)
    }
  }

  async function ensureDaemon(binary: string): Promise<void> {
    if (daemon?.alive()) return
    await mkdir(home, { recursive: true })
    await rm(join(home, "daemon.pid"), { force: true })
    const started = supervise(binary, ["daemon"], environment())
    daemon = started
    try {
      await waitForFile(join(home, "daemon.pid"), started, "dev-browser")
    } catch (error) {
      daemon = undefined
      await started.close()
      throw error
    }
  }

  async function launchKept(binary: string): Promise<Session> {
    let chrome = findChrome(home)
    if (chrome === null) {
      log("browser: no Chrome on this computer; asking dev-browser to install one")
      const installed = await execute(binary, ["install"], 10 * 60_000)
      chrome = findChrome(home)
      if (chrome === null) {
        throw new Error(
          `There is no Chrome on this computer for the browser to use, and one could not be downloaded${installed.stderr.trim() ? ` (${installed.stderr.trim().slice(-300)})` : ""}. Install Google Chrome on it, or set DEV_BROWSER_CHROME to a Chrome's path.`,
        )
      }
    }
    await mkdir(profile, { recursive: true })
    // Linux machines that do not let Chrome build its sandbox are common: try with it, then without.
    const tries = process.platform === "linux" ? [true, false] : [true]
    let failure: unknown
    for (const sandbox of tries) {
      // One left by a browser that was killed would be read as this one's.
      await rm(join(profile, "DevToolsActivePort"), { force: true })
      const program = supervise(chrome, keptChromeArgs(profile, sandbox), environment())
      try {
        const endpoint = readDevToolsActivePort(await waitForFile(join(profile, "DevToolsActivePort"), program, "The browser"))
        if (endpoint === null) throw new Error("The browser did not say where it can be reached.")
        log(`browser: started ${chrome} for agents${sandbox ? "" : " (without its sandbox)"}`)
        return { ...endpoint, own: false, chrome: program, preview: preview(endpoint.ws) }
      } catch (error) {
        failure = error
        await program.close()
      }
    }
    throw failure
  }

  function preview(ws: string): Preview {
    return createPreview(ws, { seq, onClick: () => (state.clicks += 1) })
  }

  async function dropSession(): Promise<void> {
    const old = session
    session = undefined
    old?.preview.close()
    await old?.chrome?.close()
  }

  /** The browser to use now: the one in use where it is still there, and otherwise chosen again. */
  async function ensureSession(binary: string): Promise<Session> {
    const ownAllowed = process.env.DC_BROWSER_OWN !== "0"
    if (session) {
      const there = session.chrome ? session.chrome.alive() : ownAllowed && (await listening(session.port))
      if (!there) await dropSession()
    }
    // The owner may have opened their Chrome since: theirs is preferred as soon as it is there.
    if (ownAllowed && !session?.own) {
      const own = await findOwnBrowser()
      if (own) {
        await dropSession()
        log(`browser: using the owner's own browser on port ${own.port}`)
        session = { ...own, own: true, preview: preview(own.ws) }
      }
    }
    session ??= await launchKept(binary)
    return session
  }

  /** The page in front, asked of the browser itself, for where the live view cannot say. */
  async function frontPage(port: number): Promise<{ url?: string; title?: string }> {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1_000) })
      const pages = (await response.json()) as { type?: string; url?: string; title?: string }[]
      const front = pages.find((page) => page.type === "page")
      return front ? { url: front.url ?? "", title: front.title ?? "" } : {}
    } catch {
      return {}
    }
  }

  /** The pictures a script took, read from where dev-browser wrote them and then removed. */
  async function readShots(images: { path: string; width: number; height: number }[]): Promise<Shot[]> {
    const shots: Shot[] = []
    const root = await realpath(join(home, "tmp")).catch(() => null)
    for (const image of images) {
      try {
        const path = await realpath(image.path)
        const inside = root === null ? ".." : relative(root, path)
        if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) continue
        const bytes = await readFile(path)
        await rm(path, { force: true })
        if (shots.length >= MAX_SHOTS || bytes.length > MAX_SHOT_BYTES || !isJpeg(bytes)) continue
        shots.push({ mimeType: "image/jpeg", data: bytes.toString("base64"), width: image.width, height: image.height })
      } catch {
        // A picture that cannot be read is left out; what the script printed still says it was taken.
      }
    }
    return shots
  }

  async function runOne(script: string, timeoutMs: number): Promise<BrowserRan> {
    released = false
    clearTimeout(idleTimer)
    let current: Session
    let binary: string
    try {
      binary = await ensureDevBrowser(binDir, log)
      await ensureDaemon(binary)
      current = await ensureSession(binary)
    } catch (error) {
      log(`browser: ${said(error)}`)
      return { output: "", error: said(error), shots: [], own: false }
    }
    // A long script keeps the browser in use for as long as it runs.
    const touching = setInterval(() => state.touch(), 10_000)
    current.preview.running(true)
    try {
      const seconds = Math.max(1, Math.ceil(timeoutMs / 1000))
      const ran = await execute(
        binary,
        ["--json", "--connect", current.ws, "--timeout", String(seconds), "--quiet-page", "-e", script],
        // dev-browser ends a script that takes too long itself. This is for when it does not.
        timeoutMs + 10_000,
      )
      const frames = readFrames(ran.stdout)
      let error = frames.error
      if (ran.stopped) error ??= `The script did not finish within ${seconds} seconds, and was stopped.`
      else if (frames.exitCode === undefined) {
        error ??= `dev-browser stopped before the script finished${ran.stderr.trim() ? `: ${ran.stderr.trim().slice(-500)}` : "."}`
      } else if (frames.exitCode !== 0) error ??= `The script failed (exit code ${frames.exitCode}).`
      // After a script that ran out of time dev-browser may still be busy with it: start it afresh.
      if (ran.stopped || frames.exitCode === 124 || frames.exitCode === undefined) {
        const old = daemon
        daemon = undefined
        await old?.close()
      }
      const shots = await readShots(frames.images)
      const front = (await current.preview.front()) ?? (await frontPage(current.port))
      // Where the browser can be reached is not something for an agent to be told, or to tell.
      const hide = (text: string) => text.split(current.ws).join("[the browser]").split(home).join("[dev-browser]")
      return {
        output: keepEnd(hide(frames.output)),
        ...(error === undefined ? {} : { error: hide(error) }),
        shots,
        ...front,
        own: current.own,
      }
    } catch (error) {
      return { output: "", error: `dev-browser could not be run: ${said(error)}`, shots: [], own: current.own }
    } finally {
      clearInterval(touching)
      current.preview.running(false)
      idleTimer = setTimeout(() => {
        queue = queue.then(letGo, letGo)
      }, KEPT_IDLE_MS)
      idleTimer.unref()
    }
  }

  /** Close the browser kept for agents, stop dev-browser, and stop watching the owner's own. */
  async function letGo(): Promise<void> {
    clearTimeout(idleTimer)
    await dropSession()
    const old = daemon
    daemon = undefined
    await old?.close()
  }

  return {
    async run(agent: UsingAgent, script: string, { timeoutMs, say }): Promise<BrowserRan> {
      await state.enter(agent, say)
      // One script at a time: they share the browser, and dev-browser's pages in it.
      const result = queue.then(
        () => runOne(script, timeoutMs),
        () => runOne(script, timeoutMs),
      )
      queue = result
      try {
        return await result
      } finally {
        state.touch()
      }
    },

    async view(after: number, waitMs: number): Promise<LiveView> {
      const wait = Math.max(0, Math.min(waitMs, VIEW_WAIT_MS))
      if (typeof globalThis.WebSocket !== "function") return { active: false, seq: seq.n }
      if (!state.active || released) {
        session?.preview.rest()
        return { active: false, seq: seq.n }
      }
      if (session) await session.preview.next(after, wait)
      else if (seq.n <= after) await delay(Math.min(wait, 500))
      if (!state.active || released) return { active: false, seq: seq.n }
      return {
        active: true,
        seq: seq.n,
        ...(session ? { ...session.preview.latest(), own: session.own } : {}),
        clicks: state.clicks,
        ...(state.say === undefined ? {} : { say: state.say }),
        held: state.held,
        ...(state.agent === undefined ? {} : { agent: state.agent }),
      }
    },

    async hold(held: boolean): Promise<void> {
      state.hold(held)
    },

    async close(): Promise<void> {
      released = true
      // After whatever script is running: a browser is not taken from under one.
      const done = queue.then(letGo, letGo)
      queue = done
      await done
    },
  }
}
