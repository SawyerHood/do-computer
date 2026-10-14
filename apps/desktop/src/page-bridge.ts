/**
 * What the app gives a page of the deployment that is shown in its window: enough for the
 * first run to be one scene, drawn by the deployment, and no more. Someone who has agents
 * already is shown no scene: the deployment asks them the one thing left, about this computer. The same type is written
 * down for the pages in `apps/web/src/lib/desktop.ts`; the two are kept alike by hand.
 *
 * The app answers only the top page of its main window, and only while that page is on the
 * deployment it is set to. Whatever is its owner's to decide later (which agents get this
 * computer, the screen, a browser) stays with the app: its own pages, and for the screen a
 * question the app puts itself when a page asks for it, which no page draws or can answer.
 */
import { onServer } from "./server.ts"
import type { Sharing } from "./status.ts"

export type SignInAnswer = { token: string } | { error: string }
export type ShareAnswer = { code: string } | { connected: true } | { error: string }
export type HereAnswer = { ok: true } | { error: string }
export type ScreenAnswer =
  /** Agents may use the screen. On a Mac, `missing` is what macOS has still to allow first. */
  | { allowed: true; missing?: string[] }
  /** They may not: its owner said no, or, with `why`, it is not something to ask for here. */
  | { allowed: false; why?: string }

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
  /**
   * Whether the app runs the server itself, on this computer, for its owner alone. They have
   * no account to sign in to: `signInHere` says who they are.
   */
  local: boolean
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
  /**
   * Ask this computer's owner to let agents use its screen. Where they do not yet, the app
   * asks them itself, in a window of its own, and switches it on only if they say so there.
   * Resolves once agents can be told of it, or with why not.
   */
  askForScreen(): Promise<ScreenAnswer>
  /**
   * The picture the app is shown by while it runs: in the Dock on a Mac, on its window and
   * the taskbar elsewhere. The page draws its owner's own agent, as a PNG's address, in the
   * shape this computer's desktop wants. Null is the app's usual picture again. Once the app
   * is quit it is the usual one, which is the only one the app's file has.
   */
  setIcon(picture: string | null): Promise<void>
  /**
   * Where the app runs the server: sign this window in as its owner, who is called `name`
   * from the first time on. Elsewhere it resolves with an error.
   */
  signInHere(name: string): Promise<HereAnswer>
  /**
   * What the server knows this computer by, while agents can use it, and null while they
   * cannot. A page asks as it sends a message, so that the agent is told which computer the
   * message was written on.
   */
  pairedAs(): Promise<string | null>
}

/** The names the app and the script its windows are given call each other by. */
export const CHANNELS = {
  info: "page-info",
  signIn: "page-sign-in",
  cancelSignIn: "page-cancel-sign-in",
  share: "page-share",
  finish: "page-finish",
  screen: "page-screen",
  icon: "page-icon",
  signInHere: "page-sign-in-here",
  pairedAs: "page-paired-as",
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

/** What the server knows this computer by, as a page is told it: null while agents cannot use it. */
export const pairedAs = (sharing: Sharing): string | null =>
  sharing.state === "connected" || sharing.state === "connecting"
    ? (sharing.computerId ?? null)
    : null

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

/**
 * Why a page that asked for the screen is told no without its owner being asked, if it is:
 * the question is only worth putting where saying yes would let an agent use it.
 */
export function screenRefusal(now: {
  /** Why the screen cannot be used on this computer at all, if it cannot. */
  unavailable: string | undefined
  sharing: "off" | "on"
  readOnly: boolean
}): string | undefined {
  if (now.unavailable !== undefined) return now.unavailable
  if (now.sharing === "off") {
    return "Doods cannot use this computer yet. Let them in the Do Computer app, under This Computer."
  }
  if (now.readOnly) {
    return "Doods may only read files on this computer. That is changed in the Do Computer app, under This Computer."
  }
  return undefined
}

/** The longest a name is. It is what the owner's Doods call them. */
const NAME_MOST = 80

/** What a page said its owner is called, if it said anything that is a name. */
export function ownerName(asked: unknown): string | undefined {
  if (typeof asked !== "string") return undefined
  const name = asked.trim().slice(0, NAME_MOST)
  return name === "" ? undefined : name
}

/** The provider a page asked to sign in with, if it is one there is. */
export const provider = (asked: unknown): "github" | "google" | undefined =>
  asked === "github" || asked === "google" ? asked : undefined

/** The most a picture's address may be: one of 1024 pixels a side is some tens of thousands. */
const ICON_MOST = 2_000_000
const PNG = "data:image/png;base64,"

/**
 * The picture a page asked the app to be shown by: a PNG's address, or null for the usual one.
 * Undefined is anything else, which is left unanswered: a page is whatever the deployment serves.
 */
export function iconPicture(asked: unknown): string | null | undefined {
  if (asked === null) return null
  if (typeof asked !== "string" || asked.length > ICON_MOST) return undefined
  if (!asked.startsWith(PNG) || !/^[A-Za-z0-9+/]+={0,2}$/.test(asked.slice(PNG.length))) {
    return undefined
  }
  return asked
}

/** Whether a picture of this size can be what the app is shown by: square, and of a size icons are. */
export const iconFits = (size: { width: number; height: number }): boolean =>
  size.width === size.height && size.width >= 64 && size.width <= 1024
