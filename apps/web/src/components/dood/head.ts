import { ApiError } from "@do-computer/client"
import type { Dood } from "@do-computer/protocol"
import { createIsomorphicFn } from "@tanstack/react-start"
import { client } from "@/lib/client"

/** Where the deployment is reached: its own setting where it has one, else where the request came. */
export const originHere = createIsomorphicFn()
  .server(async (): Promise<string> => {
    const [{ getPlatform }, { getRequest }] = await Promise.all([
      import("#platform"),
      import("@tanstack/react-start/server"),
    ])
    return (getPlatform().config.baseUrl ?? new URL(getRequest().url).origin).replace(/\/$/, "")
  })
  .client(async (): Promise<string> => location.origin)

/** The Dood a page is about. Null where there is none. */
export const doodFor = createIsomorphicFn()
  .server(async (id: string): Promise<Dood | null> => {
    const { doodNamed } = await import("@/server/doods")
    return (await doodNamed(id)) ?? null
  })
  .client(async (id: string): Promise<Dood | null> => {
    try {
      return await client.doods.get(id)
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null
      throw error
    }
  })

/** The side of the frame X plays a card in. */
export const CARD_SIDE = 480

/**
 * What makes X show a page as a card that is played in the post: the page itself, in a frame,
 * over a still picture until it is played.
 */
export function cardHead(at: {
  origin: string
  path: string
  title: string
  description: string
  image: string
  hidden?: boolean
}) {
  const url = `${at.origin}${at.path}`
  const image = `${at.origin}${at.image}`
  return {
    meta: [
      { title: at.title },
      { name: "description", content: at.description },
      ...(at.hidden ? [{ name: "robots", content: "noindex" }] : []),
      { name: "twitter:card", content: "player" },
      { name: "twitter:player", content: url },
      { name: "twitter:player:width", content: String(CARD_SIDE) },
      { name: "twitter:player:height", content: String(CARD_SIDE) },
      { name: "twitter:title", content: at.title },
      { name: "twitter:description", content: at.description },
      { name: "twitter:image", content: image },
      { property: "og:type", content: "website" },
      { property: "og:url", content: url },
      { property: "og:title", content: at.title },
      { property: "og:description", content: at.description },
      { property: "og:image", content: image },
    ],
  }
}
