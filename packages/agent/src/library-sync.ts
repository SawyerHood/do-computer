import { type Sandbox, SandboxError } from "@durable-computer/sandbox"
import {
  isLibraryPath,
  type LibraryBackend,
  LibraryError,
  MAX_LIBRARY_FILE_BYTES,
  sha256,
} from "./library-store.ts"

/** A file in the folder, as a listing shows it. Enough to tell that it changed without reading it. */
export type Listed = { readonly size: number; readonly mtimeMs: number }

/**
 * What one file was, in the library and in the folder, when the two last agreed. A side that no
 * longer matches this is the side that changed.
 */
export type Base = { id: string; rev: number; size: number; mtimeMs: number }

export type Stored = { readonly id: string; readonly rev: number; readonly hash?: string }

export type Action =
  /** Take the folder's file into the library, as a new file or as new content. */
  | { readonly do: "pull"; readonly path: string }
  /** Write the library's file into the folder. */
  | { readonly do: "push"; readonly path: string }
  /** The folder no longer has it: take it out of the library. */
  | { readonly do: "drop"; readonly path: string }
  /** The library no longer has it: remove it from the folder. */
  | { readonly do: "unlink"; readonly path: string }
  /** Gone from both. */
  | { readonly do: "forget"; readonly path: string }

/** Folders that are never documents, and would be thousands of files. */
const IGNORED = new Set(["node_modules", "__pycache__"])
const ignored = (name: string) => name.startsWith(".") || IGNORED.has(name)
/** More files than this in the folder is a mistake, not a library, and nothing is taken in. */
const MAX_LISTED = 5_000
const LIST_TIMEOUT_MS = 30_000
/** How many files are written to the computer at once. Each is a round trip on a remote one. */
const PUSH_WIDTH = 6

const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`

class TooManyFiles extends Error {}

/**
 * Every file under `folder`, by its path inside it. Hidden files, dependency folders and links
 * are left out. A folder that is not there is an empty one.
 */
export async function listFolder(sandbox: Sandbox, folder: string): Promise<Map<string, Listed>> {
  const files = new Map<string, Listed>()
  const add = (path: string, listed: Listed) => {
    if (files.size >= MAX_LISTED) throw new TooManyFiles()
    files.set(path, listed)
  }
  if (sandbox.capabilities.realBinaries) {
    // One command for the whole tree, where each directory would otherwise be a round trip.
    const outcome = await sandbox.exec(
      `[ -d ${quote(folder)} ] || exit 0; find ${quote(folder)} -mindepth 1 \\( -name '.*' -o -name node_modules -o -name __pycache__ \\) -prune -o -type f -printf '%s\\t%T@\\t%P\\n'`,
      { timeoutMs: LIST_TIMEOUT_MS },
    )
    if (outcome.exitCode === 0) {
      for (const line of outcome.output.split("\n")) {
        const [size, mtime, ...rest] = line.split("\t")
        const path = rest.join("\t")
        if (path === "" || !/^\d+$/.test(size ?? "") || Number.isNaN(Number(mtime))) continue
        add(path, { size: Number(size), mtimeMs: Math.round(Number(mtime) * 1000) })
      }
      return files
    }
    // No such `find` here. Read it a directory at a time instead.
    files.clear()
  }
  const walk = async (directory: string, prefix: string): Promise<void> => {
    let entries: Awaited<ReturnType<Sandbox["fs"]["list"]>>
    try {
      entries = await sandbox.fs.list(directory)
    } catch (error) {
      if (error instanceof SandboxError && error.code === "not_found") return
      throw error
    }
    const below: Promise<void>[] = []
    for (const entry of entries) {
      if (ignored(entry.name)) continue
      const path = `${prefix}${entry.name}`
      if (entry.kind === "file") add(path, { size: entry.size, mtimeMs: entry.mtimeMs })
      else if (entry.kind === "directory")
        below.push(walk(`${directory}/${entry.name}`, `${path}/`))
    }
    await Promise.all(below)
  }
  await walk(folder, "")
  return files
}

/**
 * What to do so that the folder and the library hold the same files, given what each holds and
 * what they held when they last agreed. A side that differs from that is the side that changed.
 * Where both changed the folder wins: its file is the newer work, and the library keeps what it
 * replaces as a version.
 */
export function plan(
  folder: ReadonlyMap<string, Listed>,
  stored: ReadonlyMap<string, Stored>,
  base: Readonly<Record<string, Base>>,
): Action[] {
  const actions: Action[] = []
  const paths = new Set([...folder.keys(), ...stored.keys(), ...Object.keys(base)])
  for (const path of paths) {
    const there = folder.get(path)
    const kept = stored.get(path)
    const before = Object.hasOwn(base, path) ? base[path] : undefined
    const folderChanged =
      there !== undefined &&
      (before === undefined || there.size !== before.size || there.mtimeMs !== before.mtimeMs)
    const libraryChanged =
      kept !== undefined &&
      (before === undefined || kept.id !== before.id || kept.rev !== before.rev)
    if (there === undefined && kept === undefined) {
      actions.push({ do: "forget", path })
    } else if (there !== undefined && kept === undefined) {
      // Deleted from the library and untouched since: it goes. Otherwise it is new work.
      actions.push({ do: before !== undefined && !folderChanged ? "unlink" : "pull", path })
    } else if (there === undefined && kept !== undefined) {
      actions.push({ do: before !== undefined && !libraryChanged ? "drop" : "push", path })
    } else if (folderChanged) {
      actions.push({ do: "pull", path })
    } else if (libraryChanged) {
      actions.push({ do: "push", path })
    }
  }
  return actions
}

const megabytes = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`

