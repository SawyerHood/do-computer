import type { LiveView, UseWhat } from "@do-computer/protocol"
import { useEffect, useSyncExternalStore } from "react"
import { client } from "./client.ts"

/** The pause between one picture and asking for the next: two or three pictures a second. */
const BETWEEN_MS = 300
/** How long to leave it after hearing that nobody is using it, or hearing nothing. Doubles to the longest. */
const IDLE_MS = 2_000
const LONGEST_IDLE_MS = 30_000

/**
 * One screen or browser being watched. However many places show it (the window in the chat,
 * the agent's panel, the large view), it is asked about by one loop, which runs only while
 * something is showing it.
 */
type Watch = {
  view: LiveView | undefined
  watchers: number
  listeners: Set<() => void>
  stop: AbortController | undefined
}

const watches = new Map<string, Watch>()

function watchOf(key: string): Watch {
  let watch = watches.get(key)
  if (watch === undefined) {
    watch = { view: undefined, watchers: 0, listeners: new Set(), stop: undefined }
    watches.set(key, watch)
  }
  return watch
}

const tell = (watch: Watch) => {
  for (const listener of watch.listeners) listener()
}

/** Waits, unless it is stopped first or the tab comes back into view. */
const rest = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)
      document.removeEventListener("visibilitychange", done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener("abort", done)
    document.addEventListener("visibilitychange", done)
  })

async function run(watch: Watch, agentId: string, computerId: string, what: UseWhat) {
  const stop = new AbortController()
  watch.stop = stop
  let idle = IDLE_MS
  while (!stop.signal.aborted) {
    // A tab nobody is looking at asks for nothing.
    if (document.visibilityState !== "visible") {
      await rest(LONGEST_IDLE_MS, stop.signal)
      continue
    }
    let wait = BETWEEN_MS
    try {
      // The server answers at once with what it has when asked from zero, and otherwise holds
      // the question until there is a newer picture.
      const view = await client
        .agent(agentId)
        .view(computerId, what, watch.view?.active === true ? watch.view.seq : 0, stop.signal)
      if (stop.signal.aborted) break
      // An answer with no picture means nothing changed: the one on screen still stands.
      const before = watch.view
      watch.view =
        view.active && view.shot === undefined && before?.shot !== undefined
          ? { ...view, shot: before.shot }
          : view
      tell(watch)
      if (view.active) idle = IDLE_MS
      else wait = idle
    } catch {
      if (stop.signal.aborted) break
      wait = idle
    }
    if (wait === idle) idle = Math.min(idle * 2, LONGEST_IDLE_MS)
    await rest(wait, stop.signal)
  }
}

const keyOf = (agentId: string, computerId: string, what: UseWhat) =>
  `${agentId}\n${computerId}\n${what}`

/**
 * How a computer's screen, or the browser on it, looks now. Asked for only while `on`: the
 * caller says whether what it draws can be seen.
 */
export function useLiveView(
  agentId: string,
  computerId: string | undefined,
  what: UseWhat,
  on: boolean,
): LiveView | undefined {
  const key = computerId === undefined ? undefined : keyOf(agentId, computerId, what)
  useEffect(() => {
    if (key === undefined || computerId === undefined || !on) return
    const watch = watchOf(key)
    watch.watchers += 1
    if (watch.watchers === 1) void run(watch, agentId, computerId, what)
    return () => {
      watch.watchers -= 1
      if (watch.watchers === 0) watch.stop?.abort()
    }
  }, [key, agentId, computerId, what, on])
  return useSyncExternalStore(
    (changed) => {
      if (key === undefined) return () => {}
      const { listeners } = watchOf(key)
      listeners.add(changed)
      return () => listeners.delete(changed)
    },
    () => (key === undefined ? undefined : watches.get(key)?.view),
  )
}

/** Pauses the agent there, or lets it carry on. Shown at once, and put right by the next answer. */
export async function holdUse(agentId: string, computerId: string, what: UseWhat, held: boolean) {
  const watch = watchOf(keyOf(agentId, computerId, what))
  if (watch.view !== undefined) {
    watch.view = { ...watch.view, held }
    tell(watch)
  }
  await client.agent(agentId).hold(computerId, what, held)
}

/** Forgets what was last seen there, once the agent has been stopped: it is not using it any more. */
export function endUse(agentId: string, computerId: string, what: UseWhat) {
  const watch = watchOf(keyOf(agentId, computerId, what))
  if (watch.view === undefined) return
  watch.view = { active: false, seq: watch.view.seq }
  tell(watch)
}

/** Forgets that nobody was using it, when the agent has done something there since: it is asked about afresh. */
export function askAgain(agentId: string, computerId: string, what: UseWhat) {
  const watch = watchOf(keyOf(agentId, computerId, what))
  if (watch.view === undefined || watch.view.active) return
  watch.view = undefined
  tell(watch)
}
