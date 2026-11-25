import { createHash, randomBytes } from "node:crypto"
import { access, chmod, constants, mkdir, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

/**
 * The dev-browser this daemon uses: one release, named here with what each of its binaries
 * hashes to, so that what is downloaded is what was tried. They are the files of
 * https://github.com/SawyerHood/dev-browser/releases/tag/v1.0.0 .
 */
export const DEV_BROWSER = {
  version: "1.0.0",
  repository: "SawyerHood/dev-browser",
  sha256: {
    "dev-browser-linux-x64": "564b0c85eb653d8a04fc3c2dabe1f3bbfb56c976843c5cd14102855e4ef4381f",
    "dev-browser-linux-arm64": "3b925d89fc8e4627374045c695b0bfd06a6466196e360e7770d8b55020c6aacf",
    "dev-browser-darwin-x64": "bbc851cdb31536f2245eb97a027e198b453541d50f172024d56d4d07a23832fc",
    "dev-browser-darwin-arm64": "24ba8a8841add1f15576b28c57b6ea78addc7f8828f2379db3460f7993d30d63",
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
