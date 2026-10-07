import { isShownPart } from "./activity.ts"
import type { ChatMessage } from "./chat.ts"

export type ChatErrorKind =
  | "tooLong"
  | "credit"
  | "key"
  | "rateLimit"
  | "overloaded"
  | "modelGone"
  | "timeout"
  | "provider"
  | "network"
  | "refused"
  | "unknown"

/** A failed reply, put so a person can read it. */
export type ChatErrorView = {
  kind: ChatErrorKind
  /** One plain sentence. */
  title: string
  /** What to do about it, or what the provider said. */
  hint?: string
  /** Whether sending again could work without anything else changing. */
  retryable: boolean
  /** Short facts for whoever looks closer: the status, the provider, its error code. */
  facts: string[]
  /** What the provider answered, laid out. Absent when nothing was reported. */
  detail?: string
}

const WORDS: Record<ChatErrorKind, { title: string; hint?: string; retryable: boolean }> = {
  tooLong: {
    title: "This chat is too long for the model.",
    hint: "Start fresh, or pick a model with more room.",
    retryable: false,
  },
  credit: {
    title: "The model account is out of credit.",
    hint: "Add credit with the provider, or pick another model.",
    retryable: false,
  },
  key: {
    title: "The model key was refused.",
    hint: "The key for the model provider is missing or no longer valid.",
    retryable: false,
  },
  rateLimit: {
    title: "Too many requests to the model.",
    hint: "Wait a moment, then try again.",
    retryable: true,
  },
  overloaded: {
    title: "The model is overloaded right now.",
    hint: "It usually clears within a minute.",
    retryable: true,
  },
  modelGone: {
    title: "This model isn't available.",
    hint: "Pick another model for this agent.",
    retryable: false,
  },
  timeout: {
    title: "The model took too long to answer.",
    hint: "Trying again usually works.",
    retryable: true,
  },
  provider: {
    title: "The model provider had a problem.",
    hint: "Nothing wrong on your side. Trying again usually works.",
    retryable: true,
  },
  network: {
    title: "Couldn't reach the model provider.",
    hint: "Check the connection and try again.",
    retryable: true,
  },
  refused: { title: "The model provider refused the request.", retryable: true },
  unknown: { title: "Something went wrong generating this reply.", retryable: true },
}

/**
 * What a failure is, by what it says. The first that matches wins, so the narrower ones come
 * first: a 429 that names a quota is about credit, not about going too fast.
 */
const BY_WORDS: [ChatErrorKind, RegExp][] = [
  [
    "tooLong",
    /context.?(length|window)|maximum context|too many tokens|prompt is too long|input is too long/,
  ],
  ["credit", /insufficient.?(credits?|quota|balance|funds)|out of credits?|payment required/],
  ["key", /invalid.?api.?key|incorrect api key|no auth credentials|unauthorized|unauthenticated/],
  ["rateLimit", /rate.?limit|too many requests/],
  ["overloaded", /overloaded|over capacity|at capacity/],
  ["modelGone", /model.?not.?found|no endpoints found|not a valid model|model .* does not exist/],
  ["timeout", /timed? ?out/],
  ["network", /fetch failed|network|econn|enotfound|socket|connection (error|closed|reset)/],
]

function byStatus(status: number): ChatErrorKind | undefined {
  if (status === 402) return "credit"
  if (status === 401 || status === 403) return "key"
  if (status === 429) return "rateLimit"
  if (status === 503 || status === 529) return "overloaded"
  if (status === 404) return "modelGone"
  if (status === 408 || status === 504) return "timeout"
  if (status >= 500) return "provider"
  if (status >= 400) return "refused"
  return undefined
}

type Obj = { [key: string]: unknown }
const isObj = (value: unknown): value is Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value)

function parse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Where the object that opens at `start` closes, or -1. */
function closeOf(text: string, start: number): number {
  let depth = 0
  let quoted = false
  for (let at = start; at < text.length; at++) {
    const char = text[at]
    if (quoted) {
      if (char === "\\") at++
      else if (char === '"') quoted = false
    } else if (char === '"') quoted = true
    else if (char === "{") depth++
    else if (char === "}" && --depth === 0) return at
  }
  return -1
}

/** The JSON objects written into a message, which providers put after or around their words. */
function objectsIn(text: string): Obj[] {
  const found: Obj[] = []
  for (let at = text.indexOf("{"); at !== -1; at = text.indexOf("{", at)) {
    const end = closeOf(text, at)
    const value = end === -1 ? undefined : parse(text.slice(at, end + 1))
    if (isObj(value)) {
      found.push(value)
      at = end + 1
    } else at++
  }
  return found
}

