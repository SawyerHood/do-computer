import { env } from "cloudflare:test"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { ExecutionEnv } from "@earendil-works/pi-durable/env"
import { registerEnvConformance } from "@earendil-works/pi-durable/testing"
import { describe, expect, it } from "vitest"
import { type Sandbox, SandboxEnv } from "../../src/index.ts"
import { registerSandboxConformance } from "../../src/testing.ts"
import { workerShellSandbox } from "../../src/worker-shell/index.ts"
import { movedFromDatabase } from "../../src/worker-shell/legacy.ts"
import type { Env } from "./worker.ts"

const bindings = env as unknown as Env
const context = BACKGROUND_CONTEXT

const open = (id: string = crypto.randomUUID()): Sandbox =>
  workerShellSandbox({ id, shell: bindings.SHELL.get(bindings.SHELL.idFromName(id)) })

registerSandboxConformance({ describe, it, expect }, "worker shell", async () => open())

// pi-durable's own environment suite, less what a sandbox does not offer: it cannot be watched
// for file changes, and it reports what a command printed as one stream.
const offered = (name: string) =>
  !name.startsWith("watch ") && name !== "exec reports the stream of every chunk in both forms"
registerEnvConformance(
  {
    describe,
    expect,
    it: (name: string, test: () => Promise<void>, timeoutMs?: number) =>
      offered(name) ? it(name, test, timeoutMs) : it.skip(name, test),
  },
  "worker shell: environment",
  async (use) => {
    await use(new SandboxEnv(open()))
  },
)

