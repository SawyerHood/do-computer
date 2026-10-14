import type { CallLine } from "@do-computer/protocol"
import { describe, expect, it } from "vitest"
import { addWords, NOTHING_SAID, type Said, takePause, takePauses, turnDone } from "./call-said.ts"

/** A call as it goes: the lines the page shows, and the ones the server is told. */
function call() {
  let said: Said = NOTHING_SAID
  const told: CallLine[] = []
  const keep = (next: { said: Said; line?: CallLine | undefined; lines?: CallLine[] }) => {
    said = next.said
    told.push(...(next.lines ?? (next.line === undefined ? [] : [next.line])))
  }
  return {
    words: (who: "you" | "dood", text: string, at: number) => {
      said = addWords(said, who, text, at)
    },
    done: (who: "you" | "dood", whole: string) => keep(turnDone(said, who, whole)),
    pause: (who: "you" | "dood", expectsTurn: boolean) => keep(takePause(said, who, expectsTurn)),
    tick: (now: number, pauseMs: number, expectsTurn: boolean) =>
      keep(takePauses(said, now, pauseMs, expectsTurn)),
    get shown() {
      return said.lines.map((line) => `${line.who}: ${line.text}`)
    },
    get told() {
      return told.map((line) => `${line.who}: ${line.text}`)
    },
    get saying() {
      return { you: said.you, dood: said.dood }
    },
  }
}

describe("a call that says when somebody has finished (a ChatGPT sign-in)", () => {
  // The times are a real call's: the end of a turn is said about two seconds after its last word.
  it("keeps each thing said as one line, though its end is said late", () => {
    const c = call()
    c.words("you", " What", 21_440)
    c.words("you", " is my favorite color?", 23_130)
    c.words("dood", " Teal", 23_130)
    c.words("dood", ".", 23_340)
    // The page looks for sentences left hanging, every so often. Nothing is, yet.
    c.tick(24_000, 8_000, true)
    c.tick(24_800, 8_000, true)
    expect(c.shown).toEqual([])
    expect(c.saying).toEqual({ you: " What is my favorite color?", dood: " Teal." })
    c.done("you", " What is my favorite color?")
    c.tick(25_200, 8_000, true)
    c.done("dood", " Teal.")
    expect(c.shown).toEqual(["you: What is my favorite color?", "dood: Teal."])
    expect(c.told).toEqual(c.shown)
    expect(c.saying).toEqual({ you: "", dood: "" })
  })

  it("does not take a request twice: it is handed on before its speaker is said to have finished", () => {
    const c = call()
    c.words("you", " Please look in my project folder", 36_000)
    // The hand-off arrives here, with the request in words. Nothing is taken for it.
    c.done("you", " Please look in my project folder")
    c.words("dood", " Let me check.", 39_000)
    c.done("dood", " Let me check.")
    expect(c.shown).toEqual(["you: Please look in my project folder", "dood: Let me check."])
    expect(c.told).toEqual(c.shown)
  })

  it("takes a turn whose end never comes, and makes that line the whole of it if it then does", () => {
    const c = call()
    c.words("dood", " I could not find", 10_000)
    c.tick(19_000, 8_000, true)
    expect(c.shown).toEqual(["dood: I could not find"])
    // It went on, and paused again: still one thing said, on one line.
    c.words("dood", " a project folder", 20_000)
    c.tick(29_000, 8_000, true)
    expect(c.shown).toEqual(["dood: I could not find a project folder"])
    c.words("dood", " anywhere.", 30_000)
    c.done("dood", " I could not find a project folder anywhere.")
    expect(c.shown).toEqual(["dood: I could not find a project folder anywhere."])
    // The server was told each part once, and nothing twice.
    expect(c.told).toEqual(["dood: I could not find", "dood: a project folder", "dood: anywhere."])
    // The next thing said is a line of its own.
    c.words("dood", " Anything else?", 40_000)
    c.done("dood", " Anything else?")
    expect(c.shown).toHaveLength(2)
  })

  it("passes over a turn in which nothing was said", () => {
    const c = call()
    c.done("you", "   ")
    c.pause("dood", true)
    expect(c.shown).toEqual([])
    expect(c.told).toEqual([])
  })
})

describe("a call that only ever sends words (an OpenAI key)", () => {
  it("takes a line at each pause, and never joins two", () => {
    const c = call()
    c.words("you", " Hello, can you hear me?", 8_700)
    c.tick(9_500, 1_600, false)
    expect(c.shown).toEqual([])
    c.tick(10_400, 1_600, false)
    expect(c.shown).toEqual(["you: Hello, can you hear me?"])
    c.words("dood", " Yep, I hear", 11_800)
    c.words("dood", " you fine.", 12_100)
    c.tick(12_900, 1_600, false)
    expect(c.shown).toHaveLength(1)
    c.tick(13_800, 1_600, false)
    c.words("you", " What is my favorite color?", 20_000)
    c.tick(21_700, 1_600, false)
    expect(c.shown).toEqual([
      "you: Hello, can you hear me?",
      "dood: Yep, I hear you fine.",
      "you: What is my favorite color?",
    ])
    expect(c.told).toEqual(c.shown)
  })

  it("takes what the person was saying when it is handed on", () => {
    const c = call()
    c.words("you", " Please look in my project folder", 36_000)
    c.pause("you", false)
    expect(c.shown).toEqual(["you: Please look in my project folder"])
    // Nothing more is said of it, so nothing more is taken.
    c.tick(40_000, 1_600, false)
    expect(c.shown).toHaveLength(1)
  })

  it("lets the two talk over each other", () => {
    const c = call()
    c.words("you", " So I was", 1_000)
    c.words("dood", " Mm-hm.", 1_200)
    c.words("you", " thinking.", 1_500)
    c.tick(3_200, 1_600, false)
    expect(c.shown).toEqual(["you: So I was thinking.", "dood: Mm-hm."])
  })
})
