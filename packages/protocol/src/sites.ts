/**
 * A site is a page of the library, or a folder of them, shared as a website with an address of
 * its own. It shows what is in the library at that place as it is now. Only people in the
 * workspace can open it until someone makes it public.
 */
export type SiteSummary = {
  /** What its address ends in. Random, so that an address cannot be guessed. */
  id: string
  /** The page it serves, or the folder whose `index.html` is its front page. */
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

const isPage = (path: string) => /\.html?$/i.test(path)

/**
 * What of the library a site would serve, for something asked to be shared: a path as an agent
 * or a person wrote it, which may name a page, a folder, or a folder's front page. A page beside
 * other files is shared alone, and nothing beside it is served. A folder is shared whole, and
 * needs an `index.html` to open on. Naming a folder's `index.html` shares the folder, since what
 * the page links to is in there with it.
 */
export function siteRoot(
  paths: readonly string[],
  wanted: string,
): { path: string; kind: "page" | "folder" } | { error: string } {
  const asked = wanted
    .trim()
    .replace(/^~?\/?library\//, "")
    .replace(/^\/+|\/+$/g, "")
  if (asked === "") return { error: "Say which page or folder of the library to share." }
  const holds = (folder: string) => paths.includes(`${folder}/index.html`)
  if (paths.includes(asked)) {
    if (!isPage(asked)) {
      return {
        error: `${asked} is not a page. Only an HTML page, or a folder with one, is shared.`,
      }
    }
    const slash = asked.lastIndexOf("/")
    return /^index\.html?$/i.test(asked.slice(slash + 1)) && slash !== -1
      ? { path: asked.slice(0, slash), kind: "folder" }
      : { path: asked, kind: "page" }
  }
  if (paths.some((path) => path.startsWith(`${asked}/`))) {
    return holds(asked)
      ? { path: asked, kind: "folder" }
      : {
          error: `The folder ${asked} has no index.html, which is the page a site opens on. Add one, or share a page in it by its own path.`,
        }
  }
  return { error: `There is no ${asked} in the library.` }
}

/** The title a site has when nobody gave it one: its page's or its folder's name, in words. */
export function siteTitleFor(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1).replace(/\.html?$/i, "")
  const words = name.replace(/[-_]+/g, " ").trim()
  return words === "" ? "Site" : words.charAt(0).toUpperCase() + words.slice(1)
}
