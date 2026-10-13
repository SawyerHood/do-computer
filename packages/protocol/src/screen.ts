/**
 * An agent using the screen of a paired computer, or a browser on it: what it asks for, what it
 * is given back, and what someone watching is shown.
 *
 * Both are things of the computer's own. The screen is the one its owner looks at, with the
 * mouse and keyboard. The browser is the owner's own Chrome where that lets itself be used, and
 * one kept for agents where it does not.
 */

/** The agent using a screen or a browser: said on the computer itself, and to whoever watches. */
export type UsingAgent = { id: string; name: string; color: string }

/** A picture of a screen or of a page: base64, with its size in its own pixels. */
export type Shot = { mimeType: string; data: string; width: number; height: number }

/** A place in a picture, in that picture's pixels from its top left. */
export type ShotPoint = { x: number; y: number }

/**
 * One thing done to the whole screen, with the computer's own mouse and keyboard. Places are in
 * the pixels of the picture the agent was last given of it, which is not the screen's own size.
 */
export type DesktopAction =
  | { do: "screenshot" }
  | { do: "click" | "double_click" | "right_click" | "move"; x: number; y: number }
  | { do: "drag"; x: number; y: number; toX: number; toY: number }
  | {
      do: "scroll"
      x: number
      y: number
      direction: "up" | "down" | "left" | "right"
      /** Notches of a wheel. Three when left out. */
      amount?: number
    }
  | { do: "type"; text: string }
  /** Keys pressed together, joined with `+`: `enter`, `cmd+s`, `ctrl+shift+t`. */
  | { do: "key"; keys: string }
  | { do: "wait"; seconds: number }

/**
 * One thing done to a single window, which need not be in front. Places are in the pixels of
 * the picture the agent was last given of that window.
 */
export type WindowAct =
  | { do: "screenshot" }
  | { do: "click" | "double_click" | "right_click"; x: number; y: number }
  | { do: "drag"; x: number; y: number; toX: number; toY: number }
  | {
      do: "scroll"
      x: number
      y: number
      direction: "up" | "down" | "left" | "right"
      amount?: number
    }
  /** With a place, the place is clicked first, which is what a field in a web page needs. */
  | { do: "type"; text: string; x?: number; y?: number }
  | { do: "key"; keys: string }
  | { do: "wait"; seconds: number }

/**
 * One thing an agent does with a screen. What is done to a window is done behind whatever its
 * owner has in front, without their mouse or keyboard, unless `inFront` asks for the window to
 * be brought forward for it.
 *
 * The three that came with windows are actions of their own, and not more arguments to the
 * old ones, so that an app from before them does nothing with one: it would otherwise click
 * the place on the whole screen. Its answer then has no `window` or `windows` in it.
 */
export type ScreenAction =
  | DesktopAction
  | { do: "windows" }
  /** Open an app by its name, without bringing it forward. */
  | { do: "open"; app: string }
  | { do: "in_window"; window: number; inFront?: boolean; act: WindowAct }

/** What the `screen` tool calls the things it does. */
export const SCREEN_ACTIONS = [
  "screenshot",
  "windows",
  "open",
  "click",
  "double_click",
  "right_click",
  "move",
  "drag",
  "scroll",
  "type",
  "key",
  "wait",
] as const satisfies readonly Exclude<ScreenAction["do"], "in_window">[]

/** A window on a computer's screen, as an agent is told of it. */
export type ScreenWindow = {
  /** What the window is asked for by. It lasts as long as the window does. */
  id: number
  app: string
  title: string
  /** Its size on the screen, in the screen's own points. */
  width: number
  height: number
  /** False for one that is minimized, hidden, or on another desktop. */
  shown: boolean
}

/** What a window is called for whoever reads it: its app, and its title where that says more. */
export function windowName(window: Pick<ScreenWindow, "app" | "title">): string {
  const app = window.app.trim()
  const title = window.title.trim()
  if (app === "") return title || "A window"
  return title === "" || title === app ? app : `${app}: ${title}`
}

/**
 * What came of an action: how the screen, or the window it was done in, looked afterwards.
 * `windows` answers with no picture.
 */
