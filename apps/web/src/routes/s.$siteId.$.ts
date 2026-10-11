import { createFileRoute } from "@tanstack/react-router"
import { serveSite } from "@/server/sites"

/**
 * `GET /s/:site` and everything under it: a page of the library shared as a website, to whoever
 * may open it.
 */
export const Route = createFileRoute("/s/$siteId/$")({
  server: {
    handlers: {
      GET: ({ request, params }: { request: Request; params: { siteId: string } }) =>
        serveSite(request, params.siteId),
    },
  },
})
