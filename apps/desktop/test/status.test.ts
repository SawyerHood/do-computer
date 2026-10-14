import { formatEvent, parseEvent } from "@do-computer/daemon/events"
import { describe, expect, it } from "vitest"
import { after, headline, type Sharing } from "../src/status.ts"

describe("what the daemon says", () => {
  it("is read back as it was said, and a sentence is no event", () => {
    const event = {
      event: "pairing",
      code: "AB-12",
      verifyUrl: "https://do.example/pair?code=AB-12",
    }
    expect(parseEvent(formatEvent(event as never))).toEqual(event)
    expect(
      parseEvent('[2026-10-09T10:00:00.000Z] Connected to https://do.example as "bee".'),
    ).toBeUndefined()
    expect(parseEvent("@dc-event not json")).toBeUndefined()
  })
})

describe("how things stand with this computer", () => {
  const from = (events: Parameters<typeof after>[1][], start: Sharing = { state: "starting" }) =>
    events.reduce(after, start)

  it("follows a first pairing through to being connected", () => {
    const pairing = from([
      { event: "pairing", code: "AB-12", verifyUrl: "https://do.example/pair" },
    ])
    expect(pairing).toEqual({
      state: "pairing",
      code: "AB-12",
      verifyUrl: "https://do.example/pair",
    })
    expect(headline(pairing)).toBe("Waiting for you to confirm")
    const paired = after(pairing, {
      event: "paired",
      name: "bee",
      computerId: "c1",
      readOnly: false,
    })
    expect(paired).toEqual({ state: "connecting", name: "bee", computerId: "c1" })
    const connected = after(paired, {
      event: "connected",
      name: "bee",
      computerId: "c1",
      readOnly: true,
    })
    expect(headline(connected)).toBe("Connected as “bee”, read-only")
  })

  it("keeps the computer's name, and what the server knows it by, while the connection is down", () => {
    const down = from([
      { event: "connected", name: "bee", computerId: "c1", readOnly: false },
      { event: "disconnected", retryMs: 1000 },
    ])
    expect(down).toEqual({ state: "connecting", name: "bee", computerId: "c1" })
    // A daemon that never got through has no name to keep.
    expect(from([{ event: "disconnected", retryMs: 1000 }])).toEqual({ state: "starting" })
  })

  it("is off once the computer was removed in the app", () => {
    expect(
      from([
        { event: "connected", name: "bee", computerId: "c1", readOnly: false },
        { event: "revoked" },
      ]),
    ).toEqual({ state: "off" })
  })

  it("is left as it was by something a newer daemon says that this app has not heard of", () => {
    const connected: Sharing = { state: "connected", name: "bee", readOnly: false }
    expect(after(connected, { event: "something-new" } as never)).toBe(connected)
  })
})
