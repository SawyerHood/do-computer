import { type AgentSummary, continuesMain } from "@do-computer/protocol"
import { useQuery } from "@tanstack/react-query"
import { Link, useRouteContext } from "@tanstack/react-router"
import { ArrowLeftIcon, StopIcon } from "@phosphor-icons/react"
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
import { desktop } from "@/lib/desktop"
import { screenHolds, type Starter, startersFor } from "@/lib/starters"
import { cn } from "@/lib/utils"
import { useChat } from "@/lib/use-chat"
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
import { PanelSection } from "./panel-section.tsx"
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
import { ThinksWith } from "./thinks-with.tsx"

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
  /** Whether this computer's owner is being asked for its screen, and why a starter is held. */
  const [asking, setAsking] = useState(false)
  const [held, setHeld] = useState("")
  // Fresh from the first run, it says hello first, and offers what it was given there lets it do.
  const met = agent.name === null ? undefined : meetingWith(agent.id)
  if (met !== undefined) {
    const given = met.computer
    const start = async (starter: Starter) => {
      setHeld("")
      const app = starter.screen ? desktop() : undefined
      if (app?.askForScreen !== undefined) {
        // The screen is its owner's to give, so the app asks them before the agent is sent for it.
        // An app that cannot be asked leaves it to the agent, which is told whose it is to give.
        setAsking(true)
        const answer = await app.askForScreen().catch(() => undefined)
        setAsking(false)
        const holds = answer === undefined ? undefined : screenHolds(answer)
        if (holds !== undefined) return setHeld(holds)
      }
      onSay(starter.say)
    }
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center [@media(max-height:600px)]:py-6">
        {face}
        <h1 className="text-xl font-medium">
          Hi {met.first}, I’m {agent.name}.
        </h1>
        <p className="text-sm text-muted-foreground">What should we do first?</p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {startersFor(given).map((starter) => (
            <Button
              key={starter.label}
              variant="outline"
              size="sm"
              className="rounded-full"
              disabled={asking}
              onClick={() => void start(starter)}
            >
              {starter.label}
            </Button>
          ))}
        </div>
        {held === "" ? null : (
          <p role="status" className="max-w-md text-sm text-muted-foreground">
            {held}
          </p>
        )}
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
          : "Your Dood is brand new. It has no name yet. Start talking and work out together who it is."}
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
  const { live, state, undelivered, earlier, send, sendError, retry, stop, attach } = useChat(
    agent.id,
    chatId,
  )

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
  const peerName = peer?.name ?? thread?.peer?.name ?? "the other Dood"
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
  const { open: openSettings } = useSettings()
  const panel = useAtomValue(agentPanelOpenAtom)
  const wide = useWide()
  // A file from the library that is open beside this chat, by its id. It takes the panel's place.
  const [openDoc, setOpenDoc] = useState<string>()
  useEffect(() => setOpenDoc(undefined), [chatId, sideId])
  // A side chat is beside the chat only where there is room for both, and so is the panel. Of
  // the things that can be there, one is: a document, else a side chat, else the panel.
  const sideOpen = wide && side !== undefined && openDoc === undefined
  const beside = panel && wide && openDoc === undefined && side === undefined
  // Someone who starts talking before the egg has opened has met their agent all the same.
  const talked = live.loaded && live.state.messages.length > 0
  useEffect(() => {
    if (talked && !agent.hatched) void markHatched(agent.id)
  }, [talked, agent.hatched, agent.id])

  const name = agent.name ?? "New Dood"
  // The stream was turned away, which it will be again: there is no such chat to show.
  const refused = live.status === "closed" && !live.loaded
  // A sub-agent is shown over the chat and in the panel only while it is at work. Once it has
  // ended it is in the transcript, where it was started and where it reported back.
  const atWork = useMemo(() => subagents.filter((entry) => isAtWork(entry.status)), [subagents])
  // What the chat has to say that the strip above it does not, where the panel is not there to.
  const notes = !beside && (live.status === "reconnecting" || atWork.length > 0)
  // Whether anything is over the top of the transcript.
  const floats = sub !== undefined || thread?.peer !== undefined || notes
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
              !floats && "hidden",
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
          ) : !notes ? null : (
            // The strip above says whose chat this is, and the panel beside it says the rest. With
            // the panel away, what is left to say here is what neither does, when there is any.
            <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center">
              <div className="pointer-events-auto relative flex items-center gap-1 rounded-full bg-background/85 px-1.5 py-1 shadow-raised backdrop-blur">
                {live.status === "reconnecting" ? (
                  <span className="px-1.5 text-xs text-muted-foreground">reconnecting…</span>
                ) : null}
                {/* Without the panel, this is the way to the chat's sub-agents while they work. */}
                {atWork.length === 0 ? null : (
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
                      {atWork.length} {atWork.length === 1 ? "sub-agent" : "sub-agents"} at work
                    </PopoverTrigger>
                    <PopoverContent
                      sideOffset={12}
                      className="max-h-80 max-w-[90vw] gap-0 overflow-y-auto p-1.5"
                    >
                      <SubagentRows agentId={agent.id} subagents={atWork} />
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
                    undelivered={undelivered}
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
            agentName={agent.name ?? "Your Dood"}
            chatId={chatId}
          />
          <PendingComputerRequests agentId={agent.id} agentName={agent.name ?? "Your Dood"} />
          <PendingSignIns agentId={agent.id} agentName={agent.name ?? "Your Dood"} />
          <PendingSecrets
            agentId={agent.id}
            agentName={agent.name ?? "Your Dood"}
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
                onSend={send}
                error={sendError}
                onStop={stop}
                sees={models?.find((model) => model.id === agent.model)?.images === true}
                agentName={name}
                onAttach={attach}
                extras={<ThinksWith agent={agent} models={models} />}
              />
            </>
          )}
        </div>
      </div>
      {wide && openDoc !== undefined ? (
        <DocPanel
          agentId={agent.id}
          agentName={agent.name ?? "Your Dood"}
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
          subagents={atWork}
          running={running}
          threads={threads}
          slack={slackThreads}
          chatId={chatId}
          // A call is held in a chat that is the person's to talk in.
          callIn={own ? chatId : undefined}
          presence={
            team === undefined ? undefined : (
              <PanelSection
                id="here"
                title="Here now"
                action={
                  team.role === "member" ? undefined : (
                    <Button
                      variant="link"
                      size="xs"
                      onClick={() => openSettings({ at: "workspace", section: "people" })}
                      className="h-auto px-0 tracking-normal normal-case dark:text-[oklch(0.78_0.09_195)]"
                    >
                      Invite
                    </Button>
                  )
                }
              >
                <div className="flex items-center gap-1.5 px-5 pb-3.5 [--face-ring:var(--rail)]">
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
              </PanelSection>
            )
          }
          onOpenFile={setOpenDoc}
          reconnecting={live.status === "reconnecting"}
        />
      ) : null}
    </div>
  )
}
