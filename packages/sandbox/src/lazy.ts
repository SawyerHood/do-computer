import type { Sandbox } from "./index.ts"

export type LazySandboxOptions = Pick<Sandbox, "id" | "home" | "capabilities"> & {
  /** Start or attach to the real sandbox. Called on first use; a failure is retried on the next. */
  readonly acquire: () => Promise<Sandbox>
}

/**
 * A sandbox that costs nothing until something runs in it. An agent's environment is built for
 * every model request, but most requests never touch the computer; this keeps a remote machine
 * from being started just to describe it.
 */
export function lazySandbox(options: LazySandboxOptions): Sandbox & { readonly started: boolean } {
  let acquired: Promise<Sandbox> | undefined
  let started = false
  const real = () => {
    acquired ??= options.acquire().then(
      (sandbox) => {
        started = true
        return sandbox
      },
      (error) => {
        acquired = undefined
        throw error
      },
    )
    return acquired
  }
  return {
    id: options.id,
    home: options.home,
    capabilities: options.capabilities,
    get started() {
      return started
    },
    exec: async (command, execOptions) => (await real()).exec(command, execOptions),
    // Nothing was written if nothing was ever started.
    flush: async () => {
      if (acquired !== undefined) await (await acquired).flush()
    },
    fs: {
      stat: async (path) => (await real()).fs.stat(path),
      list: async (path) => (await real()).fs.list(path),
      readFile: async (path) => (await real()).fs.readFile(path),
      writeFile: async (path, data) => (await real()).fs.writeFile(path, data),
      mkdir: async (path, mkdirOptions) => (await real()).fs.mkdir(path, mkdirOptions),
      remove: async (path, removeOptions) => (await real()).fs.remove(path, removeOptions),
      rename: async (from, to) => (await real()).fs.rename(from, to),
      realpath: async (path) => (await real()).fs.realpath(path),
    },
  }
}
