import type { DaemonEvent } from "@durable-computer/daemon/events"

/** How things stand between this computer and the agents, as the app shows it. */
export type Sharing =
  /** Agents cannot use this computer: its owner has not let them, or switched it off. */
  | { state: "off" }
  | { state: "starting" }
  /** Waiting for the owner to confirm, signed in, that this computer is theirs. */
  | { state: "pairing"; code: string; verifyUrl: string }
  | { state: "connecting"; name: string }
  | { state: "connected"; name: string; readOnly: boolean }
  /** The daemon stopped by itself, and is started again shortly unless it said not to be. */
  | { state: "stopped"; why: "superseded" | "failed"; detail?: string }

/** What the daemon saying something makes of how things stood. */
export function after(sharing: Sharing, event: DaemonEvent): Sharing {
  switch (event.event) {
    case "pairing":
      return { state: "pairing", code: event.code, verifyUrl: event.verifyUrl }
    case "paired":
      return { state: "connecting", name: event.name }
    case "connected":
      return { state: "connected", name: event.name, readOnly: event.readOnly }
    case "disconnected":
      return sharing.state === "connected" || sharing.state === "connecting"
        ? { state: "connecting", name: sharing.name }
        : { state: "starting" }
    case "revoked":
      return { state: "off" }
    case "superseded":
      return { state: "stopped", why: "superseded" }
    default:
      // A newer daemon may say things this app has not heard of.
      return sharing
  }
}

/** How things stand, in a line for the tray and the top of the window about this computer. */
export function headline(sharing: Sharing): string {
  switch (sharing.state) {
    case "off":
      return "Agents cannot use this computer"
    case "starting":
      return "Starting…"
    case "pairing":
      return "Waiting for you to confirm"
    case "connecting":
      return `Connecting as “${sharing.name}”…`
    case "connected":
      return `Connected as “${sharing.name}”${sharing.readOnly ? ", read-only" : ""}`
    case "stopped":
      return sharing.why === "superseded"
        ? "Another daemon connected as this computer"
        : "Could not connect. Trying again…"
  }
}