export type ScreenActed = {
  shot?: Shot
  /** Where the agent's pointer is in `shot`, once it has been anywhere. */
  pointer?: ShotPoint
  /** The window `shot` is of. Absent: the whole screen. */
  window?: ScreenWindow
  /** The windows there are, for `windows`, and those of the app, for `open`. */
  windows?: ScreenWindow[]
  /** Something the agent should know about how it went, where there is anything. */
  note?: string
}

/** How a script run in a browser went. */
export type BrowserRan = {
  /** What the script printed, and the value it ended with. */
  output: string
  /** Why it failed, where it did. */
  error?: string
  /** The pictures it took, in the order it took them. */
  shots: Shot[]
  /** The page in front when it ended. */
  url?: string
  title?: string
  /** True when the browser is the owner's own Chrome, with everything they are signed in to. */
  own: boolean
}

/**
 * A saved login as a computer is handed it to sign in with. It is used for the one sign-in and
 * kept nowhere: only `name` may be written down, said or sent back.
 */
export type SignInWith = {
  name: string
  username: string
  password: string
  /** The sites it is for, as host names. It is typed on these and their subdomains, and nowhere else. */
  sites: string[]
}

/** The page in front in a computer's browser, as the browser itself says. */
export type BrowserFront = {
  /** Absent where no browser is open for agents, or it has no page. */
  url?: string
  title?: string
  own: boolean
}

/**
 * How signing in with a saved login went:
 *
 * - `signed_in`: it was typed and sent, and the form is gone.
 * - `wrong_site`: the page in front is not one the login is for. Nothing was typed.
 * - `no_form`: no box for a password was found on the page. Nothing of the password was typed.
 * - `still_asking`: it was typed and sent, and the page still asks: for the same thing, or for
 *   something more (a code, a puzzle). What was typed was taken out of the page again.
 * - `failed`: it could not be tried at all.
 *
 * Nothing in it is, or is made from, the password.
 */
export type BrowserSignedIn = {
  outcome: "signed_in" | "wrong_site" | "no_form" | "still_asking" | "failed"
  /** What happened, in a sentence or two, for the agent to be told. */
  message: string
  /** The host of the page it was tried on, as the browser gave it. */
  site?: string
  /**
   * Whether the password was typed into the page at all. Where it says it was not, trying gave
   * nothing away, and whoever said it might be tried need not be asked again to try once more.
   */
  typed?: boolean
  /** The page in front afterwards. */
  url?: string
  title?: string
  own: boolean
}

/**
 * A saved card as a computer is handed it to pay with, with the security code its owner typed
 * for this one use. It is used for the one payment and kept nowhere: only `name` and the last
 * four digits of `number` may be written down, said or sent back.
 */
export type PayWith = {
  name: string
  /** The name on the card. Empty where none is kept. */
  holder: string
  /** The number, as digits alone. */
  number: string
  expMonth: number
  /** The year in full. */
  expYear: number
  code: string
  /** Empty where none is kept. */
  postalCode: string
}

/**
 * Something else for a computer to fill in on the page it pays on, since the page is loaded
 * afresh first and anything typed into it before is gone: an e-mail address, a name. None of
 * it is secret. `box` is how the box is known: its label, its placeholder or its name.
 */
export type PayField = { box: string; text: string }

/**
 * How paying with a saved card went:
 *
 * - `sent`: the card was typed, the button pressed, and the form is gone. Whether the shop took
 *   the payment is for the page to say.
 * - `no_form`: no box for a card's number was found, or no such button. Nothing of the card was
 *   typed.
 * - `still_asking`: it was typed and the button pressed, and the page still shows the form: it
 *   refused something, or asks for more (a code from the bank). What was typed was taken out.
 * - `failed`: it could not be tried at all, or how it went is not known.
 *
 * Nothing in it is, or is made from, the card's number or its code.
 */
export type BrowserPaid = {
  outcome: "sent" | "no_form" | "still_asking" | "failed"
  /** What happened, in a sentence or two, for the agent to be told. */
  message: string
  /** The host of the page it was tried on, as the browser gave it. */
  site?: string
  /** Whether anything of the card was typed into the page at all. See `BrowserSignedIn.typed`. */
  typed?: boolean
  /** The page in front afterwards. */
  url?: string
  title?: string
  own: boolean
}

