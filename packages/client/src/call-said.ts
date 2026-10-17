import type { CallLine } from "@do-computer/protocol"

/**
 * What has been said on a call, as the words arrive: what each of the two is in the middle of
 * saying, and the lines that are finished. One kind of call says when somebody has finished and
 * gives all of what they said; the other only ever sends words, and a line is then what was
 * said up to a pause. Either way a thing that was said is one line, once.
 */
export type Said = {
  lines: CallLine[]
  /** What each of the two is in the middle of saying. */
  you: string
  dood: string
  /** When each last added to it. */
  youAt: number
  doodAt: number
  /**
   * Where in `lines` the line of each is that was taken at a pause while its speaker was still
   * to be heard to finish. When they are, that line becomes all of what they said.
   */
  paused: { you?: number; dood?: number }
}

export const NOTHING_SAID: Said = { lines: [], you: "", dood: "", youAt: 0, doodAt: 0, paused: {} }

type Who = "you" | "dood"

const tidy = (text: string) => text.replace(/\s+/g, " ").trim()

/** More words of what one of the two is saying. */
export function addWords(said: Said, who: Who, text: string, now: number): Said {
  return who === "you"
    ? { ...said, you: said.you + text, youAt: now }
    : { ...said, dood: said.dood + text, doodAt: now }
}

/**
 * The call says one of the two has finished, and gives all of what they said. `line` is what
 * the server has not been told of it, where there is any.
 */
export function turnDone(
  said: Said,
  who: Who,
  whole: string,
): { said: Said; line: CallLine | undefined } {
  const text = tidy(whole)
  const rest = tidy(said[who])
  const at = said.paused[who]
  const paused = { ...said.paused }
  delete paused[who]
  if (at !== undefined && said.lines[at] !== undefined) {
    // Part of it was taken at a pause already. That line is now the whole of it, and all the
    // server lacks is what was said since the pause.
    const lines = said.lines.slice()
    lines[at] = { who, text: text || tidy(`${lines[at]!.text} ${rest}`) }
    return {
      said: { ...said, lines, [who]: "", paused },
      line: rest === "" ? undefined : { who, text: rest },
    }
  }
  const line = text !== "" ? { who, text } : rest !== "" ? { who, text: rest } : undefined
  return {
    said: {
      ...said,
      lines: line === undefined ? said.lines : [...said.lines, line],
      [who]: "",
      paused,
    },
    line,
  }
}

/**
 * Take what one of the two has said so far as a line: they paused, or it is needed now.
 * `expectsTurn` is whether the call will still say when they have finished, in which case the
 * line is kept track of, to become all of what they said then.
 */
export function takePause(
  said: Said,
  who: Who,
  expectsTurn: boolean,
): { said: Said; line: CallLine | undefined } {
  const text = tidy(said[who])
  if (text === "") return { said, line: undefined }
  const at = said.paused[who]
  if (expectsTurn && at !== undefined && said.lines[at] !== undefined) {
    // More of something part of which was taken already: it is one thing said, on one line.
    const lines = said.lines.slice()
    lines[at] = { who, text: `${lines[at]!.text} ${text}` }
    return { said: { ...said, lines, [who]: "" }, line: { who, text } }
  }
  const line: CallLine = { who, text }
  return {
    said: {
      ...said,
      lines: [...said.lines, line],
      [who]: "",
      paused: expectsTurn ? { ...said.paused, [who]: said.lines.length } : said.paused,
    },
    line,
  }
}

/** Take as said whatever either of the two has left hanging for longer than `pauseMs`. */
export function takePauses(
  said: Said,
  now: number,
  pauseMs: number,
  expectsTurn: boolean,
): { said: Said; lines: CallLine[] } {
  const lines: CallLine[] = []
  let next = said
  for (const who of ["you", "dood"] as const) {
    const at = who === "you" ? next.youAt : next.doodAt
    if (next[who] === "" || now - at <= pauseMs) continue
    const taken = takePause(next, who, expectsTurn)
    next = taken.said
    if (taken.line !== undefined) lines.push(taken.line)
  }
  return { said: next, lines }
}
