import { type AgentSummary, continuesMain } from "@durable-computer/protocol"
import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate, useRouteContext } from "@tanstack/react-router"
import { ArrowLeftIcon, ArrowsClockwiseIcon, StopIcon } from "@phosphor-icons/react"
import { useAtom } from "jotai"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useAtomValue } from "jotai"
import { AgentAvatar, AgentFace } from "@/components/agent-avatar"
import { FaceStack, names, PersonFace } from "@/components/people"
import { TranscriptPlaceholder } from "@/components/placeholders"
import { Button, buttonVariants } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { agentPanelOpenAtom, chatKey } from "@/lib/atoms"
import { isSideChat, mainChatOf } from "@/lib/chats"
import { client } from "@/lib/client"
import { agentKey, agentQuery, agentsKey, workspaceModelsKey } from "@/lib/collections"
import { mascotMoodAtom } from "@/lib/mascot"
import { queryClient } from "@/lib/query"
import { useSettings } from "@/lib/settings"
import { cn } from "@/lib/utils"
import { startsMidway, useChat } from "@/lib/use-chat"
import { meetingWith } from "@/lib/welcome"
import { useMascotMood } from "@/lib/use-mascot-mood"
import { useWide } from "@/lib/use-wide"
import {
  noteTyping,
  TeamContext,
  useHere,
  usePeople,
  useWorkspaceOfAgent,
  whoIs,
} from "@/lib/workspaces"
import { AgentPanel } from "./agent-panel.tsx"
import { PeerFace, threadWords, useThreads } from "./agent-threads.tsx"
import { PendingComputerRequests, useAgentsById } from "@/components/computer-requests"
import { PendingApprovals } from "./approvals.tsx"
import { PendingSecrets, PendingSignIns } from "./secrets.tsx"
import { RunningCount, useRunningJobs } from "./commands.tsx"
import { Composer } from "./composer.tsx"
import { DocPanel } from "@/components/library/doc-panel"
import { AgentIdContext, OpenFileContext } from "./sent-file.tsx"
import { SideChat, SideChatBar, SideChatWelcome } from "./side-chat.tsx"
import { SlackBar, SlackFoot, useSlackThreads } from "./slack-threads.tsx"
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
      outfit={agent.outfit}
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

/** What a new agent offers to start with, in its first hello. */
const STARTERS = ["Show me what you can do", "Help me plan my week", "Research something for me"]
const STARTERS_HERE = [
  "Show me what you can do",
  "Tidy up my Downloads folder",
  "Look at a project with me",
]

