import {
  type AgentSummary,
  type ChatState,
  type ChatSummary,
  type JobSummary,
  type LibraryFile,
  sentFiles,
  chatUses,
} from "@do-computer/protocol"
import { FileIcon, TShirtIcon } from "@phosphor-icons/react"
import { useAtomValue, useSetAtom } from "jotai"
import { type ReactNode, useMemo, useRef, useState } from "react"
import { AgentAvatar, AgentFace } from "@/components/agent-avatar"
import { CallButton, CallFace } from "@/components/call/call"
import { CreatureCare } from "@/components/creature/care"
import { PinnedShelf } from "@/components/pins/shelf"
import { ResizeHandle } from "@/components/shell/resize-handle"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { callAtom } from "@/lib/call"
import { client } from "@/lib/client"
import { agentPanelColumn } from "@/lib/columns"
import { creatureWardrobeAtom } from "@/lib/creature"
import { formatBytes, isViewable } from "@/lib/library"
import { type MascotMood, mascotMoodAtom } from "@/lib/mascot"
import { cn } from "@/lib/utils"

import { ThreadRows } from "./agent-threads.tsx"
import { JobRows, waitingWords } from "./commands.tsx"
import { PanelSection } from "./panel-section.tsx"
import { SlackRows } from "./slack-threads.tsx"
import { AgentIdContext } from "./sent-file.tsx"
import { UseNow } from "./uses.tsx"
import { SubagentBrood, SubagentRows, subagentSeed, subagentWords } from "./subagents.tsx"

/** How tall the bar is that stands in for the face once it has been scrolled away, in pixels. */
const BAR = 52

/** What it is doing, in a few words. The transcript's own line has the particulars. */
function moodWords(mood: MascotMood, hatched: boolean): string {
  if (!hatched) return "About to hatch"
  switch (mood.state) {
    case "listening":
      return "Listening"
    case "thinking":
      return "Thinking"
    case "working":
      return mood.variant === "file"
        ? "Working with files"
        : mood.variant === "search"
          ? "Looking something up"
          : mood.variant === "memory"
            ? "Making a note"
            : "Running a command"
    case "speaking":
      return "Answering"
    case "waiting":
      return "Waiting for your OK"
    case "done":
      return "Done"
    case "error":
      return "Something went wrong"
    case "asleep":
      return "Resting"
    default:
      return "Ready"
  }
}

/** A file the agent sent in this chat: opened beside it where it can be shown, and otherwise downloaded. */
function Shared({
  agentId,
  file,
  onOpen,
}: {
  agentId: string
  file: LibraryFile
  onOpen: (fileId: string) => void
}) {
  const row =
    "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm outline-none hover:bg-surface focus-visible:ring-3 focus-visible:ring-ring/40"
  const label = (
    <>
      <FileIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{file.name}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(file.size)}</span>
    </>
  )
  return (
    <li>
      {isViewable(file) ? (
        <button
          type="button"
          title="Open beside the chat"
          onClick={() => onOpen(file.id)}
          className={row}
        >
          {label}
        </button>
      ) : (
        <a
          href={client.agent(agentId).libraryFileUrl(file.id)}
          download={file.name}
          title="Download"
          className={row}
        >
          {label}
        </a>
      )}
    </li>
  )
}

/**
 * What a folded list of conversations says of them: that some want an OK, that one is being
 * answered, or that every one has had its answer.
 */
function threadsSaid(threads: ChatSummary[]): ReactNode {
  const waiting = threads.filter((thread) => thread.status === "waiting").length
  if (waiting > 0) {
    return (
      <>
        <span className="text-foreground">{waiting} waiting</span>
        <span aria-hidden className="size-2 shrink-0 animate-pulse rounded-full bg-amber-500" />
      </>
    )
  }
  if (threads.some((thread) => thread.status === "working")) {
    return (
      <>
        Answering
        <Spinner className="size-3.5" />
      </>
    )
  }
  const answered = threads.every((thread) => (thread.status ?? "done") === "done")
  return answered ? (threads.length === 1 ? "Answered" : "All answered") : undefined
}

/**
 * The agent, beside its chat: its creature at a size where it can be watched, what it is doing,
 * and what it has shared here, so that a file can be found without scrolling back to where it was
 * sent.
 *
 * All of it scrolls as one, the face with it; a bar with the agent's name takes the face's place
 * at the top once it has gone. Each section folds under its heading, so that a panel with a lot
 * in it can be cut down to what is wanted.
 */
