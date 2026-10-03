import { isInherited } from "./own.ts"
/**
 * The AgentSkills file format: a directory with a `SKILL.md` whose YAML frontmatter carries at
 * least `name` and `description`, optionally followed by support files.
 */
export const SKILL_FILE = "SKILL.md"
export const MAX_SKILL_BYTES = 100 * 1024
export const MAX_SUPPORT_FILE_BYTES = 512 * 1024
export const MAX_SKILL_FILES = 50
const MAX_DESCRIPTION_CHARS = 1024

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

export class SkillError extends Error {}

export function validateSkillName(name: string): void {
  if (!NAME_PATTERN.test(name)) {
    throw new SkillError(
      `"${name}" is not a valid skill name. Use lowercase letters, digits and hyphens, up to 64 characters.`,
    )
  }
}

/** A support file path: relative, forward slashes, no dot segments. */
export function validateSkillPath(path: string): void {
  const segments = path.split("/")
  const bad =
    path === "" ||
    path.length > 200 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    // A path is also a key in the skill's table of files, so it cannot be a name objects inherit.
    isInherited(path) ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  if (bad) throw new SkillError(`"${path}" is not a valid file path inside a skill.`)
}

const bytes = (text: string) => new TextEncoder().encode(text).length

export function validateSkillFile(path: string, content: string): void {
  validateSkillPath(path)
  const limit = path === SKILL_FILE ? MAX_SKILL_BYTES : MAX_SUPPORT_FILE_BYTES
  const size = bytes(content)
  if (size > limit) {
    throw new SkillError(`${path} is ${size} bytes; the limit is ${limit}.`)
  }
  if (content.includes("\u0000")) throw new SkillError(`${path} is not a text file.`)
}

export type Frontmatter = { name?: string; description?: string; body: string }

function unquote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return trimmed.slice(1, -1)
    }
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'")
  }
  return trimmed
}

/**
 * Read `name` and `description` from the frontmatter. Handles what skills in the wild use: plain
 * and quoted scalars, and folded (`>`) or literal (`|`) blocks. Other keys are ignored.
 */
export function parseFrontmatter(text: string): Frontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!match) return { body: text }
  const lines = match[1]!.split(/\r?\n/)
  const fields: Record<string, string> = {}
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    const field = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (!field) continue
    const [, key, rest] = field
    if (/^[>|][+-]?\s*$/.test(rest!)) {
      // A block scalar: the indented lines that follow.
      const block: string[] = []
      while (index + 1 < lines.length && /^(\s+\S|\s*$)/.test(lines[index + 1]!)) {
        block.push(lines[++index]!.trim())
      }
      fields[key!] = rest!.startsWith(">")
        ? block.join(" ").replace(/\s+/g, " ").trim()
        : block.join("\n").trim()
    } else {
      fields[key!] = unquote(rest!)
    }
  }
  return { name: fields.name, description: fields.description, body: match[2]! }
}

export function renderSkill(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${body.trim()}\n`
}

/** Check a skill's files as a whole and return its description. */
export function validateSkill(name: string, files: Readonly<Record<string, string>>): string {
  validateSkillName(name)
  const paths = Object.keys(files)
  if (!paths.includes(SKILL_FILE)) throw new SkillError(`A skill needs a ${SKILL_FILE}.`)
  if (paths.length > MAX_SKILL_FILES) {
    throw new SkillError(`A skill can have at most ${MAX_SKILL_FILES} files.`)
  }
  for (const [path, content] of Object.entries(files)) validateSkillFile(path, content)
  const frontmatter = parseFrontmatter(files[SKILL_FILE]!)
  if (frontmatter.name !== undefined && frontmatter.name !== name) {
    throw new SkillError(
      `${SKILL_FILE} says the skill is named "${frontmatter.name}", but it is stored as "${name}".`,
    )
  }
  const description = frontmatter.description?.trim() ?? ""
  if (description === "") {
    throw new SkillError(`${SKILL_FILE} needs a description in its frontmatter.`)
  }
  if (description.length > MAX_DESCRIPTION_CHARS) {
    throw new SkillError(`A skill description can be at most ${MAX_DESCRIPTION_CHARS} characters.`)
  }
  return description
}
