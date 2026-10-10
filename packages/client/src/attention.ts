export type StreamStatus = "connecting" | "open" | "reconnecting" | "closed"

export type Subscription = { close(): void }

/** Says whether anyone is looking at what the client's streams feed. */
export type Attention = {
  here(): boolean
  /** Call `changed` whenever that may have changed. Returns how to stop. */
  watch(changed: () => void): () => void
}

const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 5_000]
/**
 * How long to wait before the next try: the delay of that try, and up to as long again. Every
 * client of a server loses its connection at the same moment when the server is replaced, and
 * without this they would all be back at the same moment too.
 */
export const reconnectDelay = (attempt: number) =>
  RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)]! * (1 + Math.random())
/**
 * How long nobody has to have been looking before a stream is let go of. An open stream keeps
 * the agent it follows in memory on the server, which is paid for by the second, and a tab left
 * open in the background would keep it there for days.
 */
export const REST_AFTER_MS = 60_000

/** Call `then` once nobody has been looking for `ms` without a break. Returns how to stop. */
export function whenUnattended(attention: Attention, ms: number, then: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const look = () => {
    if (attention.here()) {
      clearTimeout(timer)
      timer = undefined
    } else {
      timer ??= setTimeout(then, ms)
    }
  }
  const stop = attention.watch(look)
  look()
  return () => {
    stop()
    clearTimeout(timer)
  }
}

/** Resolves once someone is looking, or `signal` is aborted. */
export function attended(attention: Attention, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (attention.here() || signal.aborted) return resolve()
    const look = () => {
      if (!attention.here() && !signal.aborted) return
      stop()
      signal.removeEventListener("abort", look)
      resolve()
    }
    const stop = attention.watch(look)
    signal.addEventListener("abort", look)
  })
}
