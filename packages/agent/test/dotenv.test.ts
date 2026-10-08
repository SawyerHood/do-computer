import { describe, expect, it } from "vitest"
import { DotenvError, reconcileDotenv } from "../src/dotenv.ts"

describe("reconcileDotenv", () => {
  it("adds to an empty file", () => {
    expect(reconcileDotenv("", { A: "one", B: "two" })).toEqual({
      content: "A='one'\nB='two'\n",
      added: ["A", "B"],
      updated: [],
      unchanged: [],
    })
  })

  it("changes an assignment where it stands and leaves every other line alone", () => {
    const before = "# keys\r\nexport A=old # first\r\n\r\nB = 'same'\r\nC=\"x\"\r\n"
    const after = reconcileDotenv(before, { A: "new", B: "same", D: "added" })
    expect(after.content).toBe(
      "# keys\r\nexport A='new' # first\r\n\r\nB = 'same'\r\nC=\"x\"\r\nD='added'\r\n",
    )
    expect(after).toMatchObject({ added: ["D"], updated: ["A"], unchanged: ["B"] })
  })

  it("quotes a value so that it reads back as it was typed", () => {
    expect(reconcileDotenv("", { A: "it's" }).content).toBe(`A="it's"\n`)
    expect(reconcileDotenv("", { A: "has # hash and $var" }).content).toBe(
      "A='has # hash and $var'\n",
    )
    expect(() => reconcileDotenv("", { A: `both ' and "` })).toThrow(DotenvError)
  })

  it("refuses a file it cannot change safely", () => {
    expect(() => reconcileDotenv("A=1\nA=2\n", { A: "3" })).toThrow(/more than once/)
    expect(() => reconcileDotenv('KEY="-----BEGIN\nMIIE\n-----END"\n', { A: "3" })).toThrow(
      /several lines/,
    )
  })
})
