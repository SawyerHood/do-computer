import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"

/** What a worker exits with to say "the daemon on disk is a new one: start it". */
export const RESTART_EXIT_CODE = 75

/** What the server says the daemon it serves is. */
export type Offered = {
  /** Changes exactly when the daemon's code does. */
  version: string
  /** Of the file at `/daemon.js`, in hex, so that a download cut short is not installed. */
  sha256: string
}

export type UpdateOptions = {
  /** The deployment this computer is paired with, which is where its daemon comes from. */
  readonly server: string
  /** The version that is running. */
  readonly current: string
  /** The file the daemon runs from, which a new one replaces. */
  readonly script: string
  /** The Node that runs it. */
  readonly node: string
  /** A version that was installed and would not start. It is not installed again. */
  readonly bad?: string | undefined
  readonly fetch?: typeof fetch
}

export type UpdateOutcome =
  | { readonly outcome: "current" }
  /** The server offers the version that would not start. */
  | { readonly outcome: "skipped"; readonly version: string }
  | { readonly outcome: "installed"; readonly from: string; readonly version: string }

/** The file a new daemon is written to before it takes the place of the one that is running. */
export const incomingPath = (script: string) => `${script}.new`
/** Where the daemon that was replaced is kept, in case the new one will not start. */
export const previousPath = (script: string) => `${script}.previous`

const run = (file: string, args: string[]) =>
  new Promise<string>((resolve, reject) => {
    execFile(file, args, { timeout: 20_000 }, (error, stdout) =>
      error === null ? resolve(String(stdout)) : reject(error),
    )
  })

/**
 * See whether the server serves a newer daemon than the one running, and if so put it in the
 * running one's place. The caller restarts.
 *
 * A new daemon is checked twice before it replaces anything: that what arrived is what the
 * server said it would send, and that it runs here and is the version it was said to be. The
 * old one is kept beside it, so that a daemon which then will not start can be put back.
 */
export async function update(options: UpdateOptions): Promise<UpdateOutcome> {
  const get = options.fetch ?? fetch
  const answered = await get(`${options.server}/api/daemon-version`)
  if (!answered.ok) throw new Error(`The server answered ${answered.status} for its version.`)
  const offered = (await answered.json()) as Partial<Offered>
  if (typeof offered.version !== "string" || offered.version === "") {
    throw new Error("The server did not say which version it serves.")
  }
  if (offered.version === options.current) return { outcome: "current" }
  if (offered.version === options.bad) return { outcome: "skipped", version: offered.version }
  // A server from before daemons updated themselves says no more than the version.
  if (typeof offered.sha256 !== "string") {
    throw new Error("The server does not say what its daemon should add up to.")
  }

  const downloaded = await get(`${options.server}/daemon.js`)
  if (!downloaded.ok) throw new Error(`The server answered ${downloaded.status} for the daemon.`)
  const bundle = new Uint8Array(await downloaded.arrayBuffer())
  const sum = createHash("sha256").update(bundle).digest("hex")
  if (sum !== offered.sha256) {
    throw new Error("What was downloaded is not what the server said it would send.")
  }

  const incoming = incomingPath(options.script)
  await fs.writeFile(incoming, bundle, { mode: 0o755 })
  try {
    const says = (await run(options.node, [incoming, "--version"])).trim()
    if (says !== offered.version) {
      throw new Error(`The new daemon says it is "${says}", not ${offered.version}.`)
    }
    await fs.copyFile(options.script, previousPath(options.script))
    // In one step, so that there is never half a daemon where the service looks for one.
    await fs.rename(incoming, options.script)
  } catch (error) {
    await fs.rm(incoming, { force: true })
    throw error
  }
  return { outcome: "installed", from: options.current, version: offered.version }
}

/** Put back the daemon that the running one replaced. Resolves with whether there was one. */
export async function restorePrevious(script: string): Promise<boolean> {
  try {
    await fs.rename(previousPath(script), script)
    return true
  } catch {
    return false
  }
}
