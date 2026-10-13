import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"

/** What the app remembers between runs. */
export type Settings = {
  /** The deployment the window shows and this computer is paired with. Absent until chosen. */
  server?: string
  /**
   * Whether that deployment is the app's own: Do Computer run by the app, on this computer.
   * `server` is then its address here.
   */
  local: boolean
  /**
   * The port the app's own server listens on, chosen the first time and kept: what the window
   * remembers and this computer's pairing go by the address.
   */
  localPort?: number
  /** Whether the app's own server is served to its owner's other devices, over Tailscale. */
  tailnet: boolean
  /** Whether the owner wants agents to be able to use this computer. */
  share: boolean
  /** Asked for when sharing: agents can read files here and nothing more. */
  readOnly: boolean
  /** Whether the app starts when its owner signs in to the computer. */
  openAtLogin: boolean
  /** Whether agents may see this computer's screen and use its mouse and keyboard. */
  screen: boolean
  /** Whether agents may use a browser on this computer. */
  browser: boolean
  /**
   * Whether the first run is over: its owner has been shown the app and asked whether agents
   * may work on this computer. Until then the window opens on the deployment's welcome.
   */
  welcomed: boolean
  /**
   * When the app last restarted itself to update with no window showing, if it has. One that
   * starts a moment after that shows none either.
   */
  restarted?: number
}

// The screen is everything its owner can see and do, so it is asked for. A browser is what a
// computer with agents on it is mostly for, and is theirs until it is taken away.
export const DEFAULTS: Settings = {
  local: false,
  tailnet: false,
  share: false,
  readOnly: false,
  openAtLogin: false,
  screen: false,
  browser: true,
  welcomed: false,
}

export function loadSettings(file: string): Settings {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<Settings>
    const server =
      typeof parsed.server === "string" && parsed.server !== "" ? parsed.server : undefined
    const localPort =
      typeof parsed.localPort === "number" &&
      Number.isInteger(parsed.localPort) &&
      parsed.localPort > 0 &&
      parsed.localPort < 65536
        ? parsed.localPort
        : undefined
    // The app's own server is at the port it was given. Without one there is none to be its own.
    const local = parsed.local === true && localPort !== undefined && server !== undefined
    return {
      ...(server === undefined ? {} : { server }),
      local,
      ...(localPort === undefined ? {} : { localPort }),
      tailnet: local && parsed.tailnet === true,
      share: parsed.share === true,
      readOnly: parsed.readOnly === true,
      openAtLogin: parsed.openAtLogin === true,
      screen: parsed.screen === true,
      browser: parsed.browser !== false,
      // An app from before there was a first run to be over wrote down nothing about it. One
      // that has a server was set up then, and its owner is not asked it all again.
      welcomed: parsed.welcomed === undefined ? server !== undefined : parsed.welcomed === true,
      ...(typeof parsed.restarted === "number" ? { restarted: parsed.restarted } : {}),
    }
  } catch {
    // Missing or unreadable: a first run.
    return { ...DEFAULTS }
  }
}

export function saveSettings(file: string, settings: Settings): void {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`)
}
