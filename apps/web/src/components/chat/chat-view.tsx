import { type AgentSummary, type ChatMessage, randomId } from "@durable-computer/protocol"
import { ArrowsClockwiseIcon } from "@phosphor-icons/react"
import { useAtom } from "jotai"
import { useCallback, useEffect, useMemo, useState } from "react"
import { AgentAvatar } from "@/components/agent-avatar"
import { Button } from "@/components/ui/button"
import { chatKey, earlierAtom } from "@/lib/atoms"
import { client } from "@/lib/client"
import { useLiveChat } from "@/lib/use-live-chat"
import { PendingApprovals } from "./approvals.tsx"
import { Composer } from "./composer.tsx"
import { AgentIdContext } from "./sent-file.tsx"
import { Transcript } from "./transcript.tsx"

function Welcome({ agent }: { agent: AgentSummary }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
      <AgentAvatar avatar={agent.avatar} seed={agent.id} className="size-20" />
      <h1 className="text-xl font-medium">{agent.name ?? "Say hello"}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        {agent.name
          ? (agent.tagline ?? "What would you like to do?")
          : "Your agent is brand new. It has no name yet. Start talking and work out together who it is."}
      </p>
    </div>
  )
}

/** A chat whose transcript starts at a summary or a fresh start has more before it. */
const startsMidway = (first: ChatMessage | undefined) => first?.role === "notice"

/** One chat: the transcript, kept live by its event stream, and the composer. */
export function ChatView({ agent, chatId }: { agent: AgentSummary; chatId: string }) {
  const live = useLiveChat(agent.id, chatId)
  const api = client.agent(agent.id)
  const [earlier, setEarlier] = useAtom(earlierAtom(chatKey(agent.id, chatId)))

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
    async (text: string) => {
      setSendError(undefined)
      try {
        await api.send(chatId, {
          text,
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
  const stop = useCallback(() => void api.abort(chatId), [api, chatId])
  const attach = useCallback(
    (file: File) =>
      api.upload(
        { name: file.name, type: file.type || "application/octet-stream", body: file },
        chatId,
      ),
    [api, chatId],
  )

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-16 bg-linear-to-b from-background via-background/80 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center">
        <div className="pointer-events-auto flex items-center gap-2 rounded-full border bg-background/85 py-1 pr-3.5 pl-1 shadow-sm backdrop-blur">
          <AgentAvatar avatar={agent.avatar} seed={agent.id} className="size-7" />
          <span className="text-sm font-medium">{agent.name ?? "New agent"}</span>
          {live.status === "reconnecting" ? (
            <span className="text-xs text-muted-foreground">reconnecting…</span>
          ) : null}
          {live.state.messages.length > 0 && !startsMidway(live.state.messages.at(-1)) ? (
            <button
              type="button"
              aria-label="Start fresh"
              title="Start fresh: the agent stops carrying this chat's earlier messages. Its memory is kept, and you can still read them."
              disabled={live.state.busy}
              onClick={startFresh}
              className="-mr-1.5 rounded-full p-1 text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              <ArrowsClockwiseIcon className="size-4" />
            </button>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <AgentIdContext value={agent.id}>
          <Transcript
            state={state}
            empty={live.loaded ? <Welcome agent={agent} /> : null}
            before={
              hasEarlier ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-center text-muted-foreground"
                  disabled={earlier.loading}
                  onClick={loadEarlier}
                >
                  {earlier.loading ? "Loading…" : "Show earlier messages"}
                </Button>
              ) : null
            }
          />
        </AgentIdContext>
      </div>
      <PendingApprovals agentId={agent.id} agentName={agent.name ?? "Your agent"} chatId={chatId} />
      <Composer
        draftKey={chatKey(agent.id, chatId)}
        placeholder={agent.name ? `Message ${agent.name}` : "Say hello"}
        busy={live.state.busy}
        queued={live.state.queued}
        onSend={send}
        error={sendError}
        onStop={stop}
        onAttach={attach}
      />
    </div>
  )
}
