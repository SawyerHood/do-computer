import { atom } from "jotai"

/**
 * The agent that was just met in the first run, by its id, or null. Its chat reads this to say
 * hello with things to try, and sets it back to null once it has.
 */
export const metAtom = atom<string | null>(null)

/**
 * The page that sent someone to sign in, or to the first run, to come back to it afterwards, as
 * an invitation does: a path of this app such as `/invite/<token>`, or null.
 */
export const nextAtom = atom<string | null>(null)
