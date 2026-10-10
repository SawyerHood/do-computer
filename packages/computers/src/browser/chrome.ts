import { spawn } from "node:child_process"
import { accessSync, constants, readdirSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { connect } from "node:net"
import { homedir } from "node:os"
import { delimiter, join, win32 } from "node:path"

/** A browser that can be reached: where its DevTools socket is, and its port. */
export type Endpoint = { ws: string; port: number }

/**
 * What Chrome writes in `DevToolsActivePort` in its user-data folder while it lets itself be
 * debugged: the port on one line, the path of the browser's socket on the next.
 */
export function readDevToolsActivePort(text: string): Endpoint | null {
  const [first, second] = text.split(/\r?\n/).map((line) => line.trim())
  const port = Number(first)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  if (second === undefined || !/^\/devtools\/browser\/[A-Za-z0-9-]+$/.test(second)) return null
  return { ws: `ws://127.0.0.1:${port}${second}`, port }
}

/**
 * The user-data folders of the browsers a person may have open, where each keeps them unless
 * told otherwise: Chrome, Chrome Beta, Chromium, Brave, Edge.
 */
export function ownDataDirs(
  platform: string,
  home: string,
  env: Record<string, string | undefined>,
): string[] {
  if (platform === "darwin") {
    const base = join(home, "Library", "Application Support")
    return [
      "Google/Chrome",
      "Google/Chrome Beta",
      "Chromium",
      "BraveSoftware/Brave-Browser",
      "Microsoft Edge",
    ].map((name) => join(base, name))
  }
  if (platform === "win32") {
    const base = env.LOCALAPPDATA ?? win32.join(home, "AppData", "Local")
    return [
      "Google\\Chrome",
      "Google\\Chrome Beta",
      "Chromium",
      "BraveSoftware\\Brave-Browser",
      "Microsoft\\Edge",
    ].map((name) => win32.join(base, name, "User Data"))
  }
  const base = env.XDG_CONFIG_HOME || join(home, ".config")
  return [
    "google-chrome",
    "google-chrome-beta",
    "chromium",
    "BraveSoftware/Brave-Browser",
    "microsoft-edge",
  ].map((name) => join(base, name))
}

/** Whether something is listening on a port of this machine. */
export function listening(port: number, waitMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port })
    const done = (answer: boolean) => {
      socket.destroy()
      resolve(answer)
    }
    socket.setTimeout(waitMs, () => done(false))
    socket.once("connect", () => done(true))
    socket.once("error", () => done(false))
  })
}

/** The browser answering DevTools' own question on a port, where one is. */
async function askVersion(port: number): Promise<Endpoint | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(500),
    })
    if (!response.ok) return null
    const answer = (await response.json()) as { webSocketDebuggerUrl?: unknown }
    if (typeof answer.webSocketDebuggerUrl !== "string") return null
    const url = new URL(answer.webSocketDebuggerUrl)
    // Node's own inspector answers on these ports too, and is not a browser.
    if (!url.pathname.startsWith("/devtools/browser/")) return null
    return { ws: `ws://127.0.0.1:${port}${url.pathname}`, port }
  } catch {
    return null
  }
}

export const OWN_PORTS = [9222, 9223, 9224, 9225, 9226, 9227, 9228, 9229]

/**
 * The owner's own browser, where it is open and lets itself be used: one that wrote
 * `DevToolsActivePort` where it keeps its things and is still listening there, or one started
 * with a debugging port in the usual range.
 *
 * A file left by a browser that has since closed is why the port is tried. It is only tried,
 * not spoken to: a Chrome that was allowed from chrome://inspect asks its owner each time
 * something connects, and has no `/json/version` to ask.
 */
export async function findOwnBrowser(
  dirs = ownDataDirs(process.platform, homedir(), process.env),
  ports: readonly number[] = OWN_PORTS,
): Promise<Endpoint | null> {
  for (const dir of dirs) {
    const text = await readFile(join(dir, "DevToolsActivePort"), "utf8").catch(() => null)
    const endpoint = text === null ? null : readDevToolsActivePort(text)
    if (endpoint && (await listening(endpoint.port))) return endpoint
  }
  const answers = await Promise.all(ports.map(askVersion))
  return answers.find((answer) => answer !== null) ?? null
}

function runnable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Every file under `root` with one of these names: how a Chrome that was downloaded is found. */
function walk(root: string, names: ReadonlySet<string>, depth = 8): string[] {
  const found: string[] = []
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      if (depth > 0) found.push(...walk(path, names, depth - 1))
    } else if (names.has(entry.name) && runnable(path)) found.push(path)
  }
  return found
}

/** A Chrome that `dev-browser install` put under dev-browser's own folder. */
export function installedChrome(devBrowserHome: string): string | null {
  const names = new Set(["chrome", "chrome.exe", "Google Chrome for Testing"])
  return walk(join(devBrowserHome, "chrome"), names).sort().reverse()[0] ?? null
}

