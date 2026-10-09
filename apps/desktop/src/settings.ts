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
}

// The screen is everything its owner can see and do, so it is asked for. A browser is what a
// computer with agents on it is mostly for, and is theirs until it is taken away.
export const DEFAULTS: Settings = {
  share: false,
  readOnly: false,
  openAtLogin: false,
  screen: false,
  browser: true,
}

export function loadSettings(file: string): Settings {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<Settings>
    return {
      ...(typeof parsed.server === "string" && parsed.server !== ""
        ? { server: parsed.server }
        : {}),
      share: parsed.share === true,
      readOnly: parsed.readOnly === true,
      openAtLogin: parsed.openAtLogin === true,
      screen: parsed.screen === true,
      browser: parsed.browser !== false,
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
