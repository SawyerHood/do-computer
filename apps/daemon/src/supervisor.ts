import { RESTART_EXIT_CODE } from "./update.ts"

/** A new daemon that stops this soon after it was installed is taken not to work. */
const SETTLED_AFTER_MS = 30_000

export type SupervisorOptions = {
  /** Run the daemon itself and resolve with its exit code when it ends. */
  readonly work: () => Promise<number>
  /** Whether this process was told to stop, which the worker ending then is not a failure of. */
  readonly stopping?: () => boolean
  /** Put back the daemon that was replaced. Resolves with whether there was one to put back. */
  readonly restore: () => Promise<boolean>
  /** Called when a new daemon was put back for not starting, so that it is not installed again. */
  readonly onBad: () => void | Promise<void>
  readonly log: (message: string) => void
  readonly now?: () => number
}

/**
 * Keeps the daemon running across its own updates. The daemon proper is a second process, the
 * worker: when it has put a new daemon in its own place it exits saying so, and is started
 * again from the file as it now is. This process never changes, so it does next to nothing.
 *
 * A new daemon that fails straight after being installed is replaced by the one before it, and
 * that version is noted so the worker does not fetch it again. Resolves with the exit code to
 * end with, when the worker ended for any other reason.
 */
export async function supervise(options: SupervisorOptions): Promise<number> {
  const now = options.now ?? Date.now
  let fresh = false
  for (;;) {
    const startedAt = now()
    const code = await options.work()
    if (options.stopping?.() === true) return code
    if (code === RESTART_EXIT_CODE) {
      options.log("Updated. Starting the new daemon.")
      fresh = true
      continue
    }
    if (fresh && code !== 0 && now() - startedAt < SETTLED_AFTER_MS) {
      fresh = false
      if (await options.restore()) {
        await options.onBad()
        options.log("The new daemon would not start, so the one before it is back.")
        continue
      }
    }
    return code
  }
}
