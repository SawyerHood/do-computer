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
