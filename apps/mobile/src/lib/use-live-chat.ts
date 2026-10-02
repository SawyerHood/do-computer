import type { StreamStatus } from "@durable-computer/client"
import { type ChatState, EMPTY_CHAT } from "@durable-computer/protocol"
import { useEffect, useState } from "react"
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
