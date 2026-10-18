/**
 * What a daemon tells the app that runs it. A daemon started by hand prints sentences for a
 * person to read. One that is part of an app (`DC_DAEMON_EMBEDDED=1`) also prints these, one to
 * a line, so that the app can show how things stand without reading sentences.
 */
export type DaemonEvent =
  /** It is waiting for its owner to confirm this code, at this address, while signed in. */
  | { event: "pairing"; code: string; verifyUrl: string }
  | { event: "paired"; name: string; computerId: string; readOnly: boolean }
  | { event: "connected"; name: string; computerId: string; readOnly: boolean }
  | { event: "disconnected"; retryMs: number }
  /** The computer was removed in the app. The daemon forgot its credentials and is exiting. */
  | { event: "revoked" }
  /** Another daemon connected as this computer. This one is exiting. */
  | { event: "superseded" }

/** What a line that is an event starts with. Nothing a person is told starts like it. */
export const EVENT_PREFIX = "@dc-event "

export const formatEvent = (event: DaemonEvent) => `${EVENT_PREFIX}${JSON.stringify(event)}`

/** The event a line of a daemon's output is, or undefined for a sentence. */
export function parseEvent(line: string): DaemonEvent | undefined {
  if (!line.startsWith(EVENT_PREFIX)) return undefined
  try {
    const parsed = JSON.parse(line.slice(EVENT_PREFIX.length)) as { event?: unknown }
    return typeof parsed?.event === "string" ? (parsed as DaemonEvent) : undefined
  } catch {
    return undefined
  }
}

/**
 * What a daemon asks of the app that runs it, and waits to be answered: to do something with
 * the computer's screen, which is the app's to use and not the daemon's. One to a line of what
 * the daemon prints, as events are. The app answers with one line of JSON on the daemon's
 * input: an `AppAnswer`.
 */
export type AppCall = {
  id: string
  op: import("@do-computer/protocol").ScreenFrame["op"] | "hello"
  protocolVersion?: 1
} & Omit<import("@do-computer/protocol").ScreenFrame, "t" | "id" | "op">

/** The app's answer to a call: what it resolves with, or why not. */
export type AppAnswer = {
  id: string
  value?: unknown
  /** `refused`: the owner has it switched off or stopped the agent; the message is for the agent. */
  error?: { refused: boolean; message: string }
}

export const CALL_PREFIX = "@dc-call "

export const formatCall = (call: AppCall) => `${CALL_PREFIX}${JSON.stringify(call)}`

/** The call a line of a daemon's output is, or undefined for anything else. */
export function parseCall(line: string): AppCall | undefined {
  if (!line.startsWith(CALL_PREFIX)) return undefined
  try {
    const parsed = JSON.parse(line.slice(CALL_PREFIX.length)) as { id?: unknown; op?: unknown }
    return typeof parsed?.id === "string" && typeof parsed.op === "string"
      ? (parsed as AppCall)
      : undefined
  } catch {
    return undefined
  }
}

/** The answer a line of a daemon's input is, or undefined for anything else. */
export function parseAnswer(line: string): AppAnswer | undefined {
  try {
    const parsed = JSON.parse(line) as { id?: unknown }
    return typeof parsed?.id === "string" ? (parsed as AppAnswer) : undefined
  } catch {
    return undefined
  }
}

/**
 * Set by the app, for the daemon it runs, when agents may use the screen: the app has it
 * switched on and can do it. The daemon then asks the app with `AppCall`s.
 */
export const SCREEN_ENV = "DC_DAEMON_SCREEN"
/** Set to `0` by the app when its owner switched the browser off for agents. */
export const BROWSER_ENV = "DC_DAEMON_BROWSER"
