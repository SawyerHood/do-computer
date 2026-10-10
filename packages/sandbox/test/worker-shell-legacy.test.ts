import { openNodeSqliteDatabase } from "@earendil-works/pi-durable/storage/sqlite/node"
import { describe, expect, it } from "vitest"
import { createJustBashSandbox } from "../src/index.ts"
import type { WorkerShellRpc } from "../src/worker-shell/index.ts"
import { movedFromDatabase } from "../src/worker-shell/legacy.ts"

/** A shell that only remembers what it was asked to keep. */
function recorder() {
  const kept: string[] = []
  const ok = async (line: string) => {
    kept.push(line)
    return { ok: true as const, value: null }
  }
  const shell = {
    mkdir: (path: string) => ok(`dir ${path}`),
    remove: (path: string) => ok(`rm ${path}`),
    symlink: (target: string, path: string) => ok(`link ${path} -> ${target}`),
    chmod: (path: string, mode: number) => ok(`mode ${path} ${mode.toString(8)}`),
    writeFile: async (path: string, data: ReadableStream<Uint8Array>) =>
      ok(`file ${path} ${(await new Response(data).arrayBuffer()).byteLength}`),
  } as unknown as WorkerShellRpc
  return { shell, kept }
}

describe("worker shell: moving in what the shell inside the server kept", () => {
  it("reads every file, directory and link from the agent's database, then sets it aside", async () => {
    const database = await openNodeSqliteDatabase(":memory:")
    const old = await createJustBashSandbox({ id: "a", database })
    await old.exec(
      "mkdir -p proj/empty && printf hello > proj/a.txt && chmod 700 proj/a.txt && ln -s a.txt proj/link",
    )
    await old.fs.writeFile("/workspace/big.bin", new Uint8Array(1_300_000))
    await old.flush()

    const { shell, kept } = recorder()
    await movedFromDatabase(database)(shell)
    expect(kept).toEqual([
      "dir /tmp",
      "mode /tmp 755",
      "dir /workspace",
      "mode /workspace 755",
      "file /workspace/big.bin 1300000",
      "mode /workspace/big.bin 644",
      "dir /workspace/proj",
      "mode /workspace/proj 755",
      "file /workspace/proj/a.txt 5",
      "mode /workspace/proj/a.txt 700",
      "dir /workspace/proj/empty",
      "mode /workspace/proj/empty 755",
      "rm /workspace/proj/link",
      "link /workspace/proj/link -> a.txt",
    ])

    // Once: there is nothing left under the old name to move again.
    const again = recorder()
    await movedFromDatabase(database)(again.shell)
    expect(again.kept).toEqual([])
    const moved = await database.get<{ n: number }>("SELECT COUNT(*) AS n FROM dc_fs_moved")
    expect(moved?.n).toBe(7)
  })

  it("does nothing for an agent that never had such a shell", async () => {
    const { shell, kept } = recorder()
    await movedFromDatabase(await openNodeSqliteDatabase(":memory:"))(shell)
    expect(kept).toEqual([])
  })

  it("leaves the files where they were when the move fails, to be made again", async () => {
    const database = await openNodeSqliteDatabase(":memory:")
    await (await createJustBashSandbox({ id: "a", database })).exec("echo x > a.txt")
    const shell = {
      mkdir: async () => ({ ok: false, code: "unknown", message: "the shell is away" }),
    } as unknown as WorkerShellRpc
    await expect(movedFromDatabase(database)(shell)).rejects.toThrow("the shell is away")
    const { shell: working, kept } = recorder()
    await movedFromDatabase(database)(working)
    expect(kept).toContain("file /workspace/a.txt 2")
  })
})
