import { getPlatform } from "#platform"
import { expo } from "@better-auth/expo"
import { betterAuth, type BetterAuthOptions } from "better-auth"
import { getMigrations } from "better-auth/db/migration"
import { tanstackStartCookies } from "better-auth/tanstack-start"
import { askTwice, NO_SHARED_SCHEMA_CHECK, seedAuthStores } from "./auth-guard.ts"
import { desktopHandoff } from "./desktop-handoff.ts"
import type { Platform } from "./platform.ts"
import { migrateAppDatabase, readMeta, writeMeta } from "./schema.ts"
import { isInvited } from "./teams.ts"
import { isWaiting, waitlistSince } from "./waitlist.ts"

// Before anything of Better Auth's is called: see the function.
seedAuthStores()

/**
 * Names the auth tables this build expects. Bump it when the Better Auth version or its plugins
 * change, so the next start runs Better Auth's migrations again.
 */
const AUTH_SCHEMA = "better-auth-1.7:email-password,social"
const AUTH_SCHEMA_KEY = "auth_schema"
/** How long a request is answered from the cookie that says who is signed in. */
const SESSION_CACHE_SECONDS = 5 * 60
/** URL scheme of the mobile app; must match `scheme` in apps/mobile/app.json. */
export const MOBILE_SCHEME = "durablecomputer"

function authOptions(platform: Platform) {
  const { config } = platform
  if (config.authSecret === undefined) {
    throw new Error("DC_AUTH_SECRET is not set. Generate one with: openssl rand -base64 32")
  }
  return {
    appName: "Do Computer",
    baseURL: config.baseUrl,
    secret: config.authSecret,
    // A D1 binding on Cloudflare, a node:sqlite database on Node; both are SQLite dialects.
    database: platform.authDatabase as never,
    // Turned off, Better Auth refuses both making an account with a password and signing in to
    // one that has it.
    emailAndPassword: { enabled: config.passwordSignIn, minPasswordLength: 8 },
    // Who is signed in is kept in a signed cookie for this long, and a request that brings it
    // is answered from it. Without it every request reads the session and its user from the
    // database, which was most of what the database was read for by people. The price is that
    // a session ended elsewhere, or a changed name, is believed for up to this long.
    session: { cookieCache: { enabled: true, maxAge: SESSION_CACHE_SECONDS } },
    socialProviders: {
      ...(config.googleClientId && config.googleClientSecret
        ? { google: { clientId: config.googleClientId, clientSecret: config.googleClientSecret } }
        : {}),
      ...(config.githubClientId && config.githubClientSecret
        ? { github: { clientId: config.githubClientId, clientSecret: config.githubClientSecret } }
        : {}),
    },
    user: {
      validateUserInfo: async ({
        user,
        source,
      }: {
        user: Record<string, unknown>
        source: {
          action: string
          oauth?: { providerId: string; profile?: Record<string, unknown> }
        }
      }) => {
        // With a waiting list anyone may make an account. What it lets them do is another matter.
        if (source.action !== "create-user" || config.signup !== "invite") return
        const email = typeof user.email === "string" ? user.email.toLowerCase() : ""
        if (config.allowedEmails.includes(email)) return
        // The first account on a fresh deployment is its owner and needs no invitation.
        const existing = await platform.db.get<{ id: string }>("SELECT id FROM user LIMIT 1")
        if (existing === undefined) return
        // Someone a team has asked to join is invited, by the address or the GitHub account
        // the team named.
        const githubId =
          source.oauth?.providerId === "github" ? source.oauth.profile?.id : undefined
        if (
          await isInvited(platform.db, {
            email,
            githubId: githubId === undefined ? undefined : String(githubId),
          })
        ) {
          return
        }
        return {
          error: "signup_not_allowed",
          errorDescription: "Sign-up is by invitation on this deployment.",
        }
      },
    },
    // No call waits on another's: see the constant.
    advanced: NO_SHARED_SCHEMA_CHECK,
    // The mobile app signs in from its own URL scheme and keeps the session cookie itself.
    trustedOrigins: [`${MOBILE_SCHEME}://`],
    // tanstackStartCookies must stay last: it turns the Set-Cookie headers of server-side calls
    // into response cookies.
    plugins: [expo(), desktopHandoff(), tanstackStartCookies()],
  } satisfies BetterAuthOptions
}

type Auth = ReturnType<typeof betterAuth<ReturnType<typeof authOptions>>>

let built: Auth | undefined

/** How many times the auth tables are tried when another request is making them too. */
const AUTH_MIGRATION_TRIES = 3

