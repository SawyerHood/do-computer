import { spawn } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { ExecutionEnv } from "@earendil-works/pi-durable/env"
import { SandboxEnv } from "./env.ts"
import { type ExecOptions, type ExecOutcome, type Sandbox, SandboxError } from "./index.ts"
import { shellFs } from "./shell-fs.ts"

/**
 * A sandbox that is just a directory on this machine, driven through `sh`. For tests only: it
 * checks the shell-based file operations against real coreutils, and it isolates nothing.
 */
export function createLocalProcessSandbox(): Sandbox {
  const home = mkdtempSync(join(tmpdir(), "dc-sandbox-"))
  const exec = (command: string, options: ExecOptions = {}): Promise<ExecOutcome> =>
    new Promise((resolve, reject) => {
      // Its own process group, so a timeout or abort stops the command's children too.
      const child = spawn("sh", ["-c", command], {
        cwd: options.cwd ?? home,
        env: { ...process.env, HOME: home, ...options.env },
        detached: true,
      })
      const kill = () => {
        try {
          if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL")
        } catch {
          // Already gone.
        }
      }
      options.signal?.addEventListener("abort", kill, { once: true })
      let output = ""
      let timedOut = false
      const timer =
        options.timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              timedOut = true
              kill()
            }, options.timeoutMs)
      const collect = (chunk: Buffer) => {
        output += chunk.toString()
        options.onOutput?.(chunk.toString())
      }
      child.stdout.on("data", collect)
      child.stderr.on("data", collect)
      child.on("error", (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.on("close", (code) => {
        clearTimeout(timer)
        resolve({ exitCode: timedOut ? 124 : (code ?? 1), output, timedOut })
      })
    })
  const node = async <T>(path: string, run: () => Promise<T>): Promise<T> => {
    try {
      return await run()
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      throw new SandboxError(
        code === "ENOENT"
          ? "not_found"
          : code === "EISDIR"
            ? "is_directory"
            : code === "ENOTDIR"
              ? "not_directory"
              : "unknown",
        (error as Error).message,
        path,
      )
    }
  }
  return {
    id: `local:${home}`,
    home,
    capabilities: { realBinaries: true, network: true },
    exec,
    flush: async () => {},
    fs: shellFs(exec, {
      readFile: (path) => node(path, async () => new Uint8Array(await readFile(path))),
      writeFile: (path, data) => node(path, () => writeFile(path, data)),
    }),
  }
}

type Runner = {
  describe(name: string, body: () => void): void
  it(name: string, body: () => Promise<void>): void
  expect(value: unknown): {
    toBe(expected: unknown): void
    toEqual(expected: unknown): void
    toContain(expected: unknown): void
  }
}

