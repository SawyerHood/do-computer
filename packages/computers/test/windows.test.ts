import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { findShell, nodeDaemonIO, type Shell } from "../src/node-io.ts"
import { fromPosixView, shownPath, toPosixView } from "../src/paths.ts"

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const bytes = (value: string) => new TextEncoder().encode(value)

describe("a Windows path as the server is shown it", () => {
  it("is written the way Git Bash writes it", () => {
    expect(toPosixView("C:\\Users\\ada\\x")).toBe("/c/Users/ada/x")
    expect(toPosixView("D:/work/notes.txt")).toBe("/d/work/notes.txt")
    expect(toPosixView("C:\\")).toBe("/c")
    expect(toPosixView("C:")).toBe("/c")
  })

  it("only has its slashes turned when it names no drive", () => {
    expect(toPosixView("notes\\today.txt")).toBe("notes/today.txt")
    expect(toPosixView("/tmp/x")).toBe("/tmp/x")
    expect(toPosixView("\\\\server\\share\\x")).toBe("//server/share/x")
  })

  it("is read back into the machine's own form", () => {
    expect(fromPosixView("/c/Users/ada")).toBe("C:\\Users\\ada")
    expect(fromPosixView("/c")).toBe("C:\\")
    expect(fromPosixView("/c/")).toBe("C:\\")
    for (const path of ["C:\\Users\\ada\\x", "C:\\", "D:\\work\\a b\\notes.txt"]) {
      expect(fromPosixView(toPosixView(path))).toBe(path)
    }
    for (const path of ["/c/Users/ada/x", "/c", "/d/work/a b/notes.txt"]) {
      expect(toPosixView(fromPosixView(path))).toBe(path)
    }
  })

  it("is understood as the server joins a home that was reported in Windows' own form", () => {
    expect(fromPosixView("/C:/Users/ada")).toBe("C:\\Users\\ada")
    expect(fromPosixView("/C:\\Users\\ada")).toBe("C:\\Users\\ada")
    expect(fromPosixView("/C:\\Users\\ada/notes/a.txt")).toBe("C:\\Users\\ada\\notes\\a.txt")
    expect(fromPosixView("/c:")).toBe("C:\\")
  })

  it("is left alone when it is not a drive's path in that form", () => {
    for (const path of ["~", "~/x", "notes.txt", "notes/a.txt", "C:\\x", "/tmp/x", "/"]) {
      expect(fromPosixView(path)).toBe(path)
    }
  })

  it("is shown that way only by a Windows machine", () => {
    expect(shownPath("C:\\Users\\ada", "win32")).toBe("/c/Users/ada")
    expect(shownPath("/home/ada", "linux")).toBe("/home/ada")
    expect(shownPath("/Users/ada", "darwin")).toBe("/Users/ada")
  })
})

describe("the shell commands run in", () => {
  const env = {
    ProgramFiles: "C:\\Program Files",
    "ProgramFiles(x86)": "C:\\Program Files (x86)",
    LOCALAPPDATA: "C:\\Users\\ada\\AppData\\Local",
  }

  it("is bash anywhere but on Windows", () => {
    for (const platform of ["linux", "darwin"] as const) {
      const shell = findShell({ platform, env, exists: () => true })
      expect(shell).toMatchObject({ file: "bash", posix: true })
      expect(shell.args("echo hi")).toEqual(["-c", "echo hi"])
    }
  })

  it("is Git for Windows' bash where that is installed for everyone", () => {
    const looked: string[] = []
    const shell = findShell({
      platform: "win32",
      env,
      exists: (file) => {
        looked.push(file)
        return true
      },
    })
    expect(shell).toMatchObject({ file: "C:\\Program Files\\Git\\bin\\bash.exe", posix: true })
    expect(shell.args("echo hi")).toEqual(["-c", "echo hi"])
    // Never the `bash` on the PATH, which on Windows starts WSL.
    expect(looked).toEqual(["C:\\Program Files\\Git\\bin\\bash.exe"])
  })

  it("is Git for Windows' bash where one person installed it for themselves", () => {
    const own = "C:\\Users\\ada\\AppData\\Local\\Programs\\Git\\bin\\bash.exe"
    const shell = findShell({ platform: "win32", env, exists: (file) => file === own })
    expect(shell).toMatchObject({ file: own, posix: true })
    const old = "C:\\Program Files (x86)\\Git\\bin\\bash.exe"
    expect(findShell({ platform: "win32", env, exists: (file) => file === old }).file).toBe(old)
  })

  it("is PowerShell on a Windows without Git, and keeps a failed program's exit code", () => {
    for (const found of [env, {}]) {
      const shell = findShell({ platform: "win32", env: found, exists: () => false })
      expect(shell).toMatchObject({ file: "powershell.exe", posix: false })
      const args = shell.args("cmd /c exit 3")
      expect(args.slice(0, -1)).toEqual([
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
      ])
      const script = args.at(-1)!
      expect(script).toContain("[Console]::OutputEncoding = [Text.Encoding]::UTF8")
      expect(script).toContain("cmd /c exit 3")
      expect(script.indexOf("cmd /c exit 3")).toBeLessThan(script.indexOf("if (-not $?)"))
      expect(script).toContain("if ($LASTEXITCODE) { exit $LASTEXITCODE } else { exit 1 }")
    }
  })
})

