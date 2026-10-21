import { access } from "node:fs/promises"
import { constants } from "node:fs"
import { delimiter, join } from "node:path"
import type { DesktopAction } from "@do-computer/protocol"
import { UseRefused } from "@do-computer/computers/use"
import type { Command } from "./command.ts"
import { virtualPointer, waylandSocket, type Layout, type PointerStep } from "./wayland-pointer.ts"

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
  /** Hyprland pointer input; the wlr virtual-pointer client unless a test replaces it. */
  pointer?: (
    socket: string,
    layout: Layout,
    steps: readonly PointerStep[],
    signal?: AbortSignal,
  ) => Promise<void>
}

export const LINUX_TOOLS = {
  // Pointer input speaks the wlr virtual-pointer protocol itself, so wlrctl is not needed.
  hyprland: ["loginctl", "hyprctl", "grim", "wtype"],
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
  // Hyprland with a Lua config (0.55+) takes dispatchers as Lua; older ones take the classic form.
  const dpmsOn = async (name: string, signal?: AbortSignal) => {
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) throw new Error("Unexpected monitor name")
    try {
      await dispatch(["dpms", `on ${name}`], signal)
    } catch (error) {
      signal?.throwIfAborted()
      await dispatch([`hl.dsp.dpms({ action = "on", monitor = "${name}" })`], signal).catch(() => {
        throw error
      })
    }
  }
  const monitor = async (
    signal?: AbortSignal,
    allowWake = false,
  ): Promise<Rect & { name: string; layout: Layout }> => {
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
      solitaryBlockedBy?: string[]
    }[]
    // Hyprland's own record of a session lock (ext-session-lock), which logind's LockedHint
    // misses for lockers that do not report to logind.
    if (
      values.some((m) => Array.isArray(m.solitaryBlockedBy) && m.solitaryBlockedBy.includes("LOCK"))
    )
      throw new ScreenNotReady("The Hyprland session is locked. Unlock it yourself before sharing.")
    const selected = monitorName
      ? values.find((m) => m.name === monitorName)
      : values.find((m) => m.focused && !m.disabled)
    if (!selected || selected.disabled)
      throw new ScreenNotReady("The selected monitor is unavailable.")
    monitorName = selected.name
    if (selected.dpmsStatus !== true) {
      if (selected.dpmsStatus === false && allowWake && options.wakeDisplay) {
        await dpmsOn(selected.name, signal)
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
    const shown = values.filter((m) => !m.disabled && m.width > 0 && m.height > 0 && m.scale > 0)
    const left = Math.min(...shown.map((m) => m.x))
    const top = Math.min(...shown.map((m) => m.y))
    const layout = {
      x: left,
      y: top,
      width: Math.max(...shown.map((m) => m.x + m.width / m.scale)) - left,
      height: Math.max(...shown.map((m) => m.y + m.height / m.scale)) - top,
    }
    return {
      layout,
      name: selected.name,
      x: selected.x,
      y: selected.y,
      width: selected.width / selected.scale,
      height: selected.height / selected.scale,
    }
  }
  const move = async (x: number, y: number, signal: AbortSignal) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Invalid pointer coordinates")
    await run("xdotool", ["mousemove", "--sync", String(Math.round(x)), String(Math.round(y))], {
      signal,
    })
  }
  /** One connection per action: a drag holds its button across motion, a double click is quick. */
  const hyprPointer = async (action: DesktopAction, layout: Layout, signal: AbortSignal) => {
    const steps: PointerStep[] = "x" in action ? [{ do: "move", x: action.x, y: action.y }] : []
    const click = (button: "left" | "right"): PointerStep[] => [
      { do: "button", button, pressed: true },
      { do: "button", button, pressed: false },
    ]
    if (action.do === "click" || action.do === "right_click")
      steps.push(...click(action.do === "click" ? "left" : "right"))
    else if (action.do === "double_click")
      steps.push(...click("left"), { do: "wait", ms: 60 }, ...click("left"))
    else if (action.do === "drag") {
      steps.push({ do: "wait", ms: 30 }, { do: "button", button: "left", pressed: true })
      // Real motion while the button is held, so apps that track the pointer see a drag.
      const count = 12
      for (let i = 1; i <= count; i++)
        steps.push(
          { do: "wait", ms: 16 },
          {
            do: "move",
            x: action.x + ((action.toX - action.x) * i) / count,
            y: action.y + ((action.toY - action.y) * i) / count,
          },
        )
      steps.push({ do: "wait", ms: 50 }, { do: "button", button: "left", pressed: false })
    } else if (action.do === "scroll") {
      const sign = action.direction === "up" || action.direction === "left" ? -1 : 1
      const axis =
        action.direction === "up" || action.direction === "down" ? "vertical" : "horizontal"
      for (let i = 0; i < (action.amount ?? 3); i++)
        steps.push({ do: "scroll", axis, notches: sign }, { do: "wait", ms: 15 })
    }
    if (steps.length)
      await (options.pointer ?? virtualPointer)(waylandSocket(env), layout, steps, signal)
  }
  const geometry = async (signal: AbortSignal): Promise<Rect> => {
    await check(signal, true)
    if (id === "hyprland") {
      const { name: _name, layout: _layout, ...rect } = await monitor(signal, true)
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
        const { name, layout: _layout, ...rect } = await monitor(signal, true)
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
      if (
        "x" in action &&
        ![action.x, action.y, ...(action.do === "drag" ? [action.toX, action.toY] : [])].every(
          Number.isFinite,
        )
      )
        throw new Error("Invalid pointer coordinates")
      if (action.do === "type" && Buffer.byteLength(action.text) > 64 * 1024)
        throw new Error("Too much text for one screen action")
      const parsed = action.do === "key" ? keys(action.keys) : undefined
      await check(signal, true)
      if (id === "hyprland") {
        const { layout } = await monitor(signal, true)
        if (action.do === "type") await run("wtype", ["-"], { signal, input: action.text })
        else if (parsed)
          await run(
            "wtype",
            [
              ...parsed.modifiers.flatMap((m) => ["-M", m]),
              "-k",
              parsed.key,
              ...[...parsed.modifiers].reverse().flatMap((m) => ["-m", m]),
            ],
            { signal },
          )
        else await hyprPointer(action, layout, signal)
        return
      }
      if ("x" in action) await move(action.x, action.y, signal)
      if (action.do === "click" || action.do === "right_click")
        await run("xdotool", ["click", action.do === "click" ? "1" : "3"], { signal })
      else if (action.do === "double_click")
        // One process, so both clicks land within the double-click time.
        await run("xdotool", ["click", "--repeat", "2", "--delay", "60", "1"], { signal })
      else if (action.do === "type")
        await run("xdotool", ["type", "--clearmodifiers", "--delay", "0", "--file", "-"], {
          signal,
          input: action.text,
        })
      else if (parsed)
        await run(
          "xdotool",
          [
            "key",
            "--clearmodifiers",
            [...parsed.modifiers.map((m) => (m === "logo" ? "super" : m)), parsed.key].join("+"),
          ],
          { signal },
        )
      else if (action.do === "scroll")
        await run(
          "xdotool",
          [
            "click",
            "--repeat",
            String(action.amount ?? 3),
            { up: "4", down: "5", left: "6", right: "7" }[action.direction],
          ],
          { signal },
        )
      else if (action.do === "drag") {
        let failed = false
        try {
          await run("xdotool", ["mousedown", "1"], { signal })
          await move(action.toX, action.toY, signal)
        } catch (error) {
          failed = true
          throw error
        } finally {
          // Always release a held button, even after cancellation (so no signal here), but never
          // let a failed release hide why the drag itself failed.
          await run("xdotool", ["mouseup", "1"]).catch((error: unknown) => {
            if (!failed) throw error
          })
        }
      }
    },
  }
}
