import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { UseState } from "@durable-computer/computers/use"
import type { LiveView, ScreenActed } from "@durable-computer/protocol"
import { describe, expect, it } from "vitest"
import { ScreenService } from "../src/screen.ts"
import {
  driverCall,
  driverMissing,
  driverTarget,
  fakeDriver,
  parseKeys,
  plainPng,
  pngSize,
} from "../src/screen-driver.ts"

const pip = { id: "a1", name: "Pip", color: "#0aa" }

function service(options: { inPictures?: boolean; forbidden?: () => string | undefined } = {}) {
  const state = new UseState({ what: "the screen" })
  const driver = fakeDriver()
  const pointed: { x: number; y: number; click: boolean }[] = []
  let pictures = 0
  const capture = driver.capture
  driver.capture = (edge) => {
    pictures += 1
    return capture(edge)
  }
  const screen = new ScreenService({
    state,
    driver,
    pointer: {
      point: (at, click) => pointed.push({ ...at, click }),
      inPictures: options.inPictures === true,
    },
    // Twice the size of the pretend screen's pictures, which are 640 by 480.
    display: () => ({ width: 1280, height: 960 }),
    toJpeg: (png, quality) => Buffer.from(`jpeg ${quality} of ${png.length}`),
    settleMs: 0,
    viewEveryMs: 20,
    ...(options.forbidden === undefined ? {} : { forbidden: options.forbidden }),
  })
  return { state, driver, pointed, screen, pictures: () => pictures }
}

