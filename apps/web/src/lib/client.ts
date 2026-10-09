import { createClient } from "@durable-computer/client"

/** Same-origin API client; the session cookie rides along. */
export const client = createClient({ baseUrl: "" })

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
