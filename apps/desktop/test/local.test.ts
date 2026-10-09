import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { autostartEntry, setLinuxAutostart } from "../src/autostart.ts"
import { seedDaemon } from "../src/daemon.ts"
import { pathBetweenMarks } from "../src/login-path.ts"
import { loadSettings, saveSettings } from "../src/settings.ts"

const scratch = () => mkdtempSync(join(tmpdir(), "dc-desktop-test-"))

describe("starting at sign-in on Linux", () => {
  it("is a desktop entry that starts the app with no window", () => {
    const entry = autostartEntry({ home: "/home/ada", exec: "/opt/Do Computer/do-computer" })
    expect(entry.path).toBe("/home/ada/.config/autostart/do-computer.desktop")
    expect(entry.content).toContain('Exec="/opt/Do Computer/do-computer" --hidden\n')
  })

  it("goes where the desktop was told to keep its settings", () => {
    const entry = autostartEntry({ home: "/home/ada", configHome: "/cfg", exec: "/x" })
    expect(entry.path).toBe("/cfg/autostart/do-computer.desktop")
  })

  it("is written when switched on and gone when switched off", () => {
    const home = scratch()
    const options = { home, exec: "/usr/bin/do-computer" }
    setLinuxAutostart(true, options)
    expect(readFileSync(autostartEntry(options).path, "utf8")).toContain("Name=Do Computer")
    setLinuxAutostart(false, options)
    expect(existsSync(autostartEntry(options).path)).toBe(false)
    // Switched off twice, or never on: nothing to do, and no complaint.
    setLinuxAutostart(false, options)
  })
})

describe("the PATH its owner has in a terminal", () => {
  it("is found between the marks, past whatever the shell printed on the way", () => {
    expect(
      pathBetweenMarks("Welcome back!\n__DC_PATH__/opt/homebrew/bin:/usr/bin__DC_PATH__\n"),
    ).toBe("/opt/homebrew/bin:/usr/bin")
  })

  it("is unknown when the shell printed none", () => {
    expect(pathBetweenMarks("")).toBeUndefined()
    expect(pathBetweenMarks("__DC_PATH____DC_PATH__")).toBeUndefined()
  })
})

describe("what the app remembers", () => {
  it("is nothing on a first run, and what was saved after", () => {
    const file = join(scratch(), "nested", "settings.json")
    expect(loadSettings(file)).toEqual({ share: false, readOnly: false, openAtLogin: false })
    saveSettings(file, {
      server: "https://do.example",
      share: true,
      readOnly: false,
      openAtLogin: true,
    })
    expect(loadSettings(file)).toEqual({
      server: "https://do.example",
      share: true,
      readOnly: false,
      openAtLogin: true,
    })
  })

  it("starts over from a file that cannot be read", () => {
    const file = join(scratch(), "settings.json")
    writeFileSync(file, "{ not json")
    expect(loadSettings(file)).toEqual({ share: false, readOnly: false, openAtLogin: false })
  })
})

describe("the daemon the app brings", () => {
  it("is put where it can replace itself, and then left to", () => {
    const dir = scratch()
    const bundled = join(scratch(), "daemon.cjs")
    writeFileSync(bundled, "// daemon one\n")
    const script = seedDaemon(bundled, dir)
    expect(script).toBe(join(dir, "bin", "daemon.cjs"))
    expect(readFileSync(script, "utf8")).toBe("// daemon one\n")

    // The daemon updated itself from its server. The same app starting again leaves that be.
    writeFileSync(script, "// daemon two, from the server\n")
    seedDaemon(bundled, dir)
    expect(readFileSync(script, "utf8")).toBe("// daemon two, from the server\n")
  })

  it("is replaced by the one a newer app brings", () => {
    const dir = scratch()
    const bundled = join(scratch(), "daemon.cjs")
    writeFileSync(bundled, "// daemon one\n")
    const script = seedDaemon(bundled, dir)
    writeFileSync(bundled, "// daemon three, with a newer app\n")
    seedDaemon(bundled, dir)
    expect(readFileSync(script, "utf8")).toBe("// daemon three, with a newer app\n")
  })
})
