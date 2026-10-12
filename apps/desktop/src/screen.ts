/**
 * The screen of this computer, as agents use it. The daemon cannot touch a screen: it asks the
 * app, which answers here. Who is using the screen, and whether they may, is `UseState`'s to
 * say; this does what was asked and takes the pictures.
 */
import { UseRefused, type UseState } from "@do-computer/computers/use"
import type { AppAnswer, AppCall } from "@do-computer/daemon/events"
import {
  type DesktopAction,
  type LiveView,
  type ScreenActed,
  type ScreenAction,
  type ScreenWindow,
  SHOT_EDGE,
  type Shot,
  type ShotPoint,
  type WindowAct,
  windowName,
} from "@do-computer/protocol"
import type { DriverWindow, Picture, ScreenDriver } from "./screen-driver.ts"

/** How long the screen is given to show what an action did, before its picture is taken. */
const SETTLE_MS = 350
/** The least time between two pictures taken for whoever watches. */
const VIEW_EVERY_MS = 400
const MAX_WAIT_MS = 10_000
const ACT_QUALITY = 70
const VIEW_QUALITY = 50

/** How long an app that was opened is given to show a window. */
const OPEN_WAIT_MS = 5_000

/** The part of the overlay the service uses: the agent's pointer, drawn over the screen. */
export type Pointer = {
  /** Put the pointer at a place on the display, or take it away where there is none to show. */
  point(at: { x: number; y: number } | undefined, click: boolean): void
  /**
   * Say whether the agent is working behind what its owner has in front. Then the screen is
   * still its owner's to use, and what is drawn over it keeps out of their way.
   */
  behind?(on: boolean): void
  readonly inPictures: boolean
}

