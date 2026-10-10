import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { UseState } from "@durable-computer/computers/use"
import {
  type LiveView,
  type ScreenActed,
  type ScreenAction,
  type WindowAct,
  windowName as named,
} from "@durable-computer/protocol"
import { describe, expect, it } from "vitest"
import { inSight, resized, ScreenService } from "../src/screen.ts"
import {
  type DriverWindow,
  driverCall,
  driverMissing,
  driverTarget,
  driverWindowCall,
  fakeDriver,
  parseKeys,
  plainPng,
  pngSize,
  windowNote,
  windowRefusal,
  windowsOf,
} from "../src/screen-driver.ts"

const pip = { id: "a1", name: "Pip", color: "#0aa" }

function service(
  options: {
    inPictures?: boolean
    forbidden?: () => string | undefined
    now?: () => number
  } = {},
) {
  const state = new UseState({ what: "the screen" })
  const driver = fakeDriver()
  // One with no place is the pointer taken away.
  const pointed: { x?: number; y?: number; click: boolean }[] = []
  const behind: boolean[] = []
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
      behind: (on) => behind.push(on),
      inPictures: options.inPictures === true,
    },
    // Twice the size of the pretend screen's pictures, which are 640 by 480.
    display: () => ({ width: 1280, height: 960 }),
    toJpeg: (png, quality) => Buffer.from(`jpeg ${quality} of ${png.length}`),
    settleMs: 0,
    viewEveryMs: 20,
    ...(options.forbidden === undefined ? {} : { forbidden: options.forbidden }),
    ...(options.now === undefined ? {} : { now: options.now }),
  })
  return { state, driver, pointed, behind, screen, pictures: () => pictures }
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
    expect(Buffer.from(acted.shot!.data, "base64").toString()).toMatch(/^jpeg 70 of/)
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

