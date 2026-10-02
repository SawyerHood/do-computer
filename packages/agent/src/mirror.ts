import { type Avatar, parseAvatar } from "@durable-computer/protocol"
import { type Sandbox, SandboxError } from "@durable-computer/sandbox"
import type { IdentityState } from "./docs.ts"
import { MEMORY_LIMIT, USER_LIMIT } from "./persona.ts"

/**
 * The agent's identity and memory as files in its workspace. The documents in the agent's store
 * are the truth; these files are a view of them that the agent can also edit with its ordinary
 * file tools.
 */
export const MIRROR_FILES = ["SOUL.md", "IDENTITY.md", "USER.md", "MEMORY.md"] as const
type MirrorFile = (typeof MIRROR_FILES)[number]

type Mirrored = Pick<IdentityState, "name" | "tagline" | "avatar" | "soul" | "user" | "memory">

const decoder = new TextDecoder()
const encoder = new TextEncoder()

const withNewline = (text: string) => (text === "" || text.endsWith("\n") ? text : `${text}\n`)
const withoutNewline = (text: string) => text.replace(/\n+$/, "")

function renderIdentity(identity: Mirrored): string {
  const avatar = identity.avatar
  return [
    `name: ${identity.name ?? ""}`,
    `tagline: ${identity.tagline ?? ""}`,
    `avatar: ${avatar ? [avatar.character, avatar.color, avatar.accessory].filter(Boolean).join(" ") : ""}`,
    "",
  ].join("\n")
}

export function renderMirror(identity: Mirrored): Record<MirrorFile, string> {
  return {
    "SOUL.md": withNewline(identity.soul),
    "IDENTITY.md": renderIdentity(identity),
    "USER.md": withNewline(identity.user),
    "MEMORY.md": withNewline(identity.memory),
  }
}

async function readText(sandbox: Sandbox, path: string): Promise<string | undefined> {
  try {
    return decoder.decode(await sandbox.fs.readFile(path))
  } catch (error) {
    if (error instanceof SandboxError && error.code === "not_found") return undefined
    throw error
  }
}

/** Bring the workspace files in line with the documents. Writes only files that differ. */
export async function writeMirror(sandbox: Sandbox, identity: Mirrored): Promise<void> {
  await sandbox.fs.mkdir(sandbox.home, { recursive: true })
  for (const [name, content] of Object.entries(renderMirror(identity))) {
    const path = `${sandbox.home}/${name}`
    if ((await readText(sandbox, path)) !== content) {
      await sandbox.fs.writeFile(path, encoder.encode(content))
    }
  }
  await sandbox.flush()
}

export type MirrorChanges = {
  /** Fields to set on the identity document. */
  readonly change: Partial<Mirrored>
  /** Edits that were refused, in words the agent can act on. Their files are restored. */
  readonly problems: readonly string[]
}

function parseIdentity(text: string, current: Mirrored, problems: string[]): Partial<Mirrored> {
  const fields = new Map<string, string>()
  for (const line of text.split("\n")) {
    const colon = line.indexOf(":")
    if (colon !== -1) fields.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim())
  }
  const change: Partial<Mirrored> = {}
  const name = fields.get("name")
  if (name !== undefined && name !== (current.name ?? "")) {
    if (name === "" || name.length > 40)
      problems.push("IDENTITY.md: name must be 1 to 40 characters.")
    else change.name = name
  }
  const tagline = fields.get("tagline")
  if (tagline !== undefined && tagline !== (current.tagline ?? "")) {
    if (tagline.length > 120) problems.push("IDENTITY.md: tagline can be at most 120 characters.")
    else change.tagline = tagline || null
  }
  const avatar = fields.get("avatar")
  if (avatar !== undefined && avatar !== "") {
    const [character = "", color = "", accessory] = avatar.split(/\s+/)
    const parsed = parseAvatar({ character, color, ...(accessory ? { accessory } : {}) })
    if ("error" in parsed) problems.push(`IDENTITY.md: ${parsed.error}.`)
    else if (!sameAvatar(parsed.avatar, current.avatar)) change.avatar = parsed.avatar
  }
  return change
}

const sameAvatar = (a: Avatar, b: Avatar | null) =>
  b !== null && a.character === b.character && a.color === b.color && a.accessory === b.accessory

/**
 * What the agent changed by editing the mirror files directly. An edit that breaks a limit is
 * reported as a problem and not applied; a deleted file counts as unchanged.
 */
export async function readMirrorChanges(
  sandbox: Sandbox,
  identity: Mirrored,
): Promise<MirrorChanges> {
  const expected = renderMirror(identity)
  const change: Partial<Mirrored> = {}
  const problems: string[] = []
  const edited = async (name: MirrorFile) => {
    const text = await readText(sandbox, `${sandbox.home}/${name}`)
    return text === undefined || text === expected[name] ? undefined : text
  }
  const limited = async (name: MirrorFile, field: "user" | "memory" | "soul", limit: number) => {
    const text = await edited(name)
    if (text === undefined) return
    const value = withoutNewline(text)
    if (value.length > limit) {
      problems.push(
        `${name} is ${value.length} characters; the limit is ${limit}. The edit was not saved. Shorten or merge entries and try again.`,
      )
    } else change[field] = value
  }
  await limited("SOUL.md", "soul", 4000)
  await limited("USER.md", "user", USER_LIMIT)
  await limited("MEMORY.md", "memory", MEMORY_LIMIT)
  const identityText = await edited("IDENTITY.md")
  if (identityText !== undefined)
    Object.assign(change, parseIdentity(identityText, identity, problems))
  return { change, problems }
}
