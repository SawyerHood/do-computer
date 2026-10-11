import type { Sharing } from "./status.ts"
import type { Update } from "./update.ts"

/** Everything the app's own pages show. */
export type AppState = {
  /** The deployment in use. Absent before one is chosen. */
  server?: string
  /** The deployment the app was built for, or the one in use: what the address field starts with. */
  suggestedServer: string
  /** Whether the first run is over. Until it is, the deployment's welcome asks what the app would. */
  welcomed: boolean
  sharing: Sharing
  /** `sharing` in a line. */
  headline: string
  readOnly: boolean
  /** Whether agents may use the screen here, as its owner has it switched. */
  screen: boolean
  /** Why the screen cannot be used on this computer whatever the switch says, if it cannot. */
  screenUnavailable?: string
  /**
   * On a Mac: what macOS has let the app do, of the two things using the screen takes. Absent
   * elsewhere, where nothing is asked.
   */
  permissions?: { accessibility: boolean; screenRecording: boolean }
  /** Whether agents may use a browser here. */
  browser: boolean
  openAtLogin: boolean
  /** Whether this run of the app can be started at sign-in. One run from its source cannot. */
  canOpenAtLogin: boolean
  /** What the daemon said lately. */
  log: string[]
  platform: string
  /** Which version of the app this is. */
  version: string
  /** Whether there is a newer one, and how far along taking its place is. */
  update: Update
}

/**
 * What the app's own pages can ask of it. A page of the deployment is given none of this: what
 * it is given is in `page-bridge.ts`.
 */
export type DesktopApi = {
  state(): Promise<AppState>
  /** Called with the state whenever it changes. */
  watch(listener: (state: AppState) => void): void
  /**
   * Use this deployment. Resolves with what is wrong with the address, or nothing. On a first
   * run only the address is heeded: the deployment's welcome asks the rest.
   */
  connect(choice: {
    server: string
    share: boolean
    openAtLogin: boolean
  }): Promise<string | undefined>
  /** Let agents use this computer, or stop letting them. */
  share(on: boolean, readOnly: boolean): Promise<void>
  /** Show the page where a pairing is confirmed. */
  confirm(): Promise<void>
  /** Let agents use the screen or a browser here, or stop letting them. */
  allow(what: "screen" | "browser", on: boolean): Promise<void>
  /** Ask macOS for one of the things using the screen takes, or show where it is given. */
  permit(what: "accessibility" | "screenRecording"): Promise<void>
  setOpenAtLogin(on: boolean): Promise<void>
  /** Show the page where the deployment is chosen. */
  changeServer(): Promise<void>
  /** Load the deployment again, after it could not be reached. */
  retry(): Promise<void>
  /** Look for a newer app, or, when one has been fetched, restart as it. */
  update(): Promise<void>
}

declare global {
  interface Window {
    desktop: DesktopApi
  }
}
