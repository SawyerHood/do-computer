/**
 * What takes pictures of this computer's screen and works its mouse and keyboard: Cua Driver,
 * which comes with the app, and a pretend one for the tests.
 */
import { appendFileSync, existsSync } from "node:fs"
import * as path from "node:path"
import { pathToFileURL } from "node:url"
import { crc32, deflateSync } from "node:zlib"
import type { DesktopAction, ScreenWindow, WindowAct } from "@do-computer/protocol"

export type Picture = { png: Buffer; width: number; height: number }

/** A window as the driver has it: what an agent is told of it, and what finds it again. */
export type DriverWindow = ScreenWindow & {
  /** The program it belongs to. */
  pid: number
  /** Where its top left is on the screen, in the screen's own points. */
  x: number
  y: number
  /** How near the front it is: higher is nearer. Absent where the system does not say. */
  z?: number
}

export type ScreenDriver = {
  /** A picture of the whole screen, its longest side no longer than `maxEdge`. */
  capture(maxEdge: number): Promise<Picture>
  /** Do one thing to the whole screen. Places are in the pixels of the picture last taken. */
  act(action: DesktopAction): Promise<void>
  /** The windows there are, the nearest the front first. */
  windows(): Promise<DriverWindow[]>
  /**
   * A picture of one window, whatever is in front of it. One taken for someone `watching` is
   * only to be looked at: the places an agent gives are in the last one taken without.
   */
  captureWindow(window: DriverWindow, maxEdge: number, watching?: boolean): Promise<Picture>
  /**
   * Do one thing in a window, behind whatever is in front, or with the window brought forward
   * for it where `inFront`. Places are in the pixels of the picture last taken of the window.
   * Resolves with something the agent should know of how it went, where there is anything.
   */
  actIn(window: DriverWindow, act: WindowAct, inFront: boolean): Promise<string | undefined>
  /** Start an app by its name, without bringing it forward. Resolves with the program it is. */
  open(app: string): Promise<{ pid: number; app: string }>
  /**
   * Ask the driver something that touches nothing and needs no leave of the system: how large
   * the screen is. What it says is proof that it loaded and runs on this computer.
   */
  probe?(): Promise<string>
  dispose(): Promise<void>
}

