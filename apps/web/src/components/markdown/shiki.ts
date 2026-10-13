import type { HighlighterCore, ThemedToken } from "shiki/core"

import type { Token } from "./highlight.ts"

/**
 * The highlighter itself and the grammars it reads languages with. This file is asked for only
 * by a browser with a block of code on the page (see highlight.ts), and each grammar only when
 * a block in that language is.
 */

/** The languages there is a grammar for, each loaded when it is first met. */
const GRAMMARS: Record<string, () => Promise<unknown>> = {
  bash: () => import("shiki/langs/bash.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  csharp: () => import("shiki/langs/csharp.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  dart: () => import("shiki/langs/dart.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  docker: () => import("shiki/langs/docker.mjs"),
  elixir: () => import("shiki/langs/elixir.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  graphql: () => import("shiki/langs/graphql.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  http: () => import("shiki/langs/http.mjs"),
  ini: () => import("shiki/langs/ini.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsonc: () => import("shiki/langs/jsonc.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  kotlin: () => import("shiki/langs/kotlin.mjs"),
  lua: () => import("shiki/langs/lua.mjs"),
  make: () => import("shiki/langs/make.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  nix: () => import("shiki/langs/nix.mjs"),
  php: () => import("shiki/langs/php.mjs"),
  powershell: () => import("shiki/langs/powershell.mjs"),
  proto: () => import("shiki/langs/proto.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  r: () => import("shiki/langs/r.mjs"),
  ruby: () => import("shiki/langs/ruby.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  scala: () => import("shiki/langs/scala.mjs"),
  scss: () => import("shiki/langs/scss.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  svelte: () => import("shiki/langs/svelte.mjs"),
  swift: () => import("shiki/langs/swift.mjs"),
  terraform: () => import("shiki/langs/terraform.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  vue: () => import("shiki/langs/vue.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  zig: () => import("shiki/langs/zig.mjs"),
}

/** What people write after a fence, for the grammar it means. */
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
  js: "javascript",
  kt: "kotlin",
  makefile: "make",
  md: "markdown",
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

/** The grammar a fence's language is read with, or undefined where there is none for it. */
export function grammarFor(language: string): string | undefined {
  const name = language.toLowerCase()
  const known = ALIASES[name] ?? name
  return known in GRAMMARS ? known : undefined
}

const THEME = "dc"

let highlighter: Promise<HighlighterCore> | undefined
const loaded = new Map<string, Promise<void>>()

async function ready(grammar: string): Promise<HighlighterCore> {
  highlighter ??= Promise.all([import("shiki/core"), import("shiki/engine/javascript")]).then(
    ([core, engine]) =>
      core.createHighlighterCore({
        themes: [
          core.createCssVariablesTheme({
            name: THEME,
            variablePrefix: "--shiki-",
            fontStyle: true,
          }),
        ],
        langs: [],
        // The engine written in JavaScript: the other is a WebAssembly file as large as the
        // rest of the chat.
        engine: engine.createJavaScriptRegexEngine(),
      }),
  )
  const shiki = await highlighter
  let grammarLoaded = loaded.get(grammar)
  if (grammarLoaded === undefined) {
    grammarLoaded = GRAMMARS[grammar]!().then((module) =>
      shiki.loadLanguage((module as { default: Parameters<typeof shiki.loadLanguage>[0] }).default),
    )
    loaded.set(grammar, grammarLoaded)
  }
  await grammarLoaded
  return shiki
}

/** Shiki's own names for its colors, as ours. The two kinds of string are one here. */
const colorOf = (color: string | undefined): string | undefined => {
  const name = /^var\(--shiki-token-([a-z-]+)\)$/.exec(color ?? "")?.[1]
  if (name === undefined) return undefined
  return `var(--syntax-${name === "string-expression" || name === "link" ? "string" : name})`
}

const read = (tokens: ThemedToken[][]): Token[][] =>
  tokens.map((line) =>
    line.map((token) => {
      const color = colorOf(token.color)
      return {
        text: token.content,
        ...(color === undefined ? {} : { color }),
        ...(((token.fontStyle ?? 0) & 1) === 1 ? { italic: true as const } : {}),
      }
    }),
  )

/** The code as lines of colored pieces, or undefined where there is no grammar for its language. */
export async function tokensOf(code: string, language: string): Promise<Token[][] | undefined> {
  const grammar = grammarFor(language)
  if (grammar === undefined) return undefined
  const shiki = await ready(grammar)
  return read(shiki.codeToTokens(code, { lang: grammar, theme: THEME }).tokens)
}
