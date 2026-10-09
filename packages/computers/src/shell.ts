import { existsSync } from "node:fs"
import * as path from "node:path"

/** The program commands run in, and how a command is handed to it. */
export type Shell = {
  readonly file: string
  readonly args: (command: string) => string[]
  /** Whether it reads commands as `sh` does, so that it can be given the script around a job. */
  readonly posix: boolean
}

/** A shell that takes a command as `-c <command>`: `bash`, `sh`. */
export function posixShell(file: string): Shell {
  return { file, args: (command) => ["-c", command], posix: true }
}

/**
 * PowerShell, which every Windows has. Given a command with `-Command` it turns every failure
 * into exit code 1, so the script puts back the exit code of the program that failed.
 */
const powerShell: Shell = {
  file: "powershell.exe",
  args: (command) => [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    // The check is on a line of its own, so that a comment ending the command does not hide it.
    `[Console]::OutputEncoding = [Text.Encoding]::UTF8\n${command}\nif (-not $?) { if ($LASTEXITCODE) { exit $LASTEXITCODE } else { exit 1 } }`,
  ],
  posix: false,
}

export type FindShellOptions = {
  readonly platform?: NodeJS.Platform
  readonly env?: Record<string, string | undefined>
  readonly exists?: (file: string) => boolean
}

/**
 * The shell commands run in on this machine. Commands are written for bash, so on Windows it
 * is the bash of Git for Windows where that is installed, and PowerShell where it is not.
 */
export function findShell(options: FindShellOptions = {}): Shell {
  if ((options.platform ?? process.platform) !== "win32") return posixShell("bash")
  const env = options.env ?? process.env
  const exists = options.exists ?? existsSync
  // Not `bash` from the PATH: `C:\Windows\System32\bash.exe` starts WSL, which would run the
  // command in another filesystem.
  const folders = [
    env.ProgramFiles,
    env["ProgramFiles(x86)"],
    env.LOCALAPPDATA === undefined ? undefined : path.win32.join(env.LOCALAPPDATA, "Programs"),
  ]
  for (const folder of folders) {
    if (folder === undefined || folder === "") continue
    const bash = path.win32.join(folder, "Git", "bin", "bash.exe")
    if (exists(bash)) return posixShell(bash)
  }
  return powerShell
}
