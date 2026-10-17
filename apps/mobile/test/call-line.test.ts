import type { StartedCall } from "@do-computer/protocol"
import type { FromPage } from "@/call/line"
import { beforeEach, describe, expect, it, vi } from "vitest"

const permission = { granted: true }
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }))
vi.mock("expo-audio", () => ({ requestRecordingPermissionsAsync: async () => permission }))

const { microphoneProblem, openLine, readFromPage, setLineHost } = await import("@/call/line")

/** A page that is stood in for: what the app tells it, and a way to have it say something. */
function page() {
  const told: unknown[] = []
  let say: ((message: FromPage) => void) | undefined
  let released = false
  setLineHost({
    open(onMessage) {
      say = onMessage
      return {
        post: (message) => told.push(message),
        release: () => {
          released = true
        },
      }
    },
  })
  return {
    told,
    say: (message: FromPage) => say?.(message),
    get opened() {
      return say !== undefined
    },
    get released() {
      return released
    },
  }
}

const placed: StartedCall = {
  id: "call-1",
  dialect: "openai",
  sdp: "answer-sdp",
  voice: "marin",
  maxSeconds: 1800,
  quietSeconds: 120,
}

describe("the phone's line for a call", () => {
  beforeEach(() => {
    permission.granted = true
    setLineHost(undefined)
  })

  it("opens the page, places the call with its offer, and is the call once the answer is taken", async () => {
    const host = page()
    const events: string[] = []
    const place = vi.fn(async () => placed)
    const opening = openLine(
      place,
      (data) => events.push(data),
      () => {},
    )
    await vi.waitFor(() => expect(host.opened).toBe(true))
    host.say({ type: "ready" })
    expect(host.told).toEqual([{ type: "open" }])
    host.say({ type: "offer", sdp: "offer-sdp" })
    await vi.waitFor(() => expect(host.told).toContainEqual({ type: "answer", sdp: "answer-sdp" }))
    expect(place).toHaveBeenCalledWith("offer-sdp")
    host.say({ type: "answered" })
    const { line, call } = await opening
    expect(call).toBe(placed)

    // What the voice says reaches the call, and what the call says reaches the voice.
    host.say({ type: "event", data: '{"type":"session.started"}' })
    expect(events).toEqual(['{"type":"session.started"}'])
    line.send(["one", "two"])
    line.setMuted(true)
    expect(host.told.slice(-2)).toEqual([
      { type: "send", events: ["one", "two"] },
      { type: "mute", muted: true },
    ])
    host.say({ type: "levels", you: 0.2, dood: 0.5 })
    expect(line.levels()).toEqual({ you: 0.2, dood: 0.5 })

    line.close()
    expect(host.told.at(-1)).toEqual({ type: "close" })
    await vi.waitFor(() => expect(host.released).toBe(true))
  })

  it("is refused before any page is opened where the phone does not allow the microphone", async () => {
    const host = page()
    permission.granted = false
    const error = await openLine(
      vi.fn(),
      () => {},
      () => {},
    ).catch((caught: unknown) => caught)
    expect(host.opened).toBe(false)
    expect(microphoneProblem(error)).toBe(
      "Do Computer is not allowed the microphone. Allow it in Settings, then call again.",
    )
  })

  it("fails with the page's own error where the page could not take the microphone", async () => {
    const host = page()
    const opening = openLine(
      vi.fn(),
      () => {},
      () => {},
    )
    await vi.waitFor(() => expect(host.opened).toBe(true))
    host.say({ type: "failed", name: "NotFoundError", message: "Requested device not found" })
    const error = await opening.catch((caught: unknown) => caught)
    expect(microphoneProblem(error)).toBe("No microphone was found.")
    expect(host.told.at(-1)).toEqual({ type: "close" })
  })

  it("says the call was lost when the page loses it after it was placed", async () => {
    const host = page()
    const lost = vi.fn()
    const opening = openLine(
      async () => placed,
      () => {},
      lost,
    )
    await vi.waitFor(() => expect(host.opened).toBe(true))
    host.say({ type: "offer", sdp: "offer-sdp" })
    await vi.waitFor(() => expect(host.told).toContainEqual({ type: "answer", sdp: "answer-sdp" }))
    host.say({ type: "answered" })
    await opening
    host.say({ type: "lost" })
    expect(lost).toHaveBeenCalledTimes(1)
  })

  it("reads only what a page says as an object with a type", () => {
    expect(readFromPage('{"type":"ready"}')).toEqual({ type: "ready" })
    expect(readFromPage("not json")).toBeNull()
    expect(readFromPage('{"no":"type"}')).toBeNull()
    expect(readFromPage({ type: "ready" })).toBeNull()
  })
})
