import type { ChatState, ToolPart } from "./chat.ts"

/** The tool an agent writes an entry with, in the list of what it did in a chat. */
export const LOG_TOOL = "log"

/** A piece of work in a line or two, as the agent put it. */
export type RunSummary = {
  /** A few words naming the task. */
  title: string
  /** A sentence on what came of it. */
  outcome: string
}

/**
 * One piece of work in a chat that the agent wrote an entry for: what the user asked for, or
 * what a scheduled task or a sub-agent's report set off, and everything the agent did until it
 * stopped.
 */
export type ChatRun = {
  /** The id of the message that started it, which does not change as the run goes on. */
  id: string
  /** What the agent wrote of it. If it wrote more than once, the last. */
  entry: RunSummary
  /** The tool calls it made, in order, other than writing the entry. */
  steps: ToolPart[]
  status: "working" | "done" | "failed" | "stopped"
  /** When it began, where the transcript says. */
  at?: number
}

const clip = (text: string, limit: number) => {
  const line = text.trim().split("\n")[0]!.trim()
  return line.length > limit ? `${line.slice(0, limit - 1).trimEnd()}…` : line
}

/** What a finished call to the log tool wrote, or undefined if it wrote nothing usable. */
function entryOf(part: ToolPart): RunSummary | undefined {
  if (part.status !== "done") return undefined
  const args = (typeof part.args === "object" && part.args !== null ? part.args : {}) as Record<
    string,
    unknown
  >
  if (typeof args.title !== "string" || typeof args.outcome !== "string") return undefined
  const title = clip(args.title.replace(/[."\s]+$/, ""), 80)
  const outcome = clip(args.outcome, 240)
  return title === "" || outcome === "" ? undefined : { title, outcome }
}

/**
 * The runs of a chat that the agent wrote an entry for, oldest first. It writes one only for
 * substantial work, so most runs are not here: what was said is in the transcript.
 */
export function chatRuns(state: ChatState): ChatRun[] {
  const runs: (Omit<ChatRun, "entry"> & { entry?: RunSummary })[] = []
  let current: (typeof runs)[number] | undefined
  for (const message of state.messages) {
    // A sub-agent's report gives the agent a turn, as a message from the user would, and so does
    // another agent's reply.
    const starts =
      message.role === "user" ||
      message.parts.some(
        (part) =>
          part.type === "notice" &&
          (part.kind === "schedule" ||
            part.kind === "agent" ||
            (part.kind === "subagent" && part.outcome !== "stopped")),
      )
    if (starts) {
      current = { id: message.id, steps: [], status: "done" }
      if (message.createdAt !== undefined) current.at = message.createdAt
      runs.push(current)
      continue
    }
    if (message.role !== "assistant" || current === undefined) continue
    for (const part of message.parts) {
      if (part.type !== "tool") continue
      if (part.name === LOG_TOOL) current.entry = entryOf(part) ?? current.entry
      else current.steps.push(part)
    }
    if (message.status === "error") current.status = "failed"
    else if (message.status === "aborted") current.status = "stopped"
    else current.status = "done"
  }
  // Only the last run can still be going.
  if (state.busy && current !== undefined) current.status = "working"
  return runs.filter((run): run is ChatRun => run.entry !== undefined)
}
