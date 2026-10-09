import { spawn } from "node:child_process"

/**
 * Stop a process and everything it started. Says whether there was anything to tell.
 *
 * Elsewhere that is its process group, which it has to have been started as the leader of.
 * Windows has no process groups and no gentle signal that reaches a console program, so there
 * it is always by force, whichever signal was asked for.
 */
export function killTree(pid: number, signal: "SIGTERM" | "SIGKILL"): boolean {
  if (process.platform === "win32") {
    const taskkill = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    })
    // Already gone, or taskkill could not be started: there is nothing more to do either way.
    taskkill.on("error", () => {})
    return true
  }
  try {
    process.kill(-pid, signal)
    return true
  } catch {
    // Already gone.
    return false
  }
}
