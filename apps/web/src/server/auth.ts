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

let ready: Promise<Auth> | undefined

/** The auth instance, with the app and auth tables migrated. Memoized per process or isolate. */
export function getAuth(): Promise<Auth> {
  ready ??= (async () => {
    const platform = getPlatform()
    await migrateAppDatabase(platform.db)
    const options = authOptions(platform)
    // Migrate before building the instance, which checks for its tables as it starts.
    if ((await readMeta(platform.db, AUTH_SCHEMA_KEY)) !== AUTH_SCHEMA) {
      const { runMigrations } = await getMigrations(options)
      await runMigrations()
      await writeMeta(platform.db, AUTH_SCHEMA_KEY, AUTH_SCHEMA)
    }
    return betterAuth(options)
  })()
  ready.catch(() => {
    ready = undefined
  })
  return ready
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
