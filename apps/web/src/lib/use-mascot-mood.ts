import { type ApprovalsState, chatMood, type ChatState } from "@durable-computer/protocol"
import { useQuery } from "@tanstack/react-query"
import { useAtomValue, useSetAtom } from "jotai"
import { useEffect, useRef, useState } from "react"
import { draftAtom } from "./atoms.ts"
import { client } from "./client.ts"
import { approvalsKey } from "./collections.ts"
import { feedMascot, IDLE, type MascotMood, mascotMoodAtom } from "./mascot.ts"

/** How long it keeps listening after the last key, and looks troubled after a failure. */
const LISTEN_MS = 2_500
const TROUBLED_MS = 8_000
/** It dozes off when nothing has happened on the page for this long. */
const DOZE_MS = 4 * 60_000

/**
 * Works out what an agent's creature should be doing from the chat on screen, and tells every
 * place the creature is drawn. The chat says whether it is thinking, working or speaking; the
 * rest comes from around it: the user typing, a request waiting for an answer, a run that just
 * finished or failed, and a page nobody has touched for a while.
 */
export function useMascotMood(agentId: string, chatKey: string, state: ChatState): void {
  const setMood = useSetAtom(mascotMoodAtom(agentId))
  const draft = useAtomValue(draftAtom(chatKey))
  const { data: approvals } = useQuery<ApprovalsState>({
    queryKey: approvalsKey(agentId),
    queryFn: () => client.agent(agentId).approvals(),
  })
  const waiting = (approvals?.pending.length ?? 0) > 0
  const base = chatMood(state)
  // Short-lived things, each with the moment it began.
  const [listening, setListening] = useState(false)
  const [ending, setEnding] = useState<"done" | "error">()
  const [dozing, setDozing] = useState(false)

  // The user is typing: it leans in, and dips a little at every key.
  const typed = useRef(draft)
  useEffect(() => {
    if (draft === typed.current) return
    typed.current = draft
    if (draft === "") return setListening(false)
    feedMascot(agentId, "key")
    setListening(true)
    const timer = setTimeout(() => setListening(false), LISTEN_MS)
    return () => clearTimeout(timer)
  }, [agentId, draft])

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
    // After being pleased it settles by itself; this only stops asking for it.
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

  // Nothing has happened here for a while: it dozes until someone stirs.
  const quiet = base.state === "idle" && !listening && !waiting && ending === undefined
  useEffect(() => {
    if (!quiet) return setDozing(false)
    let timer = setTimeout(() => setDozing(true), DOZE_MS)
    const stir = () => {
      setDozing(false)
      clearTimeout(timer)
      timer = setTimeout(() => setDozing(true), DOZE_MS)
    }
    const events = ["pointerdown", "keydown", "wheel", "pointermove"] as const
    for (const event of events) window.addEventListener(event, stir, { passive: true })
    return () => {
      clearTimeout(timer)
      for (const event of events) window.removeEventListener(event, stir)
    }
  }, [quiet])

  let mood: MascotMood
  if (base.state !== "idle" && base.state !== "error") mood = base
  else if (ending !== undefined) mood = { state: ending }
  else if (waiting) mood = { state: "waiting" }
  else if (listening) mood = { state: "listening" }
  else mood = dozing ? { state: "asleep" } : IDLE

  useEffect(() => {
    setMood({ state: mood.state, variant: mood.variant })
  }, [setMood, mood.state, mood.variant])
  // The chat is no longer on screen, so nothing is known of what the agent is doing.
  useEffect(() => () => setMood(IDLE), [setMood])
}
