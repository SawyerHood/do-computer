import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"

/** What the app remembers between runs. */
export type Settings = {
  /** The deployment the window shows and this computer is paired with. Absent until chosen. */
  server?: string
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
  /** Whether an agent's creature sits on the desktop, over the other windows. */
  companion: boolean
  /** The agent whose creature that is. Absent until one is chosen: the one last open is shown. */
  companionAgent?: string
  /** Where its owner last put it: the top left of the creature's square, on the screen. */
  companionAt?: { x: number; y: number }
}

// The screen is everything its owner can see and do, so it is asked for. A browser is what a
// computer with agents on it is mostly for, and is theirs until it is taken away.
export const DEFAULTS: Settings = {
  share: false,
  readOnly: false,
  openAtLogin: false,
  screen: false,
  browser: true,
  welcomed: false,
  companion: false,
}

export function loadSettings(file: string): Settings {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<Settings>
    const server =
      typeof parsed.server === "string" && parsed.server !== "" ? parsed.server : undefined
    const at = parsed.companionAt
    const placed =
      typeof at?.x === "number" && typeof at?.y === "number" && isFinite(at.x) && isFinite(at.y)
    return {
      ...(server === undefined ? {} : { server }),
      share: parsed.share === true,
      readOnly: parsed.readOnly === true,
      openAtLogin: parsed.openAtLogin === true,
      screen: parsed.screen === true,
      browser: parsed.browser !== false,
      // An app from before there was a first run to be over wrote down nothing about it. One
      // that has a server was set up then, and its owner is not asked it all again.
      welcomed: parsed.welcomed === undefined ? server !== undefined : parsed.welcomed === true,
      companion: parsed.companion === true,
      ...(typeof parsed.companionAgent === "string" && parsed.companionAgent !== ""
        ? { companionAgent: parsed.companionAgent }
        : {}),
      ...(placed ? { companionAt: { x: at!.x, y: at!.y } } : {}),
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