/**
 * One pass of bringing a library folder and the library into step. Returns the new record of
 * what they agree on, what could not be taken in, and the failure that stopped it early, if one
 * did: what was done before that is still recorded.
 */
export async function syncFolder(input: {
  library: Pick<LibraryBackend, "stored" | "bytes" | "add" | "write" | "move" | "remove">
  /** The pass this is, which the library is told with every change it makes. */
  pass?: string
  /** The agent doing it, which a file it brings in is put down to. */
  agentId?: string
  sandbox: Sandbox
  folder: string
  base: Readonly<Record<string, Base>>
}): Promise<{
  base: Record<string, Base>
  changed: boolean
  problems: string[]
  failed?: unknown
}> {
  const { library, sandbox, folder, pass } = input
  const base: Record<string, Base> = { ...input.base }
  const problems: string[] = []
  let changed = false
  const settle = (path: string, value: Base | undefined) => {
    changed = true
    if (value === undefined) delete base[path]
    else base[path] = value
  }
  try {
    let listed: Map<string, Listed>
    try {
      listed = await listFolder(sandbox, folder)
    } catch (error) {
      if (!(error instanceof TooManyFiles)) throw error
      return {
        base,
        changed,
        problems: [
          `Nothing in ${folder} was taken into the user's library: it holds more than ${MAX_LISTED} files. Keep only documents and what they need there, and move the rest elsewhere in your workspace.`,
        ],
      }
    }
    const stored = await library.stored()
    const actions = plan(listed, stored, base)
    if (actions.length === 0) return { base, changed, problems }

    const dropping = new Set(
      actions.flatMap((action) => (action.do === "drop" ? [action.path] : [])),
    )
    for (const action of actions) {
      if (action.do !== "pull") continue
      const { path } = action
      const there = listed.get(path)!
      if (!isLibraryPath(path)) {
        problems.push(
          `${folder}/${path} was not added to the user's library: its name or a folder's is one the library cannot use.`,
        )
        continue
      }
      if (there.size > MAX_LIBRARY_FILE_BYTES) {
        problems.push(
          `${folder}/${path} was not added to the user's library: it is ${megabytes(there.size)}, and files up to ${megabytes(MAX_LIBRARY_FILE_BYTES)} are kept.`,
        )
        continue
      }
      let bytes: Uint8Array
      try {
        bytes = await sandbox.fs.readFile(`${folder}/${path}`)
      } catch (error) {
        // Gone again since it was listed. The next pass sees it as it then is.
        if (error instanceof SandboxError && error.code === "not_found") continue
        throw error
      }
      try {
        const kept = stored.get(path)
        let file: { id: string; rev: number }
        if (kept !== undefined) {
          file = await library.write(kept.id, bytes, "agent", { pass })
        } else {
          // A file that appeared with the content of one that vanished was renamed, not replaced.
          const hash = await sha256(bytes)
          const from = [...dropping].find((old) => stored.get(old)?.hash === hash)
          if (from !== undefined) {
            dropping.delete(from)
            settle(from, undefined)
            file = await library.move(stored.get(from)!.id, path, { exact: true, pass })
          } else {
            file = await library.add({
              path,
              bytes,
              source: "agent",
              chatId: null,
              agentId: input.agentId,
              pass,
            })
          }
        }
        settle(path, { id: file.id, rev: file.rev, size: there.size, mtimeMs: there.mtimeMs })
      } catch (error) {
        if (!(error instanceof LibraryError)) throw error
        problems.push(`${folder}/${path} was not added to the user's library: ${error.message}`)
      }
    }

    for (const action of actions) {
      const { path } = action
      if (action.do === "forget") settle(path, undefined)
      if (action.do === "drop" && dropping.has(path)) {
        await library.remove(stored.get(path)!.id, "agent", { pass })
        settle(path, undefined)
      }
      if (action.do === "unlink") {
        await sandbox.fs.remove(`${folder}/${path}`, { recursive: false, force: true })
        settle(path, undefined)
      }
    }

    const pushes = actions.flatMap((action) => (action.do === "push" ? [action.path] : []))
    if (pushes.length > 0) {
      const made = new Set<string>()
      const directories = new Set(
        pushes.map((path) => `${folder}/${path}`.slice(0, `${folder}/${path}`.lastIndexOf("/"))),
      )
      // Shortest first, so a directory is made before the ones inside it are asked for.
      for (const directory of [...directories].sort((a, b) => a.length - b.length)) {
        if (made.has(directory)) continue
        await sandbox.fs.mkdir(directory, { recursive: true })
        made.add(directory)
      }
      const written = new Map<string, { id: string; rev: number; size: number }>()
      const queue = [...pushes]
      await Promise.all(
        Array.from({ length: Math.min(PUSH_WIDTH, queue.length) }, async () => {
          for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
            const kept = stored.get(path)!
            const bytes = await library.bytes(kept)
            // Its bytes are missing. Nothing to write, and nothing to delete from the library for.
            if (bytes === undefined) continue
            await sandbox.fs.writeFile(`${folder}/${path}`, bytes)
            written.set(path, { id: kept.id, rev: kept.rev, size: bytes.length })
          }
        }),
      )
      await sandbox.flush()
      // What the folder now says of them is what a later change is measured against.
      const after = await listFolder(sandbox, folder)
      for (const [path, kept] of written) {
        const there = after.get(path)
        // Changed again already, by something still running: left for the next pass to compare.
        if (there === undefined || there.size !== kept.size) settle(path, undefined)
        else settle(path, { id: kept.id, rev: kept.rev, size: there.size, mtimeMs: there.mtimeMs })
      }
    }
    return { base, changed, problems }
  } catch (failed) {
    return { base, changed, problems, failed }
  }
}
