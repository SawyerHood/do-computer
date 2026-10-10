import type { SqliteDatabase } from "@durable-computer/runtime"
import type { ShellAnswer, WorkerShellRpc } from "./index.ts"

type Row = {
  path: string
  kind: "file" | "directory" | "symlink"
  mode: number
  target: string | null
}

async function done(path: string, answer: Promise<ShellAnswer<unknown>>): Promise<void> {
  const answered = await answer
  if (!answered.ok) throw new Error(`${path}: ${answered.message}`)
}

/**
 * Moves the files of a shell that ran inside the server, which kept them in its agent's own
 * database (`dc_fs`), into the shell's object. For `workerShellSandbox`'s `prepare`. The tables
 * are renamed once everything is across, so it happens once, and a move that fails halfway is
 * made again from the start. Modification times are not kept.
 */
export function movedFromDatabase(database: SqliteDatabase) {
  return async (shell: WorkerShellRpc): Promise<void> => {
    const kept = await database.get(
      "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'dc_fs'",
    )
    if (kept === undefined) return
    const rows = await database.all<Row>("SELECT path, kind, mode, target FROM dc_fs ORDER BY path")
    // Parents sort before their children, so each entry's directory already exists.
    for (const row of rows) {
      if (row.path === "/") continue
      if (row.kind === "directory") {
        await done(row.path, shell.mkdir(row.path, true))
      } else if (row.kind === "symlink") {
        await done(row.path, shell.remove(row.path, false, true))
        await done(row.path, shell.symlink(row.target ?? "", row.path))
        continue
      } else {
        const chunks = await database.all<{ data: Uint8Array }>(
          "SELECT data FROM dc_fs_chunks WHERE path = ? ORDER BY seq",
          row.path,
        )
        const content = new Blob(chunks.map((chunk) => chunk.data.slice().buffer)).stream()
        await done(row.path, shell.writeFile(row.path, content))
      }
      await done(row.path, shell.chmod(row.path, row.mode))
    }
    await database.exec(
      "ALTER TABLE dc_fs RENAME TO dc_fs_moved; ALTER TABLE dc_fs_chunks RENAME TO dc_fs_chunks_moved;",
    )
  }
}
