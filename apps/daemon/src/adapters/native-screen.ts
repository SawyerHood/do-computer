import type { ScreenIO } from "@do-computer/computers/daemon"
import { prepareImage } from "@do-computer/computers/node"
import { UseRefused, UseState } from "@do-computer/computers/use"
import {
  IMAGE_RESULT_BYTES,
  SHOT_EDGE,
  USE_HELD_WAIT_MS,
  type DesktopAction,
  type LiveView,
  type ScreenActed,
  type Shot,
} from "@do-computer/protocol"
import type { Capture, ScreenDriver } from "./linux.ts"

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
  let viewing: Promise<LiveView> | undefined
  let cached: { at: number; view: LiveView } | undefined
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
      cached = undefined
      frame = undefined
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
              state.touch()
              cached = undefined
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
      cached = undefined
    },
    async view() {
      if (disposed || !state.active) return { active: false, seq }
      if (cached && Date.now() - cached.at < 400) return cached.view
      viewing ??= bounded(
        async (signal) => {
          const image = shot(await driver.capture(signal))
          if (!state.active || disposed) return { active: false, seq }
          const view: LiveView = {
            active: state.active,
            seq: ++seq,
            shot: image,
            held: state.held,
            agent: state.agent,
            say: state.say,
          }
          cached = { at: Date.now(), view }
          return view
        },
        10_000,
        pending,
      ).finally(() => {
        viewing = undefined
      })
      return viewing
    },
  }
}
