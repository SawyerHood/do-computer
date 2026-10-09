/**
 * A pretend screen, for trying everything else without one: in tests, and by a daemon started
 * with `DC_DAEMON_FAKE_SCREEN=1`. Nothing on the computer is touched.
 */
import { deflateSync } from "node:zlib"
import { bytesToBase64, type Shot, type ShotPoint } from "@durable-computer/protocol"
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
 * along the bottom that grows with what was typed.
 */
export function fakeScreen(state = new UseState({ what: "the screen" })): ScreenIO {
  let seq = 0
  let pointer: ShotPoint | undefined
  let typed = 0
  const shot = (): Shot => {
    const at = pointer
    const band = Math.min(WIDTH, typed * 12)
    const data = png(WIDTH, HEIGHT, (x, y) => {
      if (at !== undefined && Math.abs(x - at.x) < 9 && Math.abs(y - at.y) < 9) return [224, 96, 64]
      if (y > HEIGHT - 24 && x < band) return [240, 240, 240]
      return [36 + Math.round((x / WIDTH) * 40), 80 + Math.round((y / HEIGHT) * 60), 96]
    })
    return { mimeType: "image/png", data: bytesToBase64(data), width: WIDTH, height: HEIGHT }
  }
  return {
    async act(agent, action, say) {
      await state.enter(agent, say)
      if ("x" in action) pointer = { x: action.x, y: action.y }
      if (action.do === "drag") pointer = { x: action.toX, y: action.toY }
      if (action.do === "click" || action.do === "double_click" || action.do === "right_click") {
        state.clicks++
      }
      if (action.do === "type") typed += action.text.length
      seq++
      state.touch()
      return { shot: shot(), ...(pointer === undefined ? {} : { pointer }) }
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
      }
    },
    async hold(held) {
      state.hold(held)
      seq++
    },
  }
}
