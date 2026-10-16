import { type CallerState, type CallPhase, createCaller } from "@do-computer/client"
import type { CallsState } from "@do-computer/protocol"
import { useQuery } from "@tanstack/react-query"
import { getDefaultStore } from "jotai"
import { useSyncExternalStore } from "react"
import { messageOrigin } from "@/lib/origin"
import { serverAtom, sessionFor } from "@/lib/session"
import { useSession } from "@/lib/use-session"
import { feedMascot, type Mood } from "@/ui/avatar"
import { microphoneProblem, openLine } from "./line"

/**
 * Calls on this phone. What a call does is the web app's, in `@do-computer/client`; what is the
 * phone's is how the sound is carried (line.ts), and that the chat a call works in is followed
 * by the phone's own client.
 */

/** The client of the deployment this phone is signed in to, as it is now. */
function client() {
  const server = getDefaultStore().get(serverAtom)
  if (server === null) throw new Error("No server is connected.")
  return sessionFor(server).client
}

export const caller = createCaller({
  agent: (agentId) => client().agent(agentId),
  openLine,
  microphoneProblem,
  follow(agentId, chatId, onState) {
    const subscription = client().agent(agentId).watchChat(chatId, onState)
    return () => subscription.close()
  },
  origin: messageOrigin,
  onVoice: (agentId) => feedMascot(agentId, "token"),
})

/** The call this phone is on, why one ended, and one that is being written up. */
export function useCaller(): CallerState {
  return useSyncExternalStore(caller.subscribe, caller.getState, caller.getState)
}

/** Whether whoever is signed in can call a Dood, as the server says. Undefined until known. */
export function useCalls(agentId: string): CallsState | undefined {
  const { client } = useSession()
  return useQuery({
    queryKey: ["agents", agentId, "calls"],
    queryFn: () => client.agent(agentId).calls(),
    staleTime: 60_000,
  }).data
}

/** What the Dood's creature does at each moment of a call. */
export function callMood(phase: CallPhase): Mood {
  if (phase === "speaking") return { state: "speaking" }
  if (phase === "hearing") return { state: "listening" }
  if (phase === "working") return { state: "working", variant: "search" }
  if (phase === "starting" || phase === "connecting") return { state: "thinking" }
  return { state: "idle" }
}
