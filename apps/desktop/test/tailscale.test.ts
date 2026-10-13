import { describe, expect, it } from "vitest"
import {
  candidates,
  findTailscale,
  readStatus,
  serveProblem,
  tailnetAddress,
} from "../src/tailscale.ts"

const status = (said: object) => readStatus(JSON.stringify(said))

describe("how this computer stands with Tailscale", () => {
  it("can serve where it is connected and its network gives certificates", () => {
    expect(
      status({
        BackendState: "Running",
        Self: { DNSName: "bee.tail1234.ts.net." },
        CertDomains: ["bee.tail1234.ts.net"],
      }),
    ).toEqual({ state: "ready", name: "bee.tail1234.ts.net" })
  })

  it("is connected and cannot serve where the network gives none", () => {
    for (const none of [null, [], undefined]) {
      expect(
        status({
          BackendState: "Running",
          Self: { DNSName: "bee.tail1234.ts.net." },
          CertDomains: none,
        }),
      ).toEqual({ state: "no-https", name: "bee.tail1234.ts.net" })
    }
  })

  it("is not connected while nobody is signed in to it, or it is stopped", () => {
    for (const state of ["NeedsLogin", "Stopped", "NoState", "Starting"]) {
      expect(status({ BackendState: state, CertDomains: ["bee.tail1234.ts.net"] })).toEqual({
        state: "stopped",
      })
    }
    // Connected, and called nothing: there is no address to serve at.
    expect(status({ BackendState: "Running", Self: { DNSName: "" } })).toEqual({ state: "stopped" })
    expect(readStatus("not json at all")).toEqual({ state: "stopped" })
  })
})

describe("where the Tailscale command is looked for", () => {
  it("is wherever PATH names, and then where each system keeps it", () => {
    expect(candidates("linux", { PATH: "/home/ada/bin:/usr/bin" })).toEqual([
      "/home/ada/bin/tailscale",
      "/usr/bin/tailscale",
      "/usr/bin/tailscale",
      "/usr/sbin/tailscale",
      "/usr/local/bin/tailscale",
    ])
    // An app started from the Dock has a bare PATH: the Mac app brings the command inside it.
    expect(candidates("darwin", { PATH: "/usr/bin" })).toContain(
      "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    )
    expect(candidates("win32", { ProgramFiles: "C:\\Program Files" })).toEqual([
      "C:\\Program Files\\Tailscale\\tailscale.exe",
    ])
  })

  it("is the first of those that is there, and nothing where none is", () => {
    const there = (file: string) => file === "/usr/sbin/tailscale"
    expect(findTailscale("linux", { PATH: "/usr/bin" }, there)).toBe("/usr/sbin/tailscale")
    expect(findTailscale("linux", { PATH: "/usr/bin" }, () => false)).toBeUndefined()
  })

  it("is what a run was told, which can be that there is none", () => {
    expect(findTailscale("linux", { DC_DESKTOP_TAILSCALE: "/tmp/stand-in" }, () => false)).toBe(
      "/tmp/stand-in",
    )
    expect(findTailscale("linux", { DC_DESKTOP_TAILSCALE: "", PATH: "/usr/bin" }, () => true)).toBe(
      undefined,
    )
  })
})

describe("why serving did not start", () => {
  it("says how an administrator lets the app, on Linux", () => {
    const said =
      "Access denied: serve config denied\n\nUse 'sudo tailscale serve --bg --https=4310 http://127.0.0.1:4310'\nTo not require root, use 'sudo tailscale set --operator=$USER' once."
    expect(serveProblem(said, "linux", false)).toContain("sudo tailscale set --operator=$USER")
    expect(serveProblem(said, "win32", false)).not.toContain("sudo")
  })

  it("passes on the page Tailscale names, where the network has to allow it first", () => {
    const said =
      "Serve is not enabled on your tailnet.\nTo enable, visit:\n\n         https://login.tailscale.com/f/serve?node=abc123\n"
    expect(serveProblem(said, "darwin", true)).toContain(
      "https://login.tailscale.com/f/serve?node=abc123",
    )
    expect(serveProblem("HTTPS is not enabled for this tailnet", "linux", false)).toContain(
      "HTTPS Certificates",
    )
  })

  it("says what Tailscale said, or that it said nothing in time", () => {
    expect(serveProblem("\nsomething else went wrong\nmore", "linux", false)).toBe(
      "Tailscale said: something else went wrong",
    )
    expect(serveProblem("", "linux", true)).toContain("took too long")
    expect(serveProblem("", "linux", false)).toContain("could not serve")
  })
})

describe("the address the server is reached at from the network", () => {
  it("is this computer's name there, at the server's own port", () => {
    expect(tailnetAddress("bee.tail1234.ts.net", 4310)).toBe("https://bee.tail1234.ts.net:4310")
  })
})
