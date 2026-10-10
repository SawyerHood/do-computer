/**
 * A pretend screen, for trying everything else without one: in tests, and by a daemon started
 * with `DC_DAEMON_FAKE_SCREEN=1`. Nothing on the computer is touched.
 */
import { deflateSync } from "node:zlib"
import {
  bytesToBase64,
  type ScreenWindow,
  type Shot,
  type ShotPoint,
  windowName,
} from "@durable-computer/protocol"
import type { ScreenIO } from "./daemon-core.ts"
import { UseState } from "./use.ts"

const CRC = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data])
  let crc = 0xffffffff
  for (const byte of body) crc = CRC[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  const out = Buffer.alloc(body.length + 8)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, body.length + 4)
  return out
}

/** A PNG of `width` by `height`, each pixel as `paint` says. */
export function png(
  width: number,
  height: number,
  paint: (x: number, y: number) => readonly [number, number, number],
): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1)
    for (let x = 0; x < width; x++) raw.set(paint(x, y), row + 1 + x * 3)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ])
}

const WIDTH = 640
const HEIGHT = 400

/**
 * The pretend screen: a plain picture with a mark wherever it was last clicked, and a band
 * along the bottom that grows with what was typed. It has two pretend windows, and one more for
 * each app that is opened; a window's picture is the window's own size and another colour. As
 * on a Mac, a drag is the one thing that cannot be done in a window behind what is in front.
 */
export function fakeScreen(state = new UseState({ what: "the screen" })): ScreenIO {
  let seq = 0
  let pointer: ShotPoint | undefined
  /** The window last worked in. None: the whole screen. */
  let inWindow: ScreenWindow | undefined
  let typed = 0
  const windows: ScreenWindow[] = [
    { id: 11, app: "Notes", title: "Shopping", width: 400, height: 300, shown: true },
    { id: 12, app: "Calculator", title: "Calculator", width: 230, height: 408, shown: false },
  ]
  const shot = (): Shot => {
    const at = pointer
    const width = inWindow?.width ?? WIDTH
    const height = inWindow?.height ?? HEIGHT
    const band = Math.min(width, typed * 12)
    const blue = inWindow === undefined ? 96 : 160
    const data = png(width, height, (x, y) => {
      if (at !== undefined && Math.abs(x - at.x) < 9 && Math.abs(y - at.y) < 9) return [224, 96, 64]
      if (y > height - 24 && x < band) return [240, 240, 240]
      return [36 + Math.round((x / width) * 40), 80 + Math.round((y / height) * 60), blue]
    })
    return { mimeType: "image/png", data: bytesToBase64(data), width, height }
  }
  const on = (window: ScreenWindow | undefined) => {
    if (inWindow?.id !== window?.id) pointer = undefined
    inWindow = window
  }
  return {
    async act(agent, action, say) {
      await state.enter(agent, say)
      seq++
      state.touch()
      if (action.do === "windows") return { windows: [...windows] }
      if (action.do === "open") {
        const opened: ScreenWindow = {
          id: 20 + windows.length,
          app: action.app,
          title: action.app,
          width: 320,
          height: 240,
          shown: true,
        }
        windows.unshift(opened)
        on(opened)
        return { shot: shot(), window: opened, windows: [opened] }
      }
      const window =
        action.do === "in_window" ? windows.find((each) => each.id === action.window) : undefined
      if (action.do === "in_window" && window === undefined) {
        throw new Error(
          `There is no window ${action.window} on this computer now. Ask for \`windows\` to see the ones there are.`,
        )
      }
      const act = action.do === "in_window" ? action.act : action
      if (
        window !== undefined &&
        act.do === "drag" &&
        action.do === "in_window" &&
        !action.inFront
      ) {
        throw new Error(
          "That could not be done behind what is in front: a drag moves the real pointer. Nothing was done. Do it again with `in_front: true`: the window is then brought forward for that one action, which takes the person's mouse and keyboard for a moment.",
        )
      }
      on(window)
      if ("x" in act && act.x !== undefined && act.y !== undefined) pointer = { x: act.x, y: act.y }
      if (act.do === "drag") pointer = { x: act.toX, y: act.toY }
      if (act.do === "click" || act.do === "double_click" || act.do === "right_click") {
        state.clicks++
      }
      if (act.do === "type") typed += act.text.length
      return {
        shot: shot(),
        ...(window === undefined ? {} : { window }),
        ...(pointer === undefined ? {} : { pointer }),
      }
    },
    async view(after, waitMs) {
      if (!state.active) return { active: false, seq }
      const until = Date.now() + waitMs
      while (seq <= after && Date.now() < until && !state.held) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      return {
        active: true,
        seq,
        shot: shot(),
        ...(pointer === undefined ? {} : { pointer }),
        clicks: state.clicks,
        held: state.held,
        ...(state.say === undefined ? {} : { say: state.say }),
        ...(state.agent === undefined ? {} : { agent: state.agent }),
        ...(inWindow === undefined ? {} : { title: windowName(inWindow) }),
      }
    },
    async hold(held) {
      state.hold(held)
      seq++
    },
  }
}
