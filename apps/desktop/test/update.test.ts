import { describe, expect, it } from "vitest"
import {
  afterUpdate,
  mayRestart,
  QUIET_MS,
  returningUnseen,
  type Update,
  updateAction,
  type UpdateEvent,
  updateWords,
} from "../src/update.ts"

const from = (events: UpdateEvent[], start: Update = { state: "current" }) =>
  events.reduce(afterUpdate, start)

describe("how things stand with a newer app", () => {
  it("follows one from being found to being ready", () => {
    expect(from([{ event: "checking" }])).toEqual({ state: "checking" })
    const fetching = from([
      { event: "checking" },
      { event: "found", version: "0.6.0" },
      { event: "progress", percent: 41.6 },
    ])
    expect(fetching).toEqual({ state: "fetching", version: "0.6.0", percent: 42 })
    expect(updateWords(fetching)).toBe("Fetching 0.6.0… 42%")
    expect(updateAction(fetching)).toBeUndefined()

    const ready = afterUpdate(fetching, { event: "fetched", version: "0.6.0" })
    expect(ready).toEqual({ state: "ready", version: "0.6.0" })
    expect(updateWords(ready)).toBe("0.6.0 is ready")
    expect(updateAction(ready)).toBe("Restart to update")
  })

  it("says so when there is none, and offers to look again", () => {
    const current = from([{ event: "checking" }, { event: "none" }])
    expect(current).toEqual({ state: "current" })
    expect(updateWords(current)).toBe("Up to date")
    expect(updateAction(current)).toBe("Check for updates")
  })

  it("keeps one that is ready through looking again and finding the same", () => {
    const ready: Update = { state: "ready", version: "0.6.0" }
    expect(
      from([{ event: "checking" }, { event: "found", version: "0.6.0" }, { event: "none" }], ready),
    ).toEqual(ready)
    // A newer one still is fetched in its place.
    expect(afterUpdate(ready, { event: "found", version: "0.7.0" })).toEqual({
      state: "fetching",
      version: "0.7.0",
      percent: 0,
    })
  })

  it("says what went wrong in a line, and which version it was about", () => {
    const failed = from([
      { event: "found", version: "0.6.0" },
      { event: "error", message: `net::ERR_CONNECTION_RESET\n    at ${"stack ".repeat(80)}` },
    ])
    expect(failed).toEqual({
      state: "failed",
      version: "0.6.0",
      detail: "net::ERR_CONNECTION_RESET",
    })
    expect(updateWords(failed)).toBe("Could not update to 0.6.0: net::ERR_CONNECTION_RESET")
    expect(updateAction(failed)).toBe("Try again")

    const looking = from([{ event: "checking" }, { event: "error", message: "x".repeat(500) }])
    expect(looking.state === "failed" && looking.detail.length).toBe(160)
    expect(looking).not.toHaveProperty("version")
    // Looking again starts over.
    expect(afterUpdate(failed, { event: "checking" })).toEqual({ state: "checking" })
  })

  it("is left alone in a copy that does not update itself", () => {
    const off: Update = { state: "off", why: "Not a release: it stays as it is" }
    expect(from([{ event: "checking" }, { event: "fetched", version: "9.0.0" }], off)).toEqual(off)
    expect(updateWords(off)).toBe("Not a release: it stays as it is")
    expect(updateAction(off)).toBeUndefined()
  })
})

describe("restarting as the newer app without being asked", () => {
  const quiet = {
    update: { state: "ready", version: "0.6.0" } as Update,
    showing: false,
    usingScreen: false,
    quietMs: QUIET_MS,
  }

  it("happens once one is ready, no window is showing and no agent is at work", () => {
    expect(mayRestart(quiet)).toBe(true)
  })

  it("waits for a window to be closed, the screen to be let go and the daemon to fall silent", () => {
    expect(mayRestart({ ...quiet, showing: true })).toBe(false)
    expect(mayRestart({ ...quiet, usingScreen: true })).toBe(false)
    expect(mayRestart({ ...quiet, quietMs: QUIET_MS - 1 })).toBe(false)
    expect(
      mayRestart({ ...quiet, update: { state: "fetching", version: "0.6.0", percent: 99 } }),
    ).toBe(false)
  })

  it("comes back with no window, for a few minutes after it said it would", () => {
    const at = 1_800_000_000_000
    expect(returningUnseen(at, at + 20_000)).toBe(true)
    expect(returningUnseen(at, at + 10 * 60_000)).toBe(false)
    expect(returningUnseen(undefined, at)).toBe(false)
    // A clock that was set back since is no reason to hide.
    expect(returningUnseen(at, at - 1)).toBe(false)
  })
})
