/**
 * The server treats every path on a paired computer as a POSIX path, rooted at `/`. A Windows
 * machine therefore shows its paths the way Git Bash writes them, `/c/Users/ada`, and reads
 * them back into its own form before it touches the disk.
 */

const forward = (p: string) => p.replaceAll("\\", "/")
const backward = (p: string) => p.replaceAll("/", "\\")

/** `C:\Users\ada` as `/c/Users/ada`. A path without a drive letter only has its slashes turned. */
export function toPosixView(p: string): string {
  const drive = /^([A-Za-z]):([\\/].*)?$/.exec(p)
  if (drive === null) return forward(p)
  const rest = forward(drive[2] ?? "")
  // The root of a drive is `/c`, as a folder is written without a slash after it.
  return `/${drive[1]!.toLowerCase()}${rest === "/" ? "" : rest}`
}

/**
 * `/c/Users/ada` as `C:\Users\ada`. So are `/C:/Users/ada` and `/C:\Users\ada`, which is what
 * the server's joining of POSIX paths makes of a home that was reported in Windows' own form.
 * Anything else is left as it is.
 */
export function fromPosixView(p: string): string {
  const drive = /^\/([A-Za-z])(\/.*)?$/.exec(p) ?? /^\/([A-Za-z]):([\\/].*)?$/.exec(p)
  if (drive === null) return p
  return `${drive[1]!.toUpperCase()}:${backward(drive[2] ?? "") || "\\"}`
}

/** A path of this machine as the server is shown it. */
export function shownPath(p: string, platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? toPosixView(p) : p
}