/**
 * Whether a page at `url` is one a card may be typed on: one reached by https, or a page on
 * this computer itself, which is how such a thing is tried out. Resolves with its host.
 */
export function paySite(url: string | undefined): string | null {
  let parsed: URL
  try {
    parsed = new URL(url ?? "")
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "")
  const local = host === "localhost" || host === "127.0.0.1"
  if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) return null
  return host === "" ? null : host
}

/**
 * Whether a page at `url` is one a login for `sites` may be typed on: https, and the same host
 * as one of them or a subdomain of it. A page on this computer itself (localhost) may be plain
 * http, which is how such a thing is tried out.
 */
export function signInSite(url: string | undefined, sites: readonly string[]): string | null {
  let parsed: URL
  try {
    parsed = new URL(url ?? "")
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "")
  const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]"
  if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) return null
  for (const entry of sites) {
    const site = siteHost(entry)
    if (site !== null && (host === site || host.endsWith(`.${site}`))) return host
  }
  return null
}

/**
 * A site as it is kept with a login: a host name, lower case, with no scheme, port or path.
 * Null for what is not one. An address is taken for its host, so `https://github.com/login`
 * is `github.com`.
 */
export function siteHost(value: string): string | null {
  const text = value.trim().toLowerCase()
  if (text === "" || text.length > 253) return null
  let host: string
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(text) ? text : `https://${text}`).hostname
  } catch {
    return null
  }
  host = host.replace(/\.$/, "")
  if (host === "localhost" || host === "127.0.0.1") return host
  // A name with a dot in it, of letters, digits and hyphens: not an address in numbers, and
  // not a bare top-level name, which would cover every site under it.
  if (
    !/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/.test(
      host,
    )
  ) {
    return null
  }
  return host
}

/**
 * What someone watching is shown: the screen, or the page in front, as it is now. Each has a
 * number, so that whoever asks can wait for one newer than the last they had.
 *
 * Nothing is shown of a screen nobody is using: `active` is false, and no picture is taken.
 */
export type LiveView = {
  active: boolean
  seq: number
  shot?: Shot
  /**
   * Where the agent's pointer is in `shot`, for whoever shows it to draw. Left out where the
   * pointer is already in the picture.
   */
  pointer?: ShotPoint
  /** Counts the agent's clicks, so that a new one can be seen to happen. */
  clicks?: number
  /** What the agent is doing, in a few words. */
  say?: string
  /** True while someone has paused the agent here. */
  held?: boolean
  agent?: UsingAgent
  /** For a browser: the page in front. */
  url?: string
  /** For a browser: the page's title. For a screen: the window the agent is working in, if it is in one. */
  title?: string
  /** For a browser: true when it is the owner's own Chrome. */
  own?: boolean
}

/** How long a screen or browser counts as in use after the last thing an agent did there. */
export const USE_LINGER_MS = 45_000
/** How long an agent that was paused waits to be let on before it is told that it still is. */
export const USE_HELD_WAIT_MS = 5 * 60_000
/** The longest a watcher's question waits for a newer picture. */
export const VIEW_WAIT_MS = 5_000
/** The longest side of a picture given to an agent or a watcher. */
export const SHOT_EDGE = 1280
export const DEFAULT_BROWSER_TIMEOUT_MS = 60_000
export const MAX_BROWSER_TIMEOUT_MS = 300_000

/** Which of a computer's two things is meant. */
export type UseWhat = "screen" | "browser"

/**
 * What a call of the `screen` or `browser` tool leaves with it, for a chat to show: where it
 * was, what it was doing, and the picture it ended with, which is kept by the agent and fetched
 * by `shot`.
 */
export type UseDetails = {
  use: {
    what: UseWhat
    computer: { id: string; name: string }
    /** What it was doing, in a few words. */
    say: string
    /** The id of the picture kept of how it ended. Absent while it runs, and where none was taken. */
    shot?: string
    width?: number
    height?: number
    pointer?: ShotPoint
    url?: string
    /** For a browser: the page's title. For a screen: the window the step was done in, if it was in one. */
    title?: string
    own?: boolean
  }
}
