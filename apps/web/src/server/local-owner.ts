import type { BetterAuthPlugin } from "better-auth"
import { createAuthEndpoint } from "better-auth/api"
import { setSessionCookie } from "better-auth/cookies"
import { generateRandomString } from "better-auth/crypto"
import { handoffIdentifier } from "./desktop-handoff.ts"
import { LOCAL_OWNER_EMAIL } from "./platform.ts"

/**
 * The owner of a server the Do Computer desktop app runs itself, on their own computer.
 *
 * Such a server is for one person, who never made an account: the app starts it, and the app is
 * who says its owner is here. It does so with a secret it made and gave the server as it started
 * it (`DC_OWNER_KEY`), which nothing else has. With it the app signs its own window in, and asks
 * for a token that signs another of its owner's devices in, once.
 *
 * A server that was given no such secret answers none of this.
 */

/** How the owner's account says it was made, to whatever decides who may have one. */
export const LOCAL_OWNER_METHOD = "local-owner"

/** How long another device has to use the token it was shown: as long as it takes to pick it up. */
export const DEVICE_TOKEN_SECONDS = 10 * 60

/** What is said to whoever does not have the secret, and where there is none to have. */
export const OWNER_REFUSED = "Only the Do Computer app that runs this server can ask that."

/** What is said when the window is to be signed in and nobody has said who its owner is yet. */
export const NO_OWNER_YET = "Nobody has said who they are here yet."

/** The longest a name can be. It is what the owner's Doods call them. */
const MAX_NAME = 80

/** Whether two secrets are the same, taking as long to say no wherever they first differ. */
async function same(given: string, kept: string): Promise<boolean> {
  const digest = async (text: string) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))
  const [a, b] = await Promise.all([digest(given), digest(kept)])
  let differs = 0
  for (let at = 0; at < a.length; at++) differs |= a[at]! ^ b[at]!
  return differs === 0
}

type Issue = { message: string }
type Asked = { key: string; name?: string }

/** The body of both questions, checked by hand: see `tokenBody` in desktop-handoff.ts. */
const keyBody = {
  "~standard": {
    version: 1 as const,
    vendor: "do-computer",
    validate: (value: unknown): { value: Asked } | { issues: Issue[] } => {
      const { key, name } = (value ?? {}) as { key?: unknown; name?: unknown }
      if (typeof key !== "string" || key === "" || key.length > 256) {
        return { issues: [{ message: "A key is needed." }] }
      }
      if (name !== undefined && typeof name !== "string") {
        return { issues: [{ message: "A name is words." }] }
      }
      const called = name?.trim().slice(0, MAX_NAME)
      return { value: { key, ...(called ? { name: called } : {}) } }
    },
    types: undefined as unknown as { input: Asked; output: Asked },
  },
}

export const localOwner = (ownerKey: string | undefined) =>
  ({
    id: "local-owner",
    endpoints: {
      /**
       * POST `/local/session`: a session for the owner, for the app's own window. With a name,
       * the first time, that is who the owner is from then on. Without one, and before anyone
       * has said, there is nobody to sign in.
       */
      localSession: createAuthEndpoint(
        "/local/session",
        { method: "POST", body: keyBody },
        async (ctx) => {
          if (ownerKey === undefined || !(await same(ctx.body.key, ownerKey))) {
            throw ctx.error("FORBIDDEN", { message: OWNER_REFUSED })
          }
          const found = await ctx.context.internalAdapter.findUserByEmail(LOCAL_OWNER_EMAIL)
          let user = found?.user
          if (user === undefined) {
            if (ctx.body.name === undefined) throw ctx.error("NOT_FOUND", { message: NO_OWNER_YET })
            user = await ctx.context.internalAdapter.createUser(
              {
                email: LOCAL_OWNER_EMAIL,
                name: ctx.body.name,
                // Nobody else can have made it: the address is not one mail reaches.
                emailVerified: true,
              },
              { method: LOCAL_OWNER_METHOD },
            )
          }
          const session = await ctx.context.internalAdapter.createSession(user.id)
          await setSessionCookie(ctx, { session, user })
          return ctx.json({ ok: true, name: user.name })
        },
      ),
      /**
       * POST `/local/token`: a token that signs one other device in as the owner, exchanged at
       * `/desktop/session` as the app's own is. The app shows it as a link to scan.
       */
      localToken: createAuthEndpoint(
        "/local/token",
        { method: "POST", body: keyBody },
        async (ctx) => {
          if (ownerKey === undefined || !(await same(ctx.body.key, ownerKey))) {
            throw ctx.error("FORBIDDEN", { message: OWNER_REFUSED })
          }
          const found = await ctx.context.internalAdapter.findUserByEmail(LOCAL_OWNER_EMAIL)
          if (found === null) throw ctx.error("NOT_FOUND", { message: NO_OWNER_YET })
          const token = generateRandomString(32)
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: await handoffIdentifier(token),
            value: found.user.id,
            expiresAt: new Date(Date.now() + DEVICE_TOKEN_SECONDS * 1000),
          })
          return ctx.json({ token, seconds: DEVICE_TOKEN_SECONDS })
        },
      ),
    },
  }) satisfies BetterAuthPlugin