describe("an agent working in a window", () => {
  const notes = { id: 11, app: "Notes", title: "Shopping", width: 400, height: 300, shown: true }
  const calculator = {
    id: 12,
    app: "Calculator",
    title: "Calculator",
    width: 230,
    height: 408,
    shown: false,
  }
  const inWindow = (
    screen: ScreenService,
    act: WindowAct,
    more: { window?: number; inFront?: boolean } = {},
  ) =>
    screen.answer({
      id: "w",
      op: "act",
      agent: pip,
      action: { do: "in_window", window: 11, ...more, act },
    })

  it("is told the windows there are, and no more of them than it can use, with no picture", async () => {
    const { screen, driver, pictures } = service()
    const answer = await screen.answer({
      id: "1",
      op: "act",
      agent: pip,
      action: { do: "windows" },
    })
    expect(answer.error).toBeUndefined()
    expect(answer.value).toEqual({ windows: [notes, calculator] })
    expect(pictures()).toBe(0)
    expect(driver.done).toEqual([])
  })

  it("has what it asks done in the window, behind what is in front, and is given a picture of the window", async () => {
    const { screen, driver, pointed, state, pictures } = service()
    const answer = await inWindow(screen, { do: "click", x: 10, y: 20 })
    const acted = answer.value as ScreenActed
    expect(answer.error).toBeUndefined()
    expect(driver.done).toEqual([{ do: "click", x: 10, y: 20, window: 11, inFront: false }])
    expect(acted.window).toEqual(notes)
    expect(acted.windows).toBeUndefined()
    expect(acted.shot).toMatchObject({ mimeType: "image/jpeg", width: 400, height: 300 })
    expect(Buffer.from(acted.shot!.data, "base64").toString()).toMatch(/^jpeg 70 of/)
    expect(acted.pointer).toEqual({ x: 10, y: 20 })
    // The window's top left is at 40, 60 on the display, and its picture is its own size.
    expect(pointed).toEqual([{ x: 50, y: 80, click: true }])
    expect(state.clicks).toBe(1)
    // No picture of the whole screen is taken for it.
    expect(pictures()).toBe(0)
  })

  it("has the window brought forward for what it asks, when it asks for that", async () => {
    const { screen, driver } = service()
    await inWindow(screen, { do: "type", text: "milk", x: 5, y: 6 }, { inFront: true })
    await inWindow(screen, { do: "key", keys: "enter" }, { inFront: false })
    expect(driver.done).toEqual([
      { do: "type", text: "milk", x: 5, y: 6, window: 11, inFront: true },
      { do: "key", keys: "enter", window: 11, inFront: false },
    ])
  })

  it("only looks when it asks for a picture of the window, and only waits when it asks to", async () => {
    const { screen, driver } = service()
    const looked = (await inWindow(screen, { do: "screenshot" }, { window: 12 }))
      .value as ScreenActed
    expect(looked.window).toEqual(calculator)
    expect(looked.shot).toMatchObject({ width: 230, height: 408 })
    expect(looked.pointer).toBeUndefined()
    const waited = (await inWindow(screen, { do: "wait", seconds: 0.01 })).value as ScreenActed
    expect(waited.window).toEqual(notes)
    expect(driver.done).toEqual([])
  })

  it("has its pointer where it was when what it asked was refused", async () => {
    const { screen, pointed } = service()
    await inWindow(screen, { do: "click", x: 40, y: 30 })
    const refused = await inWindow(screen, { do: "drag", x: 10, y: 10, toX: 60, toY: 70 })
    expect(refused.error).toBeDefined()
    // Nothing was dragged, so nothing is drawn as though it had been.
    expect(pointed.at(-1)).toEqual({ x: 80, y: 90, click: false })
    const view = (await screen.answer({ id: "v", op: "view", waitMs: 0 })).value as LiveView
    expect(view.pointer).toEqual({ x: 40, y: 30 })
    expect(view.clicks).toBe(1)
  })

  it("has its pointer taken away when it leaves a window for the whole screen", async () => {
    const { screen, pointed } = service()
    await inWindow(screen, { do: "click", x: 40, y: 30 })
    const whole = (
      await screen.answer({ id: "s", op: "act", agent: pip, action: { do: "screenshot" } })
    ).value as ScreenActed
    // The place was one in the window's picture, which is no place in the screen's.
    expect(whole.pointer).toBeUndefined()
    expect(pointed.at(-1)).toEqual({ click: false })
  })

  it("is told to ask for the window in front when a drag cannot be done behind, and then it can", async () => {
    const { screen, driver } = service()
    const drag = { do: "drag", x: 10, y: 10, toX: 60, toY: 70 } as const
    const refused = await inWindow(screen, drag)
    expect(refused.value).toBeUndefined()
    expect(refused.error?.refused).toBe(false)
    expect(refused.error?.message).toMatch(/^That could not be done behind what is in front: /)
    expect(refused.error?.message).toMatch(/Nothing was done\. Do it again with `in_front: true`/)
    expect(driver.done).toEqual([])
    const done = await inWindow(screen, drag, { inFront: true })
    expect(driver.done).toEqual([{ ...drag, window: 11, inFront: true }])
    // The pointer ends where the drag did.
    expect((done.value as ScreenActed).pointer).toEqual({ x: 60, y: 70 })
  })

  it("is told to ask what windows there are when it names one that is not there", async () => {
    const { screen, driver } = service()
    const answer = await inWindow(screen, { do: "click", x: 1, y: 1 }, { window: 99 })
    expect(answer).toEqual({
      id: "w",
      error: {
        refused: false,
        message:
          "There is no window 99 on this computer now. Ask for `windows` to see the ones there are.",
      },
    })
    expect(driver.done).toEqual([])
  })

  it("opens an app, and is given its windows and a picture of the first", async () => {
    const { screen, pictures } = service()
    const answer = await screen.answer({
      id: "1",
      op: "act",
      agent: pip,
      action: { do: "open", app: "Maps" },
    })
    const maps = { id: 22, app: "Maps", title: "Maps", width: 320, height: 240, shown: true }
    const acted = answer.value as ScreenActed
    expect(answer.error).toBeUndefined()
    expect(acted.windows).toEqual([maps])
    expect(acted.window).toEqual(maps)
    expect(acted.shot).toMatchObject({ mimeType: "image/jpeg", width: 320, height: 240 })
    expect(acted.pointer).toBeUndefined()
    expect(pictures()).toBe(0)
  })

  it("is told an app it opened has no window yet, when none comes in the time it is given", async () => {
    // A clock that is ten seconds on each time it is read, so the wait for a window is over at once.
    let clock = 0
    const { screen, driver } = service({ now: () => (clock += 10_000) })
    driver.open = async () => ({ pid: 999, app: "Maps" })
    const answer = await screen.answer({
      id: "1",
      op: "act",
      agent: pip,
      action: { do: "open", app: "maps" },
    })
    expect(answer.error).toBeUndefined()
    // By the name the driver has for the app, which need not be the one that was asked for.
    expect(answer.value).toEqual({
      windows: [],
      note: "Maps is open and has no window yet. Ask for `windows` in a moment.",
    })
  })

  it("is not left waiting for an app's window once its owner stopped it", async () => {
    const { screen, driver, state } = service()
    driver.open = async (app) => ({ pid: 999, app })
    const windows = driver.windows
    driver.windows = () => {
      state.stop()
      return windows()
    }
    const answer = await screen.answer({
      id: "1",
      op: "act",
      agent: pip,
      action: { do: "open", app: "Maps" },
    })
    expect(answer.error?.refused).toBe(true)
    expect(answer.error?.message).toMatch(/stopped you/)
  })

  it("is told what the driver has to say of how it went", async () => {
    const { screen, driver } = service()
    driver.actIn = async () => "Sent without the mouse."
    const acted = (await inWindow(screen, { do: "click", x: 1, y: 1 })).value as ScreenActed
    expect(acted.note).toBe("Sent without the mouse.")
    expect(acted.window).toEqual(notes)
  })

  it("has its places moved with a window that changed size since it saw it", async () => {
    const { screen, driver } = service()
    await inWindow(screen, { do: "screenshot" })
    const window = (await driver.windows()).find((each) => each.id === 11)!
    window.width = 800
    window.height = 600
    const acted = (await inWindow(screen, { do: "click", x: 100, y: 50 })).value as ScreenActed
    expect(driver.done).toEqual([{ do: "click", x: 200, y: 100, window: 11, inFront: false }])
    expect(acted.shot).toMatchObject({ width: 800, height: 600 })
    expect(acted.pointer).toEqual({ x: 200, y: 100 })
    // The picture it has now is the one its next place is in.
    await inWindow(screen, { do: "click", x: 100, y: 50 })
    expect(driver.done.at(-1)).toMatchObject({ x: 100, y: 50 })
  })

  it("has no pointer drawn on the display for a window that is not showing", async () => {
    const { screen, pointed, state } = service()
    const acted = (await inWindow(screen, { do: "click", x: 10, y: 20 }, { window: 12 }))
      .value as ScreenActed
    expect(pointed).toEqual([{ click: true }])
    // It is still a click, and still where the agent's pointer is in the window's picture.
    expect(acted.pointer).toEqual({ x: 10, y: 20 })
    expect(state.clicks).toBe(1)
  })

  it("is told the windows that are left when the one it worked in is gone afterwards", async () => {
    const { screen, driver } = service()
    let closed = false
    const { windows, captureWindow } = driver
    driver.actIn = async () => {
      closed = true
      return undefined
    }
    driver.windows = async () => (await windows()).filter((each) => !closed || each.id !== 11)
    driver.captureWindow = async (window, edge) => {
      if (closed) throw new Error("No such window.")
      return captureWindow(window, edge)
    }
    const answer = await inWindow(screen, { do: "key", keys: "cmd+w" })
    expect(answer.error).toBeUndefined()
    expect(answer.value).toEqual({
      windows: [calculator],
      note: "That window is no longer there.",
    })
  })

  it("is told what went wrong when a window that is still there gives no picture", async () => {
    const { screen, driver } = service()
    driver.captureWindow = async () => {
      throw new Error("That window gave no picture of itself.")
    }
    const answer = await inWindow(screen, { do: "screenshot" })
    expect(answer).toEqual({
      id: "w",
      error: { refused: false, message: "That window gave no picture of itself." },
    })
  })

  it("says it is behind what is in front for all but what it does in front or to the whole screen", async () => {
    const { screen, behind } = service()
    const act = (action: ScreenAction) => screen.answer({ id: "1", op: "act", agent: pip, action })
    await act({ do: "windows" })
    await act({ do: "in_window", window: 11, act: { do: "click", x: 1, y: 1 } })
    await act({ do: "in_window", window: 11, inFront: true, act: { do: "click", x: 1, y: 1 } })
    await act({ do: "open", app: "Maps" })
    await act({ do: "click", x: 1, y: 1 })
    await act({ do: "in_window", window: 11, inFront: false, act: { do: "screenshot" } })
    await act({ do: "screenshot" })
    expect(behind).toEqual([true, true, false, true, false, true, false])
  })

  it("is named by its app, and by its title where that says more", () => {
    expect(named({ app: "Notes", title: "Shopping" })).toBe("Notes: Shopping")
    expect(named({ app: "Calculator", title: "Calculator" })).toBe("Calculator")
    expect(named({ app: " Notes ", title: " " })).toBe("Notes")
    expect(named({ app: "", title: "Untitled" })).toBe("Untitled")
    expect(named({ app: "", title: "" })).toBe("A window")
  })

  it("keeps a place where it was in proportion, in a picture of another size", () => {
    const from = { width: 400, height: 300 }
    const to = { width: 200, height: 600 }
    const click = { do: "click", x: 100, y: 30 } as const
    // The same size is the same thing asked.
    expect(resized(click, from, { ...from })).toBe(click)
    expect(resized(click, from, to)).toEqual({ do: "click", x: 50, y: 60 })
    expect(resized({ do: "drag", x: 100, y: 30, toX: 301, toY: 150 }, from, to)).toEqual({
      do: "drag",
      x: 50,
      y: 60,
      toX: 151,
      toY: 300,
    })
    expect(resized({ do: "scroll", x: 100, y: 30, direction: "up", amount: 4 }, from, to)).toEqual({
      do: "scroll",
      x: 50,
      y: 60,
      direction: "up",
      amount: 4,
    })
    expect(resized({ do: "type", text: "hi", x: 100, y: 30 }, from, to)).toEqual({
      do: "type",
      text: "hi",
      x: 50,
      y: 60,
    })
    // What has no place in it is as it was.
    expect(resized({ do: "type", text: "hi" }, from, to)).toEqual({ do: "type", text: "hi" })
    expect(resized({ do: "key", keys: "enter" }, from, to)).toEqual({ do: "key", keys: "enter" })
    expect(resized({ do: "wait", seconds: 1 }, from, to)).toEqual({ do: "wait", seconds: 1 })
  })

  it("has its pointer shown only where the window is the one to be seen", () => {
    const at = (id: number, z: number | undefined, more: Partial<DriverWindow> = {}) => ({
      id,
      pid: id,
      app: "App",
      title: "",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      shown: true,
      ...(z === undefined ? {} : { z }),
      ...more,
    })
    const back = at(1, 1, { width: 400, height: 300 })
    const front = at(2, 2, { x: 100, y: 100 })
    const all = [front, back]
    expect(inSight(back, all, { x: 50, y: 50 })).toEqual({ x: 50, y: 50 })
    expect(inSight(back, all, { x: 150, y: 150 })).toBeUndefined()
    // The far edges of the one in front are the first places that are not in it.
    expect(inSight(back, all, { x: 100, y: 100 })).toBeUndefined()
    expect(inSight(back, all, { x: 200, y: 150 })).toEqual({ x: 200, y: 150 })
    expect(inSight(back, all, { x: 150, y: 200 })).toEqual({ x: 150, y: 200 })
    // The one in front has nothing over it.
    expect(inSight(front, all, { x: 150, y: 150 })).toEqual({ x: 150, y: 150 })
    // One that is not showing covers nothing, and has no place to be seen at.
    const hidden = { ...front, shown: false }
    expect(inSight(back, [hidden, back], { x: 150, y: 150 })).toEqual({ x: 150, y: 150 })
    expect(inSight(hidden, [hidden, back], { x: 150, y: 150 })).toBeUndefined()
    // Where the system does not say which is in front, nothing is taken to be over it.
    expect(inSight(back, [at(2, undefined, { x: 100, y: 100 }), back], { x: 150, y: 150 })).toEqual(
      { x: 150, y: 150 },
    )
    expect(inSight(at(1, undefined), all, { x: 150, y: 150 })).toEqual({ x: 150, y: 150 })
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

  it("is shown the window the agent is working in, and its name, until the agent works on the whole screen", async () => {
    const { screen, pictures } = service({ inPictures: true })
    const act = (action: ScreenAction) => screen.answer({ id: "1", op: "act", agent: pip, action })
    await act({ do: "in_window", window: 11, act: { do: "click", x: 30, y: 40 } })
    const inWindow = (await screen.answer({ id: "2", op: "view" })).value as LiveView
    expect(inWindow.title).toBe("Notes: Shopping")
    expect(inWindow.shot).toMatchObject({ width: 400, height: 300 })
    // Nothing the app draws is in a window's picture, so the pointer is told even on Linux.
    expect(inWindow.pointer).toEqual({ x: 30, y: 40 })
    expect(pictures()).toBe(0)
    await act({ do: "screenshot" })
    const whole = (await screen.answer({ id: "3", op: "view", after: inWindow.seq, waitMs: 1_000 }))
      .value as LiveView
    expect(whole).not.toHaveProperty("title")
    expect(whole.shot).toMatchObject({ width: 640, height: 480 })
    // Where the pointer was in the window is nowhere on the screen.
    expect(whole.pointer).toBeUndefined()
  })

  it("is shown the whole screen once the window the agent worked in is gone", async () => {
    const { screen, driver } = service()
    await screen.answer({
      id: "1",
      op: "act",
      agent: pip,
      action: { do: "in_window", window: 12, act: { do: "click", x: 30, y: 40 } },
    })
    const watching: (boolean | undefined)[] = []
    driver.captureWindow = async (_window, _edge, forWatching) => {
      watching.push(forWatching)
      throw new Error("No such window.")
    }
    const view = (await screen.answer({ id: "2", op: "view" })).value as LiveView
    // The picture was asked for as one that is only looked at.
    expect(watching).toEqual([true])
    expect(view.shot).toMatchObject({ width: 640, height: 480 })
    expect(view).not.toHaveProperty("title")
    expect(view.pointer).toBeUndefined()
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

  it("is asked to act in a window, behind what is in front or with it brought forward", () => {
    const window = { id: 7, pid: 70 }
    const behind = { pid: 70, window_id: 7, delivery_mode: "background" }
    const forward = { pid: 70, window_id: 7, delivery_mode: "foreground" }
    expect(driverWindowCall(window, { do: "click", x: 3, y: 4 }, false)).toEqual({
      tool: "click",
      args: { ...behind, x: 3, y: 4, button: "left", count: 1 },
    })
    expect(driverWindowCall(window, { do: "click", x: 3, y: 4 }, true)).toEqual({
      tool: "click",
      args: { ...forward, x: 3, y: 4, button: "left", count: 1 },
    })
    expect(driverWindowCall(window, { do: "double_click", x: 3, y: 4 }, false)).toEqual({
      tool: "click",
      args: { ...behind, x: 3, y: 4, button: "left", count: 2 },
    })
    expect(driverWindowCall(window, { do: "right_click", x: 3, y: 4 }, false)).toEqual({
      tool: "click",
      args: { ...behind, x: 3, y: 4, button: "right", count: 1 },
    })
    expect(driverWindowCall(window, { do: "drag", x: 1, y: 2, toX: 3, toY: 4 }, true)).toEqual({
      tool: "drag",
      args: { ...forward, from_x: 1, from_y: 2, to_x: 3, to_y: 4, duration_ms: 400 },
    })
    expect(driverWindowCall(window, { do: "scroll", x: 3, y: 4, direction: "up" }, false)).toEqual({
      tool: "scroll",
      args: { ...behind, direction: "up", amount: 3, x: 3, y: 4 },
    })
    expect(
      driverWindowCall(window, { do: "scroll", x: 3, y: 4, direction: "left", amount: 99 }, false)
        .args,
    ).toMatchObject({ direction: "left", amount: 50 })
    // Typed where the keys already go, or at a place, which is clicked first.
    expect(driverWindowCall(window, { do: "type", text: "hi" }, false)).toEqual({
      tool: "type_text",
      args: { ...behind, text: "hi" },
    })
    expect(driverWindowCall(window, { do: "type", text: "hi", x: 3, y: 4 }, false)).toEqual({
      tool: "type_text",
      args: { ...behind, text: "hi", x: 3, y: 4 },
    })
    expect(driverWindowCall(window, { do: "key", keys: "Cmd+Shift+S" }, false)).toEqual({
      tool: "press_key",
      args: { ...behind, key: "s", modifiers: ["cmd", "shift"] },
    })
    expect(() => driverWindowCall(window, { do: "key", keys: "s+cmd" }, false)).toThrow(
      /not a key that is held/,
    )
  })

  it("has its refusal to work behind what is in front put as what the agent is to ask for", () => {
    const refused = {
      text: "❌ Background drag is unavailable.",
      structuredJson: JSON.stringify({
        code: "background_unavailable",
        escalation: {
          reason: 'A drag moves the real pointer. Retry with delivery_mode: "foreground".',
          recommended: "foreground",
        },
      }),
    }
    const again =
      "Do it again with `in_front: true`: the window is then brought forward for that one action, which takes the person's mouse and keyboard for a moment."
    expect(windowRefusal(refused, false)).toBe(
      `That could not be done behind what is in front: A drag moves the real pointer. Nothing was done. ${again}`,
    )
    // With the window already in front there is nothing more to ask for: its own words, cleaned.
    expect(windowRefusal(refused, true)).toBe("Background drag is unavailable.")
    // A refusal that gives no reason of its own is told in the words it came with.
    expect(
      windowRefusal(
        {
          text: "Background drag is unavailable.",
          structuredJson: JSON.stringify({
            code: "background_unavailable",
            escalation: { reason: "" },
          }),
        },
        false,
      ),
    ).toBe(
      `That could not be done behind what is in front: Background drag is unavailable. Nothing was done. ${again}`,
    )
    // Its names for things are not the agent's.
    expect(windowRefusal({ text: 'Use delivery_mode: "foreground" for window_id 7.' }, true)).toBe(
      "Use `in_front: true` for `window` 7.",
    )
    // One that only says so in its words is understood as well.
    expect(
      windowRefusal(
        { text: 'Element is not hittable. Retry with delivery_mode:"foreground".' },
        false,
      ),
    ).toBe(
      `That could not be done behind what is in front: Element is not hittable. Nothing was done. ${again}`,
    )
    expect(
      windowRefusal(
        {
          text: "Not now.",
          structuredJson: JSON.stringify({ escalation: { recommended: "foreground" } }),
        },
        false,
      ),
    ).toBe(`That could not be done behind what is in front: Not now. Nothing was done. ${again}`)
    // Any other refusal is the driver's own, whichever way it was asked.
    expect(windowRefusal({ text: "No such window.", structuredJson: "{" }, false)).toBe(
      "No such window.",
    )
    expect(windowRefusal({ text: " " }, true)).toBe("The window would not do that.")
  })

  it("has a note for the agent where a program may have taken no notice of what was sent it", () => {
    const sent = (said: object) => ({ structuredJson: JSON.stringify(said) })
    const note = windowNote(sent({ route: "synthetic_events", effect: "unverified" }), false)
    expect(note).toMatch(/^Sent to the window without the person's mouse or keyboard/)
    expect(note).toMatch(/nothing came of it: do it again with `in_front: true`/)
    expect(windowNote(sent({ route: "synthetic_events" }), false)).toBe(note)
    expect(windowNote(sent({ route: "synthetic_events", effect: "unverified" }), true)).toBe(
      undefined,
    )
    expect(windowNote(sent({ route: "synthetic_events", effect: "confirmed" }), false)).toBe(
      undefined,
    )
    expect(windowNote(sent({ route: "accessibility", effect: "unverified" }), false)).toBe(
      undefined,
    )
    expect(windowNote({}, false)).toBeUndefined()
    expect(windowNote({ structuredJson: "not json" }, false)).toBeUndefined()
  })

  it("lists the windows an agent would work in, the nearest the front first", () => {
    const bounds = { x: 1, y: 2, width: 400.4, height: 300.6 }
    const listed = [
      {
        window_id: 1,
        pid: 10,
        app_name: "Notes",
        title: "A",
        bounds,
        z_index: 1,
        is_on_screen: true,
      },
      // One the driver does not say is hidden is there to be seen.
      { window_id: 2, pid: 11, app_name: "Mail", title: "Inbox", bounds, z_index: 5 },
      // The app's own.
      { window_id: 3, pid: 500, app_name: "Do Computer", title: "Pip", bounds, z_index: 9 },
      // Scraps: too small on a side, and with no name and nowhere to be seen.
      {
        window_id: 4,
        pid: 12,
        app_name: "Dock",
        title: "Tile",
        bounds: { ...bounds, width: 59 },
        z_index: 8,
      },
      {
        window_id: 5,
        pid: 12,
        app_name: "Dock",
        title: "Tile",
        bounds: { ...bounds, height: 59 },
        z_index: 8,
      },
      {
        window_id: 6,
        pid: 12,
        app_name: "Mail",
        title: "",
        bounds,
        z_index: 7,
        is_on_screen: false,
      },
      {
        window_id: 7,
        pid: 12,
        app_name: "Mail",
        title: "",
        bounds,
        z_index: 3,
        is_on_screen: true,
      },
      { window_id: 8, pid: 12, app_name: "Mail", title: "Drafts", bounds, is_on_screen: false },
      // Not windows at all.
      { window_id: 0, pid: 12, app_name: "Mail", title: "None", bounds, z_index: 6 },
      { window_id: 9, app_name: "Mail", title: "Nobody's", bounds, z_index: 6 },
      { window_id: 10, pid: 12, app_name: "Mail", title: "No size", z_index: 6 },
    ]
    const windows = windowsOf(listed, 500)
    expect(windows.map((each) => each.id)).toEqual([2, 7, 1, 8])
    expect(windows[2]).toEqual({
      id: 1,
      pid: 10,
      app: "Notes",
      title: "A",
      x: 1,
      y: 2,
      width: 400,
      height: 301,
      shown: true,
      z: 1,
    })
    expect(windows[0]).toMatchObject({ shown: true, z: 5 })
    expect(windows[3]).toMatchObject({ title: "Drafts", shown: false })
    expect(windows[3]).not.toHaveProperty("z")
    expect(windowsOf(undefined)).toEqual([])
    expect(windowsOf("nothing")).toEqual([])
  })

  it("has pretend windows for the tests, one of them not showing, and a drag that needs the front", async () => {
    const log = join(mkdtempSync(join(tmpdir(), "dc-screen-")), "done.log")
    const driver = fakeDriver(log)
    const [notes, calculator] = await driver.windows()
    expect(notes).toMatchObject({ id: 11, app: "Notes", title: "Shopping", shown: true })
    expect(calculator).toMatchObject({ id: 12, app: "Calculator", shown: false })
    // A picture of a window is the window's size, or smaller to fit.
    expect(await driver.captureWindow(notes!, 1280)).toMatchObject({ width: 400, height: 300 })
    const small = await driver.captureWindow(notes!, 200)
    expect(pngSize(small.png)).toEqual({ width: 200, height: 150 })
    expect(await driver.actIn(notes!, { do: "click", x: 1, y: 2 }, false)).toBeUndefined()
    const drag = { do: "drag", x: 1, y: 2, toX: 3, toY: 4 } as const
    await expect(driver.actIn(notes!, drag, false)).rejects.toThrow(
      /^That could not be done behind what is in front: A drag moves the real pointer\. .*`in_front: true`/,
    )
    await driver.actIn(notes!, drag, true)
    expect(driver.done).toEqual([
      { do: "click", x: 1, y: 2, window: 11, inFront: false },
      { ...drag, window: 11, inFront: true },
    ])
    expect(readFileSync(log, "utf8").split("\n")[0]).toBe(
      '{"do":"click","x":1,"y":2,"window":11,"inFront":false}',
    )
    // An app that is opened has a window, in front of the others.
    expect(await driver.open("Maps")).toEqual({ pid: 122, app: "Maps" })
    expect((await driver.windows()).map((each) => each.id)).toEqual([22, 11, 12])
    expect((await driver.windows())[0]).toMatchObject({ pid: 122, app: "Maps", shown: true })
  })
})
