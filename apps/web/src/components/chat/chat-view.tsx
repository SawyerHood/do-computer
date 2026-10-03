import { type AgentSummary, type ChatMessage, randomId } from "@durable-computer/protocol"
import { ArrowsClockwiseIcon, SidebarSimpleIcon } from "@phosphor-icons/react"
import { useAtom } from "jotai"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useAtomValue } from "jotai"
import { AgentAvatar, AgentFace } from "@/components/agent-avatar"
import { Button } from "@/components/ui/button"
import { chatKey, earlierAtom } from "@/lib/atoms"
import { client } from "@/lib/client"
import { agentKey, agentsKey } from "@/lib/collections"
import { mascotMoodAtom } from "@/lib/mascot"
import { queryClient } from "@/lib/query"
import { cn } from "@/lib/utils"
import { useLiveChat } from "@/lib/use-live-chat"
import { useMascotMood } from "@/lib/use-mascot-mood"
import { AgentPanel } from "./agent-panel.tsx"
import { PendingApprovals } from "./approvals.tsx"
import { Composer } from "./composer.tsx"
import { AgentIdContext } from "./sent-file.tsx"
import { Transcript } from "./transcript.tsx"

/** Record that the agent's owner has seen it out of its egg, so it is shown hatched from now on. */
async function markHatched(agentId: string): Promise<void> {
  queryClient.setQueryData(agentKey(agentId), await client.agent(agentId).update({ hatched: true }))
  await queryClient.invalidateQueries({ queryKey: agentsKey })
}

/** How long a new agent sits in its egg before it starts to hatch. */
const EGG_MS = 1_600

/**
 * A new agent is met as an egg, which hatches while its owner watches. Once: after that it is
 * out, here and everywhere it is shown.
 */
function useHatch(agent: AgentSummary) {
  const [phase, setPhase] = useState<"egg" | "hatching" | "out">(agent.hatched ? "out" : "egg")
  useEffect(() => {
    if (phase !== "egg") return
    const timer = setTimeout(() => setPhase("hatching"), EGG_MS)
    return () => clearTimeout(timer)
  }, [phase])
  const told = useRef(agent.hatched)
  const hatched = useCallback(() => {
    setPhase("out")
    if (told.current) return
    told.current = true
    void markHatched(agent.id)
  }, [agent.id])
  // Leaving the hatch while it plays jumps to its end.
  const skip = useCallback(
    () => (phase === "hatching" ? setPhase("out") : hatched()),
    [phase, hatched],
  )
  return { phase, hatched, skip }
}

/** The agent's creature at a size to watch it at: in its egg, hatching, or doing what it does. */
function Hatchling({
  agent,
  hatch,
  className,
}: {
  agent: AgentSummary
  hatch: ReturnType<typeof useHatch>
  className: string
}) {
  const mood = useAtomValue(mascotMoodAtom(agent.id))
  const face = (
    <AgentAvatar
      avatar={agent.avatar}
      seed={agent.id}
      className={className}
      mood={mood}
      hatched={hatch.phase === "out"}
      hatching={hatch.phase === "hatching"}
      onHatched={hatch.hatched}
    />
  )
  if (hatch.phase === "out") return face
  return (
    <button
      type="button"
      aria-label="Skip the hatching"
      title="Skip"
      className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
      onClick={hatch.skip}
    >
      {face}
    </button>
  )
}

function Welcome({ agent, face }: { agent: AgentSummary; face: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
      {face}
      <h1 className="text-xl font-medium">{agent.name ?? "Say hello"}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        {agent.name
          ? (agent.tagline ?? "What would you like to do?")
          : "Your agent is brand new. It has no name yet. Start talking and work out together who it is."}
      </p>
    </div>
  )
}

const PANEL_KEY = "dc-agent-panel"

