import type { Serving } from "./local-server.ts"
import type { Sharing } from "./status.ts"
import type { Tailnet } from "./tailscale.ts"
import type { Update } from "./update.ts"

/** Everything the app's own pages show. */
export type AppState = {
  /** The deployment in use. Absent before one is chosen. */
  server?: string
  /** The deployment the app was built for, or the one in use: what the address field starts with. */
  suggestedServer: string
  /** Whether the deployment is the app's own: Do Computer run by the app, on this computer. */
  local: boolean
  /** Whether this copy of the app brings Do Computer with it, to run here. */
  canRunLocally: boolean
  /** How the app's own server stands. `off` where the app shows one somewhere else. */
  serving: Serving
  /** Reaching the app's own server from its owner's other devices. */
  tailnet: {
    /** How this computer stands with Tailscale, as of the last look. */
    status: Tailnet
    /** Whether its owner has asked for the server to be served to their other devices. */
    on: boolean
    /** The address it is reached at from them, while it is. */
    address?: string
    /** Why it is not served though it was asked to be, in words to show. */
    problem?: string
    /** Whether the app is in the middle of starting or stopping that. */
    busy: boolean
  }
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
    /** Run Do Computer on this computer. `server` is then not read. */
    local: boolean
    server: string
    /** With `local`: serve it to the owner's other devices over Tailscale. */
    tailnet: boolean
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
  /** Show the page about the owner's other devices. */
  devices(): Promise<void>
  /** Ask Tailscale again how this computer stands with it. */
  lookForTailnet(): Promise<void>
  /** Serve the app's own server to the owner's other devices, or stop. */
  setTailnet(on: boolean): Promise<void>
  /** A link that signs one other device in, once, and the code to scan that says it. */
  deviceLink(): Promise<DeviceLink | { error: string }>
  /** Put words where the next paste takes them from. */
  copy(text: string): Promise<void>
  /** Open one of the pages about Tailscale in the owner's browser. */
  open(page: "tailscale" | "tailscale-https"): Promise<void>
}

/** A way in for one other device of the owner's. */
export type DeviceLink = {
  link: string
  /** The link as a code to scan: `size` rows of `size` cells, dark where 1. */
  cells: number[]
  size: number
  /** How long the link can be used for. */
  seconds: number
}

declare global {
  interface Window {
    desktop: DesktopApi
  }
}
