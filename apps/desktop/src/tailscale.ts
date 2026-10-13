/**
 * Reaching the app's own server from its owner's other devices, over Tailscale.
 *
 * The server listens on this computer alone. Tailscale, where its owner has it, joins their
 * devices into a private network, and its `serve` puts something on this computer at an
 * address of that network, with a certificate. The app asks the Tailscale that is installed to
 * do that for the server's port, and to stop: it brings none of its own, and touches nothing of
 * what else is served here.
 */
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import * as path from "node:path"

/** How this computer stands with Tailscale. */
export type Tailnet =
  /** It is not installed here, as far as the app can find. */
  | { state: "missing" }
  /** It is installed and not connected: stopped, or nobody is signed in to it. */
  | { state: "stopped" }
  /** It is connected, on a network that does not give its devices certificates. */
  | { state: "no-https"; name: string }
  /** It can serve: `name` is what this computer is called on its network. */
  | { state: "ready"; name: string }

/** How long Tailscale has to answer. It asks a program that is running, or is not. */
const ANSWER_MS = 8_000
/** How long it has to start serving. Where it cannot, it waits to be answered in a terminal. */
const SERVE_MS = 20_000

/** A name of the network without the dot a full one ends in. */
const bare = (name: string) => name.replace(/\.$/, "")

/** What `tailscale status --json` printed, as how this computer stands. */
export function readStatus(printed: string): Tailnet {
  let status: {
    BackendState?: unknown
    CertDomains?: unknown
    Self?: { DNSName?: unknown } | null
  }
  try {
    status = JSON.parse(printed)
  } catch {
    return { state: "stopped" }
  }
  if (status?.BackendState !== "Running") return { state: "stopped" }
  const certified = Array.isArray(status.CertDomains)
    ? status.CertDomains.find((name): name is string => typeof name === "string" && name !== "")
    : undefined
  if (certified !== undefined) return { state: "ready", name: bare(certified) }
  const called = typeof status.Self?.DNSName === "string" ? bare(status.Self.DNSName) : ""
  // Connected, with no name on the network: nothing can be served at one.
  return called === "" ? { state: "stopped" } : { state: "no-https", name: called }
}

/** Where the Tailscale command is, on each system, besides wherever PATH finds it. */
export function candidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform === "win32") {
    return [env.ProgramFiles, env["ProgramFiles(x86)"]]
      .filter((dir): dir is string => typeof dir === "string" && dir !== "")
      .map((dir) => path.win32.join(dir, "Tailscale", "tailscale.exe"))
  }
  const named = (env.PATH ?? "")
    .split(":")
    .filter(Boolean)
    .map((dir) => path.posix.join(dir, "tailscale"))
  return [
    ...named,
    // An app started from the Dock has a bare PATH, and the Mac app brings the command inside it.
    ...(platform === "darwin"
      ? [
          "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
          "/opt/homebrew/bin/tailscale",
          "/usr/local/bin/tailscale",
        ]
      : ["/usr/bin/tailscale", "/usr/sbin/tailscale", "/usr/local/bin/tailscale"]),
  ]
}

/** The Tailscale command on this computer, if it has one. */
export function findTailscale(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (file: string) => boolean = existsSync,
): string | undefined {
  // A run can be told which: the tests', which have a stand-in for it.
  const told = env.DC_DESKTOP_TAILSCALE
  if (told !== undefined) return told === "" ? undefined : told
  return candidates(platform, env).find(exists)
}

type Ran = { code: number | string | null; out: string; err: string; late: boolean }

function run(bin: string, args: string[], timeout: number): Promise<Ran> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, windowsHide: true }, (error, stdout, stderr) => {
      const failed = error as (Error & { code?: number | string; killed?: boolean }) | null
      resolve({
        code: failed === null ? 0 : (failed.code ?? null),
        out: String(stdout),
        err: String(stderr),
        late: failed?.killed === true,
      })
    })
  })
}

/** How this computer stands with Tailscale, asked of it now. */
export async function tailnet(bin: string | undefined): Promise<Tailnet> {
  if (bin === undefined) return { state: "missing" }
  const ran = await run(bin, ["status", "--json"], ANSWER_MS)
  // The command is there and what it talks to is not: Tailscale is installed and not running.
  return ran.out.trim() === "" ? { state: "stopped" } : readStatus(ran.out)
}

/** The address the server is reached at from the network. */
export const tailnetAddress = (name: string, port: number) => `https://${name}:${port}`

/**
 * Why serving did not start, in words for whoever switched it on. What Tailscale itself said
 * is kept where it names a page to open or a command to run, since those are the way on.
 */
export function serveProblem(said: string, platform: NodeJS.Platform, late: boolean): string {
  const text = said.trim()
  const link = /https:\/\/login\.tailscale\.com\/\S+/.exec(text)?.[0]
  if (/access denied|permission denied|must be root|requires root/i.test(text)) {
    return platform === "win32"
      ? "Tailscale would not let Do Computer do that. Open Tailscale and check that you are signed in as an administrator of this computer."
      : "Tailscale only lets an administrator serve from this computer. Run this once in a terminal, then switch it on again: sudo tailscale set --operator=$USER"
  }
  if (/not enabled|enable HTTPS|HTTPS.*(disabled|not available)/i.test(text) || (late && link)) {
    return `Your Tailscale network has to allow this first.${link === undefined ? " Turn on HTTPS Certificates in Tailscale’s admin console, under DNS." : ` Open ${link} to allow it, then switch it on again.`}`
  }
  if (late) return "Tailscale took too long to answer. Check that it is running, and try again."
  const line = text.split(/\r?\n/).find((part) => part.trim() !== "")
  return line === undefined
    ? "Tailscale could not serve Do Computer. Check that it is running, and try again."
    : `Tailscale said: ${line.trim().slice(0, 200)}`
}

/**
 * Serve the server's port on the network, at the same port there, for as long as Tailscale
 * runs: it keeps doing so by itself. Resolves with what went wrong, or with nothing.
 */
export async function serve(
  bin: string,
  port: number,
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
  const ran = await run(
    bin,
    ["serve", "--bg", "--yes", `--https=${port}`, `http://127.0.0.1:${port}`],
    SERVE_MS,
  )
  if (ran.code === 0) return undefined
  return serveProblem(`${ran.err}\n${ran.out}`, platform, ran.late)
}

/** Stop serving the server's port. Only that port's entry is the app's to remove. */
export async function unserve(bin: string, port: number): Promise<void> {
  await run(bin, ["serve", "--yes", `--https=${port}`, "off"], ANSWER_MS)
}
