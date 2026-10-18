import { access } from "node:fs/promises"
import { constants } from "node:fs"
import { delimiter, join } from "node:path"
import type { DesktopAction } from "@do-computer/protocol"
import { UseRefused } from "@do-computer/computers/use"
import type { Command } from "./command.ts"

export type Rect = { x: number; y: number; width: number; height: number }
export type Capture = { png: Buffer; rect: Rect }
export interface ScreenDriver {
  probe(signal?: AbortSignal): Promise<void>
  geometry(signal: AbortSignal): Promise<Rect>
  capture(signal: AbortSignal): Promise<Capture>
  act(action: DesktopAction, signal: AbortSignal): Promise<void>
}
export type LinuxOptions = {
  env: NodeJS.ProcessEnv
  run: Command
  uid?: number
  wakeDisplay?: boolean
  has?: (file: string) => Promise<boolean>
}

export const LINUX_TOOLS = {
  hyprland: ["loginctl", "hyprctl", "grim", "wtype", "wlrctl"],
  x11: ["loginctl", "xdotool", "xset", "import"],
} as const

export async function executable(file: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  for (const directory of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
    try {
      await access(join(directory, file), constants.X_OK)
      return true
    } catch {}
  }
  return false
}

/** Temporary readiness failures must not disable the adapter until the daemon restarts. */
export class ScreenNotReady extends UseRefused {}

const aliases: Record<string, string> = {
  enter: "Return",
  return: "Return",
  esc: "Escape",
  escape: "Escape",
  space: "space",
  backspace: "BackSpace",
  delete: "Delete",
  tab: "Tab",
  left: "Left",
  right: "Right",
  up: "Up",
  down: "Down",
  home: "Home",
  end: "End",
  pageup: "Prior",
  pagedown: "Next",
  plus: "plus",
}
const modifiers: Record<string, string> = {
  ctrl: "ctrl",
  control: "ctrl",
  alt: "alt",
  shift: "shift",
  super: "logo",
  meta: "logo",
  cmd: "logo",
  win: "logo",
}
export function keys(value: string): { key: string; modifiers: string[] } {
  const parts = value.split("+")
  const last = parts.pop() ?? ""
  if (!/^[A-Za-z0-9_]+$/.test(last)) throw new Error("Use a keysym name (for +, use plus).")
  return {
    key: aliases[last.toLowerCase()] ?? last,
    modifiers: parts.map((p) => {
      const mod = modifiers[p.toLowerCase()]
      if (!mod) throw new Error(`Unknown key modifier: ${p}`)
      return mod
    }),
  }
}

/** An explicit, owned, active logind session; never scan other users' display sockets. */
async function session(options: LinuxOptions, type: string, signal?: AbortSignal): Promise<void> {
  const uid = options.uid ?? process.getuid?.()
  if (uid === undefined || uid === 0)
    throw new UseRefused("Native screen sharing must run as the desktop's non-root user.")
  const id = options.env.XDG_SESSION_ID
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id))
    throw new ScreenNotReady(
      "Set XDG_SESSION_ID from the graphical login session; do not guess a session.",
    )
  const output = await options
    .run(
      "loginctl",
      ["show-session", id, "-p", "User", "-p", "Type", "-p", "Active", "-p", "LockedHint"],
      { signal },
    )
    .catch((error) => {
      signal?.throwIfAborted()
      throw new ScreenNotReady(`Cannot verify the graphical session: ${(error as Error).message}`)
    })
  const values = Object.fromEntries(
    output
      .toString()
      .trim()
      .split("\n")
      .map((line) => line.split("=")),
  )
  if (values.User !== String(uid) || values.Type !== type)
    throw new ScreenNotReady(
      "The configured graphical session does not belong to this user or has the wrong session type.",
    )
  if (values.Active !== "yes")
    throw new ScreenNotReady("The configured graphical session is inactive.")
  if (values.LockedHint !== "no")
    throw new ScreenNotReady(
      "The graphical session is locked, or its lock state cannot be verified. Unlock it yourself before sharing.",
    )
}

