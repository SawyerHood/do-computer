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
  readonly sandbox: SandboxKind
  readonly daytona: {
    readonly apiKey: string | undefined
    readonly apiUrl: string | undefined
    readonly target: string | undefined
    readonly snapshot: string | undefined
    readonly image: string | undefined
  }
  readonly modal: {
    readonly tokenId: string | undefined
    readonly tokenSecret: string | undefined
    readonly app: string | undefined
    readonly image: string | undefined
    readonly environment: string | undefined
  }
  readonly cloudflare: {
    /** `cloudflare/debian-trixie`, or an image named in the Wrangler configuration. */
    readonly image: string | undefined
    readonly instance: string | undefined
  }
  /** Connectors may reach this machine and private networks. */
  readonly connectorsAllowPrivate: boolean
  /** OpenRouter speech-to-text model used for dictation. */
  readonly transcriptionModel: string
}

export const SANDBOX_KINDS = ["just-bash", "none", "daytona", "modal", "cloudflare"] as const
export type SandboxKind = (typeof SANDBOX_KINDS)[number]

/** A setting that is wrong in a way the deployment's owner has to fix. */
export class ConfigError extends Error {}

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

function sandboxKind(value: string | undefined): SandboxKind {
  if (value === undefined) return "just-bash"
  // A typo here must not quietly give agents a different computer than the one asked for.
  if (!(SANDBOX_KINDS as readonly string[]).includes(value)) {
    throw new ConfigError(
      `DC_SANDBOX is "${value}". It must be one of: ${SANDBOX_KINDS.join(", ")}.`,
    )
  }
  return value as SandboxKind
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
    sandbox: sandboxKind(optional("DC_SANDBOX")),
    daytona: {
      apiKey: optional("DAYTONA_API_KEY"),
      apiUrl: optional("DAYTONA_API_URL"),
      target: optional("DAYTONA_TARGET"),
      snapshot: optional("DC_DAYTONA_SNAPSHOT"),
      image: optional("DC_DAYTONA_IMAGE"),
    },
    modal: {
      tokenId: optional("MODAL_TOKEN_ID"),
      tokenSecret: optional("MODAL_TOKEN_SECRET"),
      app: optional("DC_MODAL_APP"),
      image: optional("DC_MODAL_IMAGE"),
      environment: optional("MODAL_ENVIRONMENT"),
    },
    cloudflare: {
      image: optional("DC_CLOUDFLARE_IMAGE"),
      instance: optional("DC_CLOUDFLARE_INSTANCE"),
    },
    connectorsAllowPrivate: env.DC_CONNECTORS_ALLOW_PRIVATE === "1",
    transcriptionModel: optional("DC_TRANSCRIPTION_MODEL") ?? "openai/whisper-large-v3",
  }
}
