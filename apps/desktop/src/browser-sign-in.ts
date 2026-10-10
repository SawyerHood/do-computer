/**
 * Signing in through the owner's own browser. The app listens on this computer alone, at a
 * port the system picks, and sends the browser to the deployment with that port and a word
 * only the two of them know. The deployment's page ends by sending the browser back here with
 * that word and a token, which is all the app wanted.
 *
 * Nothing here knows of Electron, so that the tests can ask it things as a browser would.
 */
import { randomBytes, timingSafeEqual } from "node:crypto"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"

export type BrowserAnswer = { token: string } | { error: string }

/** How long a browser has to come back. Signing up somewhere can take a while. */
export const SIGN_IN_TIMEOUT_MS = 10 * 60_000
/** A token longer than this is not one the deployment made. */
const MAX_TOKEN = 512

const CANCELLED = "Signing in was cancelled."
const NOBODY = "Nobody signed in in the browser. Try again."
const NO_BROWSER = "Your browser could not be opened. Try again."

// The app's colours, as in pages/pages.css. The page is whole in itself: a browser showing it
// asks nobody for anything.
const DONE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Do Computer</title>
<style>
:root { color-scheme: light dark; --canvas: oklch(0.985 0.003 212); --ink: oklch(0.27 0.008 212); --teal: oklch(0.5 0.08 195); }
@media (prefers-color-scheme: dark) {
  :root { --canvas: oklch(0.19 0.005 212); --ink: oklch(0.93 0.005 212); --teal: oklch(0.64 0.09 195); }
}
html, body { height: 100%; }
body { margin: 0; display: grid; place-items: center; background: var(--canvas); color: var(--ink); font: 15px/1.5 Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
main { max-width: 26em; padding: 28px; text-align: center; }
svg { width: 56px; height: 56px; }
h1 { margin: 14px 0 6px; font-size: 22px; font-weight: 600; letter-spacing: -0.01em; }
p { margin: 0; color: color-mix(in oklch, var(--ink) 62%, var(--canvas)); }
</style>
</head>
<body>
<main>
<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#242829"/><ellipse cx="32" cy="37" rx="20" ry="16" fill="#3b9d9d"/><circle cx="25" cy="35" r="2.6" fill="#1b2021"/><circle cx="39" cy="35" r="2.6" fill="#1b2021"/><path d="M27.5 42c2.6 2.4 6.4 2.4 9 0" fill="none" stroke="#1b2021" stroke-width="1.8" stroke-linecap="round"/></svg>
<h1>You are signed in.</h1>
<p>You can close this tab and go back to Do Computer.</p>
</main>
</body>
</html>
`

const same = (a: string, b: string) => {
  const [x, y] = [Buffer.from(a), Buffer.from(b)]
  return x.length === y.length && timingSafeEqual(x, y)
}

/** The token a request brought, if it is the browser coming back as it was sent. */
function tokenOf(method: string | undefined, address: string | undefined, state: string) {
  if (method !== "GET" || address === undefined) return undefined
  let url: URL
  try {
    url = new URL(address, "http://127.0.0.1")
  } catch {
    return undefined
  }
  if (url.pathname !== "/done") return undefined
  if (!same(url.searchParams.get("state") ?? "", state)) return undefined
  const token = url.searchParams.get("token") ?? ""
  return token !== "" && token.length <= MAX_TOKEN ? token : undefined
}

function listening(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    // This computer only: nothing else on the network can reach it.
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port))
  })
}

/**
 * One sign-in at a time. `signIn` is given what opens the browser, told the port and the word
 * to send it with, and resolves with the token the browser came back with, or with why there
 * is none, in words to show. Asking again, or `cancel`, ends the one that was waiting.
 */
export function browserSignIn(options: { timeoutMs?: number } = {}) {
  const timeoutMs = options.timeoutMs ?? SIGN_IN_TIMEOUT_MS
  /** Ends the sign-in that is waiting, if one is. */
  let end: ((answer: BrowserAnswer) => void) | undefined

  async function signIn(
    open: (to: { port: number; state: string }) => unknown,
  ): Promise<BrowserAnswer> {
    end?.({ error: CANCELLED })
    const state = randomBytes(32).toString("base64url")
    const server = createServer()
    let timer: ReturnType<typeof setTimeout> | undefined
    const answer = new Promise<BrowserAnswer>((resolve) => {
      const mine = (said: BrowserAnswer) => {
        if (end !== mine) return
        end = undefined
        clearTimeout(timer)
        server.close()
        // A browser keeps what it asked over open, and a listener with one open is not closed.
        server.closeAllConnections()
        resolve(said)
      }
      end = mine
      server.on("request", (request, response) => {
        const token = tokenOf(request.method, request.url, state)
        // The token is the only thing a browser that came back has to say. Nothing keeps it.
        const headers = { "cache-control": "no-store", connection: "close" }
        if (token === undefined || end !== mine) {
          response.writeHead(404, { ...headers, "content-type": "text/plain; charset=utf-8" })
          return response.end("Not found.\n")
        }
        response.writeHead(200, {
          ...headers,
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
          "referrer-policy": "no-referrer",
        })
        // Closed once the browser has its page, so that the tab does not show a failure.
        response.end(DONE, () => mine({ token }))
      })
    })
    const mine = end!
    try {
      const port = await listening(server)
      // Cancelled while the port was being found: there is nobody to open a browser for.
      if (end !== mine) return answer
      timer = setTimeout(() => mine({ error: NOBODY }), timeoutMs)
      await open({ port, state })
    } catch {
      mine({ error: NO_BROWSER })
    }
    return answer
  }

  return {
    signIn,
    /** Stop waiting. The sign-in that was waiting resolves with an error. */
    cancel: () => end?.({ error: CANCELLED }),
  }
}
