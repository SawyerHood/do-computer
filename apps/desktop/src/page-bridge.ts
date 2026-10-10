/**
 * What the app gives a page of the deployment that is shown in its window: enough for the
 * first run to be one scene, drawn by the deployment, and no more. The same type is written
 * down for the pages in `apps/web/src/lib/desktop.ts`; the two are kept alike by hand.
 *
 * The app answers only the top page of its main window, and only while that page is on the
 * deployment it is set to. Whatever is its owner's to decide later (which agents get this
 * computer, the screen, a browser) stays with the app's own pages.
 */
import { onServer } from "./server.ts"
import type { Sharing } from "./status.ts"

export type SignInAnswer = { token: string } | { error: string }
export type ShareAnswer = { code: string } | { connected: true } | { error: string }

/** What a page is told as it loads. */
export type PageInfo = {
  /** `darwin`, `win32` or `linux`. */
  platform: string
  /** What this computer calls itself, for saying which one is meant. */
  computer: string
  /** Whether this run of the app can be opened when its owner signs in to the computer. */
  canOpenAtLogin: boolean
  /** Whether the first run is over: its owner has been asked about agents working here. */
  welcomed: boolean
  /** Whether agents can use this computer, as things stood when the page loaded. */
  sharing: "off" | "on"
}

export type DesktopBridge = PageInfo & {
  /**
   * Sign in through the owner's own browser, where they are at home: the app opens it on
   * `/desktop/sign-in`, and resolves once whoever is signed in there has agreed. The token is
   * the page's to exchange for a session. Only one is waited for at a time.
   */
  signIn(provider?: "github" | "google"): Promise<SignInAnswer>
  /** Stop waiting for the browser. The sign-in that was waiting resolves with an error. */
  cancelSignIn(): Promise<void>
  /**
   * Let agents work on this computer. On a first run only: afterwards it is asked for in the
   * app's own window about this computer. Resolves with the code of the pairing to confirm,
   * or `connected` where this computer is paired already.
   */
  share(options: { readOnly: boolean }): Promise<ShareAnswer>
  /** The first run is over. With `openAtLogin`, whether the app opens at sign-in from now on. */
  finish(options: { openAtLogin?: boolean }): Promise<void>
}

/** The names the app and the script its windows are given call each other by. */
export const CHANNELS = {
  info: "page-info",
  signIn: "page-sign-in",
  cancelSignIn: "page-cancel-sign-in",
  share: "page-share",
  finish: "page-finish",
} as const

/**
 * Whether whoever asks is a page the app answers. The main window can be led anywhere on the
 * web, and a page can hold a frame from anywhere, so it is asked of every question.
 */
export function mayUseBridge(asking: {
  /** Whether it is in the window that shows the deployment. */
  mainWindow: boolean
  /** Whether it is that window's page itself, and not a frame inside it. */
  top: boolean
  url: string
  server: string | undefined
}): boolean {
  if (!asking.mainWindow || !asking.top || asking.server === undefined) return false
  return onServer(asking.url, asking.server)
}

/** A computer's name without the network's part of it: `sawyers-air.local` is `sawyers-air`. */
export function computerName(hostname: string): string {
  const name = hostname.trim()
  const first = name.split(".")[0]!
  // An address is no name with parts, and neither is one that starts with a dot.
  if (first === "" || /^[\d.]+$/.test(name)) return name
  return first
}

/** Whether agents can use this computer, as a page is told it. */
export const sharingNow = (sharing: Sharing): "off" | "on" =>
  sharing.state === "connected" || sharing.state === "connecting" ? "on" : "off"

/**
 * What a page that asked to share this computer is told, once the daemon has got far enough
 * to say. Undefined while it has not.
 */
export function shareAnswer(sharing: Sharing): ShareAnswer | undefined {
  switch (sharing.state) {
    case "pairing":
      return { code: sharing.code }
    case "connected":
    case "connecting":
      return { connected: true }
    case "stopped":
      if (sharing.why !== "failed") return undefined
      return {
        error:
          sharing.detail === undefined
            ? "This computer could not be connected. Try again."
            : `This computer could not be connected: ${sharing.detail}`,
      }
    default:
      return undefined
  }
}

/** The provider a page asked to sign in with, if it is one there is. */
export const provider = (asked: unknown): "github" | "google" | undefined =>
  asked === "github" || asked === "google" ? asked : undefined
