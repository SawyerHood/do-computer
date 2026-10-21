import { mkdtemp, rm } from "node:fs/promises"
import { createServer, type Server, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it } from "vitest"
import { virtualPointer, waylandSocket } from "../src/adapters/wayland-pointer.ts"

type Request = { object: number; opcode: number; body: Buffer }
const clean: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const dispose of clean.reverse()) await dispose()
  clean.length = 0
})

function message(object: number, opcode: number, body: Buffer) {
  const header = Buffer.alloc(8)
  header.writeUInt32LE(object)
  header.writeUInt32LE(((8 + body.length) << 16) | opcode, 4)
  return Buffer.concat([header, body])
}
function string(value: string) {
  const bytes = Buffer.from(`${value}\0`)
  const length = Buffer.alloc(4)
  length.writeUInt32LE(bytes.length)
  return Buffer.concat([length, bytes, Buffer.alloc((4 - (bytes.length % 4)) % 4)])
}
function uints(...values: number[]) {
  const buffer = Buffer.alloc(values.length * 4)
  values.forEach((value, index) => buffer.writeUInt32LE(value, index * 4))
  return buffer
}

/** A compositor that offers a virtual-pointer manager and records every request. */
async function compositor(offer = true) {
  const dir = await mkdtemp(join(tmpdir(), "dc-wl-"))
  clean.push(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, "wayland-9")
  const requests: Request[] = []
  let closed!: () => void
  const disconnected = new Promise<void>((resolve) => (closed = resolve))
  const server: Server = createServer((socket: Socket) => {
    let buffer = Buffer.alloc(0)
    socket.on("close", closed)
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length >= 8) {
        const size = buffer.readUInt32LE(4) >>> 16
        if (buffer.length < size) break
        const request = {
          object: buffer.readUInt32LE(0),
          opcode: buffer.readUInt32LE(4) & 0xffff,
          body: buffer.subarray(8, size),
        }
        buffer = buffer.subarray(size)
        requests.push(request)
        if (request.object === 1 && request.opcode === 1) {
          const registry = request.body.readUInt32LE(0)
          socket.write(message(registry, 0, Buffer.concat([uints(1), string("wl_seat"), uints(7)])))
          if (offer)
            socket.write(
              message(
                registry,
                0,
                Buffer.concat([uints(9), string("zwlr_virtual_pointer_manager_v1"), uints(2)]),
              ),
            )
        }
        if (request.object === 1 && request.opcode === 0)
          socket.write(message(request.body.readUInt32LE(0), 0, uints(0)))
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(path, resolve))
  clean.push(() => new Promise((resolve) => server.close(resolve)))
  // Objects: 2 registry, 3 first sync, 4 manager, 5 pointer.
  const pointerRequests = () => requests.filter((r) => r.object === 5)
  return { path, requests, pointerRequests, disconnected }
}
const layout = { x: 0, y: 0, width: 3200, height: 1080 }

it("binds the manager, sends absolute motion in layout space, and frames each step", async () => {
  const wl = await compositor()
  await virtualPointer(wl.path, layout, [
    { do: "move", x: 1600, y: 270 },
    { do: "button", button: "left", pressed: true },
    { do: "button", button: "left", pressed: false },
    { do: "scroll", axis: "vertical", notches: -1 },
  ])
  await wl.disconnected
  const bind = wl.requests.find((r) => r.object === 2 && r.opcode === 0)!
  expect(bind.body.readUInt32LE(0)).toBe(9)
  expect(bind.body.toString("utf8", 8, 39)).toBe("zwlr_virtual_pointer_manager_v1")
  const ops = wl.pointerRequests().map((r) => r.opcode)
  // motion_absolute, frame, button, frame, button, frame, axis_source, axis_discrete, frame, destroy
  expect(ops).toEqual([1, 4, 2, 4, 2, 4, 5, 7, 4, 8])
  const motion = wl.pointerRequests()[0]!.body
  expect([motion.readUInt32LE(4), motion.readUInt32LE(8), motion.readUInt32LE(12)]).toEqual([
    500_000, 250_000, 1_000_000,
  ])
  const press = wl.pointerRequests()[2]!.body
  expect([press.readUInt32LE(4), press.readUInt32LE(8)]).toEqual([0x110, 1])
  const discrete = wl.pointerRequests()[7]!.body
  expect([discrete.readInt32LE(8), discrete.readInt32LE(12)]).toEqual([-15 * 256, -1])
})

it("releases a held button and keeps the original error when a step fails", async () => {
  const wl = await compositor()
  await expect(
    virtualPointer(wl.path, layout, [
      { do: "button", button: "left", pressed: true },
      { do: "move", x: 99_999, y: 0 },
    ]),
  ).rejects.toThrow(/outside every output/)
  await wl.disconnected
  const buttons = wl.pointerRequests().filter((r) => r.opcode === 2)
  expect(buttons.map((r) => r.body.readUInt32LE(8))).toEqual([1, 0])
})

it("releases a held button when aborted mid-drag", async () => {
  const wl = await compositor()
  const controller = new AbortController()
  setTimeout(() => controller.abort(new Error("stopped by owner")), 50)
  await expect(
    virtualPointer(
      wl.path,
      layout,
      [
        { do: "button", button: "left", pressed: true },
        { do: "wait", ms: 5_000 },
        { do: "move", x: 10, y: 10 },
      ],
      controller.signal,
    ),
  ).rejects.toThrow(/stopped by owner/)
  await wl.disconnected
  const buttons = wl.pointerRequests().filter((r) => r.opcode === 2)
  expect(buttons.map((r) => r.body.readUInt32LE(8))).toEqual([1, 0])
  expect(wl.pointerRequests().some((r) => r.opcode === 1)).toBe(false)
})

it("says so when the compositor has no virtual pointers", async () => {
  const wl = await compositor(false)
  await expect(virtualPointer(wl.path, layout, [{ do: "move", x: 1, y: 1 }])).rejects.toThrow(
    /does not offer virtual pointers/,
  )
})

it("finds the socket as libwayland does", () => {
  expect(waylandSocket({ XDG_RUNTIME_DIR: "/run/user/1", WAYLAND_DISPLAY: "wayland-1" })).toBe(
    "/run/user/1/wayland-1",
  )
  expect(waylandSocket({ WAYLAND_DISPLAY: "/tmp/w" })).toBe("/tmp/w")
  expect(() => waylandSocket({ WAYLAND_DISPLAY: "wayland-1" })).toThrow()
})
