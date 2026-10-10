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
