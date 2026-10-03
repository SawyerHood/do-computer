import type { StreamStatus } from "@durable-computer/client"
import { type ChatMessage, type ChatState, EMPTY_CHAT } from "@durable-computer/protocol"
import { useCallback, useEffect, useState } from "react"
import { useSession } from "./use-session.ts"

/** Follow a chat for as long as the screen is mounted. */
export function useLiveChat(agentId: string, chatId: string) {
  const { client } = useSession()
  const [live, setLive] = useState<{ state: ChatState; status: StreamStatus; loaded: boolean }>({
    state: EMPTY_CHAT,
    status: "connecting",
    loaded: false,
  })
  useEffect(() => {
    setLive({ state: EMPTY_CHAT, status: "connecting", loaded: false })
    const subscription = client.agent(agentId).watchChat(
      chatId,
      (state) => setLive((previous) => ({ ...previous, state, loaded: true })),
      (status) => setLive((previous) => ({ ...previous, status })),
    )
    return () => subscription.close()
  }, [client, agentId, chatId])
  return live
}

type Earlier = {
  /** The first message of the live transcript these lead up to. */
  anchor?: string
  messages: ChatMessage[]
  /** Where the next page ends. Undefined until a page was asked for; null at the beginning. */
  before: string | null | undefined
  loading: boolean
}
const NONE: Earlier = { messages: [], before: undefined, loading: false }

/**
 * What came before a chat's live transcript, loaded a page at a time when asked for. A transcript
 * that starts at a summary or a fresh start has more before it.
 */
export function useEarlierMessages(agentId: string, chatId: string, state: ChatState) {
  const { client } = useSession()
  const [earlier, setEarlier] = useState<Earlier>(NONE)
  const first = state.messages[0]
  // The live transcript starts somewhere new after a summary or a fresh start; what was loaded
  // led up to the old start and would leave a gap.
  useEffect(() => {
    setEarlier((current) =>
      current.anchor !== undefined && current.anchor !== first?.id ? NONE : current,
    )
  }, [first?.id])
  useEffect(() => setEarlier(NONE), [agentId, chatId])

  const load = useCallback(async () => {
    if (first === undefined) return
    setEarlier((current) => ({ ...current, loading: true }))
    try {
      const page = await client.agent(agentId).earlier(chatId, earlier.before ?? first.id)
      setEarlier((current) => ({
        anchor: first.id,
        messages: [...page.messages, ...current.messages],
        before: page.before,
        loading: false,
      }))
    } catch {
      setEarlier((current) => ({ ...current, loading: false }))
    }
  }, [client, agentId, chatId, earlier.before, first])

  return {
    messages: earlier.messages,
    loading: earlier.loading,
    hasEarlier: earlier.before === undefined ? first?.role === "notice" : earlier.before !== null,
    load,
  }
}
