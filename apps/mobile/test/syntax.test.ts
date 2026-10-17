import { describe, expect, it } from "vitest"
import { languageFor, type SyntaxToken, syntaxOf } from "../src/ui/syntax.ts"

/** The pieces of one kind on a line, by their text. */
const of = (line: SyntaxToken[] | undefined, kind: string) =>
  (line ?? []).filter((piece) => piece.kind === kind).map((piece) => piece.text)

const whole = (lines: SyntaxToken[][] | undefined) =>
  (lines ?? []).map((line) => line.map((piece) => piece.text).join("")).join("\n")

describe("code in its colors on a phone", () => {
  it("knows a language by what people write after a fence", () => {
    expect(languageFor("ts")).toBe("typescript")
    expect(languageFor("Python")).toBe("python")
    expect(languageFor("yml")).toBe("yaml")
    expect(languageFor("sh")).toBe("bash")
    expect(languageFor("")).toBeUndefined()
    expect(languageFor("brainfuck")).toBeUndefined()
  })

  it("leaves code in a language it does not know plain", () => {
    expect(syntaxOf("+++>", "brainfuck")).toBeUndefined()
  })

  it("tells a language's words, what is called, strings, numbers and comments apart", () => {
    const [line] = syntaxOf('const total = add(price, 2) // "not a string"', "ts")!
    expect(of(line, "keyword")).toEqual(["const"])
    expect(of(line, "function")).toEqual(["add"])
    expect(of(line, "constant")).toEqual(["2"])
    expect(of(line, "comment")).toEqual(['// "not a string"'])
    expect(of(line, "string")).toEqual([])
  })

  it("keeps a comment or a string that runs over lines one thing on each of them", () => {
    const lines = syntaxOf("/* one\n   two */ let x = `a\nb`", "js")!
    expect(of(lines[0], "comment")).toEqual(["/* one"])
    expect(of(lines[1], "comment")).toEqual(["   two */"])
    expect(of(lines[1], "string")).toEqual(["`a"])
    expect(of(lines[2], "string")).toEqual(["b`"])
  })

  it("ends an ordinary string at the end of its line when it was never shut", () => {
    const lines = syntaxOf('x = "half\ny = 1', "python")!
    expect(of(lines[0], "string")).toEqual(['"half'])
    expect(of(lines[1], "constant")).toEqual(["1"])
  })

  it("reads a string with a letter in front of it", () => {
    const [line] = syntaxOf('print(f"hello {name}")', "py")!
    expect(of(line, "string")).toEqual(['"hello {name}"'])
    expect(of(line, "function")).toEqual(["print"])
  })

  it("reads a shell's variables, and a hash only as a comment where one can start", () => {
    const [line] = syntaxOf('echo "$HOME" $1 ${dir}/a#b # done', "bash")!
    expect(of(line, "parameter")).toEqual(["$1", "${dir}"])
    expect(of(line, "comment")).toEqual(["# done"])
  })

  it("reads SQL's words in any case", () => {
    const [line] = syntaxOf("select name FROM people where id = 3", "sql")!
    expect(of(line, "keyword")).toEqual(["select", "FROM", "where"])
  })

  it("tells a JSON name from a JSON string", () => {
    const [line] = syntaxOf('{"name": "Juniper", "age": 3, "ok": true}', "json")!
    expect(of(line, "keyword")).toEqual(['"name"', '"age"', '"ok"'])
    expect(of(line, "string")).toEqual(['"Juniper"'])
    expect(of(line, "constant")).toEqual(["3", "true"])
  })

  it("reads YAML's names, values and comments", () => {
    const lines = syntaxOf("name: juniper # hers\nport: 8080\n- item", "yaml")!
    expect(of(lines[0], "keyword")).toEqual(["name"])
    expect(of(lines[0], "string")).toEqual(["juniper"])
    expect(of(lines[0], "comment")).toEqual(["# hers"])
    expect(of(lines[1], "constant")).toEqual(["8080"])
  })

  it("reads a tag's name, its attributes and what they are set to", () => {
    const [line] = syntaxOf('<a href="/x" hidden>go</a><!-- note -->', "html")!
    expect(of(line, "keyword")).toEqual(["a", "a"])
    expect(of(line, "function")).toEqual(["href", "hidden"])
    expect(of(line, "string")).toEqual(['"/x"'])
    expect(of(line, "comment")).toEqual(["<!-- note -->"])
  })

  it("reads what CSS sets and what it sets it to", () => {
    const [line] = syntaxOf("a:hover { color: #fff; margin: 4px calc(1px) }", "css")!
    expect(of(line, "parameter")).toEqual(["color", "margin"])
    expect(of(line, "constant")).toEqual(["#fff", "4px", "1px"])
    expect(of(line, "function")).toEqual(["calc"])
  })

  it("colors a diff's lines by what they do", () => {
    const lines = syntaxOf("@@ -1 +1 @@\n-old\n+new\n same", "diff")!
    expect(lines.map((line) => line[0]?.kind)).toEqual([
      "keyword",
      "parameter",
      "string",
      undefined,
    ])
  })

  it("gives back every letter of the code, in order, whatever it is", () => {
    const samples: [string, string][] = [
      ["ts", "const a = `x${1}`;\n\n/* never shut"],
      ["py", "'''doc\nstring''' + \"\\\"\"\n"],
      ["yaml", "a:\n  - b: 'c'\n  - # d\n"],
      ["html", "<p class='x' <b>unfinished"],
      ["css", "@media (x) { a { b: c } "],
      ["json", '{"a": [1, 2, {"b": null}]'],
      ["toml", '[package]\nname = "x" # y\n'],
      ["bash", "if [ -f x ]; then echo $?; fi\n"],
    ]
    for (const [language, code] of samples) expect(whole(syntaxOf(code, language))).toBe(code)
  })
})
