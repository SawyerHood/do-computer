import { parseAvatar } from "@durable-computer/protocol"
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
  return [
    `name: ${identity.name ?? ""}`,
    `tagline: ${identity.tagline ?? ""}`,
    `color: ${identity.avatar?.color ?? ""}`,
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

/**
 * Bring the workspace files in line with the documents. Writes only files that differ, and
 * returns what the files now hold, which is what a later edit is recognized against.
 */
export async function writeMirror(
  sandbox: Sandbox,
  identity: Mirrored,
): Promise<Record<MirrorFile, string>> {
  await sandbox.fs.mkdir(sandbox.home, { recursive: true })
  const rendered = renderMirror(identity)
  // Side by side: on a remote computer each file is a round trip, and this runs before tools.
  await Promise.all(
    Object.entries(rendered).map(async ([name, content]) => {
      const path = `${sandbox.home}/${name}`
      if ((await readText(sandbox, path)) !== content) {
        await sandbox.fs.writeFile(path, encoder.encode(content))
      }
    }),
  )
  await sandbox.flush()
  return rendered
}

export type MirrorChanges = {
  /** Fields to set on the identity document. */
  readonly change: Partial<Mirrored>
  /** Edits that were refused, in words the agent can act on. Their files are restored. */
  readonly problems: readonly string[]
  /** What each file held when it was read, for the files that exist. */
  readonly seen: Partial<Record<MirrorFile, string>>
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
  const color = fields.get("color")
  if (color !== undefined && color !== "" && color !== current.avatar?.color) {
    // Only the color is a choice. What the creature looks like grows from its seed, which stays.
    const parsed = parseAvatar({ color, seed: current.avatar?.seed })
    if ("error" in parsed) problems.push(`IDENTITY.md: ${parsed.error}.`)
    else change.avatar = parsed.avatar
  }
  return change
}

/**
 * What the agent changed by editing the mirror files directly. An edit that breaks a limit is
 * reported as a problem and not applied; a deleted file counts as unchanged.
 *
 * A file is edited when it differs from `written`, what was last put there, and not when it
 * differs from the documents: a document can change while its file waits to be rewritten, and
 * reading that stale file as an edit would undo the change or report an error nobody made.
 */
export async function readMirrorChanges(
  sandbox: Sandbox,
  identity: Mirrored,
  written?: Partial<Record<MirrorFile, string>>,
): Promise<MirrorChanges> {
  const expected: Partial<Record<MirrorFile, string>> = written ?? renderMirror(identity)
  const change: Partial<Mirrored> = {}
  const problems: string[] = []
  // Read side by side: this runs after every file tool, and each read may be a round trip.
  const texts = new Map(
    await Promise.all(
      MIRROR_FILES.map(
        async (name) => [name, await readText(sandbox, `${sandbox.home}/${name}`)] as const,
      ),
    ),
  )
  const edited = (name: MirrorFile) => {
    const text = texts.get(name)
    return text === undefined || text === expected[name] ? undefined : text
  }
  const limited = (name: MirrorFile, field: "user" | "memory" | "soul", limit: number) => {
    const text = edited(name)
    if (text === undefined) return
    const value = withoutNewline(text)
    if (value.length > limit) {
      problems.push(
        `${name} is ${value.length} characters; the limit is ${limit}. The edit was not saved. Shorten or merge entries and try again.`,
      )
    } else change[field] = value
  }
  limited("SOUL.md", "soul", 4000)
  limited("USER.md", "user", USER_LIMIT)
  limited("MEMORY.md", "memory", MEMORY_LIMIT)
  const identityText = edited("IDENTITY.md")
  if (identityText !== undefined)
    Object.assign(change, parseIdentity(identityText, identity, problems))
  const seen: Partial<Record<MirrorFile, string>> = {}
  for (const [name, text] of texts) if (text !== undefined) seen[name] = text
  return { change, problems, seen }
}
