/** How a workspace signs in to a model provider: with an account there, or with a key. */
export type ModelLoginType = "oauth" | "api_key"

/** One way of signing in to a model provider. */
export type ModelLoginMethod = {
  type: ModelLoginType
  /** What it is called, such as "Anthropic (Claude Pro/Max)" or "Anthropic API key". */
  label: string
  /** Paid for by a subscription the person has, and not by the token. */
  subscription: boolean
}

/** How a workspace is signed in to a provider. Never the credential itself. */
export type ModelSignIn = {
  type: ModelLoginType
  /** Who signed in, by name and by id, where that is known. */
  by: string | null
  byId: string | null
  at: number
  /** How many models it gives the workspace's agents. */
  models: number
}

/** A service that runs models, and whether a workspace is signed in to it. */
export type ModelProvider = {
  id: string
  name: string
  methods: ModelLoginMethod[]
  signedIn: ModelSignIn | null
}

export type ModelProvidersState = { providers: ModelProvider[] }

/** Something a sign-in asks the person. `select` has options; the others are typed. */
export type ModelLoginPrompt = {
  id: string
  type: "text" | "secret" | "select" | "manual_code"
  message: string
  placeholder?: string
  options?: { id: string; label: string; description?: string }[]
}

/**
 * A sign-in to a model provider that is under way, as the app shows it. A provider leads the
 * person through its own steps, so what there is to show changes as it goes: a page to open, a
 * code to enter there, a question to answer here.
 */
export type ModelLogin = {
  id: string
  /** Goes up each time anything here changes, so a reader can wait for what comes next. */
  rev: number
  providerId: string
  type: ModelLoginType
  status: "waiting" | "done" | "failed" | "cancelled"
  /** What the person is asked now, or null while nothing is. */
  prompt: ModelLoginPrompt | null
  /** A page at the provider to open and sign in on. */
  authUrl: { url: string; instructions?: string } | null
  /** A code to type in at an address of the provider's. */
  deviceCode: { userCode: string; verificationUri: string; expiresAt?: number } | null
  /** What is being done at the moment, in the provider's words. */
  progress: string | null
  /** Things the provider said along the way. */
  notes: { message: string; links?: { url: string; label?: string }[] }[]
  /** Why it failed. */
  error: string | null
}

export type StartModelLoginRequest = { providerId: string; type: ModelLoginType }
export type AnswerModelLoginRequest = { promptId: string; value: string }
