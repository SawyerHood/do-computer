import { useAtom } from "jotai"
import { useEffect } from "react"
import { chatKey, liveChatAtom } from "./atoms.ts"
import { client } from "./client.ts"

/** Subscribe to a chat for as long as the component is mounted, and return its live state. */
export function useLiveChat(agentId: string, chatId: string) {
  const [live, setLive] = useAtom(liveChatAtom(chatKey(agentId, chatId)))
  useEffect(() => {
    const subscription = client.agent(agentId).watchChat(
      chatId,
      (state) => setLive((previous) => ({ ...previous, state, loaded: true })),
      (status) => setLive((previous) => ({ ...previous, status })),
    )
    return () => subscription.close()
  }, [agentId, chatId, setLive])
  return live
}
