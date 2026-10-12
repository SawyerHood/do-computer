import type { BetterAuthPlugin } from "better-auth"
import { createAuthEndpoint, sessionMiddleware } from "better-auth/api"
import { setSessionCookie } from "better-auth/cookies"
import { generateRandomString } from "better-auth/crypto"

/**
 * Signing in to the desktop app through the owner's own browser.
 *
 * The app's window has a cookie jar of its own, and the browser is where its owner is signed in
 * already. So the browser, signed in, asks for a token, and passes it to the app on this
 * computer; the app's window gives it back and is signed in as the same person. What it gets is
 * a session of its own: signing out of either leaves the other as it was.
 */

/** How long a token can be used for. It is passed from the browser to the app at once. */
export const DESKTOP_TOKEN_SECONDS = 60

/** What is said of a token that is unknown, used already, or too old: they look the same. */
export const DESKTOP_TOKEN_REFUSED =
  "That sign-in has run out or was used already. Start again from the Do Computer app."

/**
 * What a token is kept under. The token itself is never kept: whoever can read the table
 * cannot sign in with what is there.
 */
async function identifier(token: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
  return `desktop-sign-in:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`
}

type Issue = { message: string }

/**
 * The body of the exchange, checked by hand: Better Auth takes any Standard Schema, and its own
 * validation library is not one this package can import.
 */
const tokenBody = {
  "~standard": {
    version: 1 as const,
    vendor: "do-computer",
    validate: (value: unknown): { value: { token: string } } | { issues: Issue[] } => {
      const token = (value as { token?: unknown } | null)?.token
      if (typeof token !== "string" || token === "" || token.length > 256) {
        return { issues: [{ message: "A token is needed." }] }
      }
      return { value: { token } }
    },
    types: undefined as unknown as { input: { token: string }; output: { token: string } },
  },
}

export const desktopHandoff = () =>
  ({
    id: "desktop-handoff",
    endpoints: {
      /** POST `/desktop/token`: a token for whoever is signed in, to pass to the desktop app. */
      desktopToken: createAuthEndpoint(
        "/desktop/token",
        { method: "POST", use: [sessionMiddleware] },
        async (ctx) => {
          const token = generateRandomString(32)
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: await identifier(token),
            value: ctx.context.session.user.id,
            expiresAt: new Date(Date.now() + DESKTOP_TOKEN_SECONDS * 1000),
          })
          return ctx.json({ token })
        },
      ),
      /** POST `/desktop/session`: a new session for the person a token was made for. */
      desktopSession: createAuthEndpoint(
        "/desktop/session",
        { method: "POST", body: tokenBody },
        async (ctx) => {
          // Taken out of the table before anything is done with it, in the one statement, so of
          // two requests with the same token one finds nothing. Better Auth's own way of doing
          // this waits on a promise it keeps between requests, which on Workers may never
          // settle: see `auth-guard.ts`.
          const kept = await ctx.context.adapter.consumeOne<{ value: string; expiresAt: Date }>({
            model: "verification",
            where: [{ field: "identifier", value: await identifier(ctx.body.token) }],
          })
          if (kept === null || new Date(kept.expiresAt) < new Date()) {
            throw ctx.error("BAD_REQUEST", { message: DESKTOP_TOKEN_REFUSED })
          }
          const user = await ctx.context.internalAdapter.findUserById(kept.value)
          if (user === null) throw ctx.error("BAD_REQUEST", { message: DESKTOP_TOKEN_REFUSED })
          // A session of the app's own, and not the browser's: each is signed out by itself.
          const session = await ctx.context.internalAdapter.createSession(user.id)
          await setSessionCookie(ctx, { session, user })
          return ctx.json({ ok: true })
        },
      ),
    },
  }) satisfies BetterAuthPlugin