describe("an agent using the screen", () => {
  it("is given a picture of the screen once what it asked is done", async () => {
    const { screen, driver, state } = service()
    const answer = await screen.answer({
      id: "1",
      op: "act",
      agent: pip,
      say: "Opening the sheet",
      action: { do: "type", text: "hello" },
    })
    const acted = answer.value as ScreenActed
    expect(answer).toMatchObject({ id: "1" })
    expect(answer.error).toBeUndefined()
    expect(acted.shot).toMatchObject({ mimeType: "image/jpeg", width: 640, height: 480 })
    expect(Buffer.from(acted.shot.data, "base64").toString()).toMatch(/^jpeg 70 of/)
    expect(acted.pointer).toBeUndefined()
    expect(driver.done).toEqual([{ do: "type", text: "hello" }])
    expect(state.active).toBe(true)
    expect(state.agent).toEqual(pip)
    expect(state.say).toBe("Opening the sheet")
  })

  it("has its pointer put where it clicks, on the display and in the picture", async () => {
    const { screen, pointed, state } = service()
    await screen.answer({ id: "1", op: "act", agent: pip, action: { do: "screenshot" } })
    const answer = await screen.answer({
      id: "2",
      op: "act",
      agent: pip,
      action: { do: "click", x: 100, y: 50 },
    })
    expect(pointed).toEqual([{ x: 200, y: 100, click: true }])
    expect((answer.value as ScreenActed).pointer).toEqual({ x: 100, y: 50 })
    expect(state.clicks).toBe(1)
    await screen.answer({ id: "3", op: "act", agent: pip, action: { do: "move", x: 10, y: 10 } })
    expect(pointed.at(-1)).toEqual({ x: 20, y: 20, click: false })
    expect(state.clicks).toBe(1)
  })

  it("only looks when it asks for a picture, and only waits when it asks to", async () => {
    const { screen, driver } = service()
    await screen.answer({ id: "1", op: "act", agent: pip, action: { do: "screenshot" } })
    await screen.answer({ id: "2", op: "act", agent: pip, action: { do: "wait", seconds: 0.01 } })
    expect(driver.done).toEqual([])
  })

  it("is refused, in words for its owner, when the system does not allow it", async () => {
    const { screen, driver, state } = service({
      forbidden: () => "Allow Do Computer under Accessibility.",
    })
    const answer = await screen.answer({
      id: "1",
      op: "act",
      agent: pip,
      action: { do: "click", x: 1, y: 1 },
    })
    expect(answer).toEqual({
      id: "1",
      error: { refused: true, message: "Allow Do Computer under Accessibility." },
    })
    expect(driver.done).toEqual([])
    expect(state.active).toBe(false)
  })

  it("is refused once its owner stopped it, and does nothing more", async () => {
    const { screen, driver, state } = service()
    await screen.answer({ id: "1", op: "act", agent: pip, action: { do: "screenshot" } })
    state.stop()
    const answer = await screen.answer({
      id: "2",
      op: "act",
      agent: pip,
      action: { do: "click", x: 1, y: 1 },
    })
    expect(answer.error?.refused).toBe(true)
    expect(answer.error?.message).toMatch(/stopped you/)
    expect(driver.done).toEqual([])
  })

  it("waits while it is paused, and carries on when let", async () => {
    const { screen, driver } = service()
    await screen.answer({ id: "1", op: "hold", held: true })
    const acting = screen.answer({
      id: "2",
      op: "act",
      agent: pip,
      action: { do: "key", keys: "enter" },
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(driver.done).toEqual([])
    await screen.answer({ id: "3", op: "hold", held: false })
    expect((await acting).error).toBeUndefined()
    expect(driver.done).toEqual([{ do: "key", keys: "enter" }])
  })

  it("is told what went wrong when the screen would not do it, as no refusal", async () => {
    const { screen, driver } = service()
    driver.act = async () => {
      throw new Error("No such key.")
    }
    const answer = await screen.answer({
      id: "1",
      op: "act",
      agent: pip,
      action: { do: "key", keys: "f99" },
    })
    expect(answer).toEqual({ id: "1", error: { refused: false, message: "No such key." } })
  })
})

describe("someone watching the screen", () => {
  it("is shown nothing of a screen no agent is using, and no picture is taken", async () => {
    const { screen, pictures } = service()
    expect((await screen.answer({ id: "1", op: "view", waitMs: 50 })).value).toEqual({
      active: false,
      seq: 0,
    })
    expect(pictures()).toBe(0)
  })

  it("is shown the screen, the agent, and where its pointer is", async () => {
    const { screen } = service()
    await screen.answer({
      id: "1",
      op: "act",
      agent: pip,
      say: "Clicking Save",
      action: { do: "click", x: 30, y: 40 },
    })
    const view = (await screen.answer({ id: "2", op: "view" })).value as LiveView
    expect(view).toMatchObject({
      active: true,
      seq: 1,
      pointer: { x: 30, y: 40 },
      clicks: 1,
      say: "Clicking Save",
      held: false,
      agent: pip,
    })
    expect(Buffer.from(view.shot!.data, "base64").toString()).toMatch(/^jpeg 50 of/)
  })

  it("is not told where the pointer is when it is already in the picture", async () => {
    const { screen } = service({ inPictures: true })
    await screen.answer({ id: "1", op: "act", agent: pip, action: { do: "click", x: 30, y: 40 } })
    const view = (await screen.answer({ id: "2", op: "view" })).value as LiveView
    expect(view.shot).toBeDefined()
    expect(view.pointer).toBeUndefined()
  })

  it("waits for a picture newer than the one it has, and gets the old one when there is no time", async () => {
    const { screen, pictures } = service()
    await screen.answer({ id: "1", op: "act", agent: pip, action: { do: "screenshot" } })
    const first = (await screen.answer({ id: "2", op: "view" })).value as LiveView
    const same = (await screen.answer({ id: "3", op: "view", after: first.seq, waitMs: 0 }))
      .value as LiveView
    expect(same.seq).toBe(first.seq)
    const taken = pictures()
    const [next, other] = (await Promise.all([
      screen.answer({ id: "4", op: "view", after: first.seq, waitMs: 1_000 }),
      screen.answer({ id: "5", op: "view", after: first.seq, waitMs: 1_000 }),
    ])) as [{ value: LiveView }, { value: LiveView }]
    expect(next.value.seq).toBe(first.seq + 1)
    expect(other.value.seq).toBe(first.seq + 1)
    // Two watching at once are shown one picture, taken once.
    expect(pictures()).toBe(taken + 1)
  })
})

describe("the driver", () => {
  it("is asked for keys as the one pressed and the ones held", () => {
    expect(parseKeys("enter")).toEqual({ key: "enter", modifiers: [] })
    expect(parseKeys("Cmd+S")).toEqual({ key: "s", modifiers: ["cmd"] })
    expect(parseKeys("control+shift+t")).toEqual({ key: "t", modifiers: ["ctrl", "shift"] })
    expect(parseKeys("ctrl++")).toEqual({ key: "+", modifiers: ["ctrl"] })
    expect(parseKeys("Return")).toEqual({ key: "enter", modifiers: [] })
    expect(() => parseKeys("s+cmd")).toThrow(/not a key that is held/)
  })

  it("is asked to act on the whole screen, in the places the agent gave", () => {
    expect(driverCall({ do: "click", x: 3, y: 4 })).toEqual({
      tool: "click",
      args: { scope: "desktop", x: 3, y: 4, button: "left", count: 1 },
    })
    expect(driverCall({ do: "scroll", x: 3, y: 4, direction: "down" })?.args).toMatchObject({
      amount: 3,
      direction: "down",
    })
    expect(driverCall({ do: "key", keys: "cmd+s" })).toEqual({
      tool: "press_key",
      args: { scope: "desktop", key: "s", modifiers: ["cmd"] },
    })
    expect(driverCall({ do: "move", x: 1, y: 1 })).toBeUndefined()
  })

  it("is said to be missing where the app came without it for this computer", () => {
    expect(driverTarget("linux", "x64")).toBe("linux-x64-gnu")
    expect(driverTarget("darwin", "arm64")).toBe("darwin-arm64")
    expect(driverTarget("win32", "x64")).toBe("win32-x64-msvc")
    expect(driverMissing("/nowhere", "freebsd", "x64")).toMatch(/not supported/)
    expect(driverMissing("/nowhere", "linux", "x64")).toMatch(/came without/)
  })

  it("has a pretend for the tests that writes down what it was asked", async () => {
    const log = join(mkdtempSync(join(tmpdir(), "dc-screen-")), "done.log")
    const driver = fakeDriver(log)
    await driver.act({ do: "type", text: "hi" })
    expect(readFileSync(log, "utf8")).toBe('{"do":"type","text":"hi"}\n')
    const picture = await driver.capture(1280)
    expect(pngSize(picture.png)).toEqual({ width: 640, height: 480 })
    expect(pngSize(plainPng(7, 5, [1, 2, 3]))).toEqual({ width: 7, height: 5 })
  })
})
