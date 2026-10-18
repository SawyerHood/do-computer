import { spawn } from "node:child_process"

export type Command = (
  file: string,
  args: string[],
  options?: { input?: string; signal?: AbortSignal },
) => Promise<Buffer>

/** No shell, bounded output, bounded completion even if a descendant keeps a pipe open. */
export function commands(env: NodeJS.ProcessEnv, timeoutMs = 10_000): Command {
  return (file, args, options = {}) =>
    new Promise((resolve, reject) => {
      if (options.signal?.aborted) return reject(options.signal.reason)
      const child = spawn(file, args, {
        env,
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: true,
      })
      const chunks: Buffer[] = []
      let bytes = 0
      let stderr = ""
      let settled = false
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        process.off("exit", stopping)
        options.signal?.removeEventListener("abort", abort)
        child.stdin.destroy()
        child.stdout.destroy()
        child.stderr.destroy()
        if (error) {
          try {
            if (child.pid)
              process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGKILL")
          } catch {}
          reject(error)
        } else resolve(Buffer.concat(chunks))
      }
      const abort = () => finish(options.signal?.reason ?? new Error("Screen operation aborted"))
      const timer = setTimeout(() => finish(new Error(`${file} timed out`)), timeoutMs)
      const stopping = () => finish(new Error("Daemon stopping"))
      process.once("exit", stopping)
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes > 32 * 1024 * 1024) return finish(new Error(`${file} produced too much output`))
        chunks.push(chunk)
      })
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-2000)
      })
      child.stdout.on("error", finish)
      child.stderr.on("error", finish)
      child.on("error", finish)
      child.on("close", (code) =>
        finish(code === 0 ? undefined : new Error(`${file} failed (${code}): ${stderr.trim()}`)),
      )
      child.stdin.on("error", () => {})
      options.signal?.addEventListener("abort", abort, { once: true })
      if (options.signal?.aborted) return abort()
      child.stdin.end(options.input)
    })
}
