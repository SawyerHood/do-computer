import { openNodeSqliteDatabase } from "@earendil-works/pi-durable/storage/sqlite/node"
import { registerEnvConformance } from "@earendil-works/pi-durable/testing"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { describe, expect, it } from "vitest"
import type { ExecutionEnv } from "@earendil-works/pi-durable/env"
import { createJustBashSandbox, type Sandbox, SandboxEnv } from "../src/index.ts"
import { createLocalProcessSandbox, registerSandboxConformance } from "../src/testing.ts"

registerSandboxConformance({ describe, it, expect }, "just-bash", async () =>
  createJustBashSandbox({ id: "test", database: await openNodeSqliteDatabase(":memory:") }),
)

registerSandboxConformance({ describe, it, expect }, "shell (real coreutils)", async () =>
  createLocalProcessSandbox(),
)

// pi-durable's own environment suite, less what a sandbox does not offer: it cannot be watched
// for file changes, and it reports what a command printed as one stream.
const offered = (name: string) =>
  !name.startsWith("watch ") && name !== "exec reports the stream of every chunk in both forms"
const environmentRunner = {
  describe,
  expect,
  it: (name: string, test: () => Promise<void>, timeoutMs?: number) =>
    offered(name) ? it(name, test, timeoutMs) : it.skip(name, test),
}

registerEnvConformance(environmentRunner, "just-bash: environment", async (use) => {
  const database = await openNodeSqliteDatabase(":memory:")
  await use(new SandboxEnv(await createJustBashSandbox({ id: "test", database })))
})

registerEnvConformance(environmentRunner, "shell (real coreutils): environment", async (use) => {
  await use(new SandboxEnv(createLocalProcessSandbox()))
})

describe("just-bash: durability", () => {
  const context = BACKGROUND_CONTEXT
  const environment = (sandbox: Sandbox): ExecutionEnv => new SandboxEnv(sandbox)

  it("keeps the workspace across a reopen, exactly", async () => {
    const database = await openNodeSqliteDatabase(":memory:")
    const first = environment(await createJustBashSandbox({ id: "a", database }))
    const big = Uint8Array.from({ length: 1_300_000 }, (_, index) => (index * 31) % 251)
    await first.writeFile("big.bin", big, context)
    await first.createDir("empty/inner", { recursive: true }, context)
    await first.exec(
      "mkdir -p proj/src && echo 'hello' > proj/src/main.txt && chmod 700 proj/src/main.txt && ln -s src/main.txt proj/link && echo gone > doomed.txt",
      undefined,
      context,
    )
    await first.exec(
      "rm doomed.txt && mv proj project && echo 'it%s_a\\name' > 'odd%_name.txt'",
      undefined,
      context,
    )

    const second = environment(await createJustBashSandbox({ id: "a", database }))
    const read = await second.readBinaryFile("big.bin", context)
    expect(read.ok && read.value.length).toBe(big.length)
    expect(read.ok && read.value.every((byte, index) => byte === big[index])).toBe(true)
    expect(await second.readTextFile("project/src/main.txt", context)).toEqual({
      ok: true,
      value: "hello\n",
    })
    expect(await second.readTextFile("project/link", context)).toEqual({
      ok: true,
      value: "hello\n",
    })
    const link = await second.fileInfo("project/link", context)
    expect(link.ok && link.value.kind).toBe("symlink")
    const empty = await second.fileInfo("empty/inner", context)
    expect(empty.ok && empty.value.kind).toBe("directory")
    expect(await second.exists("doomed.txt", context)).toEqual({ ok: true, value: false })
    expect(await second.exists("proj", context)).toEqual({ ok: true, value: false })
    expect((await second.readTextFile("odd%_name.txt", context)).ok).toBe(true)
    let mode = ""
    await second.exec(
      "stat -c %a project/src/main.txt",
      { onOutput: (chunk) => (mode += chunk) },
      context,
    )
    expect(mode.trim()).toBe("700")
  })

  it("removing a directory does not remove a sibling that shares its prefix", async () => {
    const database = await openNodeSqliteDatabase(":memory:")
    const first = environment(await createJustBashSandbox({ id: "a", database }))
    await first.exec(
      "mkdir a a_b && echo keep > a_b/file && echo drop > a/file && rm -r a",
      undefined,
      context,
    )
    const second = environment(await createJustBashSandbox({ id: "a", database }))
    expect(await second.readTextFile("a_b/file", context)).toEqual({ ok: true, value: "keep\n" })
    expect(await second.exists("a", context)).toEqual({ ok: true, value: false })
  })

  it("keeps two agents' files apart in separate databases", async () => {
    const one = environment(
      await createJustBashSandbox({
        id: "one",
        database: await openNodeSqliteDatabase(":memory:"),
      }),
    )
    const two = environment(
      await createJustBashSandbox({
        id: "two",
        database: await openNodeSqliteDatabase(":memory:"),
      }),
    )
    await one.writeFile("secret.txt", "one's", context)
    expect(await two.exists("secret.txt", context)).toEqual({ ok: true, value: false })
  })
})
