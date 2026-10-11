import { createFileRoute } from "@tanstack/react-router"
import { DoodCard } from "@/components/dood/card"
import { cardHead, originHere } from "@/components/dood/head"

/**
 * Where a Dood is hatched by anyone, with no account: opened by itself, or played inside a post
 * on X, which reads what the page is from its head. Only the head is drawn by the server. The
 * egg needs a browser.
 */
export const Route = createFileRoute("/hatch")({
  ssr: "data-only",
  loader: async () => ({ origin: await originHere() }),
  head: ({ loaderData }) =>
    cardHead({
      origin: loaderData?.origin ?? "",
      path: "/hatch",
      title: "Hatch a Dood",
      description: "Hatch one right here. No account needed.",
      image: "/dood/hatch.jpg",
    }),
  component: HatchPage,
})

function HatchPage() {
  return <DoodCard origin={Route.useLoaderData().origin} />
}
