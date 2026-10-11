/**
 * A site is something of the library shared with a link of its own: a file, or a folder of
 * them. It shows what is in the library at that place as it is now. Only people in the
 * workspace can open it until someone makes it public. A page is shown as the page it is, a
 * folder with an `index.html` as the website that is, and anything else as the document, the
 * picture or the download it is.
 */
export type SiteSummary = {
  /** What its address ends in. Random, so that an address cannot be guessed. */
  id: string
  /** The file it shares, or the folder: a website where it has an `index.html`, a list where not. */
  path: string
  title: string
  /** Whether anyone who has the address can open it. Otherwise only people in the workspace. */
  public: boolean
  /** The agent that shared it, where one did. */
  agentId: string | null
  /** The person who shared it, where one did. */
  userId: string | null
  createdAt: number
  updatedAt: number
}

/** The tool an agent shares a site with. */
export const SHARE_TOOL = "share"
export const MAX_SITE_TITLE = 120
/** How many sites one workspace can have. */
export const MAX_SITES_PER_WORKSPACE = 200

/** Where a site is, under the app's address. */
export const sitePath = (id: string) => `/s/${encodeURIComponent(id)}`

/**
 * What of the library a site would share, for something asked to be shared: a path as an agent
 * or a person wrote it, which may name a file or a folder. A file is shared alone, and nothing
 * beside it is served. A folder is shared whole. Naming a folder's `index.html` shares the
 * folder, since what the page links to is in there with it.
 */
export function siteRoot(
  paths: readonly string[],
  wanted: string,
): { path: string; kind: "file" | "folder" } | { error: string } {
  const asked = wanted
    .trim()
    .replace(/^~?\/?library\//, "")
    .replace(/^\/+|\/+$/g, "")
  if (asked === "" || asked === "~" || asked === "library") {
    return {
      error:
        "Say which file or folder of the library to share. The whole library is not shared at once.",
    }
  }
  if (paths.includes(asked)) {
    const slash = asked.lastIndexOf("/")
    return /^index\.html?$/i.test(asked.slice(slash + 1)) && slash !== -1
      ? { path: asked.slice(0, slash), kind: "folder" }
      : { path: asked, kind: "file" }
  }
  if (paths.some((path) => path.startsWith(`${asked}/`))) return { path: asked, kind: "folder" }
  return { error: `There is no ${asked} in the library.` }
}

/** One thing in a shared folder that has no front page of its own, as its list shows it. */
export type SiteEntry = {
  name: string
  kind: "file" | "folder"
  /** For a file. */
  size?: number
  updatedAt?: number
}

/** What is in a shared folder that has no front page: what its address shows in place of one. */
export type SiteListing = {
  /** The folder, as a path within what is shared. Empty for the shared folder itself. */
  folder: string
  entries: SiteEntry[]
}

/** The header that marks a library's answer as a `SiteListing`, where a file was asked for. */
export const SITE_LISTING_HEADER = "x-dc-site-listing"

/**
 * The title a site has when nobody gave it one: the name of what it shares. A page, a document
 * and a folder are named in words; any other file keeps its name, which says what it is.
 */
export function siteTitleFor(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1)
  if (/\.[a-z0-9]{1,8}$/i.test(name) && !/\.(html?|md|markdown)$/i.test(name)) return name
  const words = name
    .replace(/\.(html?|md|markdown)$/i, "")
    .replace(/[-_]+/g, " ")
    .trim()
  return words === "" ? "Site" : words.charAt(0).toUpperCase() + words.slice(1)
}
