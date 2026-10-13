/**
 * Code in its colors. The highlighter and each language's grammar are asked for only when a
 * block of code is on the page, so a chat with no code in it loads none of them, and the
 * server, which draws nothing twice, never does.
 *
 * The colors are the app's own variables (`--syntax-*`, in packages/protocol/src/theme.ts), so
 * a block follows light and dark without being read again.
 */

/** A piece of a line, and the variable it is colored with: none for plain text. */
export type Token = { text: string; color?: string; italic?: true }

// Written so that the server's build leaves the highlighter out altogether.
const engine = import.meta.env.SSR ? undefined : () => import("./shiki.ts")

/** Longer than this, code is left plain: reading it would hold the page up. */
const MAX_HIGHLIGHT_CHARS = 80_000
/** How many blocks are remembered, so that one scrolled back to is not read again. */
const MAX_REMEMBERED = 200
const remembered = new Map<string, Token[][]>()

/** Code that was read before, at once: what a block shows first, so it does not flash plain. */
export function highlightedBefore(code: string, language: string): Token[][] | undefined {
  return remembered.get(`${language}\n${code}`)
}

/**
 * The code as lines of colored pieces, or undefined where it is left plain: no grammar for the
 * language, too long, or on the server, where nothing is drawn twice.
 */
export async function highlight(code: string, language: string): Promise<Token[][] | undefined> {
  if (engine === undefined || language === "" || code.length > MAX_HIGHLIGHT_CHARS) return undefined
  const key = `${language}\n${code}`
  const before = remembered.get(key)
  if (before !== undefined) return before
  const lines = await (await engine()).tokensOf(code, language)
  if (lines === undefined) return undefined
  remembered.set(key, lines)
  if (remembered.size > MAX_REMEMBERED) remembered.delete(remembered.keys().next().value!)
  return lines
}
