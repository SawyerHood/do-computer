import {
  type AgentSummary,
  type ChatState,
  chatActivity,
  toolActivity,
  type ToolPart,
  toolSummary,
} from "@durable-computer/protocol"
import { CheckCircleIcon, CircleNotchIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react"
import { useAtomValue } from "jotai"
import { useMemo } from "react"
import { type MascotMood, mascotMoodAtom } from "@/lib/mascot"

/** How many of the latest things it did are listed. */
const SHOWN = 40

/** What its creature is doing, in a word or two, when the chat has no fuller line for it. */
function moodWords(mood: MascotMood, hatched: boolean): string {
  if (!hatched) return "About to hatch"
  switch (mood.state) {
    case "listening":
      return "Listening"
    case "thinking":
      return "Thinking"
    case "working":
      return "Working"
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

const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })

function Did({ part, at }: { part: ToolPart; at: number | undefined }) {
  const going = part.status === "pending" || part.status === "running"
  const output = part.output?.trim() ?? ""
  return (
    <li>
      <details className="group rounded-xl open:bg-surface">
        <summary className="flex cursor-default list-none items-start gap-2.5 rounded-xl px-2.5 py-2 text-sm outline-none hover:bg-surface focus-visible:ring-3 focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden">
          {going ? (
            <CircleNotchIcon className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />
          ) : part.status === "error" ? (
            <WarningCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
          ) : (
            <CheckCircleIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 break-words group-open:line-clamp-none">
              {going ? toolActivity(part) : toolSummary(part)}
            </span>
            {at === undefined ? null : (
              <span className="block text-xs text-muted-foreground">{clock.format(at)}</span>
            )}
          </span>
        </summary>
        <pre className="mx-2.5 mb-2.5 max-h-64 overflow-auto rounded-lg bg-background p-2.5 text-xs whitespace-pre-wrap break-words text-muted-foreground">
          {output === "" ? (going ? "Still going." : "It returned nothing.") : output}
        </pre>
      </details>
    </li>
  )
}

/**
 * The agent, beside its chat: its creature at a size where it can be watched, what it is doing,
 * and what it has done here. The transcript keeps only what was said; this is where the work
 * behind an answer can be opened and read.
 */
export function AgentPanel({
  agent,
  state,
  face,
  onClose,
}: {
  agent: AgentSummary
  state: ChatState
  /** Its creature, large. Given from outside because a new agent hatches in it. */
  face: React.ReactNode
  onClose: () => void
}) {
  const mood = useAtomValue(mascotMoodAtom(agent.id))
  const did = useMemo(
    () =>
      state.messages
        .flatMap((message) =>
          message.role === "assistant"
            ? message.parts
                .filter((part): part is ToolPart => part.type === "tool")
                .map((part) => ({
                  part,
                  at: message.createdAt,
                  key: `${message.id}/${part.toolCallId}`,
                }))
            : [],
        )
        .slice(-SHOWN)
        .reverse(),
    [state.messages],
  )
  const name = agent.name ?? "New agent"
  return (
    <aside
      aria-label={`About ${name}`}
      className="relative hidden w-80 shrink-0 flex-col border-l bg-rail/40 xl:flex"
    >
      <button
        type="button"
        aria-label="Hide this panel"
        title="Hide"
        onClick={onClose}
        className="absolute top-3 right-3 z-10 rounded-full p-1.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
      >
        <XIcon className="size-4" />
      </button>
      <div className="flex flex-col items-center gap-1 px-6 pt-10 pb-5 text-center">
        {face}
        <h2 className="mt-3 text-lg font-medium">{name}</h2>
        {/* The line in the transcript is the one announced; this repeats it beside the creature. */}
        <p className="text-sm text-muted-foreground">
          {chatActivity(state) ?? moodWords(mood, agent.hatched)}
        </p>
        {agent.tagline ? (
          <p className="mt-1 text-xs text-muted-foreground">{agent.tagline}</p>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col border-t">
        <h3 className="px-5 pt-4 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          What it did here
        </h3>
        {did.length === 0 ? (
          <p className="px-5 text-sm text-muted-foreground">
            Nothing yet. When {name} runs a command, reads a file or looks something up for this
            chat, it is listed here, and can be opened to see what came back.
          </p>
        ) : (
          <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pb-4">
            {did.map(({ part, at, key }) => (
              <Did key={key} part={part} at={at} />
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}
