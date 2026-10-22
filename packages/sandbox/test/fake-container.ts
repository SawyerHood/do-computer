import { spawn } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import type {
  ContainerLike,
  ContainerProcessLike,
  MachineStore,
} from "../src/cloudflare/machine.ts"

type StartOptions = Parameters<ContainerLike["start"]>[0]

/**
 * `ctx.container` for tests. Commands really run, as processes on this machine, and the machine's
 * disk is a directory that is emptied when the machine stops, copied by a snapshot and copied back
 * by a restore. So what a test sees survive a stop is exactly what a snapshot carried.
 */
export function fakeContainer() {
  const root = mkdtempSync(join(tmpdir(), "dc-container-"))
  const disk = join(root, "disk")
  const snapshots = new Map<string, string>()
  /** Process groups started on the machine. A stopping machine takes all of them with it. */
  const groups = new Set<number>()
  const state = {
    running: false,
    starts: [] as StartOptions[],
    destroyed: [] as unknown[],
    inactivityTimeouts: [] as number[],
    /** Snapshot ids the platform has forgotten. */
    expired: new Set<string>(),
    failed: undefined as Error | undefined,
  }

  const stop = () => {
    for (const group of groups) {
      try {
        process.kill(-group, "SIGKILL")
      } catch {
        // Already gone.
      }
    }
    groups.clear()
    state.running = false
    rmSync(disk, { recursive: true, force: true })
  }

  const container: ContainerLike = {
    get running() {
      return state.running
    },
    images: { custom: "registry.example/custom@sha256:abc" },
    start(options) {
      if (state.running) throw new Error("The container is already running")
      state.starts.push(options)
      state.failed = undefined
      rmSync(disk, { recursive: true, force: true })
      const snapshot = options.containerSnapshot?.id
      if (snapshot !== undefined) {
        const saved = snapshots.get(snapshot)
        // Like the platform, `start()` itself succeeds; the failure shows on first use.
        if (saved === undefined || state.expired.has(snapshot)) {
          state.failed = new Error(`Snapshot "${snapshot}" was not found.`)
        } else {
          cpSync(saved, disk, { recursive: true, verbatimSymlinks: true })
        }
      } else {
        mkdirSync(disk, { recursive: true })
      }
      state.running = true
    },
    async exec(cmd, options = {}) {
      if (!state.running) throw new Error("The container is not running")
      if (state.failed !== undefined) {
        state.running = false
        throw state.failed
      }
      const child = spawn(cmd[0]!, cmd.slice(1), {
        cwd: options.cwd,
        // Only what was passed, and PATH: what a real exec gives a process.
        env: { PATH: process.env.PATH, ...options.env },
        detached: true,
        stdio: [options.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      })
      if (child.pid !== undefined) groups.add(child.pid)
      if (options.stdin !== undefined && child.stdin) {
        // A process that exits without reading its input is its own business.
        child.stdin.on("error", () => {})
        Readable.fromWeb(options.stdin as never).pipe(child.stdin)
      }
      const exitCode = new Promise<number>((resolve, reject) => {
        child.on("error", reject)
        child.on("close", (code, signal) => {
          resolve(code ?? (signal === "SIGKILL" ? 137 : 143))
        })
      })
      const combined = options.stderr === "combined"
      const chunks = { stdout: [] as Buffer[], stderr: [] as Buffer[] }
      let consumed = false
      let cancelled = false
      const stdout = new ReadableStream<Uint8Array>({
        start(controller) {
          let open = combined ? 2 : 1
          const end = () => {
            if (--open === 0 && !cancelled) controller.close()
          }
          const data = (chunk: Buffer) => {
            if (!cancelled) controller.enqueue(new Uint8Array(chunk))
          }
          child.stdout!.on("data", data)
          child.stdout!.on("end", end)
          if (combined) {
            child.stderr!.on("data", data)
            child.stderr!.on("end", end)
          }
        },
        cancel() {
          cancelled = true
        },
      })
      if (!combined) child.stderr!.on("data", (chunk: Buffer) => chunks.stderr.push(chunk))
      const process_: ContainerProcessLike = {
        stdout,
        exitCode,
        async output() {
          if (consumed) throw new TypeError("output() was already called")
          consumed = true
          const reader = stdout.getReader()
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            chunks.stdout.push(Buffer.from(value))
          }
          const buffer = (parts: Buffer[]) => {
            const all = Buffer.concat(parts)
            return all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength) as ArrayBuffer
          }
          // The exit comes after every stream has closed, so stderr is complete by then. Reading
          // it any earlier loses what arrives after stdout ends.
          const code = await exitCode
          return { stdout: buffer(chunks.stdout), stderr: buffer(chunks.stderr), exitCode: code }
        },
        kill(signal = 15) {
          child.kill(signal)
        },
      }
      return process_
    },
    async snapshotContainer(options) {
      if (!state.running) throw new Error("The container is not running")
      const id = `snap-${snapshots.size + 1}`
      const target = join(root, id)
      cpSync(disk, target, { recursive: true, verbatimSymlinks: true })
      snapshots.set(id, target)
      return { id, size: 1, name: options.name }
    },
    async destroy(reason) {
      state.destroyed.push(reason)
      stop()
    },
    async setInactivityTimeout(durationMs) {
      state.inactivityTimeouts.push(durationMs)
    },
  }

  return {
    container,
    state,
    /** The machine's workspace directory: a real path, since commands really run here. */
    home: join(disk, "workspace"),
    snapshots,
    /** The platform stopping the machine on its own, as when the inactivity timeout ends. */
    stop,
    cleanup: () => {
      stop()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

/** Durable Object storage, in memory. */
export function fakeStore() {
  const values = new Map<string, unknown>()
  let alarm: number | null = null
  const store: MachineStore = {
    get: async <T>(key: string) => values.get(key) as T | undefined,
    put: async (entries) => {
      for (const [key, value] of Object.entries(entries)) values.set(key, value)
    },
    delete: async (keys) => {
      for (const key of keys) values.delete(key)
    },
    getAlarm: async () => alarm,
    setAlarm: async (at) => {
      alarm = at
    },
  }
  return {
    store,
    values,
    get alarm() {
      return alarm
    },
    /** What the runtime does when it fires an alarm: there is none set while the handler runs. */
    takeAlarm() {
      const at = alarm
      alarm = null
      return at
    },
  }
}
