/**
 * Code in its colors, on a phone. The web app reads code with Shiki, whose grammars need a
 * regular-expression engine a phone's JavaScript has not got, so this reads it more simply:
 * comments, strings, numbers, a language's own words, what is called, and punctuation. It is the
 * same seven kinds the web app colors (`--syntax-*`, in packages/protocol/src/theme.ts), so a
 * block looks alike in both, and it is plain functions that never throw on half-written code.
 */

/** What a piece of code is, which says the color it is drawn in. */
export type SyntaxKind =
  "keyword" | "constant" | "string" | "function" | "parameter" | "comment" | "punctuation"

/** A piece of a line, and what it is: nothing for plain text. */
export type SyntaxToken = { text: string; kind?: SyntaxKind }

/** The seven colors, as the web app has them: its `oklch()` values written as a phone reads them. */
export const SYNTAX_COLORS: Record<"light" | "dark", Record<SyntaxKind, string>> = {
  light: {
    keyword: "#7a41af",
    constant: "#0465af",
    string: "#1d7339",
    function: "#9a5505",
    parameter: "#ab4235",
    comment: "#6a6f71",
    punctuation: "#595e60",
  },
  dark: {
    keyword: "#cca7f8",
    constant: "#82c2f7",
    string: "#83d494",
    function: "#eabc6e",
    parameter: "#f4a294",
    comment: "#9a9fa1",
    punctuation: "#adb2b4",
  },
}

/** Longer than this, code is left plain: reading it would hold the chat up. */
const MAX_CHARS = 80_000

const words = (list: string) => new Set(list.split(" "))

/** How a language is read by the one reader most of them share. */
type Rules = {
  /** What starts a comment that runs to the end of its line. */
  line?: string[]
  /** What opens and shuts a comment that can run over lines. */
  block?: [string, string][]
  /** What opens a string. One that is three of a quote, or a backtick, can run over lines. */
  quotes: string[]
  keywords: Set<string>
  constants?: Set<string>
  /** Whether the language's words are the same in any case, as SQL's are. */
  anyCase?: boolean
  /** A name the language marks as a variable, such as `$HOME`. */
  variable?: RegExp
}

const C_CONSTANTS = words(
  "true false null undefined NaN Infinity nil None nullptr NULL this self super",
)

const JS = words(
  "abstract any as async await break case catch class const continue debugger declare default delete do else enum export extends finally for from function get if implements import in infer instanceof interface is keyof let namespace new of package private protected public readonly return satisfies set static switch throw try type typeof unique var void while with yield boolean number string symbol never unknown object",
)

const c = (keywords: string, more: Partial<Rules> = {}): Rules => ({
  line: ["//"],
  block: [["/*", "*/"]],
  quotes: ['"', "'"],
  keywords: words(keywords),
  constants: C_CONSTANTS,
  ...more,
})

const script: Rules = { ...c(""), keywords: JS, quotes: ['"', "'", "`"] }