function pngDimensions(png: Buffer): { width: number; height: number } {
  if (png.length < 24 || png.readUInt32BE(0) !== 0x89504e47 || png.readUInt32BE(12) !== 0x49484452)
    throw new Error("The screen backend did not return a PNG.")
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

/** Whole-screen drivers only. Background-window semantics must never silently become foreground input. */
export function linuxDriver(id: "hyprland" | "x11", options: LinuxOptions): ScreenDriver {
  const { env, run } = options
  const required = LINUX_TOOLS[id]
  const type = id === "hyprland" ? "wayland" : "x11"
  let monitorName: string | undefined
  const check = async (signal?: AbortSignal, allowWake = false) => {
    signal?.throwIfAborted()
    if (
      id === "hyprland" &&
      (!env.WAYLAND_DISPLAY || !env.HYPRLAND_INSTANCE_SIGNATURE || !env.XDG_RUNTIME_DIR)
    )
      throw new ScreenNotReady(
        "Hyprland requires WAYLAND_DISPLAY, XDG_RUNTIME_DIR, and HYPRLAND_INSTANCE_SIGNATURE from the graphical session.",
      )
    if (id === "x11" && (env.WAYLAND_DISPLAY || env.XDG_SESSION_TYPE === "wayland"))
      throw new UseRefused(
        "X11 requires a native X11 session; XWayland is not a full-desktop backend.",
      )
    if (id === "x11" && !env.DISPLAY) throw new ScreenNotReady("No X11 display is available.")
    await session(options, type, signal)
    if (id === "x11") {
      let status = (await run("xset", ["q"], { signal })).toString()
      if (/Monitor is (Off|Standby|Suspend)/i.test(status) && allowWake && options.wakeDisplay) {
        await run("xset", ["dpms", "force", "on"], { signal })
        status = (await run("xset", ["q"], { signal })).toString()
      }
      if (/Monitor is (Off|Standby|Suspend)/i.test(status))
        throw new ScreenNotReady(
          "The X11 display is asleep. Wake it yourself or opt in with --wake-display.",
        )
    }
  }
  const dispatch = async (args: string[], signal?: AbortSignal) => {
    const said = (await run("hyprctl", ["dispatch", ...args], { signal })).toString().trim()
    if (said !== "ok")
      throw new Error(`Hyprland did not accept this operation: ${said.slice(0, 200)}`)
  }
  const monitor = async (
    signal?: AbortSignal,
    allowWake = false,
  ): Promise<Rect & { name: string }> => {
    const values = JSON.parse(
      (await run("hyprctl", ["-j", "monitors"], { signal })).toString(),
    ) as {
      name: string
      focused: boolean
      disabled?: boolean
      dpmsStatus?: boolean
      transform?: number
      x: number
      y: number
      width: number
      height: number
      scale: number
    }[]
    const selected = monitorName
      ? values.find((m) => m.name === monitorName)
      : values.find((m) => m.focused && !m.disabled)
    if (!selected || selected.disabled)
      throw new ScreenNotReady("The selected monitor is unavailable.")
    monitorName = selected.name
    if (selected.dpmsStatus !== true) {
      if (selected.dpmsStatus === false && allowWake && options.wakeDisplay) {
        await dispatch(["dpms", `on ${selected.name}`], signal)
        return monitor(signal, false)
      }
      throw new ScreenNotReady(
        "The selected monitor is asleep. Wake it yourself or opt in with --wake-display.",
      )
    }
    if ((selected.transform ?? 0) !== 0)
      throw new UseRefused("Rotated Hyprland outputs are not supported by this adapter yet.")
    if (
      ![selected.x, selected.y, selected.width, selected.height, selected.scale].every(
        Number.isFinite,
      ) ||
      selected.width <= 0 ||
      selected.height <= 0 ||
      selected.scale <= 0
    )
      throw new Error("Invalid monitor geometry")
    monitorName = selected.name
    return {
      name: selected.name,
      x: selected.x,
      y: selected.y,
      width: selected.width / selected.scale,
      height: selected.height / selected.scale,
    }
  }
  const move = async (x: number, y: number, signal: AbortSignal) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Invalid pointer coordinates")
    if (id === "hyprland")
      await dispatch(["movecursor", `${Math.round(x)} ${Math.round(y)}`], signal)
    else
      await run("xdotool", ["mousemove", "--sync", String(Math.round(x)), String(Math.round(y))], {
        signal,
      })
  }
  const button = async (which: "left" | "right", signal: AbortSignal) => {
    if (id === "hyprland") await run("wlrctl", ["pointer", "click", which], { signal })
    else await run("xdotool", ["click", which === "left" ? "1" : "3"], { signal })
  }
  const geometry = async (signal: AbortSignal): Promise<Rect> => {
    await check(signal, true)
    if (id === "hyprland") {
      const { name: _name, ...rect } = await monitor(signal, true)
      return rect
    }
    const [width, height] = (await run("xdotool", ["getdisplaygeometry"], { signal }))
      .toString()
      .trim()
      .split(/\s+/)
      .map(Number)
    if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height))
      throw new Error("Invalid X11 display geometry")
    return { x: 0, y: 0, width, height }
  }
  return {
    geometry,
    async probe(signal) {
      if (
        (options.uid ?? process.getuid?.()) === 0 ||
        (options.uid ?? process.getuid?.()) === undefined
      )
        throw new UseRefused("Native screen sharing must run as the desktop\'s non-root user.")
      for (const file of required) {
        signal?.throwIfAborted()
        if (!(await (options.has?.(file) ?? executable(file, env))))
          throw new Error(`Missing ${file} for the ${id} adapter`)
      }
      try {
        await check(signal)
        if (id === "hyprland") await monitor(signal)
        else await run("xdotool", ["getdisplaygeometry"], { signal })
      } catch (error) {
        if (error instanceof UseRefused) throw error
        throw new ScreenNotReady(`Cannot verify the graphical session: ${(error as Error).message}`)
      }
    },
    async capture(signal) {
      await check(signal, true)
      if (id === "hyprland") {
        const { name, ...rect } = await monitor(signal, true)
        const png = await run("grim", ["-o", name, "-"], { signal })
        pngDimensions(png)
        return { png, rect }
      }
      const png = await run("import", ["-window", "root", "png:-"], { signal })
      return { png, rect: { x: 0, y: 0, ...pngDimensions(png) } }
    },
    async act(action, signal) {
      if (
        action.do === "scroll" &&
        (!Number.isInteger(action.amount ?? 3) ||
          (action.amount ?? 3) < 1 ||
          (action.amount ?? 3) > 100 ||
          !["up", "down", "left", "right"].includes(action.direction))
      )
        throw new Error("Invalid scroll direction or amount")
      await check(signal, true)
      if (id === "hyprland") await monitor(signal, true)
      if ("x" in action) await move(action.x, action.y, signal)
      if (action.do === "click" || action.do === "right_click" || action.do === "double_click") {
        await button(action.do === "right_click" ? "right" : "left", signal)
        if (action.do === "double_click") await button("left", signal)
      } else if (action.do === "type") {
        if (Buffer.byteLength(action.text) > 64 * 1024)
          throw new Error("Too much text for one screen action")
        await run(
          id === "hyprland" ? "wtype" : "xdotool",
          id === "hyprland" ? ["-"] : ["type", "--clearmodifiers", "--delay", "0", "--file", "-"],
          { signal, input: action.text },
        )
      } else if (action.do === "key") {
        const parsed = keys(action.keys)
        if (id === "hyprland")
          await run(
            "wtype",
            [
              ...parsed.modifiers.flatMap((m) => ["-M", m]),
              "-k",
              parsed.key,
              ...parsed.modifiers.reverse().flatMap((m) => ["-m", m]),
            ],
            { signal },
          )
        else
          await run(
            "xdotool",
            [
              "key",
              "--clearmodifiers",
              [...parsed.modifiers.map((m) => (m === "logo" ? "super" : m)), parsed.key].join("+"),
            ],
            { signal },
          )
      } else if (action.do === "scroll") {
        const amount = action.amount ?? 3
        if (!Number.isInteger(amount) || amount < 1 || amount > 100)
          throw new Error("Scroll amount must be between 1 and 100")
        if (id === "hyprland") {
          const delta = amount * 15
          await run(
            "wlrctl",
            [
              "pointer",
              "scroll",
              String(action.direction === "up" ? -delta : action.direction === "down" ? delta : 0),
              String(
                action.direction === "left" ? -delta : action.direction === "right" ? delta : 0,
              ),
            ],
            { signal },
          )
        } else
          await run(
            "xdotool",
            [
              "click",
              "--repeat",
              String(amount),
              { up: "4", down: "5", left: "6", right: "7" }[action.direction],
            ],
            { signal },
          )
      } else if (action.do === "drag") {
        const down =
          id === "hyprland" ? ["dispatch", "sendkeystate", ",mouse:272,down,"] : ["mousedown", "1"]
        const up =
          id === "hyprland" ? ["dispatch", "sendkeystate", ",mouse:272,up,"] : ["mouseup", "1"]
        const file = id === "hyprland" ? "hyprctl" : "xdotool"
        try {
          if (id === "hyprland") await dispatch(down.slice(1), signal)
          else await run(file, down, { signal })
          await move(action.toX, action.toY, signal)
        } finally {
          if (id === "hyprland") await dispatch(up.slice(1))
          else await run(file, up)
        } // Always release a held button, even after cancellation.
      }
    },
  }
}
