import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, readFile, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { isAbsolute, join, relative } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import type {
  BrowserFront,
  BrowserPaid,
  BrowserRan,
  BrowserSignedIn,
  LiveView,
  PayField,
  PayWith,
  Shot,
  SignInWith,
  UsingAgent,
} from "@do-computer/protocol"
import { VIEW_WAIT_MS } from "@do-computer/protocol"
import type { BrowserIO } from "../daemon-core.ts"
import { UseState } from "../use.ts"
import { ensureDevBrowser } from "./binary.ts"
import {
  findChrome,
  findOwnBrowser,
  hasDisplay,
  keptChromeArgs,
  listening,
  ownBrowserAccess,
  readDevToolsActivePort,
  supervise,
  type Supervised,
} from "./chrome.ts"
import { keepEnd, readFrames, shotOf } from "./frames.ts"
import { createPreview, type Preview, type PreviewSocket } from "./preview.ts"
import { createRelay, type Relay } from "./relay.ts"
import { payOnPage } from "./pay.ts"
import { type SignInBrowser, readFront, signInOnPage } from "./sign-in.ts"

export type NodeBrowserOptions = {
  /** A folder of the daemon's own to keep things in: the dev-browser binary, the profile of the browser kept for agents. */
  readonly dir: string
  /**
   * Whether the browser kept for agents has a window its owner can watch, for a call that does
   * not say. Absent: it has none.
   */
  readonly shown?: boolean
  readonly log?: (line: string) => void
}

/** How long the browser kept for agents stays open with no agent using it. */
const KEPT_IDLE_MS = 15 * 60_000
/**
 * How long a script waits for the owner to answer their own browser, which asks them whether it
 * may be used. The question stays on their screen after that, for the next script to find answered.
 */
const ASK_WAIT_MS = 30_000
/**
 * The most pictures one script hands back, and the largest any may be as it was taken: it is
 * then made no larger than a model is shown (`shotOf`).
 */
const MAX_SHOTS = 10
const MAX_SHOT_BYTES = 4_000_000
/** The most dev-browser may print before it is taken to have run away. */
const MAX_PRINTED = 8_000_000

/**
 * What an agent is told when the system keeps this program from where the owner's Chrome says
 * how it is reached. The browser kept for agents is used meanwhile, so nothing has failed.
 */
const BLOCKED =
  process.platform === "darwin"
    ? "macOS does not let Do Computer look where their Chrome keeps its things, so their own Chrome cannot be used, even where it is open and allows it. This is the browser kept for agents instead, which is signed in to nothing of theirs. If they wanted their own, tell them to give Do Computer Full Disk Access: the Do Computer app on that computer has a button for it under This Computer (it is System Settings > Privacy & Security > Full Disk Access; for a daemon run from a terminal it is the terminal that needs it). You cannot do this for them."
    : "This computer does not let Do Computer read where their Chrome keeps its things, so their own Chrome cannot be used, even where it is open and allows it. This is the browser kept for agents instead, which is signed in to nothing of theirs."

type Session = {
  /** What dev-browser is told to connect to. */
  connect: string
  port: number
  own: boolean
  /** The one socket to the owner's own browser, which dev-browser and the live view share. */
  relay?: Relay
  /** The browser itself, where it is one this started. */
  chrome?: Supervised
  /** Whether this one was started to have a window, whether or not it then could open one. */
  windowed?: boolean
  preview: Preview
  /** Something to tell the agent whose script runs next, once. */
  note?: string
}