function Welcome({
  agent,
  face,
  onSay,
}: {
  agent: AgentSummary
  face: React.ReactNode
  /** Say this to it, as if it had been typed. */
  onSay: (text: string) => void
}) {
  // Fresh from the first run, it says hello first: to whom, and with what it was given there.
  const met = agent.name === null ? undefined : meetingWith(agent.id)
  if (met !== undefined) {
    const given = met.computer
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center [@media(max-height:600px)]:py-6">
        {face}
        <h1 className="text-xl font-medium">
          Hi {met.first}, I’m {agent.name}.
        </h1>
        <p className="max-w-md text-sm text-muted-foreground">
          {given === undefined
            ? "Good to finally see you."
            : given === null
              ? "I am not on this computer yet. When you want me to work here, switch it on under This Computer in the tray."
              : given.readOnly
                ? "I can read files on this computer now, and nothing more. I can reach it while Do Computer is running, so I have left it in your tray."
                : "I can work on this computer now: run commands, read and change files, and use a browser. I can reach it while Do Computer is running, so I have left it in your tray."}{" "}
          What should we do first?
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {(given ? STARTERS_HERE : STARTERS).map((text) => (
            <Button
              key={text}
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={() => onSay(text)}
            >
              {text}
            </Button>
          ))}
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center [@media(max-height:600px)]:py-6">
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

/**
 * One chat: the transcript, kept live by its event stream, and the composer. Beside it is the
 * agent's panel, or a document, or, beside the main chat, one of the agent's side chats.
 */
export function ChatView({
  agent,
  chatId,
  sideId,
}: {
  agent: AgentSummary
  chatId: string
  /** A side chat to have open beside this one, where there is room. */
  sideId?: string | undefined
}) {
  const { live, state, earlier, startFresh, send, sendError, retry, stop, attach } = useChat(
    agent.id,
    chatId,
  )
  const navigate = useNavigate()

  // What kind of chat this is. A sub-agent's is read here and not written in.
  const { data: agentState } = useQuery(agentQuery(agent.id))
  const chat = agentState?.chats.find((entry) => entry.id === chatId)
  const main = mainChatOf(agentState?.chats)
  // A side chat has the middle to itself here. Until the agent has a main chat there are none.
  const aside = main !== undefined && isSideChat(chat) ? chat : undefined
  const side = agentState?.chats.find(
    (entry) => entry.id === sideId && entry.id !== chatId && isSideChat(entry) && !entry.archived,
  )
  const sub = chat?.kind === "subagent" ? chat : undefined
  const parent = agentState?.chats.find((entry) => entry.id === sub?.parentId)
  const subagents = useSubagents(agent.id, chatId)
  const running = useRunningJobs(agent.id, chatId)
  // A conversation another agent is having with this one is read here too, and not written in.
  const thread = chat?.kind === "agent" ? chat : undefined
  const threads = useThreads(agent.id)
  const agents = useAgentsById()
  const peer = thread?.peer === undefined ? undefined : agents.get(thread.peer.agentId)
  const peerName = peer?.name ?? thread?.peer?.name ?? "the other agent"
  // So is a thread in Slack the agent was spoken to in: it is written in from there.
  const slack = chat?.kind === "slack" ? chat : undefined
  const slackThreads = useSlackThreads(agent.id)
  // Whether this chat is the user's to write in.
  const own = sub === undefined && thread === undefined && slack === undefined

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
    // What was just sent is shown as being answered before the chat says that it is.
    state.busy && !live.state.busy,
  )
  // What the agent's model can take decides whether a picture is sent for it to look at.
  const { data: models } = useQuery({
    queryKey: workspaceModelsKey(agent.workspaceId),
    queryFn: () => client.models(agent.workspaceId),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const hatch = useHatch(agent)
  const { openWorkspace } = useSettings()
  const [panel, setPanel] = useAtom(agentPanelOpenAtom)
  const wide = useWide()
  // A file from the library that is open beside this chat, by its id. It takes the panel's place.
  const [openDoc, setOpenDoc] = useState<string>()
  useEffect(() => setOpenDoc(undefined), [chatId, sideId])
  // A side chat is beside the chat only where there is room for both, and so is the panel. Of
  // the things that can be there, one is: a document, else a side chat, else the panel.
  const sideOpen = wide && side !== undefined && openDoc === undefined
  const beside = panel && wide && openDoc === undefined && side === undefined
  const closeSide = () =>
    void navigate({ to: "/a/$agentId/c/$chatId", params: { agentId: agent.id, chatId } })
  // Someone who starts talking before the egg has opened has met their agent all the same.
  const talked = live.loaded && live.state.messages.length > 0
  useEffect(() => {
    if (talked && !agent.hatched) void markHatched(agent.id)
  }, [talked, agent.hatched, agent.id])

  const name = agent.name ?? "New agent"
  const canStartFresh =
    own && live.state.messages.length > 0 && !startsMidway(live.state.messages.at(-1))
  const startFreshTitle =
    "Start fresh: the agent stops carrying this chat's earlier messages. Its memory is kept, and you can still read them."
  // An empty chat has the creature in its middle, so the one in the header, right above it, holds
  // still.
  const welcoming = live.loaded && state.messages.length === 0 && !state.busy
  // The stream was turned away, which it will be again: there is no such chat to show.
  const refused = live.status === "closed" && !live.loaded
  // What the header above the chat has to say on a narrow screen, where the strip names the agent.
  const floats =
    sub !== undefined ||
    thread?.peer !== undefined ||
    live.status === "reconnecting" ||
    subagents.length > 0
  const identity = (
    <>
      <AgentFace agent={agent} className="size-11" still={welcoming} />
      <span className="text-sm font-medium">{name}</span>
    </>
  )

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        {aside === undefined || main === undefined ? null : (
          <SideChatBar agent={agent} chat={aside} main={main} />
        )}
        {slack === undefined ? null : (
          <SlackBar agent={agent} chat={slack} main={main} onStop={stop} />
        )}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 top-0 z-10 h-20 bg-linear-to-b from-background via-background/80 to-transparent",
              // With nothing over the transcript there is nothing to fade it under.
              !floats && "max-md:hidden",
            )}
          />
          {sub !== undefined ? (
            // A sub-agent's chat always says whose it is, and leads back to where it was started.
            <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-3">
              <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-xl bg-background/85 py-1 pr-2 pl-1.5 shadow-raised backdrop-blur">
                <Link
                  to="/a/$agentId/c/$chatId"
                  params={{ agentId: agent.id, chatId: sub.parentId ?? chatId }}
                  aria-label={`Back to ${parent?.title ?? name}`}
                  className="flex min-w-0 items-center gap-1 rounded-lg py-1 pr-1.5 pl-1.5 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
                >
                  <ArrowLeftIcon className="size-4 shrink-0" />
                  <span className="max-w-40 truncate">{parent?.title ?? name}</span>
                </Link>
                <Separator
                  orientation="vertical"
                  className="data-vertical:h-5 data-vertical:self-center"
                />
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
                  <Button
                    variant="outline"
                    size="xs"
                    className="font-normal text-muted-foreground hover:text-destructive"
                    onClick={stop}
                  >
                    <StopIcon />
                    Stop
                  </Button>
                ) : null}
              </div>
            </div>
          ) : thread?.peer !== undefined ? (
            // A conversation with another agent says who it is with, and leads to where they wrote from.
            <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-3">
              <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-xl bg-background/85 py-1 pr-2 pl-1.5 shadow-raised backdrop-blur">
                <Link
                  to="/a/$agentId/c/$chatId"
                  params={{ agentId: thread.peer.agentId, chatId: thread.peer.chatId }}
                  aria-label={`Back to ${peerName}`}
                  className="flex min-w-0 items-center gap-1.5 rounded-lg py-1 pr-1.5 pl-1.5 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
                >
                  <ArrowLeftIcon className="size-4 shrink-0" />
                  <PeerFace agent={peer} agentId={thread.peer.agentId} className="size-7" />
                  {/* On a narrow screen the face says who, and the title keeps the room. */}
                  <span className="hidden max-w-40 truncate sm:inline">{peerName}</span>
                </Link>
                <Separator
                  orientation="vertical"
                  className="data-vertical:h-5 data-vertical:self-center"
                />
                <span className="min-w-0 truncate text-sm font-medium">{thread.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {threadWords(thread.status)}
                </span>
                {isAtWork(thread.status) ? (
                  <Button
                    variant="outline"
                    size="xs"
                    className="font-normal text-muted-foreground hover:text-destructive"
                    onClick={stop}
                  >
                    <StopIcon />
                    Stop
                  </Button>
                ) : null}
              </div>
            </div>
          ) : beside ? null : (
            // With the panel beside the chat the agent is there, and needs no header here as well.
            // On a narrow screen the strip right above says whose chat this is, so what is left
            // here is what the strip does not have, and with none of that there is nothing here.
            <div
              className={cn(
                "pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center",
                !floats && "max-md:hidden",
              )}
            >
              <div className="pointer-events-auto relative flex items-center gap-1 rounded-xl bg-background/85 py-1 pr-2.5 pl-1.5 shadow-raised backdrop-blur max-md:px-1.5">
                {wide ? (
                  // Pressing the header brings the panel back.
                  <button
                    type="button"
                    aria-label={`Show ${name} beside the chat`}
                    title={`Show ${name} beside the chat`}
                    className="flex items-center gap-2.5 rounded-lg pr-1.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                    onClick={() => {
                      setPanel(true)
                      // A side chat is where the panel would be, and makes way for it.
                      if (side !== undefined) closeSide()
                    }}
                  >
                    {identity}
                  </button>
                ) : (
                  <span className="flex items-center gap-2.5 pr-1.5 max-md:hidden">{identity}</span>
                )}
                {live.status === "reconnecting" ? (
                  <span className="pr-1 text-xs text-muted-foreground">reconnecting…</span>
                ) : null}
                {canStartFresh ? (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Start fresh"
                    title={startFreshTitle}
                    disabled={live.state.busy}
                    onClick={startFresh}
                    className="text-muted-foreground max-md:hidden"
                  >
                    <ArrowsClockwiseIcon className="size-4" />
                  </Button>
                ) : null}
                {/* Without the panel, this is the way to the chat's sub-agents. */}
                {subagents.length === 0 ? null : (
                  <Popover>
                    <PopoverTrigger
                      render={
                        <Button
                          variant="outline"
                          size="xs"
                          className="font-normal text-muted-foreground"
                        />
                      }
                    >
                      {subagents.length} {subagents.length === 1 ? "sub-agent" : "sub-agents"}
                      {subagents.some((entry) => isAtWork(entry.status))
                        ? ` · ${subagents.filter((entry) => isAtWork(entry.status)).length} at work`
                        : ""}
                    </PopoverTrigger>
                    <PopoverContent
                      sideOffset={12}
                      className="max-h-80 max-w-[90vw] gap-0 overflow-y-auto p-1.5"
                    >
                      <SubagentRows agentId={agent.id} subagents={subagents} />
                    </PopoverContent>
                  </Popover>
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
                    chatId={chatId}
                    onRetry={own ? retry : undefined}
                    asker={sub === undefined ? undefined : name}
                    empty={
                      refused ? (
                        <p role="alert" className="py-16 text-center text-sm text-muted-foreground">
                          This chat could not be opened. It may have been deleted.
                        </p>
                      ) : !live.loaded ? (
                        // What it holds is on its way. Not the hello of an empty chat.
                        <TranscriptPlaceholder />
                      ) : !own ? null : aside !== undefined ? (
                        <SideChatWelcome agent={agent} carried={continuesMain(state.messages)} />
                      ) : (
                        <Welcome
                          agent={agent}
                          onSay={(text) => void send(text)}
                          face={
                            // Where the panel is beside the chat, the creature is in it and not here too.
                            beside ? null : (
                              <span className="mb-6">
                                {/* On a short screen it is as large as lets the whole hello be seen. */}
                                <Hatchling
                                  agent={agent}
                                  hatch={hatch}
                                  className="size-[clamp(6rem,calc(100dvh-34.5rem),18rem)]"
                                />
                              </span>
                            )
                          }
                        />
                      )
                    }
                    before={
                      earlier.has ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="self-center text-muted-foreground"
                          disabled={earlier.loading}
                          onClick={earlier.load}
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
          <PendingSignIns agentId={agent.id} agentName={agent.name ?? "Your agent"} />
          <PendingSecrets
            agentId={agent.id}
            agentName={agent.name ?? "Your agent"}
            chatId={chatId}
          />
          {sub !== undefined ? (
            // Where the message box would be. Its agent is the one who talks to it.
            <div className="mx-auto flex w-full max-w-[45rem] items-center gap-3 px-4 pt-1 pb-5 text-sm text-muted-foreground">
              <AgentFace agent={agent} className="size-8" still />
              <p className="min-w-0 flex-1">
                Only {name} talks to its sub-agents. To change what this one is doing, tell {name}.
              </p>
              <Link
                to="/a/$agentId/c/$chatId"
                params={{ agentId: agent.id, chatId: sub.parentId ?? chatId }}
                // A link, in the clothes of a button: it leads somewhere.
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "font-normal text-foreground",
                )}
              >
                Back to {name}
              </Link>
            </div>
          ) : thread?.peer !== undefined ? (
            // Where the message box would be. The two agents are the ones who write here.
            <div className="mx-auto flex w-full max-w-[45rem] items-center gap-3 px-4 pt-1 pb-5 text-sm text-muted-foreground">
              <AgentFace agent={agent} className="size-8" still />
              <p className="min-w-0 flex-1">
                Only {name} and {peerName} write here. To change what {name} is doing in it, tell{" "}
                {peerName}.
              </p>
              <Link
                to="/a/$agentId/c/$chatId"
                params={{ agentId: thread.peer.agentId, chatId: thread.peer.chatId }}
                // A link, in the clothes of a button: it leads somewhere.
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "font-normal text-foreground",
                )}
              >
                Back to {peerName}
              </Link>
            </div>
          ) : slack !== undefined ? (
            <SlackFoot chat={slack} />
          ) : (
            <>
              {typing.length === 0 ? null : (
                <p
                  role="status"
                  className="mx-auto flex w-full max-w-[45rem] items-center gap-2 px-6 pb-1.5 text-xs text-muted-foreground"
                >
                  <FaceStack people={typing} className="size-[1.125rem]" />
                  {names(typing)} {typing.length === 1 ? "is" : "are"} typing…
                </p>
              )}
              <RunningCount agentId={agent.id} jobs={running} />
              <Composer
                onTyping={team === undefined ? undefined : noteTyping}
                draftKey={chatKey(agent.id, chatId)}
                placeholder={
                  aside !== undefined
                    ? `Message ${name} in this side chat`
                    : agent.name
                      ? `Message ${agent.name}`
                      : "Say hello"
                }
                busy={live.state.busy}
                queued={state.queued}
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
      {sideOpen ? <SideChat agent={agent} chat={side} mainId={chatId} /> : null}
      {beside ? (
        <AgentPanel
          agent={agent}
          state={state}
          loading={!live.loaded && !refused}
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
          running={running}
          threads={threads}
          slack={slackThreads}
          chatId={chatId}
          presence={
            team === undefined ? undefined : (
              <section aria-label="Here now" className="shrink-0 border-t px-5 pt-4 pb-3.5">
                <h3 className="flex items-center justify-between pb-2 text-[0.8125rem] font-medium text-muted-foreground">
                  Here now
                  {team.role === "member" ? null : (
                    <Button
                      variant="link"
                      size="xs"
                      onClick={() => openWorkspace("team")}
                      className="h-auto px-0 tracking-normal normal-case dark:text-[oklch(0.78_0.09_195)]"
                    >
                      Invite
                    </Button>
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
