/**
 * Putting values into a dotenv file without disturbing the rest of it: an assignment that is
 * there is changed where it stands, a new one goes at the end, and every other line is left as
 * it was. What cannot be done safely is refused, never guessed at.
 */

export class DotenvError extends Error {}

const assignment = (name: string) => new RegExp(`^(\\s*(?:export\\s+)?${name}\\s*=\\s*)(.*)$`, "u")

const ANY_ASSIGNMENT = /^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.*)$/u

function closes(value: string, quote: "'" | '"'): boolean {
  let escaped = false
  for (let index = 1; index < value.length; index += 1) {
    const character = value[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (quote === '"' && character === "\\") {
      escaped = true
      continue
    }
    if (character === quote) return true
  }
  return false
}

/** A value that runs over several lines cannot be told apart from the lines after it. */
function refuseMultiline(content: string): void {
  for (const line of content.split(/\r?\n/u)) {
    const value = ANY_ASSIGNMENT.exec(line)?.[1] ?? ""
    const quote = value[0]
    if ((quote === "'" || quote === '"') && !closes(value, quote)) {
      throw new DotenvError(
        "The file has a quoted value that runs over several lines, so it cannot be changed safely.",
      )
    }
  }
}

function refuseDuplicates(content: string, names: readonly string[]): void {
  refuseMultiline(content)
  const lines = content.split(/\r?\n/u)
  for (const name of names) {
    const pattern = assignment(name)
    if (lines.filter((line) => pattern.test(line)).length > 1) {
      throw new DotenvError(`The file sets ${name} more than once.`)
    }
  }
}

/** A value as one dotenv assignment reads it back unchanged. */
export function encodeDotenvValue(value: string): string {
  if (!value.includes("'")) return `'${value}'`
  if (!value.includes('"') && !/\\[nr]/u.test(value) && !value.includes("\\")) return `"${value}"`
  if (value === value.trim() && !value.includes("#") && !/\s/u.test(value)) return value
  throw new DotenvError("One of the values cannot be written safely as one line of a dotenv file.")
}

/** The comment that follows a value on its line, with the space before it. */
function trailingComment(rest: string): string {
  let quote: "'" | '"' | null = null
  let escaped = false
  for (let index = 0; index < rest.length; index += 1) {
    const character = rest[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (character === "\\" && quote === '"') {
      escaped = true
      continue
    }
    if (character === "'" || character === '"') {
      quote = quote === character ? null : (quote ?? character)
      continue
    }
    if (character !== "#" || quote !== null || index === 0) continue
    if (!/\s/u.test(rest[index - 1] ?? "")) continue
    let start = index
    while (start > 0 && /\s/u.test(rest[start - 1] ?? "")) start -= 1
    return rest.slice(start)
  }
  return ""
}

export type DotenvChange = {
  content: string
  /** The names that were not in the file, were there with another value, and were there as given. */
  added: string[]
  updated: string[]
  unchanged: string[]
}

/** `content` with every one of `values` set in it. */
export function reconcileDotenv(
  content: string,
  values: Readonly<Record<string, string>>,
): DotenvChange {
  const names = Object.keys(values)
  refuseDuplicates(content, names)
  const lineEnding = content.includes("\r\n") ? "\r\n" : "\n"
  const endedWithNewline = content.endsWith("\n")
  const lines = content.length === 0 ? [] : content.split(/\r?\n/u)
  if (endedWithNewline) lines.pop()

  const added: string[] = []
  const updated: string[] = []
  const unchanged: string[] = []
  const missing = new Set(names)
  const next = lines.map((line) => {
    for (const name of names) {
      const match = assignment(name).exec(line)
      if (!match) continue
      missing.delete(name)
      const replacement = `${match[1]}${encodeDotenvValue(values[name] ?? "")}${trailingComment(match[2] ?? "")}`
      ;(replacement === line ? unchanged : updated).push(name)
      return replacement
    }
    return line
  })
  for (const name of names) {
    if (!missing.has(name)) continue
    next.push(`${name}=${encodeDotenvValue(values[name] ?? "")}`)
    added.push(name)
  }
  const joined = next.join(lineEnding)
  return {
    content:
      joined.length === 0
        ? ""
        : `${joined}${endedWithNewline || added.length > 0 ? lineEnding : ""}`,
    added,
    updated,
    unchanged,
  }
}
