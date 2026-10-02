import type { ActorNamespace, AppDatabase } from "@durable-computer/runtime"

/** Deployment settings, read from the environment of whichever runtime hosts the app. */
export type Config = {
  /** Public origin of the app, for example https://agent.example.com. */
  readonly baseUrl: string | undefined
  /** Signs sessions. Required outside development. */
  readonly authSecret: string | undefined
  readonly openrouterApiKey: string | undefined
  /** OpenRouter model id new agents use. */
  readonly defaultModel: string | undefined
  readonly googleClientId: string | undefined
  readonly googleClientSecret: string | undefined
  readonly githubClientId: string | undefined
  readonly githubClientSecret: string | undefined
  /** `open`, or `invite` to require an allowlisted email. Default `invite`. */
  readonly signup: "open" | "invite"
  /** Comma-separated emails allowed to sign up when `signup` is `invite`. */
  readonly allowedEmails: readonly string[]
  /** What kind of computer agents get. Default `just-bash`. */
  readonly sandbox: "just-bash" | "none"
}

/** Everything the server code needs from its runtime. One implementation per target. */
export type Platform = {
  readonly target: "node" | "cloudflare"
  readonly config: Config
  /** Accounts, agents and sessions. */
  readonly db: AppDatabase
  /** The native handle Better Auth's database adapter takes: a D1 binding or a `DatabaseSync`. */
  readonly authDatabase: unknown
  /** One actor per agent. */
  readonly agents: ActorNamespace
  /** One actor per paired computer, holding its daemon's connection. */
  readonly computers: ActorNamespace
}

export function readConfig(env: Record<string, string | undefined>): Config {
  const optional = (name: string) => (env[name] === "" ? undefined : env[name])
  return {
    baseUrl: optional("DC_BASE_URL"),
    authSecret: optional("DC_AUTH_SECRET"),
    openrouterApiKey: optional("OPENROUTER_API_KEY"),
    defaultModel: optional("DC_DEFAULT_MODEL"),
    googleClientId: optional("GOOGLE_CLIENT_ID"),
    googleClientSecret: optional("GOOGLE_CLIENT_SECRET"),
    githubClientId: optional("GITHUB_CLIENT_ID"),
    githubClientSecret: optional("GITHUB_CLIENT_SECRET"),
    signup: env.DC_SIGNUP === "open" ? "open" : "invite",
    allowedEmails: (env.DC_ALLOWED_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
    sandbox: env.DC_SANDBOX === "none" ? "none" : "just-bash",
  }
}
