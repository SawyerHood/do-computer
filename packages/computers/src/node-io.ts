import { spawn } from "node:child_process"
import { promises as fs } from "node:fs"
import * as path from "node:path"
import { EXEC_STDIO_CAP, type RemoteFileStat } from "@do-computer/protocol"
import type { DaemonIO } from "./daemon-core.ts"
import { killTree } from "./kill.ts"
import { prepareImage } from "./node-image.ts"
import { nodeJobs } from "./node-jobs.ts"
import { fromPosixView, shownPath } from "./paths.ts"
import { findShell, posixShell, type Shell } from "./shell.ts"

export { prepareImage } from "./node-image.ts"
export { shownPath } from "./paths.ts"
export { findShell, posixShell, type Shell } from "./shell.ts"

export type NodeDaemonIOOptions = {
  /** Where relative paths and commands start. */
  readonly home: string
  readonly audit: (entry: Record<string, unknown>) => void
  /**
   * The shell commands run in: the name of one like `sh`, or a `Shell`. Default what
   * `findShell` finds: `bash`, and on Windows Git for Windows' bash or else PowerShell.
   */
  readonly shell?: string | Shell
}

function describe(stats: import("node:fs").Stats): RemoteFileStat {
  return {
    kind: stats.isSymbolicLink() ? "symlink" : stats.isDirectory() ? "directory" : "file",
    size: stats.size,
    mtimeMs: stats.mtimeMs,
  }
}

/** The daemon's effects on a real machine, through Node. */
export function nodeDaemonIO(options: NodeDaemonIOOptions): DaemonIO {
  const shell =
    typeof options.shell === "string" ? posixShell(options.shell) : (options.shell ?? findShell())
  const resolve = (given: string) => {
    // The server writes every path as a POSIX one, so a Windows path arrives as `/c/Users/…`.
    const target = process.platform === "win32" ? fromPosixView(given) : given
    const expanded =
      target === "~"
        ? options.home
        : target.startsWith("~/")
          ? path.join(options.home, target.slice(2))
          : target
    return path.isAbsolute(expanded) ? expanded : path.join(options.home, expanded)
  }
  return {
    jobs: nodeJobs({ home: options.home, shell, resolve }),
    exec(command, execOptions) {
      return new Promise((done) => {
        // Its own process group, so a timeout stops the command's children too. Windows has
        // none: there its children are found by who started them.
        const child = spawn(shell.file, shell.args(command), {
          cwd: execOptions.cwd === undefined ? options.home : resolve(execOptions.cwd),
          env: { ...process.env, ...execOptions.env },
          detached: process.platform !== "win32",
          windowsHide: true,
        })
        let stdout = ""
        let stderr = ""
        let timedOut = false
        const timer = setTimeout(() => {
          timedOut = true
          if (child.pid !== undefined) killTree(child.pid, "SIGKILL")
        }, execOptions.timeoutMs)
        // Streaming decoders, so a character split across two chunks is not garbled.
        const decoders = { stdout: new TextDecoder(), stderr: new TextDecoder() }
        child.stdout.on("data", (chunk: Uint8Array) => {
          if (stdout.length < EXEC_STDIO_CAP)
            stdout += decoders.stdout.decode(chunk, { stream: true })
        })
        child.stderr.on("data", (chunk: Uint8Array) => {
          if (stderr.length < EXEC_STDIO_CAP)
            stderr += decoders.stderr.decode(chunk, { stream: true })
        })
        child.on("error", (error) => {
          clearTimeout(timer)
          done({ stdout: "", stderr: `Could not start the command: ${error.message}`, exitCode: 1 })
        })
        child.on("close", (code) => {
          clearTimeout(timer)
          if (timedOut) {
            const seconds = Math.round(execOptions.timeoutMs / 1000)
            done({
              stdout,
              stderr: `${stderr}\nStopped after the ${seconds}s time limit.`.trim(),
              exitCode: 124,
            })
          } else done({ stdout, stderr, exitCode: code ?? 1 })
        })
      })
    },
    async statSize(target) {
      try {
        const stats = await fs.stat(resolve(target))
        return stats.isFile() ? stats.size : null
      } catch {
        return null
      }
    },
    readFile: async (target) => new Uint8Array(await fs.readFile(resolve(target))),
    async writeFile(target, bytes) {
      const full = resolve(target)
      await fs.mkdir(path.dirname(full), { recursive: true })
      await fs.writeFile(full, bytes)
    },
    async stat(target) {
      try {
        return describe(await fs.lstat(resolve(target)))
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === "ENOENT" || code === "ENOTDIR") return null
        throw error
      }
    },
    async list(target) {
      const full = resolve(target)
      const names = await fs.readdir(full)
      const entries: (RemoteFileStat & { name: string })[] = []
      for (const name of names) {
        try {
          entries.push({ name, ...describe(await fs.lstat(path.join(full, name))) })
        } catch {
          // Removed between listing and looking: leave it out.
        }
      }
      return entries
    },
    realpath: async (target) => shownPath(await fs.realpath(resolve(target))),
    mkdir: async (target, recursive) => void (await fs.mkdir(resolve(target), { recursive })),
    async remove(target, { recursive, force }) {
      const full = resolve(target)
      // `rm` refuses a directory unless recursive; an empty one is removed as `rmdir` would.
      if (!recursive) {
        const stats = await fs.lstat(full).catch((error) => {
          if (force && (error as NodeJS.ErrnoException).code === "ENOENT") return null
          throw error
        })
        if (stats === null) return
        if (stats.isDirectory()) return fs.rmdir(full)
      }
      await fs.rm(full, { recursive, force })
    },
    rename: (from, to) => fs.rename(resolve(from), resolve(to)),
    prepareImage,
    audit: options.audit,
  }
}
