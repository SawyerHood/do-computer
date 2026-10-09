/**
 * The screen of this computer, as agents use it. The daemon cannot touch a screen: it asks the
 * app, which answers here. Who is using the screen, and whether they may, is `UseState`'s to
 * say; this does what was asked and takes the pictures.
 */
import { UseRefused, type UseState } from "@durable-computer/computers/use"
import type { AppAnswer, AppCall } from "@durable-computer/daemon/events"
import {
  type LiveView,
  type ScreenActed,
  type ScreenAction,
  SHOT_EDGE,
  type Shot,
  type ShotPoint,
} from "@durable-computer/protocol"
import type { Picture, ScreenDriver } from "./screen-driver.ts"

/** How long the screen is given to show what an action did, before its picture is taken. */
const SETTLE_MS = 350
/** The least time between two pictures taken for whoever watches. */
const VIEW_EVERY_MS = 400
const MAX_WAIT_MS = 10_000
const ACT_QUALITY = 70
const VIEW_QUALITY = 50

/** The part of the overlay the service uses: the agent's pointer, drawn over the screen. */
export type Pointer = {
  point(at: { x: number; y: number }, click: boolean): void
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
    if (action.do === "wait") {
      const until = this.#now() + Math.max(0, Math.min(action.seconds * 1_000, MAX_WAIT_MS))
      // In steps, so that an agent that was stopped is not left waiting out its ten seconds.
      while (this.#now() < until && !state.stopped) await sleep(Math.min(250, until - this.#now()))
    } else if (action.do !== "screenshot") {
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
    // Asked again, so that an agent stopped while it was doing this is told so, not shown the screen.
    await state.enter(agent, say)
    const picture = await driver.capture(SHOT_EDGE)
    this.#size = { width: picture.width, height: picture.height }
    const shot = this.#shot(picture, ACT_QUALITY)
    state.touch()
    return { shot, ...(this.#pointer === undefined ? {} : { pointer: this.#pointer }) }
  }

  #shot(picture: Picture, quality: number): Shot {
    return {
      mimeType: "image/jpeg",
      data: this.#options.toJpeg(picture.png, quality).toString("base64"),
      width: picture.width,
      height: picture.height,
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
          const picture = await this.#options.driver.capture(SHOT_EDGE)
          this.#view = { shot: this.#shot(picture, VIEW_QUALITY), at: this.#now() }
          this.#seq += 1
        } finally {
          this.#viewing = undefined
        }
      })()
      await this.#viewing
      if (!state.active) return { active: false, seq: this.#seq }
    }
    return {
      active: true,
      seq: this.#seq,
      ...(this.#view === undefined ? {} : { shot: this.#view.shot }),
      ...(this.#pointer === undefined || pointer.inPictures ? {} : { pointer: this.#pointer }),
      clicks: state.clicks,
      ...(state.say === undefined ? {} : { say: state.say }),
      held: state.held,
      ...(state.agent === undefined ? {} : { agent: state.agent }),
    }
  }
}