const shell: Rules = {
  line: ["#"],
  quotes: ['"', "'"],
  keywords: words(
    "if then else elif fi for while until do done case esac in function select return exit export local readonly declare unset shift source alias set echo cd sudo",
  ),
  constants: words("true false"),
  variable: /^\$(?:\{[^}\n]*\}|[A-Za-z_][\w]*|[0-9@#?*!$-])/,
}

const RULES: Record<string, Rules> = {
  javascript: script,
  typescript: script,
  jsx: script,
  tsx: script,
  svelte: script,
  vue: script,
  bash: shell,
  docker: {
    ...shell,
    keywords: words(
      "FROM RUN CMD LABEL EXPOSE ENV ADD COPY ENTRYPOINT VOLUME USER WORKDIR ARG ONBUILD STOPSIGNAL HEALTHCHECK SHELL AS",
    ),
  },
  make: {
    ...shell,
    keywords: words("ifeq ifneq ifdef ifndef else endif include define endef export override"),
  },
  powershell: {
    line: ["#"],
    block: [["<#", "#>"]],
    quotes: ['"', "'"],
    anyCase: true,
    keywords: words(
      "begin break catch class continue data do else elseif end exit filter finally for foreach function if in param process return switch throw trap try until using while",
    ),
    constants: words("$true $false $null"),
    variable: /^\$[A-Za-z_][\w:]*/,
  },
  python: {
    line: ["#"],
    quotes: ['"""', "'''", '"', "'"],
    keywords: words(
      "and as assert async await break class continue def del elif else except finally for from global if import in is lambda match case nonlocal not or pass raise return try while with yield",
    ),
    constants: words("True False None self cls"),
  },
  ruby: {
    line: ["#"],
    quotes: ['"', "'", "`"],
    keywords: words(
      "alias and begin break case class def defined? do else elsif end ensure for if in module next not or redo rescue retry return then undef unless until when while yield require require_relative include extend attr_accessor attr_reader attr_writer private protected public",
    ),
    constants: words("true false nil self"),
    variable: /^(?:@@?|\$)[A-Za-z_]\w*|^:[A-Za-z_]\w*/,
  },
  elixir: {
    line: ["#"],
    quotes: ['"""', '"', "'"],
    keywords: words(
      "after alias and case catch cond def defp defmodule defprotocol defimpl defmacro defstruct do else end fn for if import in not or quote raise receive require rescue try unless unquote use when with",
    ),
    constants: words("true false nil"),
    variable: /^(?:@[a-z_]\w*|:[A-Za-z_]\w*)/,
  },
  lua: {
    line: ["--"],
    block: [["--[[", "]]"]],
    quotes: ['"', "'"],
    keywords: words(
      "and break do else elseif end for function goto if in local not or repeat return then until while",
    ),
    constants: words("true false nil"),
  },
  r: {
    line: ["#"],
    quotes: ['"', "'"],
    keywords: words("if else repeat while function for next break in library require return"),
    constants: words("TRUE FALSE NULL NA Inf NaN"),
  },
  sql: {
    line: ["--"],
    block: [["/*", "*/"]],
    quotes: ["'", '"'],
    anyCase: true,
    keywords: words(
      "add all alter and as asc begin between by case check column commit constraint create cross database default delete desc distinct drop else end exists foreign from full group having if in index inner insert into is join key left like limit not offset on or order outer primary references returning right rollback select set table then union unique update values view when where with",
    ),
    constants: words("true false null"),
  },
  go: c(
    "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var string int int64 int32 float64 bool byte rune error any",
    { quotes: ['"', "'", "`"] },
  ),
  rust: c(
    "as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return static struct trait type unsafe use where while",
    // A single quote is a lifetime there far more often than a character.
    { quotes: ['"'] },
  ),
  java: c(
    "abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public record return short static strictfp switch synchronized throw throws transient try var void volatile while",
  ),
  kotlin: c(
    "as break by class companion continue data do else enum for fun if import in interface internal is object open override package private protected public return sealed suspend throw try typealias val var when while",
  ),
  scala: c(
    "abstract case catch class def do else enum extends final finally for given if implicit import lazy match new object override package private protected return sealed throw trait try type using val var while with yield",
  ),
  swift: c(
    "actor as associatedtype async await break case catch class continue default defer do else enum extension fallthrough fileprivate for func guard if import in init inout internal is let mutating open operator private protocol public repeat return some static struct subscript switch throw throws try typealias var where while",
  ),
  dart: c(
    "abstract as assert async await break case catch class const continue default do dynamic else enum export extends extension external factory final finally for get if implements import in is late library mixin new on part required return set static switch throw try typedef var void while with yield",
  ),
  c: c(
    "auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while #include #define #ifdef #ifndef #endif #if #else #pragma",
  ),
  cpp: c(
    "alignas auto bool break case catch char class const constexpr continue default delete do double else enum explicit extern float for friend goto if inline int long mutable namespace new noexcept operator private protected public return short signed sizeof static struct switch template throw try typedef typename union unsigned using virtual void volatile while #include #define #ifdef #ifndef #endif #if #else #pragma",
  ),
  csharp: c(
    "abstract as async await base bool break byte case catch char class const continue decimal default delegate do double else enum event explicit extern finally float for foreach get if implicit in int interface internal is lock long namespace new object operator out override params private protected public readonly record ref return sealed set short sizeof static string struct switch throw try typeof using var virtual void while yield",
  ),
  php: c(
    "abstract and array as break case catch class clone const continue declare default do echo else elseif extends final finally fn for foreach function global if implements include instanceof interface namespace new or print private protected public require return static switch throw trait try use var while yield",
    { line: ["//", "#"], variable: /^\$[A-Za-z_]\w*/ },
  ),
  zig: c(
    "align and break catch comptime const continue defer else enum errdefer error export extern fn for if inline or orelse packed pub return struct switch test try union unreachable usingnamespace var while",
  ),
  proto: c(
    "syntax package import option message enum service rpc returns repeated optional required oneof map reserved stream string bytes bool int32 int64 uint32 uint64 double float",
  ),
  graphql: {
    line: ["#"],
    quotes: ['"""', '"'],
    keywords: words(
      "query mutation subscription fragment on type interface union enum input scalar schema extend directive implements",
    ),
    constants: words("true false null"),
    variable: /^\$[A-Za-z_]\w*/,
  },
  terraform: {
    line: ["#", "//"],
    block: [["/*", "*/"]],
    quotes: ['"'],
    keywords: words(
      "resource data variable output locals module provider terraform for_each count if for in dynamic",
    ),
    constants: words("true false null"),
  },
  nix: {
    line: ["#"],
    block: [["/*", "*/"]],
    quotes: ['"', "''"],
    keywords: words("let in with rec inherit if then else assert import"),
    constants: words("true false null"),
  },
  scss: c("@use @import @mixin @include @extend @if @else @each @for @function @return @media"),
}

/** What people write after a fence, for the language it means: the web app's list. */
const ALIASES: Record<string, string> = {
  "c#": "csharp",
  "c++": "cpp",
  cjs: "javascript",
  console: "bash",
  cs: "csharp",
  dockerfile: "docker",
  golang: "go",
  h: "c",
  hcl: "terraform",
  hpp: "cpp",
  htm: "html",
  js: "javascript",
  jsonc: "json",
  kt: "kotlin",
  makefile: "make",
  mjs: "javascript",
  patch: "diff",
  ps1: "powershell",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  shell: "bash",
  shellscript: "bash",
  svg: "xml",
  tf: "terraform",
  ts: "typescript",
  yml: "yaml",
  zsh: "bash",
}

/** Languages that are read their own way, not by the shared reader. */
const OWN: Record<string, (code: string) => SyntaxToken[]> = {
  json: readJson,
  yaml: readYaml,
  toml: readIni,
  ini: readIni,
  html: readMarkup,
  xml: readMarkup,
  css: readCss,
  diff: readDiff,
}

/** The name a fence's language is read under, or undefined where it is left plain. */
export function languageFor(language: string): string | undefined {
  const name = language.trim().toLowerCase()
  const known = ALIASES[name] ?? name
  return known in RULES || known in OWN ? known : undefined
}

/** Collects pieces, joining plain text that sits side by side. */
class Pieces {
  readonly all: SyntaxToken[] = []
  add(text: string, kind?: SyntaxKind) {
    if (text === "") return
    const last = this.all.at(-1)
    if (last !== undefined && last.kind === kind) last.text += text
    else this.all.push(kind === undefined ? { text } : { text, kind })
  }
}

const NUMBER =
  /^(?:0[xX][\da-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)[a-zA-Z%]*/
const NAME = /^[A-Za-z_$#@][\w$]*/
const PUNCTUATION = "{}[]();,.:"

/** Where a string that opened at `from` with `quote` ends: past its closing quote, or the line's end. */
function stringEnd(code: string, from: number, quote: string): number {
  const long = quote.length > 1 || quote === "`"
  let at = from + quote.length
  while (at < code.length) {
    if (code[at] === "\\") {
      at += 2
      continue
    }
    if (code.startsWith(quote, at)) return at + quote.length
    if (!long && code[at] === "\n") return at
    at++
  }
  return code.length
}

/** The shared reader: most languages differ only in their comments, quotes and words. */
function readWith(rules: Rules, code: string): SyntaxToken[] {
  const out = new Pieces()
  const has = (set: Set<string> | undefined, word: string) =>
    set !== undefined && (set.has(word) || (rules.anyCase === true && set.has(word.toLowerCase())))
  let at = 0
  // Whether the last thing read could end a word, so `#` in `a#b` or a digit in `x1` starts nothing.
  let inWord = false
  while (at < code.length) {
    const rest = code.slice(at, at + 200)
    const block = rules.block?.find(([open]) => code.startsWith(open, at))
    if (block !== undefined) {
      const shut = code.indexOf(block[1], at + block[0].length)
      const end = shut < 0 ? code.length : shut + block[1].length
      out.add(code.slice(at, end), "comment")
      at = end
      inWord = false
      continue
    }
    if (!inWord && rules.line?.some((mark) => code.startsWith(mark, at))) {
      const stop = code.indexOf("\n", at)
      const end = stop < 0 ? code.length : stop
      out.add(code.slice(at, end), "comment")
      at = end
      continue
    }
    const quote = rules.quotes.find((mark) => code.startsWith(mark, at))
    if (quote !== undefined) {
      const end = stringEnd(code, at, quote)
      out.add(code.slice(at, end), "string")
      at = end
      inWord = false
      continue
    }
    const variable = inWord ? null : (rules.variable?.exec(rest) ?? null)
    if (variable !== null) {
      out.add(variable[0], "parameter")
      at += variable[0].length
      inWord = true
      continue
    }
    const number = inWord ? null : NUMBER.exec(rest)
    if (number !== null) {
      out.add(number[0], "constant")
      at += number[0].length
      inWord = true
      continue
    }
    const name = inWord ? null : NAME.exec(rest)
    if (name !== null) {
      const word = name[0]
      at += word.length
      inWord = true
      if (has(rules.keywords, word)) out.add(word, "keyword")
      else if (has(rules.constants, word)) out.add(word, "constant")
      else if (/^\s*\(/.test(code.slice(at, at + 8))) out.add(word, "function")
      else if (word.length > 1 && /^[A-Z][A-Z0-9_]*$/.test(word)) out.add(word, "constant")
      else out.add(word)
      continue
    }
    const char = code[at]!
    out.add(char, PUNCTUATION.includes(char) ? "punctuation" : undefined)
    inWord = /[\w$]/.test(char)
    at++
  }
  return out.all
}

/** JSON: a name before a colon is the thing named, and the rest is strings, numbers and three words. */
function readJson(code: string): SyntaxToken[] {
  const out = new Pieces()
  let at = 0
  while (at < code.length) {
    const char = code[at]!
    if (char === '"') {
      const end = stringEnd(code, at, '"')
      out.add(code.slice(at, end), /^\s*:/.test(code.slice(end, end + 16)) ? "keyword" : "string")
      at = end
      continue
    }
    if (code.startsWith("//", at)) {
      const stop = code.indexOf("\n", at)
      const end = stop < 0 ? code.length : stop
      out.add(code.slice(at, end), "comment")
      at = end
      continue
    }
    const word = /^(?:-?\d[\d.eE+-]*|true|false|null)/.exec(code.slice(at, at + 40))
    if (word !== null) {
      out.add(word[0], "constant")
      at += word[0].length
      continue
    }
    out.add(char, PUNCTUATION.includes(char) ? "punctuation" : undefined)
    at++
  }
  return out.all
}

/** What stands for a value in YAML, TOML and the like: a string, a number, a word, or plain text. */
function addValue(out: Pieces, value: string) {
  const comment = /(^|\s)#.*$/.exec(value)
  const said = comment === null ? value : value.slice(0, comment.index + comment[1]!.length)
  const lead = /^\s*/.exec(said)![0]
  const body = said.slice(lead.length).trimEnd()
  const tail = said.slice(lead.length + body.length)
  out.add(lead)
  if (/^(["']).*\1$/.test(body)) out.add(body, "string")
  else if (/^(?:-?\d[\d._]*|true|false|null|yes|no|~)$/i.test(body)) out.add(body, "constant")
  else out.add(body, body === "" ? undefined : "string")
  out.add(tail)
  if (comment !== null) out.add(value.slice(said.length), "comment")
}

/** Each line of a language that is read a line at a time, with the line ends put back. */
function byLine(code: string, read: (line: string, out: Pieces) => void): SyntaxToken[] {
  const out = new Pieces()
  const lines = code.split("\n")
  lines.forEach((line, index) => {
    read(line, out)
    if (index < lines.length - 1) out.add("\n")
  })
  return out.all
}

function readYaml(code: string): SyntaxToken[] {
  return byLine(code, (line, out) => {
    if (/^\s*#/.test(line)) return out.add(line, "comment")
    const key = /^(\s*(?:-\s+)*)([^\s#:"'][^:#]*|"[^"]*"|'[^']*')(:)(\s|$)/.exec(line)
    if (key === null) {
      const item = /^(\s*(?:-\s+)+)(.*)$/.exec(line)
      if (item === null) return addValue(out, line)
      out.add(item[1]!, "punctuation")
      return addValue(out, item[2]!)
    }
    out.add(key[1]!, "punctuation")
    out.add(key[2]!, "keyword")
    out.add(key[3]!, "punctuation")
    addValue(out, line.slice(key[0].length - key[4]!.length))
  })
}

function readIni(code: string): SyntaxToken[] {
  return byLine(code, (line, out) => {
    if (/^\s*[#;]/.test(line)) return out.add(line, "comment")
    if (/^\s*\[.*\]\s*$/.test(line)) return out.add(line, "function")
    const key = /^(\s*[^=\s][^=]*?)(\s*=)(.*)$/.exec(line)
    if (key === null) return out.add(line)
    out.add(key[1]!, "keyword")
    out.add(key[2]!, "punctuation")
    addValue(out, key[3]!)
  })
}

function readDiff(code: string): SyntaxToken[] {
  return byLine(code, (line, out) => {
    if (/^(?:\+\+\+|---|diff |index )/.test(line)) out.add(line, "comment")
    else if (line.startsWith("@@")) out.add(line, "keyword")
    else if (line.startsWith("+")) out.add(line, "string")
    else if (line.startsWith("-")) out.add(line, "parameter")
    else out.add(line)
  })
}

/** HTML and XML: comments, and inside a tag its name, its attributes and what they are set to. */
function readMarkup(code: string): SyntaxToken[] {
  const out = new Pieces()
  let at = 0
  while (at < code.length) {
    if (code.startsWith("<!--", at)) {
      const shut = code.indexOf("-->", at)
      const end = shut < 0 ? code.length : shut + 3
      out.add(code.slice(at, end), "comment")
      at = end
      continue
    }
    const open = /^<[/!?]?[A-Za-z][\w:.-]*/.exec(code.slice(at, at + 80))
    if (open === null) {
      const next = code.indexOf("<", at + 1)
      const end = next < 0 ? code.length : next
      out.add(code.slice(at, end))
      at = end
      continue
    }
    const mark = /^<[/!?]?/.exec(open[0])![0]
    out.add(mark, "punctuation")
    out.add(open[0].slice(mark.length), "keyword")
    at += open[0].length
    while (at < code.length && code[at] !== ">") {
      const char = code[at]!
      if (char === '"' || char === "'") {
        const shut = code.indexOf(char, at + 1)
        const end = shut < 0 ? code.length : shut + 1
        out.add(code.slice(at, end), "string")
        at = end
        continue
      }
      const name = /^[A-Za-z_:@][\w:.-]*/.exec(code.slice(at, at + 80))
      if (name !== null) {
        out.add(name[0], "function")
        at += name[0].length
        continue
      }
      out.add(char, "=/?".includes(char) ? "punctuation" : undefined)
      at++
    }
    if (at < code.length) {
      out.add(">", "punctuation")
      at++
    }
  }
  return out.all
}

/** CSS: what is set is told from what it is set to by the colon between them. */
function readCss(code: string): SyntaxToken[] {
  const out = new Pieces()
  let at = 0
  let depth = 0
  while (at < code.length) {
    const rest = code.slice(at, at + 120)
    if (code.startsWith("/*", at)) {
      const shut = code.indexOf("*/", at + 2)
      const end = shut < 0 ? code.length : shut + 2
      out.add(code.slice(at, end), "comment")
      at = end
      continue
    }
    const char = code[at]!
    if (char === '"' || char === "'") {
      const end = stringEnd(code, at, char)
      out.add(code.slice(at, end), "string")
      at = end
      continue
    }
    const rule = /^@[\w-]+/.exec(rest)
    const property = depth > 0 ? /^(--)?[A-Za-z-][\w-]*(?=\s*:)/.exec(rest) : null
    const number = /^-?(?:\d+\.?\d*|\.\d+)(?:%|[a-z]+)?/.exec(rest)
    const color = /^#[\da-fA-F]{3,8}\b/.exec(rest)
    const call = /^[A-Za-z-][\w-]*(?=\()/.exec(rest)
    const found: [RegExpExecArray | null, SyntaxKind][] = [
      [rule, "keyword"],
      [property, "parameter"],
      [color, "constant"],
      [call, "function"],
    ]
    const hit = found.find(([match]) => match !== null)
    const before = at === 0 ? " " : code[at - 1]!
    if (hit !== undefined) {
      out.add(hit[0]![0], hit[1])
      at += hit[0]![0].length
      continue
    }
    if (number !== null && depth > 0 && !/[\w-]/.test(before)) {
      out.add(number[0], "constant")
      at += number[0].length
      continue
    }
    const word = /^[\w-]+/.exec(rest)
    if (word !== null) {
      out.add(word[0])
      at += word[0].length
      continue
    }
    if (char === "{") depth++
    if (char === "}") depth = Math.max(0, depth - 1)
    out.add(char, PUNCTUATION.includes(char) ? "punctuation" : undefined)
    at++
  }
  return out.all
}

/** One run of pieces as the lines it is written on. */
function inLines(pieces: SyntaxToken[]): SyntaxToken[][] {
  const lines: SyntaxToken[][] = [[]]
  for (const piece of pieces) {
    const parts = piece.text.split("\n")
    parts.forEach((text, index) => {
      if (index > 0) lines.push([])
      if (text !== "")
        lines.at(-1)!.push(piece.kind === undefined ? { text } : { text, kind: piece.kind })
    })
  }
  return lines
}

/**
 * The code as lines of colored pieces, or undefined where it is left plain: a language that is
 * not known, or code too long to be worth reading. Every letter of the code is in what comes
 * back, in order.
 */
export function syntaxOf(code: string, language: string): SyntaxToken[][] | undefined {
  const name = languageFor(language)
  if (name === undefined || code.length > MAX_CHARS) return undefined
  try {
    const own = OWN[name]
    return inLines(own === undefined ? readWith(RULES[name]!, code) : own(code))
  } catch {
    // Nothing above is meant to throw; if it ever does, the code is still shown, plain.
    return undefined
  }
}
