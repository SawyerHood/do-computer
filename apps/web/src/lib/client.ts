import { type Attention, createClient } from "@durable-computer/client"

/**
 * Whether this tab is showing. A window that is hidden or minimized is not; one that is only
 * behind another is, as far as a browser says.
 */
const attention: Attention = {
  here: () => typeof document === "undefined" || document.visibilityState === "visible",
  watch(changed) {
    if (typeof document === "undefined") return () => {}
    document.addEventListener("visibilitychange", changed)
    return () => document.removeEventListener("visibilitychange", changed)
  },
}

/**
 * Same-origin API client; the session cookie rides along. Agents are followed over WebSockets,
 * which a browser sends the session with too.
 */
export const client = createClient({ baseUrl: "", attention, sockets: true })

/** How long a page waits for the server before it says that the server has not answered. */
const PATIENCE_MS = 15_000

/**
 * A signal that gives up after a while, for what a page waits on before it shows anything. A
 * request that is never answered would otherwise leave the page on its placeholders for good,
 * with nothing to say that it had failed and no way to ask again.
 */
export function patience(ms = PATIENCE_MS): AbortSignal {
  const controller = new AbortController()
  setTimeout(() => controller.abort(new Error("The server took too long to answer.")), ms)
  return controller.signal
}
