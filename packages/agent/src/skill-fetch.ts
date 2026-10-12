import { BodyTooLarge, declaredTooLarge, readLimited } from "@do-computer/protocol"
import { BlockedAddressError } from "./guarded-fetch.ts"
import {
  MAX_SKILL_FILES,
  MAX_SUPPORT_FILE_BYTES,
  parseFrontmatter,
  SKILL_FILE,
  SkillError,
} from "./skill-format.ts"

export type FetchedSkill = { name: string; files: Record<string, string> }

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

type GithubEntry = {
  type: "file" | "dir" | string
  path: string
  size: number
  download_url: string | null
}

const TEXT_LIMIT = MAX_SUPPORT_FILE_BYTES
/** A directory listing from GitHub's API; a single file's listing carries its content. */
const LISTING_LIMIT = 4 * 1024 * 1024

/** A fetch whose network failures read as something the user can act on. */
const reaching =
  (fetcher: Fetch): Fetch =>
  async (url, init) => {
    try {
      return await fetcher(url, init)
    } catch (error) {
      // An address the server will not call is the user's to fix; say which rule it broke.
      if (error instanceof BlockedAddressError) throw new SkillError(error.message)
      throw new SkillError(`Could not reach ${new URL(url).host}.`)
    }
  }

/** A response's body, read no further than `limit`: its declared length is only a claim. */
async function limited(response: Response, url: string, limit: number): Promise<Uint8Array> {
  const tooLarge = () => new SkillError(`${url} is too large to be a skill file.`)
  if (declaredTooLarge(response.headers, limit)) {
    await response.body?.cancel().catch(() => {})
    throw tooLarge()
  }
  return readLimited(response.body, limit).catch((error) => {
    throw error instanceof BodyTooLarge ? tooLarge() : error
  })
}

async function text(fetcher: Fetch, url: string): Promise<string> {
  const response = await fetcher(url, { headers: { "user-agent": "do-computer" } })
  if (!response.ok) throw new SkillError(`Could not fetch ${url} (HTTP ${response.status}).`)
  return new TextDecoder().decode(await limited(response, url, TEXT_LIMIT))
}

function nameFor(skillMd: string, fallback: string): string {
  const declared = parseFrontmatter(skillMd).name
  return (declared ?? fallback)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
}

/** `owner/repo`, an optional ref and a path inside the repository, from a github.com URL. */
function parseGithub(
  url: URL,
): { owner: string; repo: string; ref?: string; path: string } | undefined {
  if (url.hostname !== "github.com") return undefined
  const [owner, repo, kind, ref, ...rest] = url.pathname.split("/").filter(Boolean)
  if (!owner || !repo) return undefined
  const name = repo.replace(/\.git$/, "")
  if (kind === undefined) return { owner, repo: name, path: "" }
  if ((kind !== "tree" && kind !== "blob") || !ref) return undefined
  let path = rest.join("/")
  // A link to the SKILL.md itself means its directory.
  if (kind === "blob")
    path = path.endsWith(SKILL_FILE) ? path.slice(0, -SKILL_FILE.length).replace(/\/$/, "") : path
  return { owner, repo: name, ref, path }
}

async function fetchGithub(
  fetcher: Fetch,
  target: { owner: string; repo: string; ref?: string; path: string },
): Promise<FetchedSkill> {
  const files: Record<string, string> = {}
  const root = target.path
  const walk = async (path: string): Promise<void> => {
    const query = target.ref ? `?ref=${encodeURIComponent(target.ref)}` : ""
    const api = `https://api.github.com/repos/${target.owner}/${target.repo}/contents/${path}${query}`
    const response = await fetcher(api, {
      headers: { accept: "application/vnd.github+json", "user-agent": "do-computer" },
    })
    if (response.status === 403 || response.status === 429) {
      throw new SkillError("GitHub is rate-limiting requests from this server. Try again later.")
    }
    if (!response.ok)
      throw new SkillError(
        `Could not read ${path || "the repository"} on GitHub (HTTP ${response.status}).`,
      )
    const listed = JSON.parse(
      new TextDecoder().decode(await limited(response, api, LISTING_LIMIT)),
    ) as GithubEntry[] | GithubEntry
    const entries = Array.isArray(listed) ? listed : [listed]
    // Check before downloading anything: a directory without a SKILL.md is not a skill.
    const skillPath = root === "" ? SKILL_FILE : `${root}/${SKILL_FILE}`
    if (
      path === root &&
      !entries.some((entry) => entry.type === "file" && entry.path === skillPath)
    ) {
      throw new SkillError(
        `No ${SKILL_FILE} was found there. Link to the directory that contains it.`,
      )
    }
    for (const entry of entries) {
      if (entry.type === "dir") {
        await walk(entry.path)
        continue
      }
      if (entry.type !== "file" || entry.download_url === null) continue
      if (entry.size > TEXT_LIMIT)
        throw new SkillError(`${entry.path} is too large to be a skill file.`)
      if (Object.keys(files).length >= MAX_SKILL_FILES) {
        throw new SkillError(
          `That directory has more than ${MAX_SKILL_FILES} files; it is not one skill.`,
        )
      }
      const relative = root === "" ? entry.path : entry.path.slice(root.length + 1)
      files[relative] = await text(fetcher, entry.download_url)
    }
  }
  await walk(root)
  const fallback = root.split("/").filter(Boolean).at(-1) ?? target.repo
  return { name: nameFor(files[SKILL_FILE]!, fallback), files }
}

/**
 * Fetch a skill the user pointed at: a GitHub repository or directory (every file in it), or a
 * direct link to a `SKILL.md` (that one file). Only https is followed.
 */
export async function fetchSkill(rawUrl: string, fetcher: Fetch = fetch): Promise<FetchedSkill> {
  let url: URL
  try {
    url = new URL(rawUrl.trim())
  } catch {
    throw new SkillError(`"${rawUrl}" is not a URL.`)
  }
  if (url.protocol !== "https:")
    throw new SkillError("Skills can only be installed from https URLs.")
  const safe = reaching(fetcher)
  const github = parseGithub(url)
  if (github !== undefined) return fetchGithub(safe, github)
  const skillMd = await text(safe, url.toString())
  if (parseFrontmatter(skillMd).description === undefined) {
    throw new SkillError(
      `That URL is not a ${SKILL_FILE}: it has no frontmatter with a description.`,
    )
  }
  const fallback = url.pathname.split("/").filter(Boolean).at(-2) ?? url.hostname
  return { name: nameFor(skillMd, fallback), files: { [SKILL_FILE]: skillMd } }
}
