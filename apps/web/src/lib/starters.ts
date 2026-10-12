import type { Meeting } from "./welcome"

/** Something a new agent offers to do first. */
export type Starter = {
  /** What its button says. */
  label: string
  /** What is said to the agent for whoever pressed it, in full, as if they had typed it. */
  say: string
  /** It is done on the computer's screen, which its owner is asked for first. */
  screen?: true
}

const DRAW: Starter = {
  label: "Draw me a picture",
  say: "Open a painting app on this computer and draw me a picture of yourself. I want to watch you do it.",
  screen: true,
}
const GAME: Starter = {
  label: "Make me a little game",
  say: "Make me a little game with you in it that I can play right here in the chat.",
}
const SPACE: Starter = {
  label: "What’s filling up this computer?",
  say: "What is taking up the most space on this computer? Show me a chart.",
}
const RESEARCH: Starter = {
  label: "Research three things at once",
  say: "Pick three things worth knowing about today and research them all at once with sub-agents. Tell me what they find.",
}
const CHECK_IN: Starter = {
  label: "Check in with me every morning",
  say: "Check in with me every morning at 9 with something worth knowing.",
}

/**
 * What a new agent offers to start with, in its first hello: things that show what it can do,
 * by what it was given in the first run. Only a computer it may do more than read on has a
 * screen for it to draw on and a disk for it to measure.
 */
export function startersFor(computer: Meeting["computer"]): Starter[] {
  return computer && !computer.readOnly ? [DRAW, GAME, SPACE, CHECK_IN] : [GAME, RESEARCH, CHECK_IN]
}

/** What the desktop app answers a page that asks for this computer's screen. */
type ScreenAnswer = { allowed: true; missing?: string[] } | { allowed: false; why?: string }

/**
 * Why a starter that takes the screen is not said yet, in words to show, once its owner has
 * been asked for the screen. Nothing where it can go ahead. An empty line is an owner who said
 * no, which needs no saying back to them.
 */
export function screenHolds(answer: ScreenAnswer): string | undefined {
  if (!answer.allowed) return answer.why ?? ""
  const missing = answer.missing ?? []
  if (missing.length === 0) return undefined
  return `macOS has to allow this first. Allow Do Computer under ${missing.join(" and ")} in the window that just opened, then ask me again.`
}