/**
 * A Chrome to launch for agents, found the way dev-browser finds one: the one `DEV_BROWSER_CHROME`
 * names, one dev-browser installed, one installed on the machine, one in Playwright's cache.
 */
export function findChrome(
  devBrowserHome: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (env.DEV_BROWSER_CHROME && runnable(env.DEV_BROWSER_CHROME)) return env.DEV_BROWSER_CHROME
  const installed = installedChrome(devBrowserHome)
  if (installed) return installed
  const home = homedir()
  const candidates: string[] = []
  if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      join(home, "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    )
  } else if (process.platform === "win32") {
    for (const root of [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA]) {
      if (!root) continue
      for (const rel of [
        "Google\\Chrome\\Application\\chrome.exe",
        "Chromium\\Application\\chrome.exe",
        "Microsoft\\Edge\\Application\\msedge.exe",
      ]) {
        candidates.push(win32.join(root, rel))
      }
    }
  } else {
    const dirs = (env.PATH ?? "").split(delimiter).filter(Boolean)
    for (const name of [
      "google-chrome",
      "google-chrome-stable",
      "chromium",
      "chromium-browser",
      "microsoft-edge",
      "microsoft-edge-stable",
      "brave-browser",
      "chrome",
    ]) {
      for (const dir of dirs) candidates.push(join(dir, name))
    }
  }
  const cache =
    process.platform === "darwin"
      ? join(home, "Library/Caches/ms-playwright")
      : join(home, ".cache/ms-playwright")
  let builds: string[] = []
  try {
    builds = readdirSync(cache)
      .filter((name) => /^chromium-\d+$/.test(name))
      .sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)))
  } catch {}
  for (const build of builds) {
    const inside =
      process.platform === "darwin"
        ? [
            "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
            "chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium",
          ]
        : process.platform === "win32"
          ? ["chrome-win64\\chrome.exe", "chrome-win\\chrome.exe"]
          : ["chrome-linux64/chrome", "chrome-linux/chrome"]
    for (const rel of inside) candidates.push(join(cache, build, rel))
  }
  return candidates.find(runnable) ?? null
}

/**
 * Whether a window opened on this computer has anywhere to be: on Linux there is a display only
 * where one is named. A Mac and a Windows machine are taken to have a screen.
 */
export function hasDisplay(
  platform: string = process.platform,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (platform !== "linux") return true
  return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY)
}

/**
 * The flags of the browser kept for agents: its own profile, a port of Chrome's choosing, and a
 * window its owner can watch where it is shown, none where it is not.
 */
export function keptChromeArgs(profile: string, sandbox: boolean, shown = false): string[] {
  return [
    ...(shown ? [] : ["--headless=new"]),
    ...(sandbox ? [] : ["--no-sandbox"]),
    "--remote-debugging-port=0",
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1280,800",
    "about:blank",
  ]
}

/**
 * Stands between this process and a program it started, and ends that program, with everything
 * it started, when this process goes away for any reason: its end of the pipe closes. Windows
 * is told to hide what the program opens unless `DC_SUPERVISED_SHOWN` says it has a window.
 */
const supervisor = `
const { spawn } = require('node:child_process');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const shown = env.DC_SUPERVISED_SHOWN === '1';
delete env.DC_SUPERVISED_SHOWN;
const windows = process.platform === 'win32';
const child = spawn(process.argv[1], process.argv.slice(2), { detached: !windows, stdio: 'ignore', env, windowsHide: !shown });
let stopping = false;
function kill(signal) {
  if (!child.pid) return;
  try {
    if (windows) spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
    else process.kill(-child.pid, signal);
  } catch {}
}
function stop() {
  if (stopping) return;
  stopping = true;
  kill('SIGTERM');
  setTimeout(() => {
    kill('SIGKILL');
    if (child.exitCode !== null || child.signalCode !== null) process.exit(0);
    else child.once('exit', () => process.exit(0));
  }, 1500);
}
child.on('error', () => process.exit(1));
child.on('exit', () => { if (!stopping) { kill('SIGKILL'); process.exit(1); } else process.exit(0); });
process.stdin.resume();
process.stdin.on('end', stop);
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
`

export type Supervised = { alive(): boolean; close(): Promise<void> }

/**
 * Start a program that is ended when this process ends, or when `close` is called. One that is
 * `shown` has a window of its own, which Windows is then not told to hide.
 */
export function supervise(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  shown = false,
): Supervised {
  const child = spawn(process.execPath, ["-e", supervisor, command, ...args], {
    env: {
      ...env,
      // Under Electron the program that is running is Electron, which is Node only when told so.
      ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
      ...(shown ? { DC_SUPERVISED_SHOWN: "1" } : {}),
    },
    stdio: ["pipe", "ignore", "ignore"],
    windowsHide: true,
  })
  child.stdin.on("error", () => {})
  let exited = false
  const completion = new Promise<void>((resolve) => {
    const done = () => {
      exited = true
      resolve()
    }
    child.once("exit", done)
    child.once("error", done)
  })
  return {
    alive: () => !exited,
    async close() {
      child.stdin.end()
      await completion
    },
  }
}
