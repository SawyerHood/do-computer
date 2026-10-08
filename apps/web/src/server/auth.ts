import { getPlatform } from "#platform"
import { expo } from "@better-auth/expo"
import { betterAuth, type BetterAuthOptions } from "better-auth"
import { getMigrations } from "better-auth/db/migration"
import { tanstackStartCookies } from "better-auth/tanstack-start"
import type { Platform } from "./platform.ts"
import { migrateAppDatabase, readMeta, writeMeta } from "./schema.ts"
import { isInvited } from "./teams.ts"

/**
 * Names the auth tables this build expects. Bump it when the Better Auth version or its plugins
 * change, so the next start runs Better Auth's migrations again.
 */
const AUTH_SCHEMA = "better-auth-1.7:email-password,social"
const AUTH_SCHEMA_KEY = "auth_schema"
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
    emailAndPassword: { enabled: true, minPasswordLength: 8 },
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
        if (source.action !== "create-user" || config.signup === "open") return
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
    // The mobile app signs in from its own URL scheme and keeps the session cookie itself.
    trustedOrigins: [`${MOBILE_SCHEME}://`],
    // tanstackStartCookies must stay last: it turns the Set-Cookie headers of server-side calls
    // into response cookies.
    plugins: [expo(), tanstackStartCookies()],
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
}

/** The signed-in user of a request, or undefined. */
export async function getUser(request: Request): Promise<SessionUser | undefined> {
  const auth = await getAuth()
  const session = await auth.api.getSession({ headers: request.headers })
  return session?.user
}

/** Sign-in options this deployment offers, for the login page. */
export function authMethods() {
  const { config } = getPlatform()
  return {
    google: Boolean(config.googleClientId && config.googleClientSecret),
    github: Boolean(config.githubClientId && config.githubClientSecret),
    signup: config.signup,
  }
}
