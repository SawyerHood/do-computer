import { getPlatform } from "#platform"
import { GUIDES, guideOf } from "@/lib/docs"

/** The address this deployment is opened at, which its guides give as their own. */
export function docsOrigin(request: Request): string {
  return getPlatform().config.baseUrl ?? new URL(request.url).origin
}

const PLAIN = { "cache-control": "public, max-age=300" }

/**
 * `GET /docs/<name>.md`: a guide as the file it is written in, for an agent to follow. It is
 * the text the page at `/docs/<name>` is drawn from, with nothing around it.
 */
export function guideFile(name: string): Response {
  const guide = guideOf(name.slice(0, -".md".length))
  if (guide === undefined) return new Response("There is no such guide.\n", { status: 404 })
  return new Response(guide.text, {
    headers: { ...PLAIN, "content-type": "text/markdown; charset=utf-8" },
  })
}

/** `GET /llms.txt`: the guides, and where each is as Markdown. */
export function llmsTxt(request: Request): Response {
  const origin = docsOrigin(request)
  const text = [
    "# Do Computer",
    "",
    "> An open source personal assistant with a name, a memory and a computer of its own, which keeps working after you close the tab. Every guide below is plain Markdown.",
    "",
    "## Guides",
    "",
    ...GUIDES.map(
      (guide) => `- [${guide.title}](${origin}/docs/${guide.slug}.md): ${guide.summary}`,
    ),
    "",
  ].join("\n")
  return new Response(text, { headers: { ...PLAIN, "content-type": "text/plain; charset=utf-8" } })
}
