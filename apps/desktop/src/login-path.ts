import { execFile } from "node:child_process"

const MARK = "__DC_PATH__"

/** The PATH out of what a shell printed between two marks, whatever else it printed. */
export function pathBetweenMarks(printed: string): string | undefined {
  const found = new RegExp(`${MARK}(.*?)${MARK}`, "s").exec(printed)?.[1]?.trim()
  return found === undefined || found === "" ? undefined : found
}

/**
 * The PATH its owner has in a terminal. An app started from the dock or at sign-in is given a
 * bare one, without Homebrew, a version manager or `~/bin`, and what an agent runs here
 * inherits it: it would not find the programs its owner uses. Windows gives every program the
 * same PATH, so there is nothing to find out.
 */
export function loginPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
  if (platform === "win32") return Promise.resolve(undefined)
  return new Promise((resolve) => {
    // A login shell that is also interactive reads everything a terminal would. What it
    // prints on the way is why the PATH is between marks.
    execFile(
      env.SHELL || "/bin/sh",
      ["-ilc", `echo "${MARK}$PATH${MARK}"`],
      { timeout: 5_000, env },
      (_error, stdout) => resolve(pathBetweenMarks(String(stdout))),
    )
  })
}