/** The size a PNG says it is, which is cheaper than asking anything to read the picture. */
export function pngSize(png: Buffer): { width: number; height: number } {
  if (png.length < 24 || png.readUInt32BE(12) !== 0x49484452) throw new Error("Not a PNG.")
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

// ---------------------------------------------------------------------------------------------
// Cua Driver

/** The driver's packages for a system, as they are named: `linux-x64-gnu`, `darwin-arm64`. */
export function driverTarget(platform: string, arch: string): string | undefined {
  if (arch !== "x64" && arch !== "arm64") return undefined
  if (platform === "darwin") return `darwin-${arch}`
  if (platform === "linux") return `linux-${arch}-gnu`
  if (platform === "win32") return `win32-${arch}-msvc`
  return undefined
}

/**
 * Why the driver in `dir` cannot be used on this computer, or undefined when it can be tried.
 * Looks only at what files are there, so that asking costs nothing: the driver itself is
 * loaded when an agent first uses the screen.
 */
export function driverMissing(
  dir: string,
  platform: string = process.platform,
  arch: string = process.arch,
): string | undefined {
  const target = driverTarget(platform, arch)
  if (target === undefined) return "Using the screen is not supported on this kind of computer."
  const packages = path.join(dir, "node_modules")
  const needed = [
    path.join(packages, "@trycua", "cua-driver", "dist", "index.js"),
    path.join(packages, "@trycua", `cua-driver-${target}`),
  ]
  return needed.every((file) => existsSync(file))
    ? undefined
    : "This copy of Do Computer came without what it needs to use the screen."
}

type Called = {
  isError: boolean
  text: string
  images: { mimeType: string; dataBase64: string }[]
  /** What the driver said in a form to be read by a program, where it said anything so. */
  structuredJson?: string | undefined
}
type Cua = {
  callTool(name: string, args: string): Promise<Called>
  shutdown(): Promise<void>
}

/**
 * The name everything the app asks of the driver goes under. The driver draws a pointer of its
 * own for whoever uses it, and switching that off is done by name: the pointer agents are seen
 * to have here is the app's.
 */
const SESSION = "do-computer"

const MODIFIERS: Record<string, string> = {
  cmd: "cmd",
  command: "cmd",
  meta: "cmd",
  super: "cmd",
  win: "cmd",
  ctrl: "ctrl",
  control: "ctrl",
  alt: "alt",
  option: "alt",
  opt: "alt",
  shift: "shift",
}
const KEYS: Record<string, string> = { return: "enter", esc: "escape", del: "delete" }

/** `cmd+shift+t` as the driver takes it: the key that is pressed, and what is held with it. */
export function parseKeys(keys: string): { key: string; modifiers: string[] } {
  // A plus sign is itself a key: `ctrl++`, or `+` alone.
  const parts = keys.trim().replace(/\+\+$/, "+plus").replace(/^\+$/, "plus").split("+")
  const names = parts.map((part) => part.trim().toLowerCase()).filter((part) => part !== "")
  const last = names.pop()
  if (last === undefined) throw new Error("No key was named.")
  const modifiers = names.map((name) => {
    const modifier = MODIFIERS[name]
    if (modifier === undefined)
      throw new Error(
        `"${name}" is not a key that is held: use cmd, ctrl, alt or shift before the key.`,
      )
    return modifier
  })
  const key = last === "plus" ? "+" : (KEYS[last] ?? last)
  return { key, modifiers }
}

/** What the driver is asked to do for an action, or nothing where the action is not its to do. */
export function driverCall(action: DesktopAction): { tool: string; args: object } | undefined {
  const scope = "desktop"
  switch (action.do) {
    case "click":
      return { tool: "click", args: { scope, x: action.x, y: action.y, button: "left", count: 1 } }
    // The driver's own double_click and right_click take no place on the whole screen, only
    // one in a window. A click with a count or another button does.
    case "double_click":
      return { tool: "click", args: { scope, x: action.x, y: action.y, button: "left", count: 2 } }
    case "right_click":
      return { tool: "click", args: { scope, x: action.x, y: action.y, button: "right", count: 1 } }
    case "drag":
      return {
        tool: "drag",
        args: {
          scope,
          from_x: action.x,
          from_y: action.y,
          to_x: action.toX,
          to_y: action.toY,
          duration_ms: 400,
        },
      }
    case "scroll":
      return {
        tool: "scroll",
        args: {
          scope,
          direction: action.direction,
          amount: Math.max(1, Math.min(50, Math.round(action.amount ?? 3))),
          x: action.x,
          y: action.y,
        },
      }
    case "type":
      return { tool: "type_text", args: { scope, text: action.text } }
    case "key":
      return { tool: "press_key", args: { scope, ...parseKeys(action.keys) } }
    // The pointer agents are seen to have is the app's own, and moving it presses nothing.
    default:
      return undefined
  }
}

/**
 * What the driver is asked to do in a window. Left to itself the driver does it behind whatever
 * is in front: it presses what is under the place through the system's accessibility, or sends
 * the click to the program alone, and the computer's own pointer and keyboard are not touched.
 */
export function driverWindowCall(
  window: Pick<DriverWindow, "id" | "pid">,
  act: Exclude<WindowAct, { do: "screenshot" | "wait" }>,
  inFront: boolean,
): { tool: string; args: object } {
  const to = {
    pid: window.pid,
    window_id: window.id,
    delivery_mode: inFront ? "foreground" : "background",
  }
  switch (act.do) {
    case "click":
      return { tool: "click", args: { ...to, x: act.x, y: act.y, button: "left", count: 1 } }
    case "double_click":
      return { tool: "click", args: { ...to, x: act.x, y: act.y, button: "left", count: 2 } }
    case "right_click":
      return { tool: "click", args: { ...to, x: act.x, y: act.y, button: "right", count: 1 } }
    case "drag":
      return {
        tool: "drag",
        args: {
          ...to,
          from_x: act.x,
          from_y: act.y,
          to_x: act.toX,
          to_y: act.toY,
          duration_ms: 400,
        },
      }
    case "scroll":
      return {
        tool: "scroll",
        args: {
          ...to,
          direction: act.direction,
          amount: Math.max(1, Math.min(50, Math.round(act.amount ?? 3))),
          x: act.x,
          y: act.y,
        },
      }
    case "type":
      return {
        tool: "type_text",
        args: {
          ...to,
          text: act.text,
          ...(act.x === undefined || act.y === undefined ? {} : { x: act.x, y: act.y }),
        },
      }
    case "key":
      return { tool: "press_key", args: { ...to, ...parseKeys(act.keys) } }
  }
}

/** How an agent is told to have something done with the window brought forward. */
const IN_FRONT =
  "Do it again with `in_front: true`: the window is then brought forward for that one action, which takes the person's mouse and keyboard for a moment."

const parsed = (json: string | undefined): Record<string, unknown> => {
  try {
    const value: unknown = json === undefined ? undefined : JSON.parse(json)
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** The driver's own words without its marks and its names for things, which are not the agent's. */
const plain = (text: string) =>
  text
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/delivery_mode:\s*"?foreground"?/g, "`in_front: true`")
    .replace(/\bwindow_id\b/g, "`window`")
    .trim()

/**
 * Why the driver would not do something in a window, in words for an agent. Where it would
 * have done it with the window in front, that is what the agent is told to ask for.
 */
export function windowRefusal(
  called: Pick<Called, "text" | "structuredJson">,
  inFront: boolean,
): string {
  const said = parsed(called.structuredJson)
  const escalation = (said.escalation ?? {}) as { reason?: unknown; recommended?: unknown }
  const code = typeof said.code === "string" ? said.code : ""
  const wantsFront =
    !inFront &&
    (code.startsWith("background_") ||
      escalation.recommended === "foreground" ||
      /delivery_mode:\s*"?foreground/.test(called.text))
  if (!wantsFront) return plain(called.text) || "The window would not do that."
  const reason =
    typeof escalation.reason === "string" && escalation.reason.trim() !== ""
      ? escalation.reason
      : called.text
  // Its first sentence is the reason. What follows is the driver's advice, in its own names.
  const first = plain(reason)
    .split(/(?<=[.!?])\s/)[0]!
    .replace(/[.!?]+$/, "")
  return `That could not be done behind what is in front: ${first}. Nothing was done. ${IN_FRONT}`
}

/** What an agent should know of something that was done in a window, if anything. */
export function windowNote(
  called: Pick<Called, "structuredJson">,
  inFront: boolean,
): string | undefined {
  const said = parsed(called.structuredJson)
  // Sent to the program alone, with the pointer where it was. Some programs look at where the
  // pointer is, and so do nothing with it; the driver cannot tell.
  if (!inFront && said.route === "synthetic_events" && said.effect !== "confirmed") {
    return `Sent to the window without the person's mouse or keyboard, which a few programs take no notice of. If the picture shows that nothing came of it: ${IN_FRONT.charAt(0).toLowerCase()}${IN_FRONT.slice(1)}`
  }
  return undefined
}

type Listed = {
  window_id?: unknown
  pid?: unknown
  app_name?: unknown
  title?: unknown
  bounds?: { x?: unknown; y?: unknown; width?: unknown; height?: unknown }
  z_index?: unknown
  is_on_screen?: unknown
}

/** The smallest a window is on either side to be one an agent would work in. */
const SMALLEST = 60

/**
 * The windows an agent is told of, from what the driver lists: the nearest the front first,
 * without the app's own, and without the scraps programs keep that nobody would call a window.
 */
export function windowsOf(listed: unknown, own: number = process.pid): DriverWindow[] {
  const all = Array.isArray(listed) ? (listed as Listed[]) : []
  const number = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : 0
  return all
    .map((each): DriverWindow => {
      const z = typeof each.z_index === "number" ? { z: each.z_index } : {}
      return {
        id: number(each.window_id),
        pid: number(each.pid),
        app: typeof each.app_name === "string" ? each.app_name : "",
        title: typeof each.title === "string" ? each.title : "",
        x: number(each.bounds?.x),
        y: number(each.bounds?.y),
        width: Math.round(number(each.bounds?.width)),
        height: Math.round(number(each.bounds?.height)),
        // A driver that does not say is one whose windows are all there to be seen.
        shown: each.is_on_screen !== false,
        ...z,
      }
    })
    .filter(
      (each) =>
        each.id > 0 &&
        each.pid > 0 &&
        each.pid !== own &&
        each.width >= SMALLEST &&
        each.height >= SMALLEST &&
        (each.shown || each.title !== ""),
    )
    .sort((a, b) => (b.z ?? -1) - (a.z ?? -1))
}

/** How much of a window is walked to wake the program it belongs to: enough to be an asking. */
const WAKE_ELEMENTS = 40

/** Two pointers would be one too many. A driver that will not hide its own still works. */
const hideCursor = (cua: Cua) =>
  cua
    .callTool("set_agent_cursor_enabled", JSON.stringify({ session: SESSION, enabled: false }))
    .then(
      () => {},
      () => {},
    )

/** Whether the driver refused because the name everything is asked under has ended. */
export function sessionEnded(called: Pick<Called, "isError" | "text" | "structuredJson">): boolean {
  if (!called.isError) return false
  const said = parsed(called.structuredJson)
  const refusal = (said.refusal ?? {}) as { code?: unknown }
  return (
    said.code === "session_ended" ||
    refusal.code === "session_ended" ||
    /\bsession\b.*\bhas ended\b/.test(called.text)
  )
}

/**
 * Cua Driver, from the packages in `dir`. It is loaded the first time it is used, since loading
 * it starts a program of its own, and most runs of the app never use the screen.
 */
export function cuaDriver(dir: string): ScreenDriver {
  let loading: Promise<Cua> | undefined
  const load = () => {
    loading ??= (async () => {
      const missing = driverMissing(dir)
      if (missing !== undefined) throw new Error(missing)
      // The package can only be imported, not required, and is not part of the app's one file.
      const file = path.join(dir, "node_modules", "@trycua", "cua-driver", "dist", "index.js")
      const { CuaDriver } = (await import(pathToFileURL(file).href)) as {
        CuaDriver: { create(options: undefined): Cua }
      }
      const cua = CuaDriver.create(undefined)
      await hideCursor(cua)
      return cua
    })()
    // A driver that would not load is tried again the next time, not remembered as broken.
    loading.catch(() => (loading = undefined))
    return loading
  }
  /** Ask the driver for something, and resolve with whatever it said, a refusal included. */
  const ask = async (tool: string, args: object): Promise<Called> => {
    const cua = await load()
    const asked = JSON.stringify({ ...args, session: SESSION })
    const called = await cua.callTool(tool, asked)
    if (!sessionEnded(called)) return called
    // The driver ends a name it has not heard in five minutes, and does nothing more under
    // it until it is started again: an agent that came back to the screen later would find it
    // refused for good.
    await cua.callTool("start_session", JSON.stringify({ session: SESSION })).catch(() => {})
    await hideCursor(cua)
    return cua.callTool(tool, asked)
  }
  const call = async (tool: string, args: object): Promise<Called> => {
    const called = await ask(tool, args)
    if (called.isError) throw new Error(called.text.trim() || `The screen would not ${tool}.`)
    return called
  }
  /** The programs whose windows have been looked at once with everything in them. */
  const woken = new Set<number>()
  const picture = (called: Called, of: string): Picture => {
    const image = called.images.find((each) => each.mimeType === "image/png")
    if (image === undefined) throw new Error(`${of} gave no picture of itself.`)
    const png = Buffer.from(image.dataBase64, "base64")
    return { png, ...pngSize(png) }
  }
  return {
    async capture(maxEdge) {
      return picture(
        await call("get_desktop_state", { max_image_dimension: maxEdge }),
        "The screen",
      )
    },
    async act(action) {
      const asked = driverCall(action)
      if (asked !== undefined) await call(asked.tool, asked.args)
    },
    async windows() {
      const called = await call("list_windows", {})
      return windowsOf(parsed(called.structuredJson).windows)
    },
    async captureWindow(window, maxEdge, watching) {
      // The picture alone: walking everything in the window is slow, and nothing here reads it.
      // But a program made of web pages tells the system what is in its window only once it
      // has been asked, and until then a click there finds nothing to press. So the first
      // picture an agent is given of a program's window asks, and by its first click it is told.
      const wake = watching !== true && !woken.has(window.pid)
      const called = await call("get_window_state", {
        pid: window.pid,
        window_id: window.id,
        include_accessibility_tree: wake,
        ...(wake ? { max_elements: WAKE_ELEMENTS } : {}),
        max_image_dimension: maxEdge,
        ...(watching === true ? { display_only: true } : {}),
      })
      if (wake) woken.add(window.pid)
      return picture(called, "That window")
    },
    async actIn(window, act, inFront) {
      if (act.do === "screenshot" || act.do === "wait") return undefined
      const asked = driverWindowCall(window, act, inFront)
      const called = await ask(asked.tool, asked.args)
      if (called.isError) throw new Error(windowRefusal(called, inFront))
      return windowNote(called, inFront)
    },
    async open(name) {
      // A name with dots and no spaces is the kind an app is known to its system by.
      const how = /^[\w-]+(\.[\w-]+)+$/.test(name) ? { bundle_id: name } : { name }
      const called = await call("launch_app", how)
      const said = parsed(called.structuredJson)
      if (typeof said.pid !== "number" || said.pid <= 0) {
        throw new Error(plain(called.text) || `"${name}" would not open.`)
      }
      return { pid: said.pid, app: typeof said.name === "string" ? said.name : name }
    },
    probe: async () => (await call("get_screen_size", {})).text.trim(),
    async dispose() {
      const cua = await loading?.catch(() => undefined)
      loading = undefined
      await cua?.shutdown().catch(() => {})
    },
  }
}

// ---------------------------------------------------------------------------------------------
// A pretend screen, for the tests

/** A PNG of one colour. */
export function plainPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data])
    const head = Buffer.alloc(4)
    head.writeUInt32BE(data.length)
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc32(body))
    return Buffer.concat([head, body, sum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, Buffer.from(rgb))])
  const rows = Buffer.alloc(row.length * height, row)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