/** A daemon's effects on this machine, in a home of its own. */
function machine(shell?: Shell) {
  const home = mkdtempSync(join(tmpdir(), "dc-daemon-home-"))
  return { home, io: nodeDaemonIO({ home, audit: () => {}, shell }) }
}

// These run with the shell found on whatever machine this is, Windows among them.
describe("a daemon on this machine", () => {
  it("gives back what a command printed and how it ended", async () => {
    const { io } = machine()
    const result = await io.exec("echo hi; exit 3", { env: {}, timeoutMs: 30_000 })
    expect(result).toEqual({ stdout: "hi\n", stderr: "", exitCode: 3 })
  })

  it("stops a command at its time limit, and what it started with it", async () => {
    const { io } = machine()
    const began = Date.now()
    const result = await io.exec("sleep 30", { env: {}, timeoutMs: 500 })
    expect(result.exitCode).toBe(124)
    expect(result.stderr).toContain("time limit")
    expect(Date.now() - began).toBeLessThan(10_000)
  })

  it("reads a file it wrote, by a path from its home and by one that starts with ~", async () => {
    const { io } = machine()
    await io.writeFile("notes/today.txt", bytes("remember"))
    expect(text(await io.readFile("notes/today.txt"))).toBe("remember")
    expect(text(await io.readFile("~/notes/today.txt"))).toBe("remember")
    await io.writeFile("~/notes/later.txt", bytes("and this"))
    expect(text(await io.readFile("notes/later.txt"))).toBe("and this")
    expect(await io.statSize("~/notes/later.txt")).toBe(8)
  })

  it("says where a file really is in the form the server is shown", async () => {
    const { io } = machine()
    await io.writeFile("notes.txt", bytes("x"))
    const real = await io.realpath("notes.txt")
    expect(real.startsWith("/")).toBe(true)
    expect(real.endsWith("/notes.txt")).toBe(true)
    expect(real).not.toContain("\\")
    // And that form is one it can be asked for a file in.
    expect(text(await io.readFile(real))).toBe("x")
  })

  it("leaves a slow command running as a job, and stops it when asked", async () => {
    const { io } = machine()
    const jobs = io.jobs!("agent-1")
    let last = await jobs.start(
      { id: "slow", command: "echo one; sleep 30", lifeMs: 600_000 },
      { waitMs: 500 },
    )
    let output = last.output
    // A shell on Windows can take longer than that to start.
    for (let tries = 0; output === "" && last.state === "running" && tries < 20; tries++) {
      last = await jobs.follow("slow", { from: last.next, waitMs: 500 })
      output += last.output
    }
    expect(last.state).toBe("running")
    expect(output).toBe("one\n")
    expect(jobs.log("slow").startsWith("/")).toBe(true)
    expect(jobs.log("slow").endsWith("/.do-computer/jobs/agent-1/slow/output.log")).toBe(true)
    await jobs.stop("slow")
    const ended = await jobs.follow("slow", { from: 0, waitMs: 10_000 })
    expect(ended).toMatchObject({ state: "exited", timedOut: false, output: "one\n" })
    expect(ended.state === "exited" && ended.exitCode).not.toBe(0)
  }, 30_000)

  it("answers for a quick job with how it ended", async () => {
    const { io } = machine()
    const done = await io.jobs!("agent-1").start(
      { id: "quick", command: "echo hi; exit 3", lifeMs: 60_000 },
      { waitMs: 20_000 },
    )
    expect(done).toMatchObject({ state: "exited", exitCode: 3, timedOut: false, output: "hi\n" })
  }, 30_000)
})

describe.runIf(process.platform === "win32")("a daemon on a Windows machine", () => {
  // What a Windows without Git for Windows is left with.
  const powerShell = () => machine(findShell({ exists: () => false }))

  it("runs a command in PowerShell where there is no bash", async () => {
    const { io } = powerShell()
    const result = await io.exec("Write-Output hi", { env: {}, timeoutMs: 60_000 })
    expect(result.stdout.trim()).toBe("hi")
    expect(result.exitCode).toBe(0)
  }, 60_000)

  it("keeps the exit code of a program that failed in PowerShell", async () => {
    const { io } = powerShell()
    const result = await io.exec("cmd /c exit 3", { env: {}, timeoutMs: 60_000 })
    expect(result.exitCode).toBe(3)
  }, 60_000)

  it("runs a job in PowerShell and says how it ended", async () => {
    const { io } = powerShell()
    const done = await io.jobs!("agent-1").start(
      { id: "quick", command: "Write-Output hi; cmd /c exit 3", lifeMs: 60_000 },
      { waitMs: 30_000 },
    )
    expect(done).toMatchObject({ state: "exited", exitCode: 3, timedOut: false })
    expect(done.output.trim()).toBe("hi")
  }, 60_000)

  it("reads a file it wrote by a path that starts at a drive, as the server writes one", async () => {
    const { io, home } = machine()
    const shown = toPosixView(home)
    expect(shown).toMatch(/^\/[a-z]\//)
    await io.writeFile(`${shown}/deep/made.txt`, bytes("from afar"))
    expect(text(await io.readFile(`${shown}/deep/made.txt`))).toBe("from afar")
    expect(text(await io.readFile("deep/made.txt"))).toBe("from afar")
    const listed = await io.list(`${shown}/deep`)
    expect(listed.map((entry) => entry.name)).toEqual(["made.txt"])
  })
})
