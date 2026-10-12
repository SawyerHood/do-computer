import { UseState } from "@do-computer/computers/use"
import { USE_LINGER_MS } from "@do-computer/protocol"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createOverlay, type Overlay, viewOf } from "../src/overlay.ts"
import { barOf, colorOf, type OverlayView, tagOf } from "../src/pages/overlay.ts"

// Electron is not there to be imported outside the app, so the test stands in for the parts
// the overlay uses and writes down what was asked of them.
const fake = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void
  const heard = new Map<string, Listener>()
  const fake = {
    windows: [] as FakeWindow[],
    shortcuts: new Map<string, () => void>(),
    heard,
    /** Say something as the overlay's page would. */
    say: (channel: string, ...args: unknown[]) =>
      heard.get(channel)?.({ sender: fake.windows.at(-1)?.webContents }, ...args),
  }
  class FakeWindow {
    visible = false
    destroyed = false
    focused = false
    ignoring: unknown[] = []
    sent: [string, unknown][] = []
    url = ""
    webContents = {
      on: () => {},
      setWindowOpenHandler: () => {},
      send: (channel: string, value: unknown) => this.sent.push([channel, value]),
    }
    constructor(readonly options: Record<string, unknown>) {
      fake.windows.push(this)
    }
    on() {}
    isDestroyed = () => this.destroyed
    isVisible = () => this.visible
    show() {
      this.visible = true
      this.focused = true
    }
    showInactive() {
      this.visible = true
    }
    hide() {
      this.visible = false
    }
    destroy() {
      this.destroyed = true
    }
    setIgnoreMouseEvents(...args: unknown[]) {
      this.ignoring = args
    }
    loadURL(url: string) {
      this.url = url
      return Promise.resolve()
    }
    setAlwaysOnTop = vi.fn()
    setVisibleOnAllWorkspaces = vi.fn()
    // Asked of it on a Mac only, where a window can be kept out of Mission Control.
    setHiddenInMissionControl = vi.fn()
    setContentProtection = vi.fn()
    setBounds = vi.fn()
  }
  return Object.assign(fake, { FakeWindow })
})

vi.mock("electron", () => ({
  BrowserWindow: fake.FakeWindow,
  globalShortcut: {
    register: (key: string, press: () => void) => {
      fake.shortcuts.set(key, press)
      return true
    },
    unregister: (key: string) => fake.shortcuts.delete(key),
  },
  ipcMain: {
    on: (channel: string, listener: (...args: unknown[]) => void) =>
      fake.heard.set(channel, listener),
    off: (channel: string) => fake.heard.delete(channel),
  },
  screen: {
    getPrimaryDisplay: () => ({
      bounds: { x: 0, y: 0, width: 1440, height: 900 },
      workArea: { x: 0, y: 25, width: 1440, height: 875 },
    }),
    on: () => {},
    off: () => {},
  },
}))

const pip = { id: "a1", name: "Pip", color: "#5f8a4e" }

describe("what the bar says", () => {
  it("names the agent and what it is doing, and offers Pause, while it works", () => {
    expect(barOf({ agent: pip, say: " Opening the budget ", held: false })).toEqual({
      title: "Pip is using this computer",
      detail: "Opening the budget",
      button: { label: "Pause", act: "pause" },
      esc: true,
    })
  })

  it("says the agent is paused, offers Carry on, and no longer promises that Esc does anything", () => {
    expect(barOf({ agent: pip, say: "Opening the budget", held: true })).toEqual({
      title: "Pip is paused",
      detail: "It carries on when you say.",
      button: { label: "Carry on", act: "carry-on" },
      esc: false,
    })
  })

  it("has something to say of an agent with no name and nothing said", () => {
    expect(barOf({ agent: { ...pip, name: " " }, held: false })).toMatchObject({
      title: "An agent is using this computer",
      detail: "",
    })
  })

  it("says the agent is in the background while it works behind what is in front, and promises nothing of Esc", () => {
    expect(barOf({ agent: pip, say: " Adding up ", held: false, behind: true })).toEqual({
      title: "Pip is working in the background",
      detail: "Adding up",
      button: { label: "Pause", act: "pause" },
      esc: false,
    })
    expect(barOf({ agent: { ...pip, name: "" }, held: false, behind: true }).title).toBe(
      "An agent is working in the background",
    )
    // Not behind is the same as never having been said.
    expect(barOf({ agent: pip, held: false, behind: false })).toEqual(
      barOf({ agent: pip, held: false }),
    )
  })

  it("says a paused agent is paused, wherever it was working", () => {
    expect(barOf({ agent: pip, held: true, behind: true })).toEqual(
      barOf({ agent: pip, held: true }),
    )
  })
})

