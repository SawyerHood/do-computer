/**
 * A tiny Wayland client for the wlr virtual-pointer protocol, which Hyprland (and other wlroots
 * compositors) implement. It replaces wlrctl: one connection per action, so a drag holds its
 * button down across real motion events and a double click is two clicks within the system's
 * double-click time, not two process launches. It needs no file descriptors passed over the
 * socket, only the plain wire protocol.
 */
import { connect, type Socket } from "node:net"
// Wayland is Linux-only: its paths are POSIX paths wherever this code is built or tested.
import { isAbsolute, join } from "node:path/posix"

/** One step of pointer input. Coordinates are in the compositor's global layout space. */
export type PointerStep =
  | { do: "move"; x: number; y: number }
  | { do: "button"; button: "left" | "right" | "middle"; pressed: boolean }
  | { do: "scroll"; axis: "vertical" | "horizontal"; notches: number }
  | { do: "wait"; ms: number }

/** The bounding box of every output, in layout coordinates, which absolute motion spans. */
export type Layout = { x: number; y: number; width: number; height: number }

const BUTTONS = { left: 0x110, right: 0x111, middle: 0x112 } as const
const MANAGER = "zwlr_virtual_pointer_manager_v1"
const EXTENT = 1_000_000

class Writer {
  #parts: Buffer[] = []
  uint(value: number) {
    const buffer = Buffer.alloc(4)
    buffer.writeUInt32LE(value >>> 0)
    this.#parts.push(buffer)
    return this
  }
  int(value: number) {
    const buffer = Buffer.alloc(4)
    buffer.writeInt32LE(value | 0)
    this.#parts.push(buffer)
    return this
  }
  fixed(value: number) {
    return this.int(Math.round(value * 256))
  }
  string(value: string) {
    const bytes = Buffer.from(`${value}\0`)
    this.uint(bytes.length)
    this.#parts.push(bytes, Buffer.alloc((4 - (bytes.length % 4)) % 4))
    return this
  }
  message(object: number, opcode: number): Buffer {
    const body = Buffer.concat(this.#parts)
    const header = Buffer.alloc(8)
    header.writeUInt32LE(object)
    header.writeUInt32LE(((8 + body.length) << 16) | opcode, 4)
    return Buffer.concat([header, body])
  }
}

function readString(body: Buffer, at: number): [string, number] {
  const length = body.readUInt32LE(at)
  const text = body.subarray(at + 4, at + 4 + Math.max(0, length - 1)).toString()
  return [text, at + 4 + length + ((4 - (length % 4)) % 4)]
}

/** The socket of the Wayland display in this environment, as libwayland would find it. */
export function waylandSocket(env: NodeJS.ProcessEnv): string {
  const display = env.WAYLAND_DISPLAY || "wayland-0"
  if (isAbsolute(display)) return display
  if (!env.XDG_RUNTIME_DIR) throw new Error("XDG_RUNTIME_DIR is not set")
  return join(env.XDG_RUNTIME_DIR, display)
}

/**
 * Connects, makes a virtual pointer, performs the steps, and disconnects. Buttons still held when
 * this stops (for an abort or an error) are released first, on the same connection, so nothing is
 * left pressed; the original error is what is thrown.
 */
export async function virtualPointer(
  path: string,
  layout: Layout,
  steps: readonly PointerStep[],
  signal?: AbortSignal,
  timeoutMs = 10_000,
): Promise<void> {
  signal?.throwIfAborted()
  if (!(layout.width > 0 && layout.height > 0)) throw new Error("Invalid output layout")
  const socket: Socket = connect(path)
  let failure: Error | undefined
  let wake: (() => void) | undefined
  let interrupt: (() => void) | undefined
  let received = Buffer.alloc(0)
  const globals = new Map<string, number>()
  const done = new Set<number>()
  const fail = (error: Error) => {
    failure ??= error
    wake?.()
    interrupt?.()
  }
  socket.on("error", fail)
  socket.on("close", () => fail(new Error("The Wayland compositor closed the connection")))
  socket.on("data", (chunk: Buffer) => {
    received = Buffer.concat([received, chunk])
    while (received.length >= 8) {
      const size = received.readUInt32LE(4) >>> 16
      if (size < 8) return fail(new Error("Malformed Wayland message"))
      if (received.length < size) break
      const object = received.readUInt32LE(0)
      const opcode = received.readUInt32LE(4) & 0xffff
      const body = received.subarray(8, size)
      received = received.subarray(size)
      if (object === 1 && opcode === 0) {
        const [message] = readString(body, 8)
        fail(new Error(`Wayland protocol error: ${message}`))
      } else if (object === 2 && opcode === 0) {
        const name = body.readUInt32LE(0)
        const [iface] = readString(body, 4)
        globals.set(iface, name)
      } else if (opcode === 0 && object >= 3) done.add(object)
    }
    wake?.()
  })
  const abort = () => fail(signal?.reason ?? new Error("Pointer input aborted"))
  signal?.addEventListener("abort", abort, { once: true })
  const timer = setTimeout(() => fail(new Error("Pointer input timed out")), timeoutMs)
  const until = async (ready: () => boolean) => {
    while (!ready()) {
      if (failure) throw failure
      await new Promise<void>((resolve) => (wake = resolve))
      wake = undefined
    }
    if (failure) throw failure
  }
  const send = (message: Buffer) => {
    if (failure) throw failure
    socket.write(message)
  }
  let nextId = 2
  const sync = async () => {
    const id = ++nextId
    send(new Writer().uint(id).message(1, 0))
    await until(() => done.has(id))
  }
  const started = Date.now()
  const time = () => (Date.now() - started) >>> 0
  const held = new Set<number>()
  let pointer = 0
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve)
      socket.once("error", reject)
    })
    send(new Writer().uint(2).message(1, 1)) // wl_display.get_registry
    await sync()
    const name = globals.get(MANAGER)
    if (name === undefined)
      throw new Error("This compositor does not offer virtual pointers (wlr-virtual-pointer)")
    const manager = ++nextId
    send(new Writer().uint(name).string(MANAGER).uint(1).uint(manager).message(2, 0))
    pointer = ++nextId
    send(new Writer().uint(0).uint(pointer).message(manager, 0)) // no particular seat
    for (const step of steps) {
      if (failure) throw failure
      if (step.do === "wait") {
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, step.ms)
          interrupt = () => {
            clearTimeout(timeout)
            resolve()
          }
        })
        interrupt = undefined
        continue
      }
      if (step.do === "move") {
        const fx = (step.x - layout.x) / layout.width
        const fy = (step.y - layout.y) / layout.height
        if (![fx, fy].every((f) => Number.isFinite(f) && f >= 0 && f <= 1))
          throw new Error("Pointer position is outside every output")
        send(
          new Writer()
            .uint(time())
            .uint(Math.round(fx * EXTENT))
            .uint(Math.round(fy * EXTENT))
            .uint(EXTENT)
            .uint(EXTENT)
            .message(pointer, 1),
        )
      } else if (step.do === "button") {
        const code = BUTTONS[step.button]
        send(
          new Writer()
            .uint(time())
            .uint(code)
            .uint(step.pressed ? 1 : 0)
            .message(pointer, 2),
        )
        if (step.pressed) held.add(code)
        else held.delete(code)
      } else {
        const axis = step.axis === "vertical" ? 0 : 1
        send(new Writer().uint(0).message(pointer, 5)) // axis_source: wheel
        send(
          new Writer()
            .uint(time())
            .uint(axis)
            .fixed(15 * step.notches)
            .int(step.notches)
            .message(pointer, 7), // axis_discrete
        )
      }
      send(new Writer().message(pointer, 4)) // frame
    }
    await sync()
  } finally {
    signal?.removeEventListener("abort", abort)
    clearTimeout(timer)
    if (pointer && !socket.destroyed) {
      try {
        for (const code of held) {
          socket.write(new Writer().uint(time()).uint(code).uint(0).message(pointer, 2))
          socket.write(new Writer().message(pointer, 4))
        }
        socket.write(new Writer().message(pointer, 8)) // destroy
      } catch {}
    }
    if (!socket.destroyed) {
      // Let any release reach the compositor before hanging up; bounded so it cannot hang.
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 500)
        socket.end(() => {
          clearTimeout(timeout)
          resolve()
        })
      })
    }
    socket.destroy()
  }
}
