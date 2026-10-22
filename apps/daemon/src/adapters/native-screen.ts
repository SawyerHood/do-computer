import type { ScreenIO } from "@do-computer/computers/daemon"
import { prepareImage } from "@do-computer/computers/node"
import { UseRefused, UseState } from "@do-computer/computers/use"
import {
  IMAGE_RESULT_BYTES,
  SHOT_EDGE,
  USE_HELD_WAIT_MS,
  type DesktopAction,
  type ScreenActed,
  type Shot,
} from "@do-computer/protocol"
import type { Capture, ScreenDriver } from "./linux.ts"

/** How often a new picture is taken for someone watching; the desktop app uses 400ms. */
export const VIEW_EVERY_MS = 500
const MAX_VIEW_WAIT_MS = 10_000

function bounded<T>(
  work: (signal: AbortSignal) => Promise<T>,
  ms: number,
  pending: Set<AbortController>,
): Promise<T> {
  const controller = new AbortController()
  pending.add(controller)
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => controller.abort(new Error("Screen operation timed out")), ms)
    controller.signal.addEventListener("abort", () => reject(controller.signal.reason), {
      once: true,
    })
    work(controller.signal)
      .then(resolve, reject)
      .finally(() => {
        clearTimeout(timer)
        pending.delete(controller)
      })
  })
}
function shot(capture: Capture): Shot {
  const image = prepareImage(capture.png, {
    maxEdge: SHOT_EDGE,
    maxPixels: SHOT_EDGE * SHOT_EDGE,
    maxBytes: IMAGE_RESULT_BYTES,
  })
  if (!image) throw new Error("Screen capture could not be made small enough to send safely")
  return {
    mimeType: image.mimeType,
    data: Buffer.from(image.bytes).toString("base64"),
    width: image.width,
    height: image.height,
  }
}

/** Shared native-screen policy; drivers only capture and perform validated desktop actions. */
export function nativeScreen(driver: ScreenDriver): ScreenIO & { dispose(): void } {
  const state = new UseState({ what: "the screen" })
  let queue: Promise<unknown> = Promise.resolve()
  let frame: { image: Shot; capture: Capture } | undefined
  let active: AbortController | undefined
  const pending = new Set<AbortController>()
  let disposed = false
  let seq = 0
  let viewing: Promise<void> | undefined
  /** The newest picture, from an action or from someone watching; `seq` counts them. */
  let latest: { shot: Shot; at: number } | undefined
  const waiters = new Set<() => void>()
  const changed = () => {
    for (const wake of [...waiters]) wake()
  }
  /** Sleeps for up to `ms`, waking early when a picture is taken, use is held, or it stops. */
  const nap = (ms: number) =>
    new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer)
        waiters.delete(done)
        resolve()
      }
      const timer = setTimeout(done, Math.max(0, ms))
      waiters.add(done)
    })
  const point = (x: number, y: number) => {
    if (!frame) throw new Error("Take a screenshot before sending pointer coordinates")
    if (
      ![x, y].every(Number.isFinite) ||
      x < 0 ||
      y < 0 ||
      x >= frame.image.width ||
      y >= frame.image.height
    )
      throw new Error("Pointer coordinates are outside the last screenshot")
    const r = frame.capture.rect
    return {
      x: r.x + (x * r.width) / frame.image.width,
      y: r.y + (y * r.height) / frame.image.height,
    }
  }
  return {
    dispose() {
      disposed = true
      for (const controller of pending) controller.abort(new Error("Screen adapter stopped"))
      state.stop()
      latest = undefined
      frame = undefined
      changed()
    },
    act(agent, action, say) {
      if (disposed) return Promise.reject(new Error("Screen adapter stopped"))
      if (action.do === "windows" || action.do === "open" || action.do === "in_window")
        return Promise.reject(
          new UseRefused(
            "This native adapter supports whole-screen actions only; background-window operations require the desktop-app adapter.",
          ),
        )
      const result = bounded<ScreenActed>(
        (signal) => {
          const work = queue.then(async () => {
            signal.throwIfAborted()
            if (disposed) throw new Error("Screen adapter stopped")
            await state.enter(agent, say)
            signal.throwIfAborted()
            const controller = new AbortController()
            active = controller
            const abort = () => controller.abort(signal.reason)
            signal.addEventListener("abort", abort, { once: true })
            try {
              let mapped: DesktopAction = action
              if ("x" in action) {
                const current = await driver.geometry(controller.signal)
                if (
                  frame &&
                  (Object.keys(current) as (keyof typeof current)[]).some(
                    (key) => current[key] !== frame!.capture.rect[key],
                  )
                )
                  throw new Error(
                    "The display geometry changed. Take another screenshot before pointing.",
                  )
              }
              if ("x" in action)
                mapped = {
                  ...action,
                  ...point(action.x, action.y),
                  ...(action.do === "drag"
                    ? { toX: point(action.toX, action.toY).x, toY: point(action.toX, action.toY).y }
                    : {}),
                }
              if (action.do === "wait") {
                if (!Number.isFinite(action.seconds) || action.seconds < 0 || action.seconds > 30)
                  throw new Error("Wait must be between 0 and 30 seconds")
                await new Promise<void>((resolve, reject) => {
                  const timer = setTimeout(done, action.seconds * 1000)
                  function done() {
                    controller.signal.removeEventListener("abort", stopped)
                    resolve()
                  }
                  function stopped() {
                    clearTimeout(timer)
                    reject(controller.signal.reason)
                  }
                  controller.signal.addEventListener("abort", stopped, { once: true })
                })
              } else if (action.do !== "screenshot") await driver.act(mapped, controller.signal)
              controller.signal.throwIfAborted()
              const capture = await driver.capture(controller.signal)
              const image = shot(capture)
              frame = { image, capture }
              seq++
              latest = { shot: image, at: Date.now() }
              state.touch()
              changed()
              return { shot: image }
            } finally {
              signal.removeEventListener("abort", abort)
              if (active === controller) active = undefined
            }
          })
          queue = work.catch(() => {})
          return work
        },
        USE_HELD_WAIT_MS + 40_000,
        pending,
      )
      return result
    },
    async hold(held) {
      state.hold(held)
      if (held) active?.abort(new UseRefused("Screen use was paused by its owner."))
      // Watchers waiting for something newer are told at once.
      seq++
      changed()
    },
    /**
     * What someone watching sees: returns as soon as there is a picture newer than `after`, and
     * otherwise waits up to `waitMs`, taking a new picture at most every VIEW_EVERY_MS however
     * many watch. Nothing is captured while nobody is using the screen.
     */
    async view(after, waitMs) {
      const until = Date.now() + Math.min(Math.max(0, waitMs), MAX_VIEW_WAIT_MS)
      while (!disposed && state.active && !(latest && seq > after) && !state.held) {
        const wait = (latest?.at ?? Number.NEGATIVE_INFINITY) + VIEW_EVERY_MS - Date.now()
        if (wait > 0) {
          // No newer picture is due in the time there is: the one there is has to do.
          if (Date.now() + wait > until) break
          await nap(wait)
          continue
        }
        viewing ??= bounded(
          async (signal) => {
            const image = shot(await driver.capture(signal))
            if (disposed || !state.active) return
            seq++
            latest = { shot: image, at: Date.now() }
            changed()
          },
          10_000,
          pending,
        ).finally(() => {
          viewing = undefined
        })
        await viewing
      }
      if (disposed || !state.active) return { active: false, seq }
      return {
        active: true,
        seq,
        ...(latest === undefined ? {} : { shot: latest.shot }),
        held: state.held,
        agent: state.agent,
        say: state.say,
      }
    },
  }
}