export function AgentPanel({
  agent,
  state,
  face,
  reconnecting,
  subagent,
  subagents,
  running = [],
  threads = [],
  slack = [],
  chatId,
  callIn,
  presence,
  onOpenFile,
  loading = false,
}: {
  agent: AgentSummary
  state: ChatState
  /** Its creature, large. Given from outside because a new agent hatches in it. */
  face: React.ReactNode
  /** The chat's stream dropped and is being picked up again. */
  reconnecting: boolean
  /** Set in a sub-agent's chat: the panel is then about it, not about its agent. */
  subagent?: {
    chatId: string
    title: string
    status: ChatSummary["status"]
    parentTitle: string | undefined
  }
  /** The sub-agents of this chat that are at work. */
  subagents: ChatSummary[]
  /** The commands this chat left running in the background. */
  running?: JobSummary[]
  /** The conversations other agents have had with it, newest first. */
  threads?: ChatSummary[]
  /** The threads in Slack it has been spoken to in, newest first. */
  slack?: ChatSummary[]
  /** The chat the panel is beside, so that a thread which is open is marked in its list. */
  chatId?: string
  /** The chat a call with the agent would be held in. Without it there is no calling it from here. */
  callIn?: string | undefined
  /** In a team: who is in this chat right now. */
  presence?: React.ReactNode
  /** Opens a file the agent sent beside the chat, by its id. Without it the files are not listed. */
  onOpenFile?: (fileId: string) => void
  /** The chat has not been heard from yet, so what the agent is doing is not known. */
  loading?: boolean
}) {
  const mood = useAtomValue(
    mascotMoodAtom(subagent === undefined ? agent.id : subagentSeed(agent.id, subagent.chatId)),
  )
  const width = useAtomValue(agentPanelColumn.width)
  const openWardrobe = useSetAtom(creatureWardrobeAtom)
  // A call with the agent happens here, where its face is. A sub-agent is not who is on it.
  const onCall = useAtomValue(callAtom)
  const call = subagent === undefined && onCall?.agentId === agent.id ? onCall : undefined
  const files = useMemo(() => sentFiles(state), [state])
  const using = useMemo(() => chatUses(state).at(-1), [state])
  const scroller = useRef<HTMLDivElement>(null)
  const nameplate = useRef<HTMLDivElement>(null)
  // Whether the agent's name has gone up under where the bar is.
  const [tucked, setTucked] = useState(false)
  const follow = () => {
    const [box, plate] = [scroller.current, nameplate.current]
    if (box === null || plate === null) return
    setTucked(plate.getBoundingClientRect().bottom <= box.getBoundingClientRect().top + BAR)
  }
  const agentName = agent.name ?? "New Dood"
  const name = subagent?.title ?? agentName
  // A sub-agent at rest says how it ended; one at work says what it is doing.
  // An agent at rest with a command still running is waiting on it, not ready.
  const doing =
    mood.state === "idle" && running.length > 0
      ? waitingWords(running, false)
      : subagent !== undefined && mood.state === "idle"
        ? subagentWords(subagent.status)
        : moodWords(mood, agent.hatched)
  const seed = subagent === undefined ? undefined : subagentSeed(agent.id, subagent.chatId)
  return (
    <aside
      aria-label={`About ${name}`}
      className="relative my-2.5 mr-2.5 overflow-hidden rounded-2xl border flex shrink-0 flex-col bg-rail/50"
      style={{ width }}
    >
      <ResizeHandle column={agentPanelColumn} edge="left" label={`Resize ${name}'s panel`} />
      {tucked ? (
        // The face has been scrolled away: who this is and what it is doing stay in sight, and
        // a press brings the face back.
        <button
          type="button"
          aria-label={`Back to ${name}`}
          title="Back to the top"
          onClick={() => scroller.current?.scrollTo({ top: 0, behavior: "smooth" })}
          style={{ height: BAR }}
          className="absolute inset-x-0 top-0 z-10 flex animate-in cursor-default items-center gap-2.5 border-b bg-background px-3 text-left duration-150 outline-none slide-in-from-top-2 fade-in focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:ring-inset"
        >
          {/* Over the page's color, the panel's own tint, as the rest of the panel has. */}
          <span aria-hidden className="absolute inset-0 bg-rail/50" />
          {seed === undefined ? (
            <AgentFace agent={agent} className="relative size-9 shrink-0" quiet />
          ) : (
            <AgentAvatar
              avatar={null}
              seed={seed}
              mood={mood}
              className="relative size-9 shrink-0"
              quiet
            />
          )}
          <span className="relative truncate text-sm font-medium">{name}</span>
          {loading ? null : (
            <span className="relative min-w-0 flex-1 truncate text-sm text-muted-foreground">
              {doing}
            </span>
          )}
        </button>
      ) : null}
      <div ref={scroller} onScroll={follow} className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col items-center gap-1 px-6 pt-10 pb-5 text-center">
          {call === undefined ? null : (
            <div ref={nameplate} className="w-full">
              <CallFace call={call} face={face} />
            </div>
          )}
          {/* Its treats and its box are beside the agent's own creature, not a sub-agent's. */}
          {call !== undefined ? null : subagent === undefined ? (
            <CreatureCare agent={agent}>{face}</CreatureCare>
          ) : (
            face
          )}
          {subagent === undefined && call === undefined ? (
            <SubagentBrood agentId={agent.id} subagents={subagents} />
          ) : null}
          <div
            ref={call === undefined ? nameplate : undefined}
            className={cn("flex flex-col items-center gap-1", call !== undefined && "hidden")}
          >
            <div className="mt-3 flex items-center gap-0.5">
              <h2 className="text-lg font-medium">{name}</h2>
              {subagent !== undefined || !agent.hatched ? null : (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`${name}'s wardrobe`}
                  title="Wardrobe"
                  onClick={() => openWardrobe(true)}
                  className="-mr-8 size-7 text-muted-foreground/70"
                >
                  <TShirtIcon />
                </Button>
              )}
            </div>
            {/* The line in the transcript is the one announced; this repeats it beside the creature. */}
            {loading ? (
              // Not "Ready": nothing has been heard from it yet.
              <div data-loading aria-busy="true" className="placeholder-late flex h-5 items-center">
                <Skeleton className="h-2.5 w-16 rounded-full" />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{doing}</p>
            )}
            {callIn === undefined || subagent !== undefined || !agent.hatched ? null : (
              <CallButton agent={agent} chatId={callIn} />
            )}
          </div>
          {subagent === undefined ? null : (
            <p className="mt-1 text-xs text-muted-foreground">
              A sub-agent of {agentName}
              {subagent.parentTitle === undefined ? "" : `, for “${subagent.parentTitle}”`}
            </p>
          )}
          {reconnecting ? (
            <p className="mt-1 text-xs text-muted-foreground">reconnecting…</p>
          ) : null}
        </div>
        {/* What is pinned to the agent is the agent's, not a sub-agent's. */}
        {subagent === undefined ? <PinnedShelf agentId={agent.id} onOpen={onOpenFile} /> : null}
        {using === undefined ? null : (
          // The last screen the agent used here may still be its own; the section says when it is.
          <AgentIdContext value={agent.id}>
            <UseNow key={using.id} use={using} chatId={chatId} />
          </AgentIdContext>
        )}
        {running.length === 0 ? null : (
          <PanelSection
            id="running"
            title="Running in the background"
            count={running.length}
            said={<Spinner className="size-3.5" />}
          >
            <div className="px-2.5 pb-3">
              <JobRows agentId={agent.id} jobs={running} />
            </div>
          </PanelSection>
        )}
        {subagent !== undefined || subagents.length === 0 ? null : (
          <PanelSection
            id="subagents"
            title="Sub-agents at work"
            count={subagents.length}
            said={<Spinner className="size-3.5" />}
          >
            <div className="px-2.5 pb-3">
              <SubagentRows agentId={agent.id} subagents={subagents} />
            </div>
          </PanelSection>
        )}
        {subagent !== undefined || threads.length === 0 ? null : (
          // Mostly read and done with, so they are folded until they are wanted.
          <PanelSection
            id="doods"
            title="From other Doods"
            count={threads.length}
            said={threadsSaid(threads)}
            startsFolded
          >
            <div className="px-2.5 pb-3">
              <ThreadRows agentId={agent.id} threads={threads} />
            </div>
          </PanelSection>
        )}
        {subagent !== undefined || slack.length === 0 ? null : (
          <PanelSection
            id="slack"
            title="From Slack"
            count={slack.length}
            said={threadsSaid(slack)}
            startsFolded
          >
            <div className="px-2.5 pb-3">
              <SlackRows agentId={agent.id} threads={slack} current={chatId} />
            </div>
          </PanelSection>
        )}
        {presence}
        {onOpenFile === undefined || files.length === 0 ? null : (
          <PanelSection id="shared" title="Shared here" count={files.length} startsFolded>
            <ul className="flex flex-col gap-0.5 px-2.5 pb-3">
              {files.map((file) => (
                <Shared key={file.id} agentId={agent.id} file={file} onOpen={onOpenFile} />
              ))}
            </ul>
          </PanelSection>
        )}
      </div>
    </aside>
  )
}
