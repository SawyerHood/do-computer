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
   * The picture the app is shown by while it runs: in the Dock on a Mac, on its window and
   * the taskbar elsewhere. A PNG's address, in the shape this computer's desktop wants, or
   * null for the app's usual picture. An app older than this has no such thing to ask.
   */
  setIcon?(picture: string | null): Promise<void>
}

declare global {
  interface Window {
    doComputer?: DesktopBridge
  }
}

/** The desktop app this page is shown in, if it is in one. */
export const desktop = (): DesktopBridge | undefined =>
  typeof window === "undefined" ? undefined : window.doComputer

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
