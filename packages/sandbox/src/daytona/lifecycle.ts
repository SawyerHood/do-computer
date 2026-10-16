/** The parts of a Daytona sandbox the lifecycle needs. The SDK's `Sandbox` satisfies it. */
export interface DaytonaMachineLike {
  state?: string
  /** Why Daytona put it in `error` or `build_failed`, in Daytona's words. */
  errorReason?: string
  /** Whether Daytona says the error is one `recover()` can undo. */
  recoverable?: boolean
  waitUntilStarted?(timeout?: number): Promise<void>
  /** Bring it back from a recoverable error, and wait until it has started. */
  recover?(timeout?: number): Promise<void>
}

/** The parts of the Daytona client the lifecycle needs. */
export interface DaytonaClientLike<S extends DaytonaMachineLike> {
  get(name: string): Promise<S>
  create(params: Record<string, unknown>): Promise<S>
  start(sandbox: S): Promise<void>
  delete(sandbox: S): Promise<void>
}

/**
 * The agent's computer exists, or might, but cannot be used right now. Never a reason to make a
 * replacement: that would leave the real workspace stranded behind an empty one.
 */
export class SandboxUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "SandboxUnavailableError"
  }
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))

const status = (error: unknown): unknown =>
  typeof error === "object" && error !== null
    ? ((error as { statusCode?: unknown }).statusCode ?? (error as { status?: unknown }).status)
    : undefined

const named = (error: unknown, name: string) =>
  typeof error === "object" && error !== null && (error as { name?: unknown }).name === name

/**
 * Whether Daytona said "there is no such sandbox", as opposed to "I could not tell you". Matched
 * on the status code and the class name, not `instanceof`: two copies of the SDK in one install
 * make `instanceof` quietly false.
 */
export const isNotFound = (error: unknown) =>
  status(error) === 404 || named(error, "DaytonaNotFoundError")

/** Someone else created this name between our look and our create. */
export const isConflict = (error: unknown) =>
  status(error) === 409 || named(error, "DaytonaConflictError")

/** Already on the way to `started`: starting it again races the provider. Wait instead. */
const ARRIVING = new Set([
  "starting",
  "creating",
  "restoring",
  "resuming",
  "pulling_snapshot",
  "pending_build",
  "building",
])
/** On the way down. A start is rejected here and nothing would start it afterwards; let it settle. */
const LEAVING = new Set(["stopping", "archiving", "pausing"])
/** Nothing will start these. Only `error` can be come back from, and only when Daytona says so. */
const BROKEN = new Set(["error", "build_failed", "destroyed", "destroying"])

/** A bound on state changes, so a machine that keeps flapping cannot hold a turn forever. */
const MAX_TRANSITIONS = 12
const POLL_INTERVAL_MS = 1000

export type GetOrCreateOptions = {
  /** What to create the sandbox with when there is none. */
  readonly create: Record<string, unknown>
  /** Injected by tests so they do not wait. */
  readonly sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function reread<S extends DaytonaMachineLike>(
  client: DaytonaClientLike<S>,
  name: string,
  when: string,
): Promise<S> {
  try {
    return await client.get(name)
  } catch (error) {
    throw new SandboxUnavailableError(
      `Daytona could not look up sandbox "${name}" ${when}: ${describe(error)}`,
      { cause: error },
    )
  }
}

/**
 * Find the sandbox with this name, or create it, and bring it to `started`.
 *
 * A sandbox is created only when Daytona says, with a 404, that there is none. A timeout, a rate
 * limit, an expired key and a server error all look like "could not find it" too, and creating a
 * replacement for any of those would give the agent an empty machine in place of its own.
 */
export async function getOrCreateSandbox<S extends DaytonaMachineLike>(
  client: DaytonaClientLike<S>,
  name: string,
  options: GetOrCreateOptions,
): Promise<S> {
  let sandbox: S
  try {
    sandbox = await client.get(name)
  } catch (error) {
    if (!isNotFound(error)) {
      throw new SandboxUnavailableError(
        `Daytona could not look up sandbox "${name}": ${describe(error)}. ` +
          "Not creating a replacement, because this does not mean there is none.",
        { cause: error },
      )
    }
    try {
      sandbox = await client.create({ ...options.create, name })
    } catch (createError) {
      // Lost a race to create it: the name exists now, so use that one.
      if (!isConflict(createError)) {
        throw new SandboxUnavailableError(
          `Daytona could not create sandbox "${name}": ${describe(createError)}`,
          { cause: createError },
        )
      }
      sandbox = await reread(client, name, "after losing a race to create it")
    }
  }
  return ensureStarted(client, sandbox, name, options.sleep ?? defaultSleep)
}

/**
 * Bring a sandbox to `started`, reading its state again after every step instead of assuming the
 * step worked. A conflict from `start()` in particular is not evidence that someone else is
 * starting it: a sandbox that is stopping rejects a start the same way, and then stays stopped.
 */
export async function ensureStarted<S extends DaytonaMachineLike>(
  client: DaytonaClientLike<S>,
  sandbox: S,
  name: string,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<S> {
  let current = sandbox
  // One recovery for each attempt to use the machine: one that fails again is not asked twice.
  let recovered = false
  for (let attempt = 0; attempt < MAX_TRANSITIONS; attempt++) {
    const state = current.state ?? "unknown"
    if (state === "started") return current
    if (BROKEN.has(state)) {
      const reason = current.errorReason?.trim()
      const because = reason ? ` Daytona's reason: ${reason}` : ""
      const recover = current.recover?.bind(current)
      if (state !== "error" || current.recoverable !== true || !recover || recovered) {
        throw new SandboxUnavailableError(
          `Sandbox "${name}" is in state "${state}" and cannot be started` +
            `${recovered ? ", after one recovery" : ""}.${because}`,
        )
      }
      recovered = true
      try {
        await recover()
      } catch (error) {
        throw new SandboxUnavailableError(
          `Sandbox "${name}" is in state "error" and Daytona could not recover it: ` +
            `${describe(error)}.${because}`,
          { cause: error },
        )
      }
      current = await reread(client, name, "after a recovery")
      continue
    }
    if (ARRIVING.has(state)) {
      try {
        await current.waitUntilStarted?.()
      } catch (error) {
        throw new SandboxUnavailableError(
          `Daytona failed while sandbox "${name}" was starting: ${describe(error)}`,
          { cause: error },
        )
      }
      current = await reread(client, name, `while it was "${state}"`)
      continue
    }
    if (LEAVING.has(state)) {
      await sleep(POLL_INTERVAL_MS)
      current = await reread(client, name, `while it was "${state}"`)
      continue
    }
    // Stopped, archived, paused, or a state from a newer Daytona: a start is the thing to try.
    try {
      await client.start(current)
    } catch (error) {
      if (!isConflict(error)) {
        throw new SandboxUnavailableError(
          `Daytona could not start sandbox "${name}": ${describe(error)}`,
          { cause: error },
        )
      }
    }
    current = await reread(client, name, "after a start")
  }
  throw new SandboxUnavailableError(
    `Sandbox "${name}" did not start after ${MAX_TRANSITIONS} state changes ` +
      `(last state: "${current.state ?? "unknown"}").`,
  )
}
