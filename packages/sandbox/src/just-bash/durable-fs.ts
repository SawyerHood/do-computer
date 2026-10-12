import type { SqliteDatabase, SqliteExecutor } from "@do-computer/runtime"
import { type IFileSystem, InMemoryFs } from "just-bash/browser"

/** Durable Object SQLite caps a row at 2 MB, so file content is stored in pieces. */
const CHUNK_BYTES = 512 * 1024

type Row = {
  path: string
  kind: "file" | "directory" | "symlink"
  mode: number
  mtime: number
  target: string | null
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS dc_fs (
  path TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('file', 'directory', 'symlink')),
  mode INTEGER NOT NULL,
  mtime INTEGER NOT NULL,
  target TEXT
) STRICT;
CREATE TABLE IF NOT EXISTS dc_fs_chunks (
  path TEXT NOT NULL,
  seq INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (path, seq)
) STRICT;`

/** `LIKE` pattern matching everything under `path`. */
const under = (path: string) => `${path.replace(/[\\%_]/g, "\\$&")}/%`

const parent = (path: string) => path.slice(0, path.lastIndexOf("/")) || "/"

function concat(chunks: Uint8Array[]): Uint8Array {
  const joined = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.length
  }
  return joined
}

/**
 * A just-bash filesystem that survives restarts. Work happens in memory; every mutation records
 * which subtree it touched, and `flush()` rewrites exactly those subtrees in SQLite inside one
 * transaction. Opening reads the stored tree back into memory.
 */
export class DurableFs {
  readonly fs: IFileSystem
  readonly #memory: InMemoryFs
  readonly #database: SqliteDatabase
  /** Roots of subtrees whose stored copy is out of date. */
  readonly #dirty = new Set<string>()
  #flushing: Promise<void> = Promise.resolve()

  private constructor(database: SqliteDatabase, memory: InMemoryFs) {
    this.#database = database
    this.#memory = memory
    this.fs = this.#track(memory)
  }

  static async open(database: SqliteDatabase, maxTotalBytes: number): Promise<DurableFs> {
    await database.exec(SCHEMA)
    const memory = new InMemoryFs(undefined, { maxTotalBytes })
    const rows = await database.all<Row>(
      "SELECT path, kind, mode, mtime, target FROM dc_fs ORDER BY path",
    )
    // Parents sort before their children, so each entry's directory already exists.
    for (const row of rows) {
      const mtime = new Date(row.mtime)
      if (row.kind === "directory") {
        if (row.path !== "/") await memory.mkdir(row.path, { recursive: true })
      } else if (row.kind === "symlink") {
        await memory.symlink(row.target ?? "", row.path)
        continue
      } else {
        const chunks = await database.all<{ data: Uint8Array }>(
          "SELECT data FROM dc_fs_chunks WHERE path = ? ORDER BY seq",
          row.path,
        )
        await memory.writeFile(row.path, concat(chunks.map((chunk) => chunk.data)))
      }
      await memory.chmod(row.path, row.mode)
      await memory.utimes(row.path, mtime, mtime)
    }
    return new DurableFs(database, memory)
  }

  /** The same filesystem, with each mutating call noting what it changed. */
  #track(memory: InMemoryFs): IFileSystem {
    const mark = (...paths: string[]) => {
      for (const path of paths) this.#dirty.add(memory.resolvePath("/", path))
    }
    const mutations: Record<string, (args: unknown[]) => void> = {
      writeFile: ([path]) => mark(path as string),
      appendFile: ([path]) => mark(path as string),
      createExclusive: ([path]) => mark(path as string),
      // A recursive mkdir may create ancestors; storing a path stores its missing parents too.
      mkdir: ([path]) => mark(path as string),
      rm: ([path]) => mark(path as string),
      cp: ([, destination]) => mark(destination as string),
      mv: ([source, destination]) => mark(source as string, destination as string),
      chmod: ([path]) => mark(path as string),
      symlink: ([, link]) => mark(link as string),
      link: ([, created]) => mark(created as string),
      utimes: ([path]) => mark(path as string),
    }
    return new Proxy(memory, {
      get: (target, property, receiver) => {
        const value = Reflect.get(target, property, receiver)
        if (typeof value !== "function") return value
        const note = mutations[property as string]
        if (note === undefined) return value.bind(target)
        return async (...args: unknown[]) => {
          try {
            return await value.apply(target, args)
          } finally {
            // Marked even when the call fails: a partial copy or move still changed the tree.
            note(args)
          }
        }
      },
    }) as IFileSystem
  }

  /** Store every change made since the last flush. Concurrent calls run one after another. */
  flush(): Promise<void> {
    this.#flushing = this.#flushing.then(
      () => this.#flush(),
      () => this.#flush(),
    )
    return this.#flushing
  }

  async #flush(): Promise<void> {
    if (this.#dirty.size === 0) return
    const roots = [...this.#dirty].sort()
    this.#dirty.clear()
    // A root inside another dirty root is rewritten with it.
    const outer = roots.filter(
      (root, index) => !roots.slice(0, index).some((other) => root.startsWith(`${other}/`)),
    )
    try {
      await this.#database.transaction(async (transaction) => {
        for (const root of outer) {
          await transaction.run(
            "DELETE FROM dc_fs_chunks WHERE path = ? OR path LIKE ? ESCAPE '\\'",
            root,
            under(root),
          )
          await transaction.run(
            "DELETE FROM dc_fs WHERE path = ? OR path LIKE ? ESCAPE '\\'",
            root,
            under(root),
          )
          if (await this.#exists(root)) {
            await this.#storeAncestors(transaction, root)
            await this.#store(transaction, root)
          }
        }
      })
    } catch (error) {
      for (const root of outer) this.#dirty.add(root)
      throw error
    }
  }

  async #exists(path: string): Promise<boolean> {
    try {
      await this.#memory.lstat(path)
      return true
    } catch {
      return false
    }
  }

  async #storeAncestors(transaction: SqliteExecutor, path: string): Promise<void> {
    const missing: string[] = []
    for (let ancestor = parent(path); ancestor !== "/"; ancestor = parent(ancestor)) {
      const stored = await transaction.get("SELECT 1 AS found FROM dc_fs WHERE path = ?", ancestor)
      if (stored !== undefined) break
      missing.push(ancestor)
    }
    for (const ancestor of missing.reverse()) {
      const stat = await this.#memory.lstat(ancestor)
      await transaction.run(
        "INSERT OR REPLACE INTO dc_fs (path, kind, mode, mtime, target) VALUES (?, 'directory', ?, ?, NULL)",
        ancestor,
        stat.mode,
        stat.mtime.getTime(),
      )
    }
  }

  async #store(transaction: SqliteExecutor, path: string): Promise<void> {
    const stat = await this.#memory.lstat(path)
    const insert = (kind: Row["kind"], target: string | null) =>
      transaction.run(
        "INSERT OR REPLACE INTO dc_fs (path, kind, mode, mtime, target) VALUES (?, ?, ?, ?, ?)",
        path,
        kind,
        stat.mode,
        stat.mtime.getTime(),
        target,
      )
    if (stat.isSymbolicLink) {
      await insert("symlink", await this.#memory.readlink(path))
    } else if (stat.isDirectory) {
      await insert("directory", null)
      for (const name of await this.#memory.readdir(path)) {
        await this.#store(transaction, path === "/" ? `/${name}` : `${path}/${name}`)
      }
    } else {
      await insert("file", null)
      const content = await this.#memory.readFileBuffer(path)
      for (let offset = 0, seq = 0; offset < content.length; offset += CHUNK_BYTES, seq++) {
        await transaction.run(
          "INSERT INTO dc_fs_chunks (path, seq, data) VALUES (?, ?, ?)",
          path,
          seq,
          content.subarray(offset, offset + CHUNK_BYTES),
        )
      }
    }
  }
}