/**
 * Bring Better Auth's tables up to date. Several requests may be doing this at once, each on its
 * own, and one then fails on a table another has just made. What is left to do is worked out
 * again from the tables as they are.
 */
async function migrateAuthTables(platform: Platform, options: ReturnType<typeof authOptions>) {
  for (let tries = 1; ; tries++) {
    if ((await readMeta(platform.db, AUTH_SCHEMA_KEY)) === AUTH_SCHEMA) return
    try {
      const { runMigrations } = await getMigrations(options)
      await runMigrations()
      await writeMeta(platform.db, AUTH_SCHEMA_KEY, AUTH_SCHEMA)
      return
    } catch (error) {
      if (tries >= AUTH_MIGRATION_TRIES) throw error
    }
  }
}

/**
 * The auth instance, with the app and auth tables migrated. Kept per process or isolate once it
 * is built.
 *
 * What is kept is the instance and never the promise of one. On Workers what a request starts
 * belongs to that request: when it ends early, as when a browser goes away, nothing it was
 * waiting for arrives, and a promise it left behind never settles. Every later request in that
 * isolate would wait on it for good. So a request that finds no instance builds its own, and the
 * first to finish is kept.
 */
export async function getAuth(): Promise<Auth> {
  if (built !== undefined) return built
  const platform = getPlatform()
  await migrateAppDatabase(platform.db)
  // From here on an account can be made: with a waiting list, it is one that waits.
  if (platform.config.signup === "waitlist") await waitlistSince(platform.db)
  const options = authOptions(platform)
  // Migrate before building the instance, which checks for its tables as it starts.
  await migrateAuthTables(platform, options)
  const auth = betterAuth(options)
  // It finishes setting itself up after it is returned, which is the same kind of promise.
  await auth.$context
  return (built ??= auth)
}

export type SessionUser = {
  id: string
  email: string
  name: string
  image?: string | null
  /** Whether the address is known to be theirs: a social sign-in vouches for it. */
  emailVerified?: boolean
  /** When the account was made. */
  createdAt?: Date | string | number
}

/** How long who is signed in is waited for. It is answered in milliseconds, or not at all. */
const SESSION_PATIENCE_MS = 5_000

/**
 * Whoever is signed in, whether or not they may use the app yet: someone on the waiting list
 * has an account and a session like anyone. Only for what such a person may do.
 *
 * Every page waits on this, so it is not waited on for good. Better Auth keeps promises of its
 * own, and on Workers one that its first request left behind is never settled (see
 * `seedAuthStores`, which is for the one that was found). Should another be, the instance is
 * let go of and a new one asked, and if that does not answer either the request fails.
 */
export async function getSignedIn(request: Request): Promise<SessionUser | undefined> {
  const session = await askTwice(
    async () => (await getAuth()).api.getSession({ headers: request.headers }),
    {
      ms: SESSION_PATIENCE_MS,
      renew: () => {
        built = undefined
      },
      report: (message) => console.error(`[auth] ${message}`),
    },
  )
  return session?.user
}

/**
 * The signed-in user of a request, if they may use the app; undefined for nobody, and for
 * someone still on the waiting list. This is what everything of the app's asks.
 */
export async function getUser(request: Request): Promise<SessionUser | undefined> {
  const user = await getSignedIn(request)
  return user === undefined || (await isWaiting(user)) ? undefined : user
}

/** Sign-in options this deployment offers, for the login page. */
export function authMethods() {
  const { config } = getPlatform()
  return {
    google: Boolean(config.googleClientId && config.googleClientSecret),
    github: Boolean(config.githubClientId && config.githubClientSecret),
    password: config.passwordSignIn,
    signup: config.signup,
  }
}

/** Whether anyone has an account here yet. Once someone has, someone always does. */
let anyAccount = false

/**
 * What someone who is not signed in is shown first: the ways to sign in, whether `/` is the
 * landing page, and whether anyone at all may make an account. Sign-up by invitation is open
 * to the first person to arrive, who is the deployment's owner, and shut to strangers after.
 */
export async function frontDoor() {
  const platform = getPlatform()
  const { config } = platform
  if (config.signup === "invite" && !anyAccount) {
    anyAccount = await platform.db.get<{ id: string }>("SELECT id FROM user LIMIT 1").then(
      (found) => found !== undefined,
      // No table of accounts yet: nobody has asked to sign in since the deployment was made.
      () => false,
    )
  }
  return {
    ...authMethods(),
    landing: config.landing,
    // With a waiting list a stranger may make an account too, and then waits.
    open: config.signup !== "invite" || !anyAccount,
  }
}
