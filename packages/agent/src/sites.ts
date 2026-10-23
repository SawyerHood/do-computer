import {
  MAX_SITE_TITLE,
  SHARE_TOOL,
  sitePath,
  siteRoot,
  type SiteSummary,
  siteTitleFor,
} from "@do-computer/protocol"
import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool, type Extension, section } from "@earendil-works/pi-durable"
import { LIBRARY_FOLDER, type LibraryBackend } from "./library-store.ts"

/** Something about a site that the agent is told in words: there are too many, or it is gone. */
export class SiteError extends Error {}

/**
 * The sites of an agent's workspace, and how one is shared. The host keeps them, since it is
 * the host that serves them and decides who may open one. Which workspace an agent is in is
 * looked up each time: an agent can be moved.
 */
export type SiteDirectory = {
  /** The sites of the workspace of `agentId`, newest first. */
  list(agentId: string): Promise<SiteSummary[]>
  /**
   * Share what is at `path` in the workspace's library, or say what it is already shared as.
   * A site starts open to the workspace only.
   */
  publish(agentId: string, input: { path: string; title: string }): Promise<SiteSummary>
  /** Let anyone with the address open a site, or only the workspace again. */
  setPublic(agentId: string, siteId: string, open: boolean): Promise<SiteSummary | undefined>
  /** Stop sharing a site. Its address then leads nowhere. */
  remove(agentId: string, siteId: string): Promise<boolean>
}

export type SitesOptions = {
  readonly agentId: string
  readonly directory: SiteDirectory
  /** Where the library is kept right now. */
  readonly backend: () => Promise<LibraryBackend>
  /** The address people reach the app at, which a site's address begins with. */
  readonly appUrl: () => string | undefined
}

/**
 * Lets the agent share a file of the library, or a folder of them, with a link of its own. The
 * people in the agent's workspace can open it; making it open to anyone is a separate step,
 * which a person is asked about.
 */
export function sites(options: SitesOptions): Extension {
  const { agentId, directory } = options
  const fail = (text: string) => ({ isError: true, output: [{ type: "text" as const, text }] })
  const address = (site: SiteSummary) => {
    const app = options.appUrl()
    return app === undefined ? sitePath(site.id) : `${app}${sitePath(site.id)}`
  }
  const who = (site: SiteSummary) =>
    site.public
      ? "anyone who has the link, without signing in"
      : "people in this workspace, signed in"
  /** The site meant by what the agent wrote: an id, an address, a title or a place in the library. */
  const find = async (wanted: string | undefined): Promise<SiteSummary | string> => {
    const text = wanted?.trim() ?? ""
    if (text === "") return "Say which site: its link, its title or its path, as `list` shows them."
    const all = await directory.list(agentId)
    const id = /\/s\/([^/?#\s]+)/.exec(text)?.[1] ?? text
    const path = text.replace(/^~?\/?library\//, "").replace(/\/+$/, "")
    const site =
      all.find((entry) => entry.id === id) ??
      all.find(
        (entry) => entry.path === path || entry.path === path.replace(/\/index\.html?$/i, ""),
      ) ??
      all.find((entry) => entry.title.toLowerCase() === text.toLowerCase())
    return site ?? `There is no shared site "${text}". Use the list action to see them.`
  }
  const tool = defineTool({
    name: SHARE_TOOL,
    // Described to the model only once it loads it (`deferred.ts`).
    deferred: true,
    description:
      "Share something from the library with a link of its own, which the person can send to others. " +
      `action "publish" needs \`path\`: a file or a folder, as it is in the library. A file is shared alone: an HTML page is shown as the page, a Markdown document as the document, a picture as the picture, and anything else as a download. A folder is shared whole: one with an index.html is a website that opens on it, so a page that uses files beside it belongs in a folder with them, and one without is shown as a list of its files. It takes a \`title\`. ` +
      "The link shows what is in the library there as it is now, so changing the files changes what it shows, and publishing the same place again gives the same link. " +
      'A new link can be opened only by people in this workspace who are signed in. "public" lets anyone who has the link open it, and needs the person\'s approval: do it only when they ask for it to be public. "private" makes it the workspace\'s only again. ' +
      '"stop" stops sharing it, and "list" shows what is shared. "public", "private" and "stop" need `site`: its link, title or path.',
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("publish"),
        Type.Literal("public"),
        Type.Literal("private"),
        Type.Literal("stop"),
        Type.Literal("list"),
      ]),
      path: Type.Optional(
        Type.String({
          description: `For publish: the file or folder, as it is in the library (under ~/${LIBRARY_FOLDER} on a machine)`,
        }),
      ),
      title: Type.Optional(Type.String({ description: "For publish: what the site is called" })),
      site: Type.Optional(
        Type.String({ description: "For public, private and stop: its link, title or path" }),
      ),
    }),
    execute: async (args) => {
      try {
        if (args.action === "list") {
          const all = await directory.list(agentId)
          return {
            output: [
              {
                type: "text",
                text:
                  all.length === 0
                    ? "Nothing is shared as a site."
                    : all
                        .map(
                          (site) =>
                            `${site.title}: ${address(site)} (${site.path}, open to ${who(site)})`,
                        )
                        .join("\n"),
              },
            ],
          }
        }
        if (args.action === "publish") {
          const files = await (await options.backend()).list()
          const root = siteRoot(
            files.map((file) => file.path),
            args.path ?? "",
          )
          if ("error" in root) return fail(root.error)
          const title = (args.title ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_SITE_TITLE)
          const site = await directory.publish(agentId, {
            path: root.path,
            title: title === "" ? siteTitleFor(root.path) : title,
          })
          return {
            output: [
              {
                type: "text",
                text: `Shared ${site.path} as “${site.title}” at ${address(site)}. It can be opened by ${who(site)}. The person sees the link in the chat, with who can open it, and can change that there.`,
              },
            ],
            details: { site },
          }
        }
        const found = await find(args.site)
        if (typeof found === "string") return fail(found)
        if (args.action === "stop") {
          await directory.remove(agentId, found.id)
          return {
            output: [
              {
                type: "text",
                text: `“${found.title}” is no longer shared: ${address(found)} leads nowhere now. Its files are still in the library.`,
              },
            ],
          }
        }
        const site = await directory.setPublic(agentId, found.id, args.action === "public")
        if (site === undefined) return fail(`“${found.title}” is no longer shared.`)
        return {
          output: [
            {
              type: "text",
              text: `“${site.title}” at ${address(site)} can now be opened by ${who(site)}.`,
            },
          ],
          details: { site },
        }
      } catch (error) {
        if (error instanceof SiteError) return fail(error.message)
        throw error
      }
    },
  })
  return defineExtension({
    name: "dc.sites",
    tools: [tool],
    sections: [
      section("sites", () =>
        [
          `Anything in the library can be shared with a link of its own with the \`${SHARE_TOOL}\` tool: a page, a document, a picture, any file, or a folder of them. A folder of pages with an index.html is a website. Use it when the person asks for something to be shared, published or put where others can open it; for something only they need to see, a visual or a file is enough.`,
          "A link is open to the workspace's people only. Making it public is for when they ask for that, and they are asked to approve it.",
        ].join(" "),
      ),
    ],
  })
}
