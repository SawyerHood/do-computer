import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import * as path from "node:path"

/** What the app is started with when it starts by itself, so that it opens no window. */
export const HIDDEN_FLAG = "--hidden"

/** One word of an `Exec` line, quoted the way the desktop entry specification asks. */
const quoted = (word: string) => `"${word.replace(/(["`$\\])/g, "\\$1")}"`

/**
 * The file that makes a Linux desktop start the app when its owner signs in. macOS and Windows
 * keep such a list themselves; Linux desktops read this folder.
 */
export function autostartEntry(options: {
  home: string
  configHome?: string | undefined
  exec: string
}) {
  // A Linux path wherever this is worked out, which the tests do on every system.
  const { join } = path.posix
  const folder = join(options.configHome || join(options.home, ".config"), "autostart")
  return {
    path: join(folder, "do-computer.desktop"),
    content: `[Desktop Entry]
Type=Application
Name=Do Computer
Comment=Lets your agents work on this computer
Exec=${quoted(options.exec)} ${HIDDEN_FLAG}
Terminal=false
X-GNOME-Autostart-enabled=true
`,
  }
}

/** Start the app at sign-in on Linux, or stop doing so. */
export function setLinuxAutostart(
  on: boolean,
  options: { home: string; configHome?: string | undefined; exec: string },
): void {
  const entry = autostartEntry(options)
  if (!on) return rmSync(entry.path, { force: true })
  mkdirSync(path.dirname(entry.path), { recursive: true })
  writeFileSync(entry.path, entry.content)
}
