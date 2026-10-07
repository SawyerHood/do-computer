import { type ChatMessage, type MessageImage, randomId } from "@durable-computer/protocol"
import { useAtom } from "jotai"
import { useCallback, useEffect, useMemo, useState } from "react"
import { chatKey, earlierAtom } from "./atoms.ts"
import { client } from "./client.ts"
import { useLiveChat } from "./use-live-chat.ts"

/** A chat whose transcript starts at a summary or a fresh start has more before it. */
export const startsMidway = (first: ChatMessage | undefined) => first?.role === "notice"

/**
 * One chat as a page of it needs it: the transcript, kept live by its event stream, what came
 * before that where it has been asked for, and the things that can be done in it.
 */
export function useChat(agentId: string, chatId: string) {
  const live = useLiveChat(agentId, chatId)
  const api = useMemo(() => client.agent(agentId), [agentId])
  const [earlier, setEarlier] = useAtom(earlierAtom(chatKey(agentId, chatId)))

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
  const state = useMemo(
    () =>
      earlier.messages.length === 0
        ? live.state
        : { ...live.state, messages: [...earlier.messages, ...live.state.messages] },
    [earlier.messages, live.state],
  )

  const [sendError, setSendError] = useState<string>()
  useEffect(() => setSendError(undefined), [chatId])
  const send = useCallback(
    async (text: string, images: MessageImage[] = []) => {
      setSendError(undefined)
      try {
        await api.send(chatId, {
          text,
          ...(images.length > 0 ? { images } : {}),
          requestId: randomId(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        })
        return true
      } catch (error) {
        // A message that did not go must not just vanish: say so, and leave it in the box.
        setSendError(
          `That was not sent: ${error instanceof Error ? error.message : "something went wrong"}. Try again.`,
        )
        return false
      }
    },
    [api, chatId],
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
    /** The live transcript with what was loaded from before it. */
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