/** Whether the panel beside the chat is wanted. Remembered, and open until it is closed. */
function usePanel(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(true)
  useEffect(() => {
    try {
      if (localStorage.getItem(PANEL_KEY) === "closed") setOpen(false)
    } catch {
      // Storage can be unavailable; the panel is then simply open.
    }
  }, [])
  const set = useCallback((next: boolean) => {
    setOpen(next)
    try {
      localStorage.setItem(PANEL_KEY, next ? "open" : "closed")
    } catch {
      // The choice then lasts for this page only.
    }
  }, [])
  return [open, set]
}

/** A chat whose transcript starts at a summary or a fresh start has more before it. */
const startsMidway = (first: ChatMessage | undefined) => first?.role === "notice"

/** One chat: the transcript, kept live by its event stream, and the composer. */
export function ChatView({ agent, chatId }: { agent: AgentSummary; chatId: string }) {
  const live = useLiveChat(agent.id, chatId)
  const api = client.agent(agent.id)
  const [earlier, setEarlier] = useAtom(earlierAtom(chatKey(agent.id, chatId)))

  useMascotMood(agent.id, chatKey(agent.id, chatId), live.state)
  const hatch = useHatch(agent)
  const [panel, setPanel] = usePanel()
  // Someone who starts talking before the egg has opened has met their agent all the same.
  const talked = live.loaded && live.state.messages.length > 0
  useEffect(() => {
    if (talked && !agent.hatched) void markHatched(agent.id)
  }, [talked, agent.hatched, agent.id])

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
    <div className="flex h-full min-h-0">
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-20 bg-linear-to-b from-background via-background/80 to-transparent" />
        {/* Where the panel's own close button is when it is open, so it is found again. */}
        {panel ? null : (
          <Button
            variant="secondary"
            size="icon-sm"
            className="absolute top-3 right-3 z-20 hidden rounded-full xl:inline-flex"
            aria-label="Show the panel"
            title={`Show ${agent.name ?? "the agent"} beside the chat`}
            onClick={() => setPanel(true)}
          >
            <SidebarSimpleIcon mirrored />
          </Button>
        )}
        <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center">
          <div
            className={cn(
              "pointer-events-auto flex items-center gap-2.5 rounded-full border bg-background/85 py-1 pr-4 pl-1.5 shadow-sm backdrop-blur",
              // With the panel beside the chat, the creature is there and this is only a name.
              panel && "xl:py-2 xl:pl-4",
            )}
          >
            <span className={cn("contents", panel && "xl:hidden")}>
              <AgentFace agent={agent} className="size-11" />
            </span>
            {panel ? null : (
              <button
                type="button"
                className="hidden text-sm font-medium outline-none hover:underline focus-visible:underline xl:inline"
                title="Show the panel beside the chat"
                onClick={() => setPanel(true)}
              >
                {agent.name ?? "New agent"}
              </button>
            )}
            <span className={cn("text-sm font-medium", !panel && "xl:hidden")}>
              {agent.name ?? "New agent"}
            </span>
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
              face={
                // Where the panel is beside the chat, the creature is in it and not here too.
                <span className={cn("contents", panel && "xl:hidden")}>
                  <AgentFace agent={agent} className="size-12" />
                </span>
              }
              empty={
                live.loaded ? (
                  <Welcome
                    agent={agent}
                    face={
                      // Where the panel is beside the chat, the creature is in it and not here too.
                      <span className={cn("mb-6", panel && "xl:hidden")}>
                        <Hatchling agent={agent} hatch={hatch} className="size-72" />
                      </span>
                    }
                  />
                ) : null
              }
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
        <PendingApprovals
          agentId={agent.id}
          agentName={agent.name ?? "Your agent"}
          chatId={chatId}
        />
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
      {panel ? (
        <AgentPanel
          agent={agent}
          state={state}
          face={<Hatchling agent={agent} hatch={hatch} className="size-52" />}
          onClose={() => setPanel(false)}
        />
      ) : null}
    </div>
  )
}
