import { createFileRoute, notFound } from "@tanstack/react-router"
import { DoodCard } from "@/components/dood/card"
import { cardHead, doodFor, originHere } from "@/components/dood/head"

/**
 * A Dood someone hatched, for anyone to stroke and feed: opened by itself, or played inside the
 * post it was shared in. Only the head is drawn by the server, as on `/hatch`.
 */
export const Route = createFileRoute("/dood/$doodId")({
  ssr: "data-only",
  loader: async ({ params }) => {
    const [origin, dood] = await Promise.all([originHere(), doodFor(params.doodId)])
    // Answered as not found, by the server too.
    if (dood === null) throw notFound()
    return { origin, dood }
  },
  head: ({ loaderData, params }) => {
    const dood = loaderData?.dood
    return cardHead({
      origin: loaderData?.origin ?? "",
      path: `/dood/${encodeURIComponent(params.doodId)}`,
      title: dood ? `Meet ${dood.name}` : "This Dood is not here any more",
      description: "A Dood, hatched in a post. Stroke it, give it a treat, or hatch your own.",
      image: dood ? `/dood/meet-${dood.avatar.color}.jpg` : "/dood/hatch.jpg",
      hidden: true,
    })
  },
  component: DoodPage,
  notFoundComponent: () => (
    <main className="flex h-dvh w-screen flex-col items-center justify-center gap-4 bg-[#05071a] p-6 text-center text-white">
      <p className="text-lg font-semibold">This Dood is not here any more.</p>
      <a
        href="/hatch"
        className="flex h-10 items-center rounded-full bg-white px-4 text-sm font-semibold text-neutral-900 hover:bg-neutral-200"
      >
        Hatch your own
      </a>
    </main>
  ),
})

function DoodPage() {
  const { origin, dood } = Route.useLoaderData()
  return <DoodCard key={dood.id} origin={origin} dood={dood} />
}
