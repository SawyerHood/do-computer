import { lstat, readdir } from "node:fs/promises"
import { join } from "node:path"
import type { Command } from "./command.ts"

/**
 * Owned and not writable by everyone. Group-write is allowed: a umask of 0002 (one group per
 * user) gives Hyprland's own directories that mode, and the 0700 runtime directory above them is
 * what keeps other users out.
 */
const WORLD_WRITABLE = 0o002

/** Discover only this UID's runtime sockets and a unique owned graphical logind session.
 * Explicit values win. Never inspect process environments, other users' sockets, or /tmp.
 */
export async function discoverSession(
  env: NodeJS.ProcessEnv,
  run: Command,
  uid = process.getuid?.(),
  signal?: AbortSignal,
): Promise<{ env: NodeJS.ProcessEnv; reason?: string; blocked?: boolean }> {
  const found = { ...env }
  signal?.throwIfAborted()
  if (uid === undefined || uid === 0)
    return { env: found, reason: "Native screen sharing requires the desktop's non-root user." }
  const readSession = async (id: string) =>
    Object.fromEntries(
      (
        await run(
          "loginctl",
          ["show-session", id, "-p", "User", "-p", "Type", "-p", "Active", "-p", "Display"],
          { signal },
        )
      )
        .toString()
        .trim()
        .split("\n")
        .map((line) => line.split("=")),
    )
  let type: string | undefined
  let display: string | undefined
  try {
    if (env.XDG_SESSION_ID) {
      if (!/^[A-Za-z0-9_-]+$/.test(env.XDG_SESSION_ID))
        return { env: found, reason: "Invalid XDG_SESSION_ID." }
      const data = await readSession(env.XDG_SESSION_ID)
      if (data.User !== String(uid))
        return { env: found, reason: "The configured session does not belong to this user." }
      type = data.Type
      display = data.Display
    } else {
      const listed = (
        await run("loginctl", ["list-sessions", "--no-legend", "--no-pager"], { signal })
      ).toString()
      const ids = listed
        .split("\n")
        .map((line) => line.trim().split(/\s+/))
        .filter((parts) => parts[1] === String(uid) && /^[A-Za-z0-9_-]+$/.test(parts[0]!))
        .map((parts) => parts[0]!)
      if (ids.length > 16)
        return {
          env: found,
          blocked: true,
          reason: "Too many owned sessions; set XDG_SESSION_ID explicitly.",
        }
      const candidates: { id: string; type: string; display?: string }[] = []
      for (const id of ids) {
        signal?.throwIfAborted()
        const data = await readSession(id)
        if (data.User === String(uid) && ["wayland", "x11"].includes(data.Type ?? ""))
          candidates.push({ id, type: data.Type!, display: data.Display })
      }
      if (candidates.length !== 1)
        return {
          env: found,
          blocked: true,
          reason:
            candidates.length > 1
              ? "Multiple owned graphical sessions; set XDG_SESSION_ID and the intended display environment explicitly."
              : "No owned graphical session was found.",
        }
      found.XDG_SESSION_ID = candidates[0]!.id
      type = candidates[0]!.type
      display = candidates[0]!.display
    }
  } catch (error) {
    signal?.throwIfAborted()
    return {
      env: found,
      blocked: true,
      reason: "Cannot discover a graphical logind session; supply its environment explicitly.",
    }
  }
  signal?.throwIfAborted()
  found.XDG_SESSION_TYPE ??= type
  if (type === "x11") {
    if (!found.DISPLAY && display) found.DISPLAY = display
    return { env: found }
  }
  if (found.WAYLAND_DISPLAY && found.HYPRLAND_INSTANCE_SIGNATURE && found.XDG_RUNTIME_DIR)
    return { env: found }
  const runtime = found.XDG_RUNTIME_DIR ?? `/run/user/${uid}`
  try {
    const owner = await lstat(runtime)
    if (
      !owner.isDirectory() ||
      owner.isSymbolicLink() ||
      owner.uid !== uid ||
      (owner.mode & 0o022) !== 0
    )
      return {
        env: found,
        blocked: true,
        reason:
          "The runtime directory is not owned by this user, is writable by others, or is a symlink.",
      }
    const entries = await readdir(runtime, { withFileTypes: true })
    const sockets: string[] = []
    for (const entry of entries) {
      signal?.throwIfAborted()
      if (!/^wayland-\d+$/.test(entry.name) || !entry.isSocket()) continue
      if ((await lstat(join(runtime, entry.name))).uid === uid) sockets.push(entry.name)
    }
    if (!found.WAYLAND_DISPLAY) {
      if (sockets.length !== 1)
        return {
          env: found,
          blocked: true,
          reason:
            sockets.length > 1
              ? "Multiple owned Wayland sockets; set WAYLAND_DISPLAY explicitly."
              : "No owned Wayland display socket was found.",
        }
      found.WAYLAND_DISPLAY = sockets[0]
    }
    found.XDG_RUNTIME_DIR = runtime
    if (!found.HYPRLAND_INSTANCE_SIGNATURE) {
      const instances: string[] = []
      const hypr = join(runtime, "hypr")
      const directory = await lstat(hypr).catch(() => undefined)
      if (
        directory &&
        (!directory.isDirectory() || directory.uid !== uid || (directory.mode & WORLD_WRITABLE) !== 0)
      )
        return {
          env: found,
          blocked: true,
          reason: "The Hyprland runtime directory is not a private owned directory.",
        }
      for (const entry of await readdir(hypr, { withFileTypes: true }).catch(() => [])) {
        signal?.throwIfAborted()
        if (!entry.isDirectory() || !/^[A-Za-z0-9_.-]+$/.test(entry.name)) continue
        const dir = join(runtime, "hypr", entry.name)
        const owner = await lstat(dir)
        const socket = await lstat(join(dir, ".socket.sock")).catch(() => undefined)
        if (
          owner.uid === uid &&
          owner.isDirectory() &&
          (owner.mode & WORLD_WRITABLE) === 0 &&
          socket?.isSocket() &&
          socket.uid === uid
        )
          instances.push(entry.name)
      }
      if (instances.length !== 1)
        return {
          env: found,
          blocked: instances.length > 1,
          reason:
            instances.length > 1
              ? "Multiple owned Hyprland instances; set HYPRLAND_INSTANCE_SIGNATURE explicitly."
              : "No owned Hyprland instance was found (generic Wayland is not supported yet).",
        }
      found.HYPRLAND_INSTANCE_SIGNATURE = instances[0]
    }
    return { env: found }
  } catch {
    signal?.throwIfAborted()
    return {
      env: found,
      blocked: true,
      reason:
        "No usable owned runtime display sockets; start a graphical session or supply its environment explicitly.",
    }
  }
}
