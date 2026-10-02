import {
  type DirectoryEntry,
  type ExecOutcome,
  type FileKind,
  SandboxError,
  type SandboxErrorCode,
  type SandboxFs,
} from "./index.ts"

/** Quote a string as one POSIX shell word. */
export function quote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

type Run = (command: string) => Promise<ExecOutcome>

const KINDS: Record<string, FileKind> = { f: "file", d: "directory", l: "symlink" }

/**
 * Prints `kind size mtime` for "$1": GNU stat first, then BSD stat for macOS. The kind comes from
 * shell tests so it reads the same on both.
 */
const DESCRIBE = `describe() {
  if [ -L "$1" ]; then k=l; elif [ -d "$1" ]; then k=d; elif [ -e "$1" ]; then k=f; else return 3; fi
  s=$(stat -c '%s %Y' -- "$1" 2>/dev/null || stat -f '%z %m' -- "$1" 2>/dev/null) || return 4
  printf '%s %s' "$k" "$s"
}`

/** The `SandboxError` for a file command that failed, read from what the command printed. */
export function failure(outcome: ExecOutcome, path: string): SandboxError {
  const text = outcome.output.trim()
  const patterns: [RegExp, SandboxErrorCode][] = [
    [/no such file or directory/i, "not_found"],
    [/not a directory/i, "not_directory"],
    [/is a directory/i, "is_directory"],
    [/permission denied|operation not permitted/i, "permission_denied"],
    [/directory not empty|file exists/i, "invalid"],
  ]
  const code = patterns.find(([pattern]) => pattern.test(text))?.[1] ?? "unknown"
  return new SandboxError(code, text || `Command failed with exit code ${outcome.exitCode}`, path)
}

/**
 * File operations for a sandbox that only offers a shell and whole-file transfer, which is every
 * remote provider and every paired computer. Uses POSIX shell and coreutils only.
 */
export function shellFs(run: Run, transfer: Pick<SandboxFs, "readFile" | "writeFile">): SandboxFs {
  const succeed = async (command: string, path: string) => {
    const outcome = await run(command)
    if (outcome.exitCode !== 0) throw failure(outcome, path)
    return outcome.output
  }
  const parse = (line: string) => {
    const [kind, size, mtime] = line.trim().split(" ")
    return { kind: KINDS[kind!] ?? "file", size: Number(size), mtimeMs: Number(mtime) * 1000 }
  }
  return {
    async stat(path) {
      const outcome = await run(`${DESCRIBE}; describe ${quote(path)}`)
      if (outcome.exitCode === 3) return undefined
      if (outcome.exitCode !== 0) throw failure(outcome, path)
      return parse(outcome.output)
    },
    async list(path) {
      // One line per entry: "kind size mtime" then a tab and the name. Names with newlines are
      // not supported.
      const output = await succeed(
        `${DESCRIBE}; [ -d ${quote(path)} ] || { [ -e ${quote(path)} ] && echo 'Not a directory' >&2 || echo 'No such file or directory' >&2; exit 1; }
cd ${quote(path)} || exit 1
for f in * .[!.]* ..?*; do
  [ -e "$f" ] || [ -L "$f" ] || continue
  d=$(describe "$f") && printf '%s\\t%s\\n' "$d" "$f"
done`,
        path,
      )
      const entries: DirectoryEntry[] = []
      for (const line of output.split("\n")) {
        const tab = line.indexOf("\t")
        if (tab === -1) continue
        entries.push({ name: line.slice(tab + 1), ...parse(line.slice(0, tab)) })
      }
      return entries
    },
    readFile: transfer.readFile,
    writeFile: transfer.writeFile,
    async mkdir(path, options) {
      await succeed(`mkdir ${options.recursive ? "-p " : ""}-- ${quote(path)}`, path)
    },
    async remove(path, options) {
      const flags = `${options.recursive ? "r" : ""}${options.force ? "f" : ""}`
      // Plain `rm` refuses a directory; `rmdir` removes an empty one, as a non-recursive remove should.
      const command = options.recursive
        ? `rm -${flags} -- ${quote(path)}`
        : `if [ -d ${quote(path)} ] && [ ! -L ${quote(path)} ]; then rmdir -- ${quote(path)}; else rm ${flags ? `-${flags} ` : ""}-- ${quote(path)}; fi`
      await succeed(command, path)
    },
    async rename(from, to) {
      await succeed(`mv -- ${quote(from)} ${quote(to)}`, from)
    },
    async realpath(path) {
      const output = await succeed(
        `realpath -- ${quote(path)} 2>/dev/null || (cd ${quote(path)} 2>/dev/null && pwd -P) || { echo 'No such file or directory' >&2; exit 1; }`,
        path,
      )
      return output.trim()
    },
  }
}
