import { createHash, randomBytes } from "node:crypto"
import { access, chmod, constants, mkdir, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

/**
 * The dev-browser this daemon uses: one release, named here with what each of its binaries
 * hashes to, so that what is downloaded is what was tried. They are the files of
 * https://github.com/SawyerHood/dev-browser/releases/tag/v1.0.0-rc.4 .
 */
export const DEV_BROWSER = {
  version: "1.0.0-rc.4",
  repository: "SawyerHood/dev-browser",
  sha256: {
    "dev-browser-linux-x64": "fa6cec3f84463e171bd7b307e2e1f0243df59c70c38f96d790dc41b160db921a",
    "dev-browser-linux-arm64": "578db7f1e502cf6b9e43ac09e6adc5720f5397fa3e6d6b7b9ba8377708fe040e",
    "dev-browser-darwin-x64": "7cfad83f7f9e16dc5acbc94553430bcd1be24adc4304c0f534805969bfa6d2ba",
    "dev-browser-darwin-arm64": "f0a7e7d10ab8be0fee1ee8ac2ca33d3efc46b493e5e998b29ea75c79479a2e8d",
  } as Record<string, string>,
} as const

/** The release's file for a machine, or null where dev-browser has none for it: Windows, so far. */
export function assetName(platform: string, arch: string): string | null {
  const os = platform === "darwin" || platform === "linux" ? platform : null
  const cpu = arch === "x64" || arch === "arm64" ? arch : null
  if (os === null || cpu === null) return null
  return `dev-browser-${os}-${cpu}`
}

export function assetUrl(asset: string): string {
  return `https://github.com/${DEV_BROWSER.repository}/releases/download/v${DEV_BROWSER.version}/${asset}`
}

const runnable = (path: string) =>
  access(path, constants.X_OK).then(
    () => true,
    () => false,
  )

/**
 * The path of a dev-browser to run: the one `DC_DEV_BROWSER` names, or the pinned one, downloaded
 * into `dir` the first time. Rejects in words an agent can pass on.
 */
export async function ensureDevBrowser(
  dir: string,
  log: (line: string) => void,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const given = env.DC_DEV_BROWSER
  if (given) {
    if (await runnable(given)) return given
    throw new Error(`DC_DEV_BROWSER names ${given}, which is not a program that can be run.`)
  }
  const asset = assetName(process.platform, process.arch)
  if (asset === null) {
    throw new Error(
      `The browser cannot be used on this computer yet: dev-browser, which runs it, has no build for ${process.platform} ${process.arch}.`,
    )
  }
  // The version is in the name, so that a daemon that pins a newer one does not run the old.
  const dest = join(dir, `${asset}-${DEV_BROWSER.version}`)
  if (await runnable(dest)) return dest
  const url = assetUrl(asset)
  log(`browser: downloading dev-browser ${DEV_BROWSER.version} from ${url}`)
  let bytes: Uint8Array
  try {
    const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(120_000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    bytes = new Uint8Array(await response.arrayBuffer())
  } catch (error) {
    throw new Error(
      `The browser could not be set up: downloading dev-browser from ${url} failed (${error instanceof Error ? error.message : String(error)}). The computer may be offline; try again later.`,
    )
  }
  const hash = createHash("sha256").update(bytes).digest("hex")
  if (hash !== DEV_BROWSER.sha256[asset]) {
    throw new Error(
      `The browser could not be set up: what was downloaded from ${url} is not the dev-browser ${DEV_BROWSER.version} that was expected, and was not kept.`,
    )
  }
  await mkdir(dir, { recursive: true })
  // Written beside it and renamed, so that a half-written file is never run.
  const partial = `${dest}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`
  try {
    await writeFile(partial, bytes, { mode: 0o755 })
    await chmod(partial, 0o755)
    await rename(partial, dest)
  } catch (error) {
    await rm(partial, { force: true })
    throw new Error(
      `The browser could not be set up: dev-browser could not be written to ${dest} (${error instanceof Error ? error.message : String(error)}).`,
    )
  }
  log(`browser: dev-browser is at ${dest}`)
  return dest
}
