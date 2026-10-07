import {
  type AgentSummary,
  type ChatMessage,
  type MessageImage,
  randomId,
} from "@durable-computer/protocol"
import type { AgentState } from "@durable-computer/client"
import { useQuery } from "@tanstack/react-query"
import { Link, useRouteContext } from "@tanstack/react-router"
import { ArrowLeftIcon, ArrowsClockwiseIcon, StopIcon } from "@phosphor-icons/react"
import { useAtom } from "jotai"
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { useAtomValue } from "jotai"
import { AgentAvatar, AgentFace } from "@/components/agent-avatar"
import { FaceStack, names, PersonFace } from "@/components/people"
import { Button } from "@/components/ui/button"
import { agentPanelOpenAtom, chatKey, earlierAtom } from "@/lib/atoms"
import { client } from "@/lib/client"
import { agentKey, agentsKey, modelsKey } from "@/lib/collections"
import { mascotMoodAtom } from "@/lib/mascot"
import { queryClient } from "@/lib/query"
import { useSettings } from "@/lib/settings"
import { useLiveChat } from "@/lib/use-live-chat"
import { useMascotMood } from "@/lib/use-mascot-mood"
import {
  noteTyping,
  TeamContext,
  useHere,
  usePeople,
  useWorkspaceOfAgent,
  whoIs,
} from "@/lib/workspaces"
import { AgentPanel } from "./agent-panel.tsx"
import { PendingComputerRequests } from "@/components/computer-requests"
import { PendingApprovals } from "./approvals.tsx"
import { Composer } from "./composer.tsx"
import { DocPanel } from "@/components/library/doc-panel"
import { AgentIdContext, OpenFileContext } from "./sent-file.tsx"
import {
  isAtWork,
  SubagentFace,
  SubagentHero,
  SubagentRows,
  subagentSeed,
  subagentWords,
  useSubagents,
} from "./subagents.tsx"
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
      pettable
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

/** The width from which the agent's panel fits beside the chat. */
const WIDE = "(min-width: 80rem)"

/** Whether the screen is wide enough for the agent's panel to be beside a page. */
export function useWide(): boolean {
  return useSyncExternalStore(
    (changed) => {
      const query = matchMedia(WIDE)
      query.addEventListener("change", changed)
      return () => query.removeEventListener("change", changed)
    },
    () => matchMedia(WIDE).matches,
    // Not known on the server. The page is first drawn as for a narrow screen.
    () => false,
  )
}

/** A chat whose transcript starts at a summary or a fresh start has more before it. */
const startsMidway = (first: ChatMessage | undefined) => first?.role === "notice"

