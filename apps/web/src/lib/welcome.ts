import { atom } from "jotai"

/**
 * Whether the first run's scene is over the page. It is opened by its own page and outlives it:
 * when the scene ends it is still there as the chat comes up under it, so that the creature can
 * be seen going to its place.
 */
export const welcomeOpenAtom = atom(false)

/**
 * The page that sent the visitor to sign in, or to the first run, to come back to it afterwards,
 * when it named itself, as an invitation does. Only ever a path of this app, never an address
 * someone else could choose.
 */
export function sentFrom(
  search = typeof location === "undefined" ? "" : location.search,
): string | undefined {
  const next = new URLSearchParams(search).get("next") ?? ""
  return /^\/(?![/\\])/.test(next) ? next : undefined
}

/**
 * Whether that page is where the desktop app signs its owner in. The app shows the first run in
 * its own window, so the browser it sent them to makes the account on the plain form and goes
 * straight back.
 */
export const forDesktopApp = (next: string | undefined) =>
  next !== undefined && /^\/desktop\/sign-in(?:[/?#]|$)/.test(next)

let handing = false

/**
 * The scene has sent the page on to the chat and is still showing. Its own page going away is
 * then no reason to take it down.
 */
export const handingOver = {
  begin: () => {
    handing = true
  },
  end: () => {
    handing = false
  },
  on: () => handing,
}

/** Who a new agent has just met in the scene, and what it was given there. */
export type Meeting = {
  agentId: string
  /** What its person is called, as it greeted them. */
  first: string
  /**
   * The computer it asked for: its name where it was given it, null where it was told not now.
   * Absent where there was none to ask for, as in a browser.
   */
  computer?: { name: string; readOnly: boolean } | null
}

const MEETING_KEY = "dc-meeting"

/** Keep it for as long as this window is open: the agent's first words in its chat go by it. */
export function rememberMeeting(meeting: Meeting): void {
  try {
    sessionStorage.setItem(MEETING_KEY, JSON.stringify(meeting))
  } catch {
    // Its chat then says hello as any empty chat does.
  }
}

/** The meeting with this agent, if it was in this window. */
export function meetingWith(agentId: string): Meeting | undefined {
  try {
    const kept = JSON.parse(sessionStorage.getItem(MEETING_KEY) ?? "null") as Meeting | null
    return kept?.agentId === agentId ? kept : undefined
  } catch {
    return undefined
  }
}
