import { getDefaultStore, useAtomValue } from "jotai"
import { useEffect } from "react"
import { chatKey, liveChatAtom } from "./atoms.ts"
import { client } from "./client.ts"

const store = getDefaultStore()

/** The chats being followed, each by one stream however many are holding it. */
const followed = new Map<string, { holders: number; close: () => void }>()

/**
 * Follow a chat until it is let go of, feeding its live state. A chat held more than once is
 * still followed once, so one that was fetched ahead and is then opened is not asked for twice.
 */
export function holdChat(agentId: string, chatId: string): () => void {
  const key = chatKey(agentId, chatId)
  const live = liveChatAtom(key)
  let entry = followed.get(key)
  if (entry === undefined) {
    const mine = { holders: 0, close: () => {} }
    entry = mine
    // In place before the stream starts, which says "connecting" as it does.
    followed.set(key, mine)
    // A stream that was let go of still has things to say on its way out. They are not heard.
    const current = () => followed.get(key) === mine
    const subscription = client.agent(agentId).watchChat(
      chatId,
      (state) => {
        if (current()) store.set(live, (previous) => ({ ...previous, state, loaded: true }))
      },
      (status) => {
        if (current()) store.set(live, (previous) => ({ ...previous, status }))
      },
    )
    mine.close = () => subscription.close()
  }
  const held = entry
  held.holders++
  let released = false
  return () => {
    if (released) return
    released = true
    if (--held.holders > 0) return
    followed.delete(key)
    held.close()
    // At rest it is as it starts. What it last showed is kept, to be shown the next time.
    store.set(live, (previous) => ({ ...previous, status: "connecting" }))
  }
}

/** How long a chat fetched ahead is waited for before it is given up on. */
const WARM_MS = 10_000
/** How long it is then kept, for the click that the pointing was leading up to. */
const WARM_KEEP_MS = 2_000

/**
 * Fetch a chat ahead of its being opened: follow it until its state has arrived and a moment
 * longer, and then let go. Opened meanwhile, it is the same stream that carries on.
 */
export function warmChat(agentId: string, chatId: string): void {
  const key = chatKey(agentId, chatId)
  if (followed.has(key)) return
  const live = liveChatAtom(key)
  const before = store.get(live).state
  const release = holdChat(agentId, chatId)
  const settle = (keep: number) => {
    clearTimeout(timer)
    unsubscribe()
    setTimeout(release, keep)
  }
  const unsubscribe = store.sub(live, () => {
    const now = store.get(live)
    if (now.state !== before) settle(WARM_KEEP_MS)
    // Refused: there is nothing to wait for.
    else if (now.status === "closed") settle(0)
  })
  const timer = setTimeout(() => settle(0), WARM_MS)
}

/** Follow a chat for as long as the component is mounted, and return its live state. */
export function useLiveChat(agentId: string, chatId: string) {
  const live = useAtomValue(liveChatAtom(chatKey(agentId, chatId)))
  useEffect(() => holdChat(agentId, chatId), [agentId, chatId])
  return live
}