describe("the agent's pointer", () => {
  it("carries the agent's name, and says it is waiting while paused", () => {
    expect(tagOf({ agent: pip, held: false })).toBe("Pip")
    expect(tagOf({ agent: pip, held: true })).toBe("Pip · waiting")
  })

  it("is drawn in the agent's colour, and in teal where that is no colour", () => {
    const supports = (color: string) => color.startsWith("#")
    expect(colorOf(" #5f8a4e ", supports)).toBe("#5f8a4e")
    expect(colorOf("url(x)", supports)).toBe("#2f9c95")
    expect(colorOf("", supports)).toBe("#2f9c95")
  })
})

describe("what the page is told to draw", () => {
  const place = { top: 41, buttons: true }

  it("is nothing where no agent has used the screen", () => {
    expect(viewOf({ agent: undefined, say: undefined, held: false }, undefined, 0, place)).toBe(
      undefined,
    )
  })

  it("has no pointer until the agent's has been put somewhere", () => {
    const state = { agent: pip, say: "Looking", held: false }
    expect(viewOf(state, undefined, 0, place)).not.toHaveProperty("pointer")
    expect(viewOf(state, { x: 10, y: 20 }, 2, place)).toEqual({
      agent: { name: "Pip", color: "#5f8a4e" },
      say: "Looking",
      held: false,
      pointer: { x: 10, y: 20 },
      ripples: 2,
      top: 41,
      buttons: true,
    })
  })

  it("says whether the agent is behind what is in front, where it was told", () => {
    const state = { agent: pip, say: undefined, held: false }
    expect(viewOf(state, undefined, 0, place)).not.toHaveProperty("behind")
    expect(viewOf(state, undefined, 0, { ...place, behind: true })).toMatchObject({ behind: true })
    expect(viewOf(state, undefined, 0, { ...place, behind: false })).toMatchObject({
      behind: false,
    })
  })
})

