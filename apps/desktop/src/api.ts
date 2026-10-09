import type { Sharing } from "./status.ts"

/** Everything the app's own pages show. */
export type AppState = {
  /** The deployment in use. Absent before one is chosen. */
  server?: string
  /** The deployment the app was built for, or the one in use: what the address field starts with. */
  suggestedServer: string
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
}

/** What the app's own pages can ask of it. A page of the deployment is given none of this. */
export type DesktopApi = {
  state(): Promise<AppState>
  /** Called with the state whenever it changes. */
  watch(listener: (state: AppState) => void): void
  /** Use this deployment. Resolves with what is wrong with the address, or nothing. */
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
}

declare global {
  interface Window {
    desktop: DesktopApi
  }
}
