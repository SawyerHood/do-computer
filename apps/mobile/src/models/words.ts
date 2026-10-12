import type {
  ModelLoginMethod,
  ModelLoginPrompt,
  ModelProvider,
  WorkspaceRole,
  WorkspaceSummary,
} from "@durable-computer/protocol"

/**
 * What a way of signing in is called on a button. pi names them for a list in a terminal,
 * "Anthropic (Claude Pro/Max)", where the provider is already said beside the button here.
 */
export function short(method: ModelLoginMethod): string {
  const inside = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(method.label)
  const name =
    inside === null
      ? method.label.replace(/ OAuth$/, "")
      : inside[2] === "subscription"
        ? (inside[1] ?? "")
        : (inside[2] ?? "")
  return name.replace(/ subscription$/, "").replace("/", " or ")
}

/**
 * Where a sign-in is kept, and so whose agents it is for: a workspace, or the deployment
 * itself, whose sign-ins are for everyone's.
 */
export type Scope = Pick<WorkspaceSummary, "id" | "name"> & {
  kind: WorkspaceSummary["kind"] | "deployment"
  role: WorkspaceRole
}

/** The name the deployment's own sign-ins are kept under, where a workspace's id would be. */
export const DEPLOYMENT: Scope = {
  id: "deployment",
  name: "This server",
  kind: "deployment",
  role: "owner",
}

/** Whose agents these are, in a sentence: a team's by its name, one's own as "your". */
export const whose = (scope: Scope) =>
  scope.kind === "deployment" ? "everyone's" : scope.kind === "team" ? `${scope.name}'s` : "your"

/** The day something was done, as it reads after "by you,". */
export const day = (at: number, now = new Date()) =>
  new Date(at).toDateString() === now.toDateString()
    ? "today"
    : `on ${new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`

/** A provider's own choices, said the way they turn out from a page. Others keep pi's words. */
export const WAYS: Record<string, { label: string; description: string }> = {
  browser: {
    label: "On a sign-in page",
    description: "Its page ends at an address that you paste back here.",
  },
  device_code: {
    label: "With a code",
    description: "Enter a short code on its page. Nothing to paste back.",
  },
}

/** Whether a provider's page ends at an address on the person's own machine, which does not load. */
export const endsAtAddress = (prompt: ModelLoginPrompt) =>
  /localhost|127\.0\.0\.1/.test(prompt.placeholder ?? "")

/** What is pasted back from a provider's page, where a sign-in asks for that: by its name. */
export const pasted = (prompt: ModelLoginPrompt) =>
  prompt.type !== "manual_code"
    ? undefined
    : endsAtAddress(prompt)
      ? "The address you end up at"
      : "The code it shows"

/** What a field of a sign-in is called. One that would only say the window's title again says "Key". */
export function asked(prompt: ModelLoginPrompt, title: string): string {
  const words = prompt.message.replace(/^Enter /, "").replace(/:$/, "")
  const label = words === title ? "Key" : words
  return label.slice(0, 1).toUpperCase() + label.slice(1)
}

/** What a provider offers, in a few words, for one the workspace is not signed in to. */
export function offer(provider: ModelProvider, deployment: boolean): string {
  if (deployment) return "Already here. Sign in to use your own account."
  const account = provider.methods.find((method) => method.type === "oauth")
  const key = provider.methods.some((method) => method.type === "api_key")
  const first =
    account === undefined ? undefined : account.subscription ? "A subscription" : "An account"
  return `${[first, key ? (first === undefined ? "A key" : "a key") : undefined]
    .filter((part) => part !== undefined)
    .join(" or ")}.`
}

/** How a workspace is signed in to a provider: with what, by whom and when, and for how many models. */
export function signedInWords(provider: ModelProvider, meId: string): string {
  const { signedIn } = provider
  if (signedIn === null) return ""
  const method = provider.methods.find((entry) => entry.type === signedIn.type)
  return [
    signedIn.type === "api_key"
      ? "A key"
      : method?.subscription
        ? `${short(method)} subscription`
        : "An account",
    `by ${signedIn.byId === meId ? "you" : (signedIn.by ?? "someone")}, ${day(signedIn.at)}`,
    `${signedIn.models} model${signedIn.models === 1 ? "" : "s"}`,
  ].join(" · ")
}

/** What signing in one way is called, and what it means, at the top of its screen. */
export function signInWords(scope: Scope, provider: ModelProvider, method: ModelLoginMethod) {
  const way = short(method)
  const key = method.type === "api_key"
  return {
    key,
    title: key ? method.label : `Sign in with ${way}`,
    description: key
      ? `Paid for by the token, on your account with ${provider.name}.`
      : method.subscription
        ? `Use a ${way} subscription for ${whose(scope)} agents.`
        : `Use your own ${provider.name} account for ${whose(scope)} agents.`,
    shared:
      (scope.kind === "deployment"
        ? "Everyone on this server can then set agents to these models, and what the agents use counts against your account there."
        : scope.kind === "team"
          ? `Everyone in ${scope.name} can then set agents to these models, and what the agents use counts against your account there.`
          : "Your agents can then be set to these models, and what they use counts against your account there.") +
      (provider.id === "anthropic" && !key
        ? " Anthropic decides how use outside its own apps is billed; it may count as extra usage."
        : ""),
  }
}
