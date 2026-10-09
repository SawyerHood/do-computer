/**
 * What takes pictures of this computer's screen and works its mouse and keyboard: Cua Driver,
 * which comes with the app, and a pretend one for the tests.
 */
import { appendFileSync, existsSync } from "node:fs"
import * as path from "node:path"
import { pathToFileURL } from "node:url"
import { crc32, deflateSync } from "node:zlib"
import type { ScreenAction } from "@durable-computer/protocol"

export type Picture = { png: Buffer; width: number; height: number }

export type ScreenDriver = {
  /** A picture of the whole screen, its longest side no longer than `maxEdge`. */
  capture(maxEdge: number): Promise<Picture>
  /** Do one thing. Places are in the pixels of the picture last taken. */
  act(action: ScreenAction): Promise<void>
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
export function driverCall(action: ScreenAction): { tool: string; args: object } | undefined {
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
      // Two pointers would be one too many. A driver that will not hide its own still works.
      await cua
        .callTool("set_agent_cursor_enabled", JSON.stringify({ session: SESSION, enabled: false }))
        .catch(() => {})
      return cua
    })()
    // A driver that would not load is tried again the next time, not remembered as broken.
    loading.catch(() => (loading = undefined))
    return loading
  }
  const call = async (tool: string, args: object): Promise<Called> => {
    const cua = await load()
    const called = await cua.callTool(tool, JSON.stringify({ ...args, session: SESSION }))
    if (called.isError) throw new Error(called.text.trim() || `The screen would not ${tool}.`)
    return called
  }
  return {
    async capture(maxEdge) {
      const called = await call("get_desktop_state", { max_image_dimension: maxEdge })
      const image = called.images.find((each) => each.mimeType === "image/png")
      if (image === undefined) throw new Error("The screen gave no picture of itself.")
      const png = Buffer.from(image.dataBase64, "base64")
      return { png, ...pngSize(png) }
    },
    async act(action) {
      const asked = driverCall(action)
      if (asked !== undefined) await call(asked.tool, asked.args)
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
export function fakeDriver(log?: string): ScreenDriver & { readonly done: ScreenAction[] } {
  const done: ScreenAction[] = []
  return {
    done,
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
      done.push(action)
      if (log !== undefined) appendFileSync(log, `${JSON.stringify(action)}\n`)
    },
    async dispose() {},
  }
}
