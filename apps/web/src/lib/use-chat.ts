import {
  type ChatMessage,
  continuesMain,
  type MessageImage,
  randomId,
} from "@do-computer/protocol"
import { useAtom } from "jotai"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { chatKey, earlierAtom, sendingAtom } from "./atoms.ts"
import { client } from "./client.ts"
import { GIVE_UP_MS, settleSends } from "./sending.ts"
import { useLiveChat } from "./use-live-chat.ts"

/** How long after the chat shows a message of the user's it may take to say it is being answered. */
const ANSWER_BEGINS_MS = 2_000

/**
 * A chat whose transcript starts at a summary or a fresh start has more before it. One that
 * starts where it branched off the main chat does not: what came before is the main chat's.
 */
export const startsMidway = (first: ChatMessage | undefined) =>
  first?.role === "notice" && !continuesMain([first])

/**
 * One chat as a page of it needs it: the transcript, kept live by its event stream, what came
 * before that where it has been asked for, and the things that can be done in it.
 */
export function useChat(agentId: string, chatId: string) {
  const live = useLiveChat(agentId, chatId)
  const api = useMemo(() => client.agent(agentId), [agentId])
  const [earlier, setEarlier] = useAtom(earlierAtom(chatKey(agentId, chatId)))
  const [sending, setSending] = useAtom(sendingAtom(chatKey(agentId, chatId)))

  const liveFirst = live.state.messages[0]
  // The live transcript starts somewhere new after a summary or a fresh start. What was loaded
  // led up to the old start and would now leave a gap, so it is dropped and can be loaded again.
  useEffect(() => {
    if (live.loaded && earlier.anchor !== undefined && earlier.anchor !== liveFirst?.id) {
      setEarlier({ messages: [], before: undefined, loading: false })
    }
  }, [live.loaded, earlier.anchor, liveFirst?.id, setEarlier])

  const hasEarlier =
    earlier.before === undefined ? startsMidway(liveFirst) : earlier.before !== null
  const loadEarlier = useCallback(async () => {
    if (liveFirst === undefined) return
    setEarlier((previous) => ({ ...previous, loading: true }))
    try {
      const page = await api.earlier(chatId, earlier.before ?? liveFirst.id)
      setEarlier((previous) => ({
        anchor: liveFirst.id,
        messages: [...page.messages, ...previous.messages],
        before: page.before,
        loading: false,
      }))
    } catch {
      setEarlier((previous) => ({ ...previous, loading: false }))
    }
  }, [api, chatId, earlier.before, liveFirst, setEarlier])
  const startFresh = useCallback(() => void api.resetChat(chatId), [api, chatId])

  // What has been sent and is not in the chat yet is shown as if it were: a message is on
  // screen the moment it is sent, and the chat's own copy takes its place when it arrives.
  const [now, setNow] = useState(() => Date.now())
  const settled = useMemo(
    () => settleSends(sending, live.state, now, live.status === "open"),
    [sending, live.state, now, live.status],
  )
  // A message of the user's that the chat now has, and has not yet said it is answering. The
  // chat says a moment after it shows the message that the agent is at work on it, and the
  // agent is shown at work on it throughout: from the sending, across that moment.
  const [unanswered, setUnanswered] = useState<string>()
  useEffect(() => {
    if (settled.sending === sending) return
    const last = settled.arrived.at(-1)
    if (last !== undefined) setUnanswered(last)
    setSending(settled.sending)
  }, [settled, sending, setSending])
  const said = live.state.busy
  useEffect(() => {
    if (unanswered === undefined) return
    // The chat has said so itself, and is what says from here whether the agent is at work.
    if (said) return setUnanswered(undefined)
    // Long enough for the chat to say so. Past that, it is not being answered.
    const timer = setTimeout(() => setUnanswered(undefined), ANSWER_BEGINS_MS)
    return () => clearTimeout(timer)
  }, [unanswered, said])
  const expecting =
    settled.messages.length > 0 ||
    settled.arrived.length > 0 ||
    (unanswered !== undefined && live.state.messages.at(-1)?.id === unanswered)
  // One the server took and the chat never shows is looked at again once it is due to be given
  // up on. Nothing else would bring it back up.
  const accepted = sending.find((send) => send.acceptedAt !== undefined)?.acceptedAt
  useEffect(() => {
    if (accepted === undefined) return
    const due = accepted + GIVE_UP_MS + 100 - Date.now()
    const timer = setTimeout(() => setNow(Date.now()), Math.max(due, 0))
    return () => clearTimeout(timer)
  }, [accepted])

  const state = useMemo(() => {
    const ahead = settled.messages
    if (
      earlier.messages.length === 0 &&
      ahead.length === 0 &&
      settled.queued === live.state.queued &&
      !expecting
    )
      return live.state
    return {
      ...live.state,
      messages: [...earlier.messages, ...live.state.messages, ...ahead],
      queued: settled.queued,
      // What was just said is about to be answered. The agent is shown at it from now, and not
      // from when the server says it has begun.
      busy: live.state.busy || expecting,
    }
  }, [earlier.messages, live.state, settled, expecting])

  const [sendError, setSendError] = useState<string>()
  useEffect(() => setSendError(undefined), [chatId])
  const latest = useRef(live.state)
  latest.current = live.state
  const send = useCallback(
    async (text: string, images: MessageImage[] = []) => {
      setSendError(undefined)
      const id = randomId()
      const chat = latest.current
      setSending((current) => [
        ...current,
        {
          id,
          text,
          images,
          at: Date.now(),
          waiting: chat.busy,
          known: new Set([...chat.messages, ...chat.queued].map((entry) => entry.id)),
        },
      ])
      try {
        const { submissionId } = await api.send(chatId, {
          text,
          ...(images.length > 0 ? { images } : {}),
          requestId: id,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        })
        setSending((current) =>
          current.map((entry) =>
            entry.id === id ? { ...entry, submissionId, acceptedAt: Date.now() } : entry,
          ),
        )
        return true
      } catch (error) {
        // It did not go, so it is taken back out of the chat.
        setSending((current) => current.filter((entry) => entry.id !== id))
        // A message that did not go must not just vanish: say so, and leave it in the box.
        setSendError(
          `That was not sent: ${error instanceof Error ? error.message : "something went wrong"}. Try again.`,
        )
        return false
      }
    },
    [api, chatId, setSending],
  )
  // There is no running a reply again as such: asking again is what works, so the button asks.
  const retry = useCallback(() => void send("Try again"), [send])
  const stop = useCallback(() => void api.abort(chatId), [api, chatId])
  const attach = useCallback(
    (file: File) =>
      api.upload(
        { name: file.name, type: file.type || "application/octet-stream", body: file },
        chatId,
      ),
    [api, chatId],
  )

  return {
    live,
    /** The live transcript with what was loaded from before it, and what is being sent after it. */
    state,
    earlier: { has: hasEarlier, loading: earlier.loading, load: loadEarlier },
    startFresh,
    send,
    sendError,
    retry,
    stop,
    attach,
  }
}
