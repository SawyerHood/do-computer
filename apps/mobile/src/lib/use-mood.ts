import { type ApprovalsState, chatMood, type ChatState } from "@durable-computer/protocol"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { feedMascot, type Mood } from "@/components/avatar"
import { keys } from "./use-agent.ts"
import { useSession } from "./use-session.ts"

/** How long it keeps listening after the last key, and looks troubled after a failure. */
const LISTEN_MS = 2_500
const TROUBLED_MS = 8_000

/**
 * What an agent's creature should be doing, from the chat on screen. The chat says whether it is
 * thinking, working or speaking; the rest comes from around it: the user typing (`typed` counts
 * their keys), a request waiting for an answer, and a run that just finished or failed.
 */
export function useMood(agentId: string, state: ChatState, typed: number): Mood {
  const { client } = useSession()
  const { data: approvals } = useQuery<ApprovalsState>({
    queryKey: keys.approvals(agentId),
    queryFn: () => client.agent(agentId).approvals(),
  })
  const waiting = (approvals?.pending.length ?? 0) > 0
  const base = chatMood(state)
  const [listening, setListening] = useState(false)
  const [ending, setEnding] = useState<"done" | "error">()

  // The user is typing: it leans in, and dips a little at every key.
  useEffect(() => {
    if (typed === 0) return setListening(false)
    feedMascot(agentId, "key")
    setListening(true)
    const timer = setTimeout(() => setListening(false), LISTEN_MS)
    return () => clearTimeout(timer)
  }, [agentId, typed])

  // A run that was going has stopped: pleased if it answered, troubled if it failed.
  const wasBusy = useRef(state.busy)
  useEffect(() => {
    const finished = wasBusy.current && !state.busy
    wasBusy.current = state.busy
    if (state.busy) return setEnding(undefined)
    if (!finished) return
    const last = state.messages.at(-1)
    if (last?.role !== "assistant" || last.status === "aborted") return
    const how = last.status === "error" ? "error" : "done"
    setEnding(how)
    const timer = setTimeout(() => setEnding(undefined), how === "error" ? TROUBLED_MS : 1_800)
    return () => clearTimeout(timer)
  }, [state.busy, state.messages])

  // Its answer is being written: it moves with the words as they arrive.
  const last = state.messages.at(-1)
  const written =
    base.state === "speaking" && last !== undefined
      ? last.parts.reduce((sum, part) => sum + (part.type === "text" ? part.text.length : 0), 0)
      : 0
  useEffect(() => {
    if (written > 0) feedMascot(agentId, "token")
  }, [agentId, written])

  if (base.state !== "idle" && base.state !== "error") return base
  if (ending !== undefined) return { state: ending }
  if (waiting) return { state: "waiting" }
  return { state: listening ? "listening" : "idle" }
}
