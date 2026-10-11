import { createFileRoute, notFound } from "@tanstack/react-router"
import { createIsomorphicFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { Docs } from "@/components/docs/docs"
import { guideOf } from "@/lib/docs"
import { frontDoor } from "@/lib/front-door"

/** The address the guides give as their own: the deployment's, as it was opened. */
const origin = createIsomorphicFn()
  .server(async () => (await import("@/server/docs")).docsOrigin(getRequest()))
  .client(async () => window.location.origin)

/**
 * A guide. `/docs/self-hosting` is the page, for anyone, sent whole. `/docs/self-hosting.md`
 * is the file the page is drawn from, which is what an agent is pointed at.
 */
export const Route = createFileRoute("/docs/$slug")({
  server: {
    handlers: {
      GET: async ({ params, next }) =>
        params.slug.endsWith(".md")
          ? (await import("@/server/docs")).guideFile(params.slug)
          : next(),
    },
  },
  loader: async ({ params }) => {
    const guide = guideOf(params.slug)
    if (guide === undefined) throw notFound()
    const [door, at] = await Promise.all([frontDoor(), origin()])
    return { slug: guide.slug, title: guide.title, summary: guide.summary, door, origin: at }
  },
  head: ({ loaderData }) =>
    loaderData === undefined
      ? {}
      : {
          meta: [
            { title: `${loaderData.title} · Do Computer` },
            { name: "description", content: loaderData.summary },
          ],
          links: [{ rel: "alternate", type: "text/markdown", href: `/docs/${loaderData.slug}.md` }],
        },
  component: GuidePage,
})

function GuidePage() {
  const { slug, door, origin } = Route.useLoaderData()
  const guide = guideOf(slug)
  if (guide === undefined) return null
  return <Docs guide={guide} door={door} origin={origin} />
}