/** The same value, with any JSON that was carried as a string opened up. */
function unwrap(value: unknown): unknown {
  if (typeof value === "string") {
    const inner = value.trimStart().startsWith("{") ? parse(value) : undefined
    return isObj(inner) ? unwrap(inner) : value
  }
  if (Array.isArray(value)) return value.map(unwrap)
  if (isObj(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, unwrap(inner)]))
  }
  return value
}

/** Every value held under `key`, outermost first. */
function valuesOf(value: unknown, key: string, into: unknown[] = []): unknown[] {
  if (Array.isArray(value)) for (const inner of value) valuesOf(inner, key, into)
  else if (isObj(value)) {
    if (key in value) into.push(value[key])
    for (const inner of Object.values(value)) valuesOf(inner, key, into)
  }
  return into
}

const strings = (values: unknown[]) =>
  values.filter((value): value is string => typeof value === "string" && value.trim() !== "")
const numbers = (values: unknown[]) =>
  values.filter((value): value is number => typeof value === "number")
const isStatus = (value: number) => Number.isInteger(value) && value >= 400 && value <= 599

/** A sentence somebody wrote, as against a code or a wrapper's stock phrase. */
function readable(text: string): boolean {
  return (
    text.length <= 200 && /\s/.test(text) && !/[{}]/.test(text) && !/^provider returned/i.test(text)
  )
}

function sentence(text: string): string {
  const trimmed = text.trim()
  const capital = trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
  return /[.!?]$/.test(capital) ? capital : `${capital}.`
}

/**
 * Put a failed reply's error into words. The error is whatever the model provider answered, in
 * whatever shape, so nothing here depends on recognizing it: one that matches no known kind
 * still gets a plain sentence, the provider's own words where it had any, and the whole of what
 * it said under `detail`.
 */
export function describeChatError(error: string | undefined): ChatErrorView {
  const raw = error?.trim() ?? ""
  if (raw === "") return { kind: "unknown", ...WORDS.unknown, facts: [] }

  const objects = objectsIn(raw).map(unwrap)
  const leading = /^(?:HTTP |error:? )?(\d{3})\b/i.exec(raw)
  const status =
    (leading === null ? undefined : [Number(leading[1])].find(isStatus)) ??
    numbers([...valuesOf(objects, "status"), ...valuesOf(objects, "code")]).find(isStatus)

  const haystack = raw.toLowerCase()
  const kind =
    BY_WORDS.find(([, words]) => words.test(haystack))?.[0] ??
    (status === undefined ? undefined : byStatus(status)) ??
    "unknown"

  // The innermost message is the provider's own; the ones around it are wrappers'.
  const said = strings(valuesOf(objects, "message")).filter(readable).at(-1)
  const words = WORDS[kind]
  const hint =
    words.hint ??
    (said !== undefined
      ? sentence(said)
      : objects.length === 0 && readable(raw)
        ? sentence(raw)
        : undefined)

  const provider = strings(valuesOf(objects, "provider_name"))[0]
  const code = strings([
    ...valuesOf(objects, "provider_error_code"),
    ...valuesOf(objects, "code"),
  ])[0]
  const wait = numbers(valuesOf(objects, "retry_after_seconds"))[0]
  const facts = [
    status === undefined ? undefined : String(status),
    provider,
    code,
    wait === undefined ? undefined : `retry after ${wait}s`,
  ].filter((fact): fact is string => fact !== undefined)

  // A provider's answer is often given twice, once inside its wrapper and once after it.
  const laidOut = objects.map((object) => JSON.stringify(object, null, 2))
  const first = laidOut[0]
  const repeated = new Set(
    valuesOf(objects[0], "raw").map((value) => JSON.stringify(value, null, 2)),
  )
  const detail =
    first === undefined
      ? raw
      : [first, ...laidOut.slice(1).filter((text) => !repeated.has(text))].join("\n\n")

  const view: ChatErrorView = { kind, title: words.title, retryable: words.retryable, facts }
  if (hint !== undefined) view.hint = hint
  // Words that are already the hint, in full, are not worth a second look.
  if (detail !== raw || hint === undefined || sentence(raw) !== hint) view.detail = detail
  return view
}

/** A reply that failed before it said anything. */
function isBareFailure(message: ChatMessage): boolean {
  return (
    message.role === "assistant" && message.status === "error" && !message.parts.some(isShownPart)
  )
}

/**
 * Fold failures that follow one another into the last of them, with how many there were, so that
 * a reply that failed four times is said once.
 */
export function foldFailures(
  messages: readonly ChatMessage[],
): { message: ChatMessage; failures: number }[] {
  const folded: { message: ChatMessage; failures: number }[] = []
  let failures = 0
  messages.forEach((message, index) => {
    const next = messages[index + 1]
    if (isBareFailure(message)) {
      failures++
      if (next !== undefined && isBareFailure(next)) return
    }
    folded.push({ message, failures: message.status === "error" ? Math.max(failures, 1) : 0 })
    failures = 0
  })
  return folded
}
