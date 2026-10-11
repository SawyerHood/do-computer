import { createFileRoute, notFound, redirect } from "@tanstack/react-router"
import { GUIDES } from "@/lib/docs"

/** `/docs` opens the first guide. The list of them is beside every guide. */
export const Route = createFileRoute("/docs/")({
  beforeLoad: () => {
    const first = GUIDES[0]
    if (first === undefined) throw notFound()
    throw redirect({ to: "/docs/$slug", params: { slug: first.slug }, replace: true })
  },
})