describe("the window over the screen", () => {
  let clock = 1_000_000
  let state: UseState
  let overlay: Overlay
  const window = () => fake.windows.at(-1)!
  const views = () =>
    window()
      .sent.filter(([channel]) => channel === "overlay:view")
      .map(([, view]) => view as OverlayView)

  beforeEach(() => {
    vi.useFakeTimers()
    fake.windows.length = 0
    fake.shortcuts.clear()
    state = new UseState({ what: "the screen", now: () => clock })
    overlay = createOverlay({ state, pagesDir: "/app/dist/pages", preload: "/app/dist/o.cjs" })
  })
  afterEach(() => {
    overlay.dispose()
    vi.useRealTimers()
  })

  it("is not made until an agent uses the screen, and then is shown without taking the keyboard", async () => {
    expect(fake.windows).toHaveLength(0)
    await state.enter(pip, "Opening the budget")
    expect(fake.windows).toHaveLength(1)
    expect(window().visible).toBe(true)
    // An agent types into whatever window is in front. This one must never be that window.
    expect(window().focused).toBe(false)
    expect(window().options).toMatchObject({
      x: 0,
      y: 0,
      width: 1440,
      height: 900,
      frame: false,
      transparent: true,
      focusable: false,
      skipTaskbar: true,
      show: false,
    })
    expect(window().setAlwaysOnTop).toHaveBeenCalledWith(true, "screen-saver")
    expect(window().setContentProtection).toHaveBeenCalledWith(true)
    // On Windows the folder is on a drive, which the address then names.
    expect(window().url).toMatch(/^file:\/\/\/(\w:\/)?app\/dist\/pages\/overlay\.html$/)
    expect(window().ignoring[0]).toBe(true)
  })

  it("tells the page what to draw once the page asks, and again when it changes", async () => {
    await state.enter(pip, "Opening the budget")
    expect(views()).toHaveLength(0)
    fake.say("overlay:ready")
    // The bar sits below the menu bar of a screen that has one.
    expect(views().at(-1)).toMatchObject({ agent: { name: "Pip" }, held: false, top: 41 })
    overlay.point({ x: 300.4, y: 200.6 }, true)
    expect(views().at(-1)).toMatchObject({ pointer: { x: 300, y: 201 }, ripples: 1 })
    overlay.point({ x: 310, y: 200 }, false)
    expect(views().at(-1)).toMatchObject({ pointer: { x: 310, y: 200 }, ripples: 1 })
  })

  it("takes the Esc key only while the agent works, and Esc pauses it", async () => {
    expect(fake.shortcuts.has("Escape")).toBe(false)
    await state.enter(pip, undefined)
    expect(fake.shortcuts.has("Escape")).toBe(true)
    fake.shortcuts.get("Escape")!()
    expect(state.held).toBe(true)
    // Paused, the key is its owner's again, and the window stays to say who is waiting.
    expect(fake.shortcuts.has("Escape")).toBe(false)
    expect(window().visible).toBe(true)
    state.hold(false)
    expect(fake.shortcuts.has("Escape")).toBe(true)
  })

  it("leaves Esc to its owner while the agent works behind what is in front, and takes it again after", async () => {
    await state.enter(pip, undefined)
    fake.say("overlay:ready")
    expect(fake.shortcuts.has("Escape")).toBe(true)
    overlay.behind(true)
    expect(fake.shortcuts.has("Escape")).toBe(false)
    expect(views().at(-1)).toMatchObject({ behind: true })
    // Told the same again, the page is told nothing.
    const told = views().length
    overlay.behind(true)
    expect(views()).toHaveLength(told)
    overlay.behind(false)
    expect(fake.shortcuts.has("Escape")).toBe(true)
    expect(views().at(-1)).toMatchObject({ behind: false })
  })

  it("takes the pointer away when it is given no place for it", async () => {
    await state.enter(pip, undefined)
    fake.say("overlay:ready")
    overlay.point({ x: 300, y: 200 }, true)
    expect(views().at(-1)).toMatchObject({ pointer: { x: 300, y: 200 }, ripples: 1 })
    overlay.point(undefined, true)
    expect(views().at(-1)).not.toHaveProperty("pointer")
    // A click at no place is not one to ripple for.
    expect(views().at(-1)).toMatchObject({ ripples: 1 })
  })

  it("does what the bar's buttons ask", async () => {
    await state.enter(pip, undefined)
    fake.say("overlay:act", "pause")
    expect(state.held).toBe(true)
    fake.say("overlay:act", "carry-on")
    expect(state.held).toBe(false)
    fake.say("overlay:act", "stop")
    expect(state.stopped).toBe(true)
    vi.advanceTimersByTime(0)
    expect(window().visible).toBe(false)
    expect(fake.shortcuts.has("Escape")).toBe(false)
  })

  it("listens to nobody but its own page", async () => {
    await state.enter(pip, undefined)
    fake.heard.get("overlay:act")!({ sender: {} }, "stop")
    expect(state.stopped).toBe(false)
  })

  it("goes when the agent has done nothing for a while, though nothing says so, and forgets where the pointer was", async () => {
    await state.enter(pip, undefined)
    fake.say("overlay:ready")
    overlay.point({ x: 5, y: 5 }, false)
    clock += USE_LINGER_MS + 1
    expect(window().visible).toBe(true)
    vi.advanceTimersByTime(1_000)
    expect(window().visible).toBe(false)
    expect(fake.shortcuts.has("Escape")).toBe(false)

    // The next use shows the same window again, with no pointer until it is put somewhere.
    await state.enter(pip, "Back again")
    expect(fake.windows).toHaveLength(1)
    expect(window().visible).toBe(true)
    expect(views().at(-1)).not.toHaveProperty("pointer")
  })

  it("stays while the agent is paused, however long that is", async () => {
    await state.enter(pip, undefined)
    state.hold(true)
    clock += USE_LINGER_MS * 10
    vi.advanceTimersByTime(5_000)
    expect(window().visible).toBe(true)
  })

  it("does not go and come back when an agent that was waiting is let carry on", async () => {
    await state.enter(pip, undefined)
    state.hold(true)
    const waiting = state.enter(pip, "Typing the total")
    // Long enough that nothing the agent did before still counts.
    clock += USE_LINGER_MS * 2
    const hide = vi.spyOn(window(), "hide")
    state.hold(false)
    await waiting
    vi.advanceTimersByTime(0)
    expect(hide).not.toHaveBeenCalled()
    expect(window().visible).toBe(true)
    expect(fake.shortcuts.has("Escape")).toBe(true)
  })

  it("gives back the key and its window when it is done with", async () => {
    await state.enter(pip, undefined)
    overlay.dispose()
    expect(fake.shortcuts.has("Escape")).toBe(false)
    expect(window().destroyed).toBe(true)
    expect(fake.heard.size).toBe(0)
    // What the agent does afterwards is none of its business.
    state.touch()
    expect(fake.windows).toHaveLength(1)
  })

  it("says whether it turns up in pictures of the screen, which it does only on Linux", () => {
    expect(overlay.inPictures).toBe(process.platform === "linux")
  })
})
