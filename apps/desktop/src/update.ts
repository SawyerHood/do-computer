/** How things stand between this copy of the app and a newer one, as the app shows it. */
export type Update =
  /** This copy does not update itself, and `why` says so in a sentence. */
  | { state: "off"; why: string }
  /** Nothing newer is known of. */
  | { state: "current" }
  | { state: "checking" }
  | { state: "fetching"; version: string; percent: number }
  /** A newer app is on this computer. It is the one that starts when the app next does. */
  | { state: "ready"; version: string }
  /** Looking, fetching or taking the newer app's place went wrong. It is tried again later. */
  | { state: "failed"; version?: string; detail: string }

/** What the part that looks for a newer app says as it goes. */
export type UpdateEvent =
  | { event: "checking" }
  | { event: "found"; version: string }
  | { event: "none" }
  | { event: "progress"; percent: number }
  | { event: "fetched"; version: string }
  | { event: "error"; message: string }

/** How much of what went wrong is shown: its first line, and not a page of it. */
const DETAIL_LENGTH = 160

/** What something said about a newer app makes of how things stood. */
export function afterUpdate(update: Update, event: UpdateEvent): Update {
  if (update.state === "off") return update
  switch (event.event) {
    case "checking":
      // A newer app that is being fetched, or is here already, is not forgotten for looking again.
      return update.state === "fetching" || update.state === "ready"
        ? update
        : { state: "checking" }
    case "found":
      return update.state === "ready" && update.version === event.version
        ? update
        : { state: "fetching", version: event.version, percent: 0 }
    case "none":
      return update.state === "ready" ? update : { state: "current" }
    case "progress":
      return update.state === "fetching"
        ? { ...update, percent: Math.min(100, Math.max(0, Math.round(event.percent))) }
        : update
    case "fetched":
      return { state: "ready", version: event.version }
    case "error": {
      const line = event.message.split("\n")[0]!.trim()
      const detail = line.length > DETAIL_LENGTH ? `${line.slice(0, DETAIL_LENGTH - 1)}…` : line
      return {
        state: "failed",
        ...(update.state === "fetching" || update.state === "ready" || update.state === "failed"
          ? update.version === undefined
            ? {}
            : { version: update.version }
          : {}),
        detail: detail === "" ? "Something went wrong." : detail,
      }
    }
  }
}

/** How things stand, in a line beside the app's version. */
export function updateWords(update: Update): string {
  switch (update.state) {
    case "off":
      return update.why
    case "current":
      return "Up to date"
    case "checking":
      return "Looking for a newer one…"
    case "fetching":
      return `Fetching ${update.version}… ${update.percent}%`
    case "ready":
      return `${update.version} is ready`
    case "failed":
      return `Could not update${update.version === undefined ? "" : ` to ${update.version}`}: ${update.detail}`
  }
}

/** What the button beside it does, in its words. Nothing, while there is nothing to press for. */
export function updateAction(update: Update): string | undefined {
  switch (update.state) {
    case "ready":
      return "Restart to update"
    case "current":
      return "Check for updates"
    case "failed":
      return "Try again"
    default:
      return undefined
  }
}

/** How long the daemon has to have said nothing before the app restarts itself to update. */
export const QUIET_MS = 5 * 60_000

/**
 * Whether the app may restart itself as the newer one without being asked. It stays running
 * for weeks with nobody looking at it, and is the daemon too, so it does: but not under its
 * owner's eyes, and not in the middle of what an agent is doing here.
 */
export function mayRestart(now: {
  update: Update
  /** Whether any of the app's windows is on the screen. */
  showing: boolean
  /** Whether an agent is using the screen. */
  usingScreen: boolean
  /** How long ago the daemon last said anything, which it does with every command it runs. */
  quietMs: number
}): boolean {
  return now.update.state === "ready" && !now.showing && !now.usingScreen && now.quietMs >= QUIET_MS
}

/** How long after restarting itself unseen the app still counts as having done so. */
const RETURN_MS = 3 * 60_000

/**
 * Whether the app is coming back from restarting itself to update while no window was showing,
 * and so shows none now either. `restarted` is when it wrote down that it was about to.
 */
export function returningUnseen(restarted: number | undefined, now: number): boolean {
  return restarted !== undefined && now >= restarted && now - restarted < RETURN_MS
}