const said = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * A browser on this computer for agents, run with dev-browser. It is the owner's own Chrome
 * where that is open and lets itself be used, and otherwise one kept for agents with a profile
 * of its own, in a window where its owner asked to see it and there is a screen to show it on.
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
      : join(
          tmpdir(),
          `dc-browser-${createHash("sha1").update(home).digest("hex").slice(0, 12)}.sock`,
        )
  let daemon: Supervised | undefined
  let session: Session | undefined
  let queue: Promise<unknown> = Promise.resolve()
  let idleTimer: NodeJS.Timeout | undefined
  /** True from `close` until an agent next uses the browser: nothing is shown of it meanwhile. */
  let released = false
  /** True once it has been said that the browser cannot be shown here. */
  let saidUnseen = false
  /** True while it has been said that the owner's own browser cannot be looked for. */
  let saidBlocked = false

  state.onChange(() => session?.preview.bump())

  /** What dev-browser and the browser are started with: little of this process's own, and a home apart from the owner's dev-browser. */
  function environment(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {}
    for (const key of [
      "PATH",
      "HOME",
      "USERPROFILE",
      "LANG",
      "LC_ALL",
      "TMPDIR",
      "TEMP",
      "TMP",
      "XDG_RUNTIME_DIR",
      "DBUS_SESSION_BUS_ADDRESS",
      "DISPLAY",
      "WAYLAND_DISPLAY",
      "XAUTHORITY",
      "HTTPS_PROXY",
      "HTTP_PROXY",
      "NO_PROXY",
    ]) {
      if (process.env[key]) env[key] = process.env[key]
    }
    env.DEV_BROWSER_HOME = home
    env.DEV_BROWSER_SOCKET = socket
    return env
  }

  /**
   * Run dev-browser to its end. Resolves with what it printed, and whether it had to be stopped.
   * A script is handed to it as its input, which no other program on the computer can read, as
   * each can read the words a program was started with.
   */
  function execute(
    binary: string,
    args: string[],
    limitMs: number,
    script?: string,
  ): Promise<{ stdout: string; stderr: string; stopped: boolean }> {
    return new Promise((resolve, reject) => {
      const child = spawn(binary, args, {
        env: environment(),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      })
      // One that ends before it has read its script is heard of when it closes.
      child.stdin.on("error", () => {})
      child.stdin.end(script)
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

  async function launchKept(binary: string, windowed: boolean): Promise<Session> {
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
    const sandboxes = process.platform === "linux" ? [true, false] : [true]
    // A browser that cannot open its window is still a browser: it is then started without one.
    const tries = (windowed ? [true, false] : [false]).flatMap((shown) =>
      sandboxes.map((sandbox) => ({ shown, sandbox })),
    )
    let failure: unknown
    for (const { shown, sandbox } of tries) {
      // One left by a browser that was killed would be read as this one's.
      await rm(join(profile, "DevToolsActivePort"), { force: true })
      const program = supervise(
        chrome,
        keptChromeArgs(profile, sandbox, shown),
        environment(),
        shown,
      )
      try {
        const endpoint = readDevToolsActivePort(
          await waitForFile(join(profile, "DevToolsActivePort"), program, "The browser"),
        )
        if (endpoint === null) throw new Error("The browser did not say where it can be reached.")
        log(
          `browser: started ${chrome} for Doods, ${shown ? "in a window" : "without a window"}${sandbox ? "" : " (without its sandbox)"}`,
        )
        return {
          connect: endpoint.ws,
          port: endpoint.port,
          own: false,
          chrome: program,
          windowed,
          preview: createPreview(endpoint.ws, { seq, onClick }),
        }
      } catch (error) {
        failure = error
        await program.close()
      }
    }
    throw failure
  }

  const onClick = () => {
    state.clicks += 1
  }

  async function dropSession(): Promise<void> {
    const old = session
    session = undefined
    old?.preview.close()
    await old?.relay?.close()
    await old?.chrome?.close()
  }

  /** The browser to use now: the one in use where it is still there, and otherwise chosen again. */
  async function ensureSession(binary: string, asked: boolean): Promise<Session> {
    const ownAllowed = process.env.DC_BROWSER_OWN !== "0"
    if (session) {
      const there = session.chrome
        ? session.chrome.alive()
        : ownAllowed && (session.relay ? session.relay.alive() : await listening(session.port))
      if (!there) await dropSession()
    }
    // The owner may have opened their Chrome since: theirs is preferred as soon as it is there.
    if (ownAllowed && !session?.own) {
      const own = await findOwnBrowser()
      if (own) {
        await dropSession()
        log(`browser: using the owner's own browser on port ${own.port}`)
        // One socket for dev-browser and the live view both, kept from one script to the next:
        // a Chrome that asks its owner asks about each socket, so they are asked once. Where
        // there is nothing to open it with, or to listen on, dev-browser opens its own.
        const relay =
          typeof globalThis.WebSocket === "function" && process.platform !== "win32"
            ? await createRelay(own.ws, { log })
            : undefined
        session = {
          connect: relay?.address ?? own.ws,
          port: own.port,
          own: true,
          ...(relay ? { relay } : {}),
          preview: createPreview(own.ws, {
            seq,
            onClick,
            ...(relay ? { openSocket: () => relay.open() } : {}),
          }),
        }
      }
    }
    // The owner's own could not be looked for: that is said once, and is no reason to fail.
    let note: string | undefined
    if (ownAllowed && !session?.own && ownBrowserAccess() === "blocked") {
      if (!saidBlocked) {
        saidBlocked = true
        note = BLOCKED
        log(
          process.platform === "darwin"
            ? "browser: macOS does not let Do Computer look for the owner's own Chrome; it needs Full Disk Access for that"
            : "browser: the owner's own Chrome cannot be looked for: its folder cannot be read",
        )
      }
    } else saidBlocked = false
    if (session?.relay) {
      const answer = await session.relay.answer(ASK_WAIT_MS)
      if (answer === "asking") {
        throw new Error(
          "Their own Chrome is asking whoever is at the computer whether it may be used, and nobody has answered yet. The question is still on their screen: tell them to press Allow in Chrome, and try again once they have.",
        )
      }
      if (answer === "closed") {
        await dropSession()
        throw new Error(
          "Their own Chrome asked whoever is at the computer whether it may be used, and the answer was no, or it was closed just then. Do not try again unless they say to.",
        )
      }
    }
    // The one kept for agents is started again when it is asked for the other way: with a
    // window where it had none, or without. Its profile is kept, so it stays signed in.
    const windowed = asked && hasDisplay(process.platform, environment())
    if (asked && !windowed && !saidUnseen) {
      saidUnseen = true
      log("browser: there is no display here to show a window on, so it runs without one")
    }
    if (session?.chrome && session.windowed !== windowed) {
      log(
        windowed
          ? "browser: starting it again with a window, as the Dood's workspace now asks"
          : "browser: starting it again without a window, as the Dood's workspace now asks",
      )
      await dropSession()
    }
    session ??= await launchKept(binary, windowed)
    if (note !== undefined) session.note = note
    return session
  }

  /** The page in front, asked of the browser itself, for where the live view cannot say. */
  async function frontPage(port: number): Promise<{ url?: string; title?: string }> {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(1_000),
      })
      const pages = (await response.json()) as { type?: string; url?: string; title?: string }[]
      const front = pages.find((page) => page.type === "page")
      return front ? { url: front.url ?? "", title: front.title ?? "" } : {}
    } catch {
      return {}
    }
  }

  /** The pictures a script took, read from where dev-browser wrote them and then removed. */
  async function readShots(
    images: { path: string; width: number; height: number }[],
  ): Promise<Shot[]> {
    const shots: Shot[] = []
    const root = await realpath(join(home, "tmp")).catch(() => null)
    for (const image of images) {
      try {
        const path = await realpath(image.path)
        const inside = root === null ? ".." : relative(root, path)
        if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) continue
        const bytes = await readFile(path)
        await rm(path, { force: true })
        if (shots.length >= MAX_SHOTS || bytes.length > MAX_SHOT_BYTES) continue
        const shot = shotOf(bytes, image)
        if (shot !== undefined) shots.push(shot)
      } catch {
        // A picture that cannot be read is left out; what the script printed still says it was taken.
      }
    }
    return shots
  }

  async function runOne(script: string, timeoutMs: number, asked: boolean): Promise<BrowserRan> {
    released = false
    clearTimeout(idleTimer)
    let current: Session
    let binary: string
    try {
      binary = await ensureDevBrowser(binDir, log)
      await ensureDaemon(binary)
      current = await ensureSession(binary, asked)
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
        ["--json", "--connect", current.connect, "--timeout", String(seconds), "--quiet-page"],
        // dev-browser ends a script that takes too long itself. This is for when it does not.
        timeoutMs + 10_000,
        script,
      )
      const frames = readFrames(ran.stdout)
      let error = frames.error
      if (ran.stopped)
        error ??= `The script did not finish within ${seconds} seconds, and was stopped.`
      else if (frames.exitCode === undefined) {
        error ??= `dev-browser stopped before the script finished${ran.stderr.trim() ? `: ${ran.stderr.trim().slice(-500)}` : "."}`
      } else if (frames.exitCode !== 0)
        error ??= `The script failed (exit code ${frames.exitCode}).`
      // The owner may close their Chrome, or switch off what lets it be used, under a script.
      if (current.relay && !current.relay.alive()) {
        error =
          "Their own Chrome went away while the script ran: it was closed, or no longer lets itself be used. What the script did before that may or may not have happened."
      }
      // After a script that ran out of time dev-browser may still be busy with it: start it afresh.
      if (ran.stopped || frames.exitCode === 124 || frames.exitCode === undefined) {
        await stopDaemon()
      }
      const shots = await readShots(frames.images)
      const front = (await current.preview.front()) ?? (await frontPage(current.port))
      const { note } = current
      delete current.note
      // Where the browser can be reached is not something for an agent to be told, or to tell.
      const hide = (text: string) =>
        text
          .split(current.connect)
          .join("[the browser]")
          .split(current.connect.replace(/^unix:/, ""))
          .join("[the browser]")
          .split(home)
          .join("[dev-browser]")
      return {
        output: keepEnd(hide(frames.output)),
        ...(error === undefined ? {} : { error: hide(error) }),
        shots,
        ...front,
        own: current.own,
        ...(note === undefined ? {} : { note }),
      }
    } catch (error) {
      return {
        output: "",
        error: `dev-browser could not be run: ${said(error)}`,
        shots: [],
        own: current.own,
      }
    } finally {
      clearInterval(touching)
      current.preview.running(false)
      restLater()
    }
  }

  /** Stop dev-browser. It is started again by the next script, and finds its named pages as they were. */
  async function stopDaemon(): Promise<void> {
    const old = daemon
    daemon = undefined
    await old?.close()
  }

  /** Let the browser rest once no agent has used it for a while. */
  function restLater(): void {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      queue = queue.then(rest, rest)
    }, KEPT_IDLE_MS)
    idleTimer.unref()
  }

  /** The browser agents are using now, where it is still there. Never starts one. */
  function openSession(): Session | undefined {
    if (session === undefined) return undefined
    const there = session.chrome ? session.chrome.alive() : (session.relay?.alive() ?? true)
    return there && typeof globalThis.WebSocket === "function" ? session : undefined
  }

  /**
   * A DevTools socket of the daemon's own to a browser: through the one shared socket to the
   * owner's own, which would ask them about another, and straight to the one kept for agents.
   */
  function ownSocket(current: Session): PreviewSocket {
    return current.relay
      ? current.relay.open()
      : (new WebSocket(current.connect) as unknown as PreviewSocket)
  }

  /**
   * Do something on the page in front of the browser agents are using that the daemon does
   * itself, with dev-browser stopped for as long as it takes. Resolves with undefined where no
   * browser is open, and starts none.
   */
  async function onFront<Went>(
    act: (browser: SignInBrowser) => Promise<Went>,
  ): Promise<(Went & { own: boolean }) | undefined> {
    const current = openSession()
    if (current === undefined) return undefined
    clearTimeout(idleTimer)
    const touching = setInterval(() => state.touch(), 10_000)
    current.preview.running(true)
    try {
      // The live view knows which page is in front a moment after it has connected.
      for (let tries = 0; tries < 20 && current.preview.target() === undefined; tries++) {
        await delay(50)
      }
      const front = current.preview.target()
      const went = await act({
        open: () => ownSocket(current),
        ...(front === undefined ? {} : { front }),
        stop: stopDaemon,
      })
      return { ...went, own: current.own }
    } finally {
      clearInterval(touching)
      current.preview.running(false)
      restLater()
    }
  }

  /** Sign in on the page in front. Where no browser is open it says so. */
  async function signInOne(login: SignInWith, timeoutMs: number): Promise<BrowserSignedIn> {
    return (
      (await onFront((browser) => signInOnPage(browser, login, { timeoutMs }))) ?? {
        outcome: "failed",
        message:
          "No browser is open for Doods on this computer. Open the page that asks to sign in with the browser tool first, and then sign in.",
        own: false,
      }
    )
  }

  /** Pay on the page in front. Where no browser is open it says so. */
  async function payOne(
    card: PayWith,
    asked: { timeoutMs: number; fields: PayField[]; button: string },
  ): Promise<BrowserPaid> {
    return (
      (await onFront((browser) => payOnPage(browser, card, asked))) ?? {
        outcome: "failed",
        message:
          "No browser is open for Doods on this computer. Open the checkout page with the browser tool first, and then pay.",
        own: false,
      }
    )
  }

  /**
   * No agent has used the browser for a while: close the one kept for agents and stop
   * dev-browser. The owner's own stays connected, since connecting to it again would have it
   * ask them again.
   */
  async function rest(): Promise<void> {
    clearTimeout(idleTimer)
    if (!session?.own) await dropSession()
    await stopDaemon()
  }

  /** Close the browser kept for agents, stop dev-browser, and let go of the owner's own. */
  async function letGo(): Promise<void> {
    await rest()
    await dropSession()
  }

  return {
    async run(agent: UsingAgent, script: string, { timeoutMs, say, shown }): Promise<BrowserRan> {
      const asked = shown ?? options.shown === true
      await state.enter(agent, say)
      // One script at a time: they share the browser, and dev-browser's pages in it.
      const result = queue.then(
        () => runOne(script, timeoutMs, asked),
        () => runOne(script, timeoutMs, asked),
      )
      queue = result
      try {
        return await result
      } finally {
        state.touch()
      }
    },

    async front(): Promise<BrowserFront> {
      const current = openSession()
      if (current === undefined) return { own: false }
      const hint = current.preview.target()
      const page = await readFront({
        open: () => ownSocket(current),
        ...(hint === undefined ? {} : { front: hint }),
      })
      return {
        ...(page === undefined
          ? {}
          : { url: page.url.slice(0, 2_000), title: page.title.slice(0, 300) }),
        own: current.own,
      }
    },

    async signIn(
      agent: UsingAgent,
      login: SignInWith,
      { timeoutMs, say },
    ): Promise<BrowserSignedIn> {
      await state.enter(agent, say)
      // After whatever script is running, and before the next: one thing at a time in the browser.
      const result = queue.then(
        () => signInOne(login, timeoutMs),
        () => signInOne(login, timeoutMs),
      )
      queue = result
      try {
        return await result
      } finally {
        state.touch()
      }
    },

    async pay(agent: UsingAgent, card: PayWith, { say, ...asked }): Promise<BrowserPaid> {
      await state.enter(agent, say)
      const result = queue.then(
        () => payOne(card, asked),
        () => payOne(card, asked),
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
