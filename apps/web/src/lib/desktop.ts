import { deviceOf, type MessageOrigin } from "@do-computer/protocol"

/**
 * What the Do Computer desktop app gives a page of the deployment that is shown in its window.
 * In a browser there is none of this. The app answers only the deployment it is set to, and
 * keeps to itself whatever is its owner's to decide: see `apps/desktop/src/page-bridge.ts`.
 */
export type DesktopBridge = {
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
   * no account to sign in to: `signInHere` says who they are. An app older than this never does.
   */
  local?: boolean
  /**
   * Where the app runs the server: sign this window in as its owner, who is called `name`
   * from the first time on. Resolves with what went wrong, in words to show, or with nothing.
   */
  signInHere?(name: string): Promise<{ ok: true } | { error: string }>
  /**
   * Sign in through the owner's own browser, where they are at home: the app opens it on
   * `/desktop/sign-in`, and resolves once whoever is signed in there has agreed. The token is
   * exchanged for a session by `signInThroughBrowser`. Only one is waited for at a time.
   */
  signIn(provider?: "github" | "google"): Promise<{ token: string } | { error: string }>
  /** Stop waiting for the browser. The sign-in that was waiting resolves with an error. */
  cancelSignIn(): Promise<void>
  /**
   * Let agents work on this computer. On a first run only: afterwards it is asked for in the
   * app's own window about this computer. Resolves with the code of the pairing to confirm,
   * or `connected` where this computer is paired already.
   */
  share(options: {
    readOnly: boolean
  }): Promise<{ code: string } | { connected: true } | { error: string }>
  /** The first run is over. With `openAtLogin`, whether the app opens at sign-in from now on. */
  finish(options: { openAtLogin?: boolean }): Promise<void>
  /**
   * Ask this computer's owner to let agents use its screen. Where they do not yet, the app
   * asks them itself, in a window of its own, and switches it on only if they say so there.
   * Resolves once agents can be told of it, or with why not: `missing` is what macOS has still
   * to allow. An app older than this has no such thing to ask.
   */
  askForScreen?(): Promise<{ allowed: true; missing?: string[] } | { allowed: false; why?: string }>
  /**
   * The picture the app is shown by while it runs: in the Dock on a Mac, on its window and
   * the taskbar elsewhere. A PNG's address, in the shape this computer's desktop wants, or
   * null for the app's usual picture. An app older than this has no such thing to ask.
   */
  setIcon?(picture: string | null): Promise<void>
  /**
   * The pictures the app's tray shows while it runs: `on` while agents can use this computer
   * and `off` while they cannot. Each a PNG's address, 36 pixels a side, or null for the app's
   * usual pair. An app older than this has no such thing to ask.
   */
  setTray?(pictures: { on: string; off: string } | null): Promise<void>
  /**
   * What the server knows this computer by, while agents can use it, and null while they
   * cannot. An app older than this has no such thing to ask.
   */
  pairedAs?(): Promise<string | null>
  /**
   * `inset` where the app's window has no title bar: the page runs to the top of the window,
   * with the window's three buttons over its top left corner, and the window is dragged by what
   * the page says. Absent where the window has a title bar, in full screen, and in an older app.
   */
  titleBar?: "inset"
  /** Told whenever that changes: going into full screen and coming out of it. */
  onTitleBar?(listener: (titleBar: "inset" | null) => void): void
}

/**
 * Runs before first paint. It says on the document whether the app's window has no title bar,
 * for the styles that make room for the window's buttons: see `inset` in styles.css.
 */
export const TITLE_BAR_INIT_SCRIPT = `try{var b=window.doComputer,e=document.documentElement;if(b&&b.titleBar){e.dataset.titleBar=b.titleBar;if(b.onTitleBar)b.onTitleBar(function(t){e.dataset.titleBar=t||""})}}catch(e){}`

declare global {
  interface Window {
    doComputer?: DesktopBridge
  }
}

/** The desktop app this page is shown in, if it is in one. */
export const desktop = (): DesktopBridge | undefined =>
  typeof window === "undefined" ? undefined : window.doComputer

/**
 * Where a message written in this page is from, for the agent to be told: a browser or the
 * desktop app, the kind of device, and, in the app on a computer agents can use, which computer.
 */
export async function messageOrigin(): Promise<MessageOrigin> {
  const device = deviceOf(navigator.userAgent, navigator.maxTouchPoints)
  const bridge = desktop()
  // Asked as each message is sent: the computer can be shared, or not, long after the page loaded.
  // A message is sent whether or not the app answers.
  const computerId = await bridge?.pairedAs?.().catch(() => null)
  return {
    app: bridge === undefined ? "browser" : "desktop",
    ...(device === undefined ? {} : { device }),
    ...(typeof computerId === "string" && computerId !== "" ? { computerId } : {}),
  }
}

/**
 * Sign this window in as whoever is signed in in the owner's browser, or signs in there now.
 * Resolves with what went wrong, in words to show, or with nothing.
 */
export async function signInThroughBrowser(
  bridge: DesktopBridge,
  provider?: "github" | "google",
): Promise<string | undefined> {
  const answer = await bridge.signIn(provider)
  if ("error" in answer) return answer.error
  const response = await fetch("/api/auth/desktop/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: answer.token }),
  })
  if (response.ok) return undefined
  const said = (await response.json().catch(() => null)) as { message?: string } | null
  return said?.message ?? "That sign-in could not be finished. Try again."
}
