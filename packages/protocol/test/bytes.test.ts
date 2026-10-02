import { describe, expect, it } from "vitest"
import { BodyTooLarge, declaredTooLarge, readLimited } from "../src/index.ts"

/** A body that would never end, and that says how much of it was asked for. */
function endless(chunk = 1024) {
  const state = { pulled: 0, cancelled: false }
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.pulled += chunk
      controller.enqueue(new Uint8Array(chunk).fill(7))
    },
    cancel() {
      state.cancelled = true
    },
  })
  return { stream, state }
}

describe("readLimited", () => {
  it("returns a body that fits, whole and in order", async () => {
    const body = new Response(new Uint8Array([1, 2, 3, 4, 5])).body
    expect([...(await readLimited(body, 5))]).toEqual([1, 2, 3, 4, 5])
    expect((await readLimited(null, 10)).length).toBe(0)
    const chunked = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]))
        controller.enqueue(new Uint8Array([3]))
        controller.close()
      },
    })
    expect([...(await readLimited(chunked, 3))]).toEqual([1, 2, 3])
  })

  it("stops reading as soon as the limit is passed, and lets the sender go", async () => {
    const { stream, state } = endless()
    await expect(readLimited(stream, 10_000)).rejects.toBeInstanceOf(BodyTooLarge)
    // It did not keep pulling a body that has no end.
    expect(state.pulled).toBeLessThan(20_000)
    expect(state.cancelled).toBe(true)
  })

  it("does not trust a declared length, but uses one that already rules the body out", () => {
    expect(declaredTooLarge(new Headers({ "content-length": "11" }), 10)).toBe(true)
    expect(declaredTooLarge(new Headers({ "content-length": "10" }), 10)).toBe(false)
    // Absent or nonsense: not a reason to refuse, and not a reason to believe it is small.
    expect(declaredTooLarge(new Headers(), 10)).toBe(false)
    expect(declaredTooLarge(new Headers({ "content-length": "many" }), 10)).toBe(false)
  })
})