export type ScreenServiceOptions = {
  readonly state: UseState
  readonly driver: ScreenDriver
  readonly pointer: Pointer
  /** The size of the primary display, in its own points. */
  readonly display: () => { width: number; height: number }
  /** A PNG as a JPEG. The app's to do, since Electron has it and nothing else here does. */
  readonly toJpeg: (png: Buffer, quality: number) => Buffer
  /** Why the system will not let the app use the screen, in words for an agent, if it will not. */
  readonly forbidden?: () => string | undefined
  readonly settleMs?: number
  readonly viewEveryMs?: number
  readonly now?: () => number
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export class ScreenService {
  readonly #options: ScreenServiceOptions
  readonly #now: () => number
  /** One thing at a time: two agents' clicks must not land between each other's. */
  #queue: Promise<unknown> = Promise.resolve()
  /** The size of the picture an agent was last given, which is what its places are in. */
  #size: { width: number; height: number } | undefined
  /** The same for each window an agent was given a picture of. */
  readonly #sizes = new Map<number, { width: number; height: number }>()
  /** The window the agent last worked in, which is what someone watching is shown. None: the whole screen. */
  #window: DriverWindow | undefined
  /** Where the agent's pointer is, in the picture of what it last worked in. */
  #pointer: ShotPoint | undefined
  #seq = 0
  #view: { shot: Shot; at: number } | undefined
  #viewing: Promise<void> | undefined

  constructor(options: ScreenServiceOptions) {
    this.#options = options
    this.#now = options.now ?? Date.now
  }

  /** Answer something the daemon asked. Never rejects: what went wrong is the answer. */
  async answer(call: AppCall): Promise<AppAnswer> {
    try {
      return { id: call.id, value: await this.#do(call) }
    } catch (error) {
      return {
        id: call.id,
        error: { refused: error instanceof UseRefused, message: message(error) },
      }
    }
  }

  async #do(call: AppCall): Promise<unknown> {
    if (call.op === "hold") {
      this.#options.state.hold(call.held === true)
      return {}
    }
    if (call.op === "view") return this.#look(call.after, call.waitMs ?? 0)
    if (call.op !== "act") throw new Error(`The screen has no "${String(call.op)}".`)
    const { agent, action } = call
    if (agent === undefined || action === undefined) throw new Error("Nothing was asked.")
    const forbidden = this.#options.forbidden?.()
    if (forbidden !== undefined) throw new UseRefused(forbidden)
    const acting = this.#queue.then(() => this.#act(agent, action, call.say))
    this.#queue = acting.catch(() => {})
    return acting
  }

  async #act(
    agent: NonNullable<AppCall["agent"]>,
    action: ScreenAction,
    say: string | undefined,
  ): Promise<ScreenActed> {
    const { state, driver, pointer } = this.#options
    await state.enter(agent, say)
    if (action.do === "windows") {
      pointer.behind?.(true)
      return { windows: (await driver.windows()).map(told) }
    }
    if (action.do === "open") {
      pointer.behind?.(true)
      return this.#open(agent, action.app, say)
    }
    if (action.do === "in_window") {
      pointer.behind?.(action.inFront !== true)
      return this.#actIn(agent, action.window, action.act, action.inFront === true, say)
    }
    pointer.behind?.(false)
    // The pointer was in a window's picture, and the screen's is another.
    if (this.#window !== undefined) this.#on(undefined)
    await this.#do1(action)
    // Asked again, so that an agent stopped while it was doing this is told so, not shown the screen.
    await state.enter(agent, say)
    const picture = await driver.capture(SHOT_EDGE)
    this.#size = { width: picture.width, height: picture.height }
    const shot = this.#shot(picture, ACT_QUALITY)
    state.touch()
    return { shot, ...(this.#pointer === undefined ? {} : { pointer: this.#pointer }) }
  }

  /** Wait as long as was asked, in steps, so that an agent that was stopped is not left waiting. */
  async #wait(seconds: number): Promise<void> {
    const { state } = this.#options
    const until = this.#now() + Math.max(0, Math.min(seconds * 1_000, MAX_WAIT_MS))
    while (this.#now() < until && !state.stopped) await sleep(Math.min(250, until - this.#now()))
  }

  /** One thing done to the whole screen, with the computer's own mouse and keyboard. */
  async #do1(action: DesktopAction): Promise<void> {
    const { state, driver, pointer } = this.#options
    if (action.do === "screenshot") return
    if (action.do === "wait") return this.#wait(action.seconds)
    if ("x" in action) {
      const click =
        action.do === "click" || action.do === "double_click" || action.do === "right_click"
      pointer.point(this.#onDisplay(action), click)
      this.#pointer = { x: action.x, y: action.y }
      if (click) state.clicks += 1
    }
    // The keys the agent presses are its own: Esc among them must not pause it.
    const keys = action.do === "key" || action.do === "type"
    if (keys) state.press(true)
    try {
      await driver.act(action)
    } finally {
      if (keys) state.press(false)
    }
    if (action.do === "drag") {
      this.#pointer = { x: action.toX, y: action.toY }
      pointer.point(this.#onDisplay(this.#pointer), false)
    }
    await sleep(this.#options.settleMs ?? SETTLE_MS)
  }

  /**
   * Say what the agent works in from here on: a window, or the whole screen. Its pointer was
   * at a place in a picture of what it worked in before, which is no place in this one.
   */
  #on(window: DriverWindow | undefined): void {
    if (this.#window?.id !== window?.id && this.#pointer !== undefined) {
      this.#pointer = undefined
      this.#options.pointer.point(undefined, false)
    }
    this.#window = window
  }

  /** The window of that id, as it is now. */
  async #find(id: number): Promise<{ window: DriverWindow; all: DriverWindow[] }> {
    const all = await this.#options.driver.windows()
    const window = all.find((each) => each.id === id)
    if (window === undefined) {
      throw new Error(
        `There is no window ${id} on this computer now. Ask for \`windows\` to see the ones there are.`,
      )
    }
    return { window, all }
  }

  /** One thing done in a window, and a picture of the window afterwards. */
  async #actIn(
    agent: NonNullable<AppCall["agent"]>,
    id: number,
    asked: WindowAct,
    inFront: boolean,
    say: string | undefined,
  ): Promise<ScreenActed> {
    const { state, driver, pointer } = this.#options
    const { window, all } = await this.#find(id)
    this.#on(window)
    let note: string | undefined
    if (asked.do === "wait") await this.#wait(asked.seconds)
    else if (asked.do !== "screenshot") {
      // The driver takes a place to be in the picture it last took of the window. Taking one
      // now makes that so whatever was taken in between, and shows what size the window is.
      const before = await driver.captureWindow(window, SHOT_EDGE)
      const act = resized(asked, this.#sizes.get(window.id) ?? before, before)
      const was = this.#pointer
      const click = act.do === "click" || act.do === "double_click" || act.do === "right_click"
      if ("x" in act && act.x !== undefined && act.y !== undefined) {
        this.#pointer = { x: act.x, y: act.y }
        pointer.point(inSight(window, all, onWindow(window, before, this.#pointer)), click)
      }
      // Only a key pressed with the window in front is one the app itself could take for its owner's Esc.
      const keys = inFront && (act.do === "key" || act.do === "type")
      if (keys) state.press(true)
      try {
        note = await driver.actIn(window, act, inFront)
      } catch (error) {
        // What was refused was not done: the pointer is where it was.
        this.#pointer = was
        pointer.point(
          was === undefined ? undefined : inSight(window, all, onWindow(window, before, was)),
          false,
        )
        throw error
      } finally {
        if (keys) state.press(false)
      }
      if (click) state.clicks += 1
      if (act.do === "drag") {
        this.#pointer = { x: act.toX, y: act.toY }
        pointer.point(inSight(window, all, onWindow(window, before, this.#pointer)), false)
      }
      await sleep(this.#options.settleMs ?? SETTLE_MS)
    }
    await state.enter(agent, say)
    let picture: Picture
    try {
      picture = await driver.captureWindow(window, SHOT_EDGE)
    } catch (error) {
      // Closing a window is a thing an agent does: then there is no picture of it to take.
      const now = await driver.windows()
      if (now.some((each) => each.id === window.id)) throw error
      this.#on(undefined)
      this.#sizes.delete(window.id)
      state.touch()
      return { windows: now.map(told), note: "That window is no longer there." }
    }
    this.#sizes.set(window.id, { width: picture.width, height: picture.height })
    state.touch()
    return {
      shot: this.#shot(picture, ACT_QUALITY),
      window: told(window),
      ...(this.#pointer === undefined ? {} : { pointer: this.#pointer }),
      ...(note === undefined ? {} : { note }),
    }
  }

  /** Open an app behind what is in front, and answer with its windows and a picture of the first. */
  async #open(
    agent: NonNullable<AppCall["agent"]>,
    app: string,
    say: string | undefined,
  ): Promise<ScreenActed> {
    const { state, driver } = this.#options
    const opened = await driver.open(app)
    // An app is running a moment before it has a window.
    const until = this.#now() + OPEN_WAIT_MS
    let windows: DriverWindow[] = []
    for (;;) {
      windows = (await driver.windows()).filter((each) => each.pid === opened.pid)
      if (windows.length > 0 || this.#now() >= until || state.stopped) break
      await sleep(250)
    }
    await state.enter(agent, say)
    const first = windows.find((each) => each.shown) ?? windows[0]
    if (first === undefined) {
      state.touch()
      return {
        windows: [],
        note: `${opened.app} is open and has no window yet. Ask for \`windows\` in a moment.`,
      }
    }
    await sleep(this.#options.settleMs ?? SETTLE_MS)
    const picture = await driver.captureWindow(first, SHOT_EDGE)
    this.#sizes.set(first.id, { width: picture.width, height: picture.height })
    this.#on(first)
    state.touch()
    return {
      shot: this.#shot(picture, ACT_QUALITY),
      window: told(first),
      windows: windows.map(told),
    }
  }

  #shot(picture: Picture, quality: number): Shot {
    return {
      mimeType: "image/jpeg",
      data: this.#options.toJpeg(picture.png, quality).toString("base64"),
      width: picture.width,
      height: picture.height,
    }
  }

  /** What someone watching is shown: the window the agent is working in, or the whole screen. */
  async #watched(): Promise<Picture> {
    const { driver } = this.#options
    const window = this.#window
    if (window === undefined) return driver.capture(SHOT_EDGE)
    try {
      return await driver.captureWindow(window, SHOT_EDGE, true)
    } catch {
      // A window that has gone leaves the screen to be shown.
      if (this.#window === window) this.#on(undefined)
      return driver.capture(SHOT_EDGE)
    }
  }

  /** A place in the agent's picture as a place on the display, which is another size. */
  #onDisplay(at: ShotPoint): { x: number; y: number } {
    const display = this.#options.display()
    // Before any picture: the size one would be, which is the display's made to fit.
    const fit = Math.min(1, SHOT_EDGE / Math.max(display.width, display.height))
    const size = this.#size ?? { width: display.width * fit, height: display.height * fit }
    return { x: (at.x * display.width) / size.width, y: (at.y * display.height) / size.height }
  }

  async #look(after: number | undefined, waitMs: number): Promise<LiveView> {
    const { state, pointer } = this.#options
    // A screen nobody is using is nobody's to watch: no picture of it is taken at all.
    if (!state.active) return { active: false, seq: this.#seq }
    const until = this.#now() + Math.max(0, Math.min(waitMs, MAX_WAIT_MS))
    const every = this.#options.viewEveryMs ?? VIEW_EVERY_MS
    // Whoever has seen none is given one taken just now, not one from when they last watched.
    const seen = () =>
      this.#view !== undefined &&
      (after === undefined ? this.#now() - this.#view.at < every : this.#seq > after)
    while (!seen()) {
      const due = (this.#view?.at ?? Number.NEGATIVE_INFINITY) + every
      const wait = due - this.#now()
      if (wait > 0) {
        // No newer picture in the time there is: the one there is has to do.
        if (this.#now() + wait > until) break
        await sleep(wait)
        continue
      }
      // Everyone watching shares one picture, however many of them asked.
      this.#viewing ??= (async () => {
        try {
          const picture = await this.#watched()
          this.#view = { shot: this.#shot(picture, VIEW_QUALITY), at: this.#now() }
          this.#seq += 1
        } finally {
          this.#viewing = undefined
        }
      })()
      await this.#viewing
      if (!state.active) return { active: false, seq: this.#seq }
    }
    const window = this.#window
    return {
      active: true,
      seq: this.#seq,
      ...(this.#view === undefined ? {} : { shot: this.#view.shot }),
      // A window's picture is of the window alone, with nothing the app draws in it.
      ...(this.#pointer === undefined || (pointer.inPictures && window === undefined)
        ? {}
        : { pointer: this.#pointer }),
      ...(window === undefined ? {} : { title: windowName(window) }),
      clicks: state.clicks,
      ...(state.say === undefined ? {} : { say: state.say }),
      held: state.held,
      ...(state.agent === undefined ? {} : { agent: state.agent }),
    }
  }
}

/** A window as an agent is told of it. */
function told(window: DriverWindow): ScreenWindow {
  const { id, app, title, width, height, shown } = window
  return { id, app, title, width, height, shown }
}

/**
 * What was asked, with its places moved to a picture of another size: a window that was made
 * larger or smaller since the agent saw it is the same window, and what was at a place in it is
 * mostly where it was in proportion.
 */
export function resized(
  act: WindowAct,
  from: { width: number; height: number },
  to: { width: number; height: number },
): WindowAct {
  if (from.width === to.width && from.height === to.height) return act
  const x = (value: number) => Math.round((value * to.width) / from.width)
  const y = (value: number) => Math.round((value * to.height) / from.height)
  switch (act.do) {
    case "click":
    case "double_click":
    case "right_click":
    case "scroll":
      return { ...act, x: x(act.x), y: y(act.y) }
    case "drag":
      return { ...act, x: x(act.x), y: y(act.y), toX: x(act.toX), toY: y(act.toY) }
    case "type":
      return act.x === undefined || act.y === undefined ? act : { ...act, x: x(act.x), y: y(act.y) }
    default:
      return act
  }
}

/** A place in a window's picture as a place on the display. */
function onWindow(
  window: DriverWindow,
  picture: { width: number; height: number },
  at: ShotPoint,
): { x: number; y: number } {
  return {
    x: window.x + (at.x * window.width) / picture.width,
    y: window.y + (at.y * window.height) / picture.height,
  }
}

/**
 * A place in a window, where the window is the one to be seen there, and nothing where another
 * is over it or it is not showing: a pointer drawn there would point at something else.
 */
export function inSight(
  window: DriverWindow,
  all: readonly DriverWindow[],
  at: { x: number; y: number },
): { x: number; y: number } | undefined {
  if (!window.shown) return undefined
  const over = all.some(
    (each) =>
      each.id !== window.id &&
      each.shown &&
      each.z !== undefined &&
      window.z !== undefined &&
      each.z > window.z &&
      at.x >= each.x &&
      at.x < each.x + each.width &&
      at.y >= each.y &&
      at.y < each.y + each.height,
  )
  return over ? undefined : at
}