describe("worker shell: durability", () => {
  const environment = (id: string): ExecutionEnv => new SandboxEnv(open(id))

  it("keeps the workspace from one use to the next, exactly", async () => {
    const id = crypto.randomUUID()
    const first = environment(id)
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

    const second = environment(id)
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

  it("keeps two shells' files apart", async () => {
    const one = environment(crypto.randomUUID())
    const two = environment(crypto.randomUUID())
    await one.writeFile("secret.txt", "one's", context)
    expect(await two.exists("secret.txt", context)).toEqual({ ok: true, value: false })
  })

  it("deletes everything when it is destroyed, and can be used again", async () => {
    const id = crypto.randomUUID()
    const sandbox = open(id)
    await sandbox.exec("echo kept > note.txt")
    await sandbox.destroy?.()
    const again = open(id)
    expect(await again.fs.stat("/workspace/note.txt")).toBe(undefined)
    expect((await again.exec("echo back > note.txt && cat note.txt")).output).toBe("back\n")
  })

  it("stops a command when the caller gives up on it", async () => {
    const sandbox = open()
    const controller = new AbortController()
    const started = Date.now()
    const running = sandbox.exec("sleep 30", { signal: controller.signal })
    setTimeout(() => controller.abort(), 300)
    await expect(running).rejects.toThrow()
    expect(Date.now() - started < 5_000).toBe(true)
  })

  it("has the tools the shell inside the server has", async () => {
    const sandbox = open()
    const result = await sandbox.exec(
      `echo '{"a":[1,2,3]}' | jq -c '.a | map(. * 2)'; echo '<h1>T</h1>' | html-to-markdown; echo hi > f.txt; file f.txt; gzip -k f.txt; gunzip -c f.txt.gz; rg -c hi f.txt; printf 'a,b\\n1,2\\n' | xan count`,
    )
    expect(result).toEqual({
      exitCode: 0,
      output: "[2,4,6]\n# T\nf.txt: ASCII text\nhi\n1\n1\n",
      timedOut: false,
    })
  })

  it("tells a command that ran out of time from one that exits as if it had", async () => {
    const sandbox = open()
    expect(await sandbox.exec("echo late; exit 124")).toEqual({
      exitCode: 124,
      output: "late\n",
      timedOut: false,
    })
    expect(await sandbox.exec("echo early; sleep 30", { timeoutMs: 300 })).toEqual({
      exitCode: 124,
      output: "",
      timedOut: true,
    })
  })
})

describe("worker shell: network", () => {
  it("has none unless it is given one", async () => {
    const id = crypto.randomUUID()
    const sandbox = workerShellSandbox({
      id,
      network: false,
      shell: bindings.QUIET.get(bindings.QUIET.idFromName(id)),
    })
    expect(sandbox.capabilities.network).toBe(false)
    const result = await sandbox.exec("curl https://example.test/hello")
    expect(result.exitCode).not.toBe(0)
    expect(result.output).not.toContain("hello from the web")
  })

  it("fetches with curl through what the server allows", async () => {
    const sandbox = open()
    expect(sandbox.capabilities.network).toBe(true)
    expect((await sandbox.exec("curl -s https://example.test/hello")).output).toBe(
      "hello from the web\n",
    )
    const posted = await sandbox.exec("curl -s -X POST -d 'a=1' https://example.test/echo")
    expect(posted.output).toBe("got POST: a=1")
    expect((await sandbox.exec("curl -sL https://example.test/moved")).output).toBe(
      "hello from the web\n",
    )
  })

  it("is refused private addresses, by redirect too", async () => {
    const sandbox = open()
    for (const url of [
      "http://127.0.0.1:8787/",
      "http://169.254.169.254/latest",
      "http://localhost/",
      "https://example.test/inside",
    ]) {
      const result = await sandbox.exec(`curl -sL -w '%{http_code}' ${url}`)
      expect(result.output).toContain("403")
      expect(result.output).toContain("private network")
    }
  })
})

describe("worker shell: files from the shell that ran inside the server", () => {
  it("are moved in before it is first used, once", async () => {
    const id = crypto.randomUUID()
    const statements: string[] = []
    const rows = [
      { path: "/workspace", kind: "directory", mode: 0o755, target: null },
      { path: "/workspace/link", kind: "symlink", mode: 0o777, target: "src/run.sh" },
      { path: "/workspace/src", kind: "directory", mode: 0o755, target: null },
      { path: "/workspace/src/big.bin", kind: "file", mode: 0o644, target: null },
      { path: "/workspace/src/run.sh", kind: "file", mode: 0o700, target: null },
    ]
    const chunks: Record<string, Uint8Array[]> = {
      "/workspace/src/big.bin": [new Uint8Array(600_000).fill(7), new Uint8Array(5).fill(9)],
      "/workspace/src/run.sh": [new TextEncoder().encode("echo ran\n")],
    }
    let kept = true
    const database = {
      get: async () => (kept ? { found: 1 } : undefined),
      all: async (sql: string, path?: string) =>
        sql.includes("dc_fs_chunks") ? (chunks[path!] ?? []).map((data) => ({ data })) : rows,
      exec: async (sql: string) => {
        statements.push(sql)
        kept = false
      },
    } as unknown as Parameters<typeof movedFromDatabase>[0]
    const shell = bindings.SHELL.get(bindings.SHELL.idFromName(id))
    const sandbox = workerShellSandbox({ id, shell, prepare: movedFromDatabase(database) })

    expect((await sandbox.exec("sh link; stat -c %a src/run.sh; wc -c < src/big.bin")).output).toBe(
      "ran\n700\n600005\n",
    )
    const big = await sandbox.fs.readFile("/workspace/src/big.bin")
    expect([big[0], big[599_999], big[600_000], big.length]).toEqual([7, 7, 9, 600_005])
    expect((await sandbox.fs.stat("/workspace/link"))?.kind).toBe("symlink")
    expect(statements.length).toBe(1)
    expect(statements[0]).toContain("RENAME TO dc_fs_moved")

    // What was changed since is not written over by a second look.
    await sandbox.exec("echo changed > src/run.sh")
    const later = workerShellSandbox({ id, shell, prepare: movedFromDatabase(database) })
    expect((await later.exec("cat src/run.sh")).output).toBe("changed\n")
    expect(statements.length).toBe(1)
  })
})
