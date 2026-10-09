import { createHash, randomBytes } from "node:crypto"
import { access, chmod, constants, mkdir, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

/**
 * The dev-browser this daemon uses: one release, named here with what each of its binaries
 * hashes to, so that what is downloaded is what was tried. They are the files of
 * https://github.com/SawyerHood/dev-browser/releases/tag/v1.0.0-rc.3 .
 */
export const DEV_BROWSER = {
  version: "1.0.0-rc.3",
  repository: "SawyerHood/dev-browser",
  sha256: {
    "dev-browser-linux-x64": "390dd08f8321807bca2e1e060ec031511adb0af002e871dfde3b1f6c8feac914",
    "dev-browser-linux-arm64": "8a1d7c80c3bede69809996848526b5ed43cf6f0965d87f99e4349b775f76042e",
    "dev-browser-darwin-x64": "76f70f6e8a48c5caf546003e09d9daa4a0cb756d191c4f7fc3c300c2e2935522",
    "dev-browser-darwin-arm64": "d68887f7df149915811bf362b208377c2d0d7d500297d4d5977dab129db5b5eb",
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
