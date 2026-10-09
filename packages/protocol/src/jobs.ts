/**
 * How a command an agent left running in the background stands. `done` ended with exit code 0
 * and `failed` with another; `timed_out` was stopped at its time limit; `stopped` was stopped by
 * the agent or a person; `lost` went with its machine, which stopped or restarted under it.
 */
export type JobStatus = "running" | "done" | "failed" | "stopped" | "timed_out" | "lost"

/** A background command, as the app lists it. */
export type JobSummary = {
  /** What the agent calls it, such as `b3`. */
  id: string
  /** The chat it was started in, where word of its end is sent. */
  chatId: string
  /** The name of the computer it runs on. */
  computer: string
  command: string
  status: JobStatus
  startedAt: number
  endedAt?: number
  exitCode?: number
  /** The file on the computer that everything it prints is written to. */
  log: string
}

/** How long something took, in the two largest units that are not zero: `4m 12s`, `1h 5m`, `38s`. */
export function spanOf(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  if (minutes > 0) return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`
  return `${rest}s`
}

/** How a background command ended, in a few words: "Finished in 4m 12s". */
export function jobOutcome(job: {
  status: JobStatus
  exitCode?: number | undefined
  ms: number
}): string {
  const span = spanOf(job.ms)
  switch (job.status) {
    case "running":
      return `Running for ${span}`
    case "done":
      return `Finished in ${span}`
    case "failed":
      return job.exitCode === undefined
        ? `Failed after ${span}`
        : `Failed (exit ${job.exitCode}) after ${span}`
    case "timed_out":
      return `Stopped at its time limit after ${span}`
    case "stopped":
      return `Stopped after ${span}`
    case "lost":
      return `Lost with its computer after ${span}`
  }
}

/** A background command prints at most this much. Past it, it is stopped. */
export const JOB_LOG_CAP_BYTES = 100 * 1024 * 1024