/** Behavior every sandbox must have, checked through the environment the agent's tools use. */
export function registerSandboxConformance(
  { describe, it, expect }: Runner,
  label: string,
  open: () => Promise<Sandbox>,
): void {
  const context = BACKGROUND_CONTEXT
  // Typed as the interface the agent's tools are written against.
  const environment = (sandbox: Sandbox): ExecutionEnv => new SandboxEnv(sandbox)

  describe(`${label}: sandbox`, () => {
    it("runs commands in the workspace and reports output and exit codes", async () => {
      const sandbox = await open()
      const env = environment(sandbox)
      let streamed = ""
      const result = await env.exec(
        "echo out; echo err >&2; pwd; exit 3",
        { onOutput: (chunk) => (streamed += chunk) },
        context,
      )
      expect(result).toEqual({ ok: true, value: { exitCode: 3, spillPath: undefined } })
      expect(streamed).toContain("out\n")
      expect(streamed).toContain("err\n")
      expect(streamed).toContain(sandbox.home)
    })

    it("passes environment variables and a working directory", async () => {
      const sandbox = await open()
      const env = environment(sandbox)
      await env.createDir("sub dir", { recursive: true }, context)
      let output = ""
      await env.exec(
        'echo "$GREETING from $(basename "$PWD")"',
        { env: { GREETING: "hello" }, cwd: "sub dir", onOutput: (chunk) => (output += chunk) },
        context,
      )
      expect(output).toBe("hello from sub dir\n")
    })

    it("shares files between the shell and file operations", async () => {
      const sandbox = await open()
      const env = environment(sandbox)
      await env.exec("printf 'from shell' > a.txt", undefined, context)
      expect(await env.readTextFile("a.txt", context)).toEqual({ ok: true, value: "from shell" })
      // Writing creates the directories on the way, as the write tool promises.
      await env.writeFile("made/on/the/way/b.txt", "from tool\n", context)
      let output = ""
      await env.exec(
        "cat made/on/the/way/b.txt",
        { onOutput: (chunk) => (output += chunk) },
        context,
      )
      expect(output).toBe("from tool\n")
    })

    it("round-trips binary content and awkward names", async () => {
      const env = environment(await open())
      const bytes = Uint8Array.from({ length: 600 }, (_, index) => index % 256)
      const name = 'it\'s a "file" $HOME.bin'
      expect((await env.writeFile(name, bytes, context)).ok).toBe(true)
      const read = await env.readBinaryFile(name, context)
      expect(read.ok && [...read.value]).toEqual([...bytes])
      const listed = await env.listDir(".", context)
      expect(listed.ok && listed.value.map((entry) => entry.name)).toContain(name)
    })

    it("describes files, directories and symlinks, hidden ones included", async () => {
      const sandbox = await open()
      const env = environment(sandbox)
      await env.createDir("dir/nested", { recursive: true }, context)
      await env.writeFile("dir/file.txt", "12345", context)
      await env.writeFile("dir/.hidden", "", context)
      await env.exec("ln -s file.txt dir/link", undefined, context)
      const listed = await env.listDir("dir", context)
      expect(
        listed.ok &&
          listed.value.map((entry) => [
            entry.name,
            entry.kind,
            entry.kind === "file" ? entry.size : 0,
          ]),
      ).toEqual([
        [".hidden", "file", 0],
        ["file.txt", "file", 5],
        ["link", "symlink", 0],
        ["nested", "directory", 0],
      ])
      const info = await env.fileInfo("dir/file.txt", context)
      expect(info.ok && [info.value.kind, info.value.size, info.value.path]).toEqual([
        "file",
        5,
        `${sandbox.home}/dir/file.txt`,
      ])
      expect(info.ok && Math.abs(info.value.mtimeMs - Date.now()) < 120_000).toBe(true)
      expect(await env.exists("dir/missing", context)).toEqual({ ok: true, value: false })
      const canonical = await env.canonicalPath("dir/link", context)
      expect(canonical.ok && canonical.value.endsWith("/dir/file.txt")).toBe(true)
    })

    it("returns typed failures instead of throwing", async () => {
      const env = environment(await open())
      const missing = await env.readTextFile("nope.txt", context)
      expect(!missing.ok && missing.error.code).toBe("not_found")
      const info = await env.fileInfo("nope.txt", context)
      expect(!info.ok && info.error.code).toBe("not_found")
      const list = await env.listDir("nope", context)
      expect(!list.ok && list.error.code).toBe("not_found")
      await env.writeFile("plain.txt", "x", context)
      const notDirectory = await env.listDir("plain.txt", context)
      expect(!notDirectory.ok && notDirectory.error.code).toBe("not_directory")
      const blocked = await env.writeFile("plain.txt/child.txt", "x", context)
      expect(blocked.ok).toBe(false)
    })

    it("renames, appends, truncates and removes", async () => {
      const env = environment(await open())
      await env.writeFile("a.txt", "one", context)
      await env.appendFile("a.txt", " two", context)
      await env.renameFile("a.txt", "b.txt", context)
      expect(await env.exists("a.txt", context)).toEqual({ ok: true, value: false })
      expect(await env.readTextFile("b.txt", context)).toEqual({ ok: true, value: "one two" })
      await env.truncateFile("b.txt", 3, context)
      expect(await env.readTextFile("b.txt", context)).toEqual({ ok: true, value: "one" })
      await env.createDir("tree/deep", { recursive: true }, context)
      await env.writeFile("tree/deep/x", "x", context)
      const refused = await env.remove("tree", undefined, context)
      expect(refused.ok).toBe(false)
      expect((await env.remove("tree", { recursive: true }, context)).ok).toBe(true)
      expect(await env.exists("tree", context)).toEqual({ ok: true, value: false })
      expect((await env.remove("gone", { force: true }, context)).ok).toBe(true)
    })

    it("reads text line by line", async () => {
      const env = environment(await open())
      await env.writeFile("lines.txt", "a\nb\nc", context)
      expect(await env.readTextLines("lines.txt", { maxLines: 2 }, context)).toEqual({
        ok: true,
        value: ["a", "b"],
      })
      const reader = await env.openTextLineReader("lines.txt", context)
      if (!reader.ok) throw reader.error
      const lines: unknown[] = []
      for (;;) {
        const line = await reader.value.readLine(context)
        if (!line.ok || line.value === undefined) break
        lines.push([line.value.text, line.value.terminated])
      }
      expect(lines).toEqual([
        ["a", true],
        ["b", true],
        ["c", false],
      ])
    })

    it("creates temporary files and spills long output to one", async () => {
      const env = environment(await open())
      const directory = await env.createTempDir("job-", context)
      expect(directory.ok && directory.value.startsWith("/tmp/job-")).toBe(true)
      const result = await env.exec(
        "i=0; while [ $i -lt 40 ]; do echo line $i; i=$((i+1)); done",
        { spill: { afterBytes: 100_000, afterLines: 10 } },
        context,
      )
      if (!result.ok || result.value.spillPath === undefined)
        throw new Error("expected a spill file")
      const spilled = await env.readTextFile(result.value.spillPath, context)
      expect(spilled.ok && spilled.value.split("\n").length).toBe(41)
    })

    it("stops a command that runs past its timeout", async () => {
      const env = environment(await open())
      const started = Date.now()
      const result = await env.exec("sleep 30", { timeout: 0.3 }, context)
      expect(!result.ok && result.error.code).toBe("timeout")
      expect(Date.now() - started < 5_000).toBe(true)
    })
  })
}
