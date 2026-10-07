import type { ComputerChoices } from "@durable-computer/agent"
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
  /** OpenRouter model id that reads web search results. Default: the default model. */
  readonly searchModel: string | undefined
  /** OpenRouter model id that judges whether an agent meant to stop. Default: a small one. */
  readonly judgeModel: string | undefined
  readonly googleClientId: string | undefined
  readonly googleClientSecret: string | undefined
  readonly githubClientId: string | undefined
  readonly githubClientSecret: string | undefined
  /** `open`, or `invite` to require an allowlisted email. Default `invite`. */
  readonly signup: "open" | "invite"
  /** Comma-separated emails allowed to sign up when `signup` is `invite`. */
  readonly allowedEmails: readonly string[]
  /** What kind of computer a new agent gets. Default `just-bash`. */
  readonly sandbox: SandboxKind
  /** The kinds an agent can be given. Undefined: every kind that has what it needs. */
  readonly sandboxKinds: readonly SandboxKind[] | undefined
  /** Whether agents' computers can reach the internet. Default true. */
  readonly sandboxNetwork: boolean
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
  /** Connectors and skill installs may reach this machine and private networks. */
  readonly allowPrivateHosts: boolean
  /** OpenRouter speech-to-text model used for dictation. */
  readonly transcriptionModel: string
  /** For sending invitations by email, through Resend. Without both, invitations are links only. */
  readonly email: {
    readonly resendApiKey: string | undefined
    /** The address mail is sent from, for example `Do Computer <hello@example.com>`. */
    readonly from: string | undefined
  }
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
  /** One actor per team, holding its members' connections and where each of them is. */
  readonly presence: ActorNamespace
  /** One actor per workspace, keeping the library its agents share. Named by the workspace's id. */
  readonly libraries: ActorNamespace
  /** The kinds of machine there are, and how one is reached: to learn its home, and to delete it. */
  readonly machines: ComputerChoices
}

function sandboxKind(value: string | undefined, saying = "DC_SANDBOX is"): SandboxKind {
  if (value === undefined) return "just-bash"
  // A typo here must not quietly give agents a different computer than the one asked for.
  if (!(SANDBOX_KINDS as readonly string[]).includes(value)) {
    throw new ConfigError(`${saying} "${value}". It must be one of: ${SANDBOX_KINDS.join(", ")}.`)
  }
  return value as SandboxKind
}

function sandboxKinds(value: string | undefined): readonly SandboxKind[] | undefined {
  const names = (value ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
  return names.length === 0
    ? undefined
    : names.map((name) => sandboxKind(name, "DC_SANDBOX_KINDS includes"))
}

export function readConfig(env: Record<string, string | undefined>): Config {
  const optional = (name: string) => (env[name] === "" ? undefined : env[name])
  return {
    baseUrl: optional("DC_BASE_URL"),
    authSecret: optional("DC_AUTH_SECRET"),
    openrouterApiKey: optional("OPENROUTER_API_KEY"),
    defaultModel: optional("DC_DEFAULT_MODEL"),
    searchModel: optional("DC_SEARCH_MODEL"),
    judgeModel: optional("DC_JUDGE_MODEL"),
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
    sandboxKinds: sandboxKinds(optional("DC_SANDBOX_KINDS")),
    sandboxNetwork: !["off", "0", "false", "none"].includes(
      (optional("DC_SANDBOX_NETWORK") ?? "on").toLowerCase(),
    ),
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
    allowPrivateHosts: env.DC_ALLOW_PRIVATE_HOSTS === "1",
    transcriptionModel: optional("DC_TRANSCRIPTION_MODEL") ?? "openai/whisper-large-v3",
    email: { resendApiKey: optional("RESEND_API_KEY"), from: optional("DC_EMAIL_FROM") },
  }
}
