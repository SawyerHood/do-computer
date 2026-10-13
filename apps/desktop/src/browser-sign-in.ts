/**
 * What the owner's own browser brings back to the app. The app listens on this computer alone,
 * at a port the system picks, and sends the browser away knowing that port and a word only
 * the two of them know. Whoever the browser was sent to ends by sending it back here with that
 * word and what the app wanted.
 *
 * Signing in: the browser goes to the deployment, and comes back with a token. A connector's
 * sign-in: the browser goes to the connector's service, the deployment passes the service's
 * answer on to this computer, and the app takes it to the deployment in its own session.
 *
 * Nothing here knows of Electron, so that the tests can ask it things as a browser would.
 */
import { randomBytes, timingSafeEqual } from "node:crypto"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { CONNECTOR_RETURN_PATH } from "@do-computer/protocol"
import { MARK } from "./mark.ts"

type Failed = { error: string }
export type BrowserAnswer = { token: string } | Failed
/** What a service said of a connector's sign-in: the query it sent the browser back with. */
export type ConnectAnswer = { query: string } | Failed

/** How long a browser has to come back. Signing up somewhere can take a while. */
export const SIGN_IN_TIMEOUT_MS = 10 * 60_000
/** How long a service has to send the browser back: as long as the deployment keeps the sign-in. */
export const CONNECT_TIMEOUT_MS = 15 * 60_000
/** A token longer than this is not one the deployment made. */
const MAX_TOKEN = 512

const CANCELLED = "Signing in was cancelled."
const NOBODY = "Nobody signed in in the browser. Try again."
const NO_BROWSER = "Your browser could not be opened. Try again."

// The app's colours, as in pages/pages.css. The page is whole in itself: a browser showing it
// asks nobody for anything.
const page = (heading: string, words: string) => `<!doctype html>
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
svg { width: 64px; height: 64px; }
h1 { margin: 14px 0 6px; font-size: 22px; font-weight: 600; letter-spacing: -0.01em; }
p { margin: 0; color: color-mix(in oklch, var(--ink) 62%, var(--canvas)); }
</style>
</head>
<body>
<main>
${MARK}
<h1>${heading}</h1>
<p>${words}</p>
</main>
</body>
</html>
`

const SIGNED_IN = page("You are signed in.", "You can close this tab and go back to Do Computer.")
const CONNECTING = page(
  "Back to Do Computer.",
  "The rest happens in the app. You can close this tab.",
)

const same = (a: string, b: string) => {
  const [x, y] = [Buffer.from(a), Buffer.from(b)]
  return x.length === y.length && timingSafeEqual(x, y)
}

/** The token a browser brought, if it is the one that was sent, coming back as it was sent. */
function tokenOf(url: URL, state: string): { token: string } | undefined {
  if (url.pathname !== "/done") return undefined
  if (!same(url.searchParams.get("state") ?? "", state)) return undefined
  const token = url.searchParams.get("token") ?? ""
  return token !== "" && token.length <= MAX_TOKEN ? { token } : undefined
}

function listening(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    // This computer only: nothing else on the network can reach it.
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port))
  })
}

/**
 * One wait at a time for the browser to come back. `wait` is given what reads the thing the
 * app wants out of the address a browser came to, or nothing where it is not the browser that
 * was sent, and what opens the browser, which is told the port. It resolves with what was
 * read, or with why there is nothing, in words to show. Waiting again, or `cancel`, ends the
 * wait there was.
 */
function browserReturn(options: { timeoutMs: number; page: string }) {
  /** Ends the wait there is, if there is one. */
  let end: ((answer: Failed) => void) | undefined

  async function wait<Got extends object>(
    read: (url: URL) => Got | undefined,
    open: (port: number) => unknown,
  ): Promise<Got | Failed> {
    end?.({ error: CANCELLED })
    const server = createServer()
    let timer: ReturnType<typeof setTimeout> | undefined
    const answer = new Promise<Got | Failed>((resolve) => {
      const mine = (said: Got | Failed) => {
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
        let got: Got | undefined
        try {
          if (request.method === "GET") got = read(new URL(request.url ?? "", "http://127.0.0.1"))
        } catch {
          // An address that is none brought nothing.
        }
        // What it brought is the only thing a browser that came back has to say. Nothing keeps it.
        const headers = { "cache-control": "no-store", connection: "close" }
        if (got === undefined || end !== mine) {
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
        const brought = got
        response.end(options.page, () => mine(brought))
      })
    })
    const mine = end!
    try {
      const port = await listening(server)
      // Cancelled while the port was being found: there is nobody to open a browser for.
      if (end !== mine) return answer
      timer = setTimeout(() => mine({ error: NOBODY }), options.timeoutMs)
      await open(port)
    } catch {
      mine({ error: NO_BROWSER })
    }
    return answer
  }

  return {
    wait,
    /** Stop waiting. The wait there was resolves with an error. */
    cancel: () => end?.({ error: CANCELLED }),
  }
}

/**
 * Signing in through the browser, one sign-in at a time. `signIn` is given what opens the
 * browser, told the port and the word to send it with, and resolves with the token the browser
 * came back with, or with why there is none.
 */
export function browserSignIn(options: { timeoutMs?: number } = {}) {
  const browser = browserReturn({
    timeoutMs: options.timeoutMs ?? SIGN_IN_TIMEOUT_MS,
    page: SIGNED_IN,
  })
  return {
    signIn(open: (to: { port: number; state: string }) => unknown): Promise<BrowserAnswer> {
      const state = randomBytes(32).toString("base64url")
      return browser.wait(
        (url) => tokenOf(url, state),
        (port) => open({ port, state }),
      )
    },
    /** Stop waiting. The sign-in that was waiting resolves with an error. */
    cancel: browser.cancel,
  }
}

/**
 * A connector's sign-in in the browser, one at a time. The word is the sign-in's own `state`,
 * which the service sends back and nobody else knows. `connect` is given what tells the
 * deployment the port and opens the browser, and resolves with the query the service sent the
 * browser back with, whether it agreed or refused, or with why nothing came.
 */
export function browserConnect(options: { timeoutMs?: number } = {}) {
  const browser = browserReturn({
    timeoutMs: options.timeoutMs ?? CONNECT_TIMEOUT_MS,
    page: CONNECTING,
  })
  return {
    connect(state: string, open: (port: number) => unknown): Promise<ConnectAnswer> {
      return browser.wait(
        (url) =>
          url.pathname === CONNECTOR_RETURN_PATH && same(url.searchParams.get("state") ?? "", state)
            ? { query: url.search }
            : undefined,
        open,
      )
    },
    cancel: browser.cancel,
  }
}
