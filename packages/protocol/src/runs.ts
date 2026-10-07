import { toolActivity } from "./activity.ts"
import type { ChatState, ToolPart } from "./chat.ts"

/**
 * One piece of work in a chat: what the user asked for, or what a scheduled task set off, and
 * everything the agent did until it stopped.
 */
export type ChatRun = {
  /** The id of the message that started it, which does not change as the run goes on. */
  id: string
  /** What was asked, in the asker's words. */
  asked: string
  /** The tool calls it made, in order. */
  steps: ToolPart[]
  /** What it said back, so far. */
  answer: string
  status: "working" | "done" | "failed" | "stopped"
  /** When it began, where the transcript says. */
  at?: number
}

/** A run in a line or two, for a list of what the agent has done. */
export type RunSummary = {
  /** A few words naming the task. */
  title: string
  /** A sentence on what came of it, or what it is doing now. */
  outcome: string
}

/**
 * The summaries a deployment has written for a chat's runs, by run id. Only substantial work is
 * written up, so most runs have none.
 */
export type ChatActivity = {
  runs: Record<string, RunSummary>
  /**
   * Whether the deployment has a model that picks out the substantial runs. With one, the runs
   * to list are those in `runs`. Without one nothing can tell them apart, and every run is
   * listed, described by `runSummary`.
   */
  judged: boolean
}

/**
 * The runs of a chat in which the agent did something with its tools, oldest first. A reply that
 * was only words is in the transcript and is not a piece of work to list.
 */
export function chatRuns(state: ChatState): ChatRun[] {
  const runs: ChatRun[] = []
  let current: ChatRun | undefined
  for (const message of state.messages) {
    const notice = message.parts.find((part) => part.type === "notice")
    const starts =
      message.role === "user" || (notice?.type === "notice" && notice.kind === "schedule")
    if (starts) {
      const asked =
        notice?.type === "notice"
          ? notice.text
          : message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
      current = { id: message.id, asked: asked.trim(), steps: [], answer: "", status: "done" }
      if (message.createdAt !== undefined) current.at = message.createdAt
      runs.push(current)
      continue
    }
    if (message.role !== "assistant" || current === undefined) continue
    for (const part of message.parts) {
      if (part.type === "tool") current.steps.push(part)
      else if (part.type === "text") current.answer = `${current.answer}\n${part.text}`.trim()
    }
    if (message.status === "error") current.status = "failed"
    else if (message.status === "aborted") current.status = "stopped"
    else current.status = "done"
  }
  // Only the last run can still be going.
  if (state.busy && current !== undefined) current.status = "working"
  return runs.filter((run) => run.steps.length > 0)
}

const clip = (text: string, limit: number) => {
  const line = text.trim().split("\n")[0]!.trim()
  return line.length > limit ? `${line.slice(0, limit - 1).trimEnd()}…` : line
}

/** How many words a title made from what was asked may run to. */
const TITLE_WORDS = 6

/** The first few words of what was asked, as a title. */
function headline(asked: string): string {
  const words = asked.trim().split("\n")[0]!.trim().split(/\s+/).filter(Boolean)
  const kept = words.slice(0, TITLE_WORDS).join(" ")
  return clip(words.length > TITLE_WORDS ? `${kept}…` : kept, 56)
}

/** The first sentence of some prose, without its Markdown marks. */
function opening(text: string): string {
  const plain = text.replaceAll(/[*_`#>]+/g, "").trim()
  const end = plain.search(/[.!?](\s|$)/)
  return clip(end === -1 ? plain : plain.slice(0, end + 1), 110)
}

/**
 * A summary made from the run itself, with no model: its title is what was asked, and its outcome
 * is what it is doing or how its answer opens. It stands in until a written one arrives, and
 * where a deployment writes none.
 */
export function runSummary(run: ChatRun): RunSummary {
  const steps = `${run.steps.length} step${run.steps.length === 1 ? "" : "s"}`
  let outcome: string
  if (run.status === "working") outcome = toolActivity(run.steps.at(-1)!)
  else if (run.status === "failed") outcome = `Did not finish, after ${steps}.`
  else if (run.status === "stopped") outcome = `Stopped after ${steps}.`
  else outcome = run.answer === "" ? `Done in ${steps}.` : opening(run.answer)
  return { title: headline(run.asked) || "A piece of work", outcome }
}
