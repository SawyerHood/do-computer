import { type ExecOutcome, SandboxError, type SandboxFs } from "./index.ts"
import { failure, quote } from "./shell-fs.ts"

/** How long a command may run when the caller does not say, and the longest it may ask for. */
export const DEFAULT_EXEC_TIMEOUT_MS = 300_000
export const MAX_EXEC_TIMEOUT_MS = 600_000
/** Exit code of GNU `timeout` when it stopped the command. */
const TIMEOUT_EXIT_CODE = 124
const KILLED_EXIT_CODE = 137
/** Seconds between asking a command to stop and killing it. */
const KILL_AFTER_SECONDS = 5

export function execDeadline(timeoutMs: number | undefined): number {
  return Math.max(1, Math.min(timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS, MAX_EXEC_TIMEOUT_MS))
}

/**
 * The arguments that run `command` in bash with a deadline. GNU `timeout` puts the command in its
 * own process group and signals the whole group, so what the command started stops with it, and a
 * signal sent to `timeout` itself is passed on the same way.
 */
export function boundedArgv(command: string, timeoutMs: number): string[] {
  return [
    "timeout",
    `--kill-after=${KILL_AFTER_SECONDS}`,
    (timeoutMs / 1000).toFixed(3),
    "bash",
    "-c",
    command,
  ]
}

/** `boundedArgv` as one shell command, for a provider that takes a string. */
export function boundedShell(command: string, timeoutMs: number): string {
  return boundedArgv(command, timeoutMs).map(quote).join(" ")
}

/** Whether an exit code means the deadline stopped the command, given how long it ran. */
export function hitDeadline(exitCode: number, elapsedMs: number, timeoutMs: number): boolean {
  // 137 is also what a command killed for any other reason reports, so it only counts once the
  // deadline has passed.
  return exitCode === TIMEOUT_EXIT_CODE || (exitCode === KILLED_EXIT_CODE && elapsedMs >= timeoutMs)
}

type Run = (command: string) => Promise<ExecOutcome>

/**
 * Why a file transfer failed, found by asking the machine. Providers report transfer failures in
 * their own words; the shell says the same thing for all of them.
 */
export async function transferFailure(
  run: Run,
  path: string,
  kind: "read" | "write",
  cause: unknown,
): Promise<SandboxError> {
  const p = quote(path)
  const probe =
    kind === "read"
      ? `if [ -d ${p} ]; then echo 'Is a directory' >&2; exit 1; fi; cat -- ${p} > /dev/null`
      : `d=$(dirname -- ${p})
if [ ! -e "$d" ]; then echo 'No such file or directory' >&2; exit 1; fi
if [ ! -d "$d" ]; then echo 'Not a directory' >&2; exit 1; fi
if [ -d ${p} ]; then echo 'Is a directory' >&2; exit 1; fi
if [ ! -w "$d" ]; then echo 'Permission denied' >&2; exit 1; fi`
  try {
    const outcome = await run(probe)
    if (outcome.exitCode !== 0) return failure(outcome, path)
  } catch {
    // The machine cannot be asked; report what the provider said.
  }
  return new SandboxError("unknown", cause instanceof Error ? cause.message : String(cause), path)
}

/** Whole-file transfer that reports failures as `SandboxError`s, for use with `shellFs`. */
export function checkedTransfer(
  run: Run,
  transfer: Pick<SandboxFs, "readFile" | "writeFile">,
): Pick<SandboxFs, "readFile" | "writeFile"> {
  return {
    readFile: async (path) => {
      try {
        return await transfer.readFile(path)
      } catch (error) {
        if (error instanceof SandboxError) throw error
        throw await transferFailure(run, path, "read", error)
      }
    },
    writeFile: async (path, data) => {
      try {
        await transfer.writeFile(path, data)
      } catch (error) {
        if (error instanceof SandboxError) throw error
        throw await transferFailure(run, path, "write", error)
      }
    },
  }
}

export type RemoteMachineOptions<M> = {
  /** Find the machine, or create it, and make sure it is running. */
  readonly attach: () => Promise<M>
  /** Whether a machine attached earlier is still running. Should be cheap. */
  readonly alive: (machine: M) => Promise<boolean>
  /** A machine unused for this long is checked before it is used again. */
  readonly staleAfterMs: number
  readonly now?: () => number
}

/**
 * A handle on a machine that stops on its own when idle. It attaches on first use, checks a
 * machine it has not used for a while before trusting it, and when an operation fails on a machine
 * that turns out to have stopped, attaches again and repeats the operation once.
 */
export function remoteMachine<M>(options: RemoteMachineOptions<M>) {
  const now = options.now ?? Date.now
  let attached: Promise<M> | undefined
  let usedAt = 0

  const attach = () => {
    const attempt = options.attach()
    attached = attempt
    // A failed attach is not remembered: the next use tries again.
    attempt.catch(() => {
      if (attached === attempt) attached = undefined
    })
    return attempt
  }
  const alive = (machine: M) => options.alive(machine).catch(() => false)

  return {
    get attached() {
      return attached !== undefined
    },
    async use<T>(operation: (machine: M) => Promise<T>): Promise<T> {
      let current = attached
      if (current === undefined) {
        current = attach()
      } else if (now() - usedAt > options.staleAfterMs && !(await alive(await current))) {
        // Someone else may have attached while this was checking.
        current = attached === current ? attach() : (attached ?? attach())
      }
      const machine = await current
      usedAt = now()
      try {
        return await operation(machine)
      } catch (error) {
        if (error instanceof SandboxError || (await alive(machine))) throw error
        const next = attached === current ? attach() : (attached ?? attach())
        const result = await operation(await next)
        usedAt = now()
        return result
      } finally {
        usedAt = now()
      }
    },
  }
}