/**
 * A screen that is a plain picture and does nothing it is asked, but says what it was asked:
 * in `done`, and as a line of JSON each in the file `log` where one is named.
 */
export function fakeDriver(log?: string): ScreenDriver & {
  readonly done: (DesktopAction | (WindowAct & { window: number; inFront: boolean }))[]
} {
  const done: (DesktopAction | (WindowAct & { window: number; inFront: boolean }))[] = []
  const windows: DriverWindow[] = [
    {
      id: 11,
      pid: 101,
      app: "Notes",
      title: "Shopping",
      x: 40,
      y: 60,
      width: 400,
      height: 300,
      shown: true,
      z: 2,
    },
    {
      id: 12,
      pid: 102,
      app: "Calculator",
      title: "Calculator",
      x: 80,
      y: 90,
      width: 230,
      height: 408,
      shown: false,
      z: 1,
    },
  ]
  const write = (entry: (typeof done)[number]) => {
    done.push(entry)
    if (log !== undefined) appendFileSync(log, `${JSON.stringify(entry)}\n`)
  }
  return {
    done,
    async windows() {
      return [...windows]
    },
    async captureWindow(window, maxEdge) {
      const fit = Math.min(1, maxEdge / Math.max(window.width, window.height))
      const width = Math.round(window.width * fit)
      const height = Math.round(window.height * fit)
      return {
        png: plainPng(width, height, [90, 60 + ((done.length * 16) % 120), window.id]),
        width,
        height,
      }
    },
    async actIn(window, act, inFront) {
      // As on a Mac, where a drag is the one thing that cannot be done behind what is in front.
      if (act.do === "drag" && !inFront) {
        throw new Error(
          windowRefusal(
            {
              text: "Background drag is unavailable.",
              structuredJson: JSON.stringify({
                code: "background_unavailable",
                escalation: { reason: "A drag moves the real pointer.", recommended: "foreground" },
              }),
            },
            inFront,
          ),
        )
      }
      write({ ...act, window: window.id, inFront })
      return undefined
    },
    async open(app) {
      const id = 20 + windows.length
      windows.unshift({
        id,
        pid: 100 + id,
        app,
        title: app,
        x: 0,
        y: 0,
        width: 320,
        height: 240,
        shown: true,
        z: id,
      })
      return { pid: 100 + id, app }
    },
    async capture(maxEdge) {
      const width = Math.min(maxEdge, 640)
      const height = Math.round((width * 3) / 4)
      // A shade that changes with what was done, so that one picture can be told from the next.
      return {
        png: plainPng(width, height, [20, 120 + ((done.length * 16) % 120), 130]),
        width,
        height,
      }
    },
    async act(action) {
      write(action)
    },
    async dispose() {},
  }
}