/** One chat: the transcript, kept live by its event stream, and the composer. */
export function ChatView({ agent, chatId }: { agent: AgentSummary; chatId: string }) {
  const live = useLiveChat(agent.id, chatId)
  const api = client.agent(agent.id)
  const [earlier, setEarlier] = useAtom(earlierAtom(chatKey(agent.id, chatId)))

  // What kind of chat this is. A sub-agent's is read here and not written in.
  const { data: agentState } = useQuery<AgentState>({
    queryKey: agentKey(agent.id),
    queryFn: () => client.agent(agent.id).state(),
  })
  const chat = agentState?.chats.find((entry) => entry.id === chatId)
  const sub = chat?.kind === "subagent" ? chat : undefined
  const parent = agentState?.chats.find((entry) => entry.id === sub?.parentId)
  const subagents = useSubagents(agent.id, chatId)
  const [subagentsOpen, setSubagentsOpen] = useState(false)

  // In a team: who else has this chat open, and who is writing in it.
  const { me } = useRouteContext({ from: "/_app" })
  const workspace = useWorkspaceOfAgent(agent.id)
  const team = workspace?.kind === "team" ? workspace : undefined
  const people = usePeople(team)
  const here = useHere(team?.id)
  const inChat = (place: { agentId: string | null; chatId: string | null }) =>
    place.agentId === agent.id && place.chatId === chatId
  const present = whoIs(here, inChat).flatMap((id) => people.get(id) ?? [])
  const typing = whoIs(
    here,
    (place) => inChat(place) && place.typing && place.userId !== me.user.id,
  ).flatMap((id) => people.get(id) ?? [])
  const teamContext = useMemo(
    () => (team === undefined ? undefined : { meId: me.user.id, people }),
    [team, me.user.id, people],
  )

  useMascotMood(
    agent.id,
    chatKey(agent.id, chatId),
    live.state,
    sub === undefined ? undefined : subagentSeed(agent.id, chatId),
  )
  // What the agent's model can take decides whether a picture is sent for it to look at.
  const { data: models } = useQuery({
    queryKey: modelsKey,
    queryFn: () => client.models(),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const hatch = useHatch(agent)
  const { openWorkspace } = useSettings()
  const [panel, setPanel] = useAtom(agentPanelOpenAtom)
  const wide = useWide()
  // A file from the library that is open beside this chat, by its id. It takes the panel's place.
  const [openDoc, setOpenDoc] = useState<string>()
  useEffect(() => setOpenDoc(undefined), [chatId])
  // The panel is beside the chat only where there is room for both.
  const beside = panel && wide && openDoc === undefined
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

  const name = agent.name ?? "New agent"
  const canStartFresh =
    sub === undefined && live.state.messages.length > 0 && !startsMidway(live.state.messages.at(-1))
  const startFreshTitle =
    "Start fresh: the agent stops carrying this chat's earlier messages. Its memory is kept, and you can still read them."
  // An empty chat has the creature in its middle, so the one in the header, right above it, holds
  // still.
  const welcoming = live.loaded && state.messages.length === 0 && !state.busy
  const identity = (
    <>
      <AgentFace agent={agent} className="size-11" still={welcoming} />
      <span className="text-sm font-medium">{name}</span>
    </>
  )

  return (
    <div className="flex h-full min-h-0">
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-20 bg-linear-to-b from-background via-background/80 to-transparent" />
        {sub !== undefined ? (
          // A sub-agent's chat always says whose it is, and leads back to where it was started.
          <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-3">
            <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-xl border bg-background/85 py-1 pr-2 pl-1.5 shadow-sm backdrop-blur">
              <Link
                to="/a/$agentId/c/$chatId"
                params={{ agentId: agent.id, chatId: sub.parentId ?? chatId }}
                aria-label={`Back to ${parent?.title ?? name}`}
                className="flex min-w-0 items-center gap-1 rounded-lg py-1 pr-1.5 pl-1.5 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
              >
                <ArrowLeftIcon className="size-4 shrink-0" />
                <span className="max-w-40 truncate">{parent?.title ?? name}</span>
              </Link>
              <span aria-hidden className="h-5 w-px shrink-0 bg-border" />
              <SubagentFace
                agentId={agent.id}
                chatId={chatId}
                status={sub.status}
                className="size-7"
              />
              <span className="min-w-0 truncate text-sm font-medium">{sub.title}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {subagentWords(sub.status)}
              </span>
              {isAtWork(sub.status) ? (
                <button
                  type="button"
                  onClick={stop}
                  className="flex shrink-0 items-center gap-1 rounded-md border px-2.5 py-0.5 text-xs text-muted-foreground outline-none hover:text-destructive focus-visible:ring-3 focus-visible:ring-ring/40"
                >
                  <StopIcon className="size-3" />
                  Stop
                </button>
              ) : null}
            </div>
          </div>
        ) : beside ? null : (
          // With the panel beside the chat the agent is there, and needs no header here as well.
          <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center">
            <div className="pointer-events-auto relative flex items-center gap-1 rounded-xl border bg-background/85 py-1 pr-2.5 pl-1.5 shadow-sm backdrop-blur">
              {wide ? (
                // Pressing the header brings the panel back.
                <button
                  type="button"
                  aria-label={`Show ${name} beside the chat`}
                  title={`Show ${name} beside the chat`}
                  className="flex items-center gap-2.5 rounded-lg pr-1.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                  onClick={() => setPanel(true)}
                >
                  {identity}
                </button>
              ) : (
                <span className="flex items-center gap-2.5 pr-1.5">{identity}</span>
              )}
              {live.status === "reconnecting" ? (
                <span className="pr-1 text-xs text-muted-foreground">reconnecting…</span>
              ) : null}
              {canStartFresh ? (
                <button
                  type="button"
                  aria-label="Start fresh"
                  title={startFreshTitle}
                  disabled={live.state.busy}
                  onClick={startFresh}
                  className="rounded-md p-1 text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  <ArrowsClockwiseIcon className="size-4" />
                </button>
              ) : null}
              {/* Without the panel, this is the way to the chat's sub-agents. */}
              {subagents.length === 0 ? null : (
                <>
                  <button
                    type="button"
                    aria-expanded={subagentsOpen}
                    onClick={() => setSubagentsOpen(!subagentsOpen)}
                    className="rounded-md border px-2.5 py-0.5 text-xs whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
                  >
                    {subagents.length} {subagents.length === 1 ? "sub-agent" : "sub-agents"}
                    {subagents.some((entry) => isAtWork(entry.status))
                      ? ` · ${subagents.filter((entry) => isAtWork(entry.status)).length} at work`
                      : ""}
                  </button>
                  {subagentsOpen ? (
                    <div className="absolute top-full left-1/2 mt-2 max-h-80 w-72 max-w-[90vw] -translate-x-1/2 overflow-y-auto rounded-2xl border bg-popover p-1.5 shadow-lg">
                      <SubagentRows agentId={agent.id} subagents={subagents} />
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        )}
        <div className="min-h-0 flex-1">
          <AgentIdContext value={agent.id}>
            <OpenFileContext value={wide ? setOpenDoc : undefined}>
              <TeamContext value={teamContext}>
                <Transcript
                  state={state}
                  onRetry={sub === undefined ? retry : undefined}
                  asker={sub === undefined ? undefined : name}
                  empty={
                    live.loaded && sub === undefined ? (
                      <Welcome
                        agent={agent}
                        face={
                          // Where the panel is beside the chat, the creature is in it and not here too.
                          beside ? null : (
                            <span className="mb-6">
                              <Hatchling agent={agent} hatch={hatch} className="size-72" />
                            </span>
                          )
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
              </TeamContext>
            </OpenFileContext>
          </AgentIdContext>
        </div>
        <PendingApprovals
          agentId={agent.id}
          agentName={agent.name ?? "Your agent"}
          chatId={chatId}
        />
        <PendingComputerRequests agentId={agent.id} agentName={agent.name ?? "Your agent"} />
        {sub !== undefined ? (
          // Where the message box would be. Its agent is the one who talks to it.
          <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 pt-1 pb-5 text-sm text-muted-foreground">
            <AgentFace agent={agent} className="size-8" still />
            <p className="min-w-0 flex-1">
              Only {name} talks to its sub-agents. To change what this one is doing, tell {name}.
            </p>
            <Link
              to="/a/$agentId/c/$chatId"
              params={{ agentId: agent.id, chatId: sub.parentId ?? chatId }}
              className="shrink-0 rounded-lg border px-3 py-1.5 text-foreground outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/40"
            >
              Back to {name}
            </Link>
          </div>
        ) : (
          <>
            {typing.length === 0 ? null : (
              <p
                role="status"
                className="mx-auto flex w-full max-w-3xl items-center gap-2 px-6 pb-1.5 text-xs text-muted-foreground"
              >
                <FaceStack people={typing} className="size-[1.125rem]" />
                {names(typing)} {typing.length === 1 ? "is" : "are"} typing…
              </p>
            )}
            <Composer
              onTyping={team === undefined ? undefined : noteTyping}
              draftKey={chatKey(agent.id, chatId)}
              placeholder={agent.name ? `Message ${agent.name}` : "Say hello"}
              busy={live.state.busy}
              queued={live.state.queued}
              onSend={send}
              error={sendError}
              onStop={stop}
              sees={models?.find((model) => model.id === agent.model)?.images === true}
              agentName={name}
              onAttach={attach}
            />
          </>
        )}
      </div>
      {wide && openDoc !== undefined ? (
        <DocPanel
          agentId={agent.id}
          agentName={agent.name ?? "Your agent"}
          fileId={openDoc}
          onOpen={setOpenDoc}
          onClose={() => setOpenDoc(undefined)}
        />
      ) : null}
      {beside ? (
        <AgentPanel
          agent={agent}
          state={state}
          face={
            sub === undefined ? (
              <Hatchling agent={agent} hatch={hatch} className="size-52" />
            ) : (
              <SubagentHero agentId={agent.id} chatId={chatId} className="size-44" />
            )
          }
          subagent={
            sub === undefined
              ? undefined
              : { chatId, title: sub.title, status: sub.status, parentTitle: parent?.title }
          }
          subagents={subagents}
          presence={
            team === undefined ? undefined : (
              <section aria-label="Here now" className="shrink-0 border-t px-5 pt-4 pb-3.5">
                <h3 className="flex items-center justify-between pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Here now
                  {team.role === "member" ? null : (
                    <button
                      type="button"
                      onClick={() => openWorkspace("team")}
                      className="rounded-sm text-xs font-medium tracking-normal text-primary normal-case outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/40 dark:text-[oklch(0.78_0.09_195)]"
                    >
                      Invite
                    </button>
                  )}
                </h3>
                <div className="flex items-center gap-1.5 [--face-ring:var(--rail)]">
                  {present.map((person) => (
                    <PersonFace key={person.id} person={person} here className="size-7" />
                  ))}
                  <span className="ml-1 min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {typing.length > 0
                      ? `${names(typing)} ${typing.length === 1 ? "is" : "are"} typing`
                      : present.length === 0
                        ? "Connecting…"
                        : names(present, me.user.name)}
                  </span>
                </div>
              </section>
            )
          }
          onOpenFile={setOpenDoc}
          reconnecting={live.status === "reconnecting"}
          startFresh={
            canStartFresh
              ? { title: startFreshTitle, disabled: live.state.busy, run: startFresh }
              : undefined
          }
        />
      ) : null}
    </div>
  )
}
