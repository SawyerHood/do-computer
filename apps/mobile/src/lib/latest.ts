import type { AgentLatest, AgentSummary, Person } from "@durable-computer/protocol"

// The words of a row in the list of agents. These are the web app's own rules
// (apps/web/src/lib/latest.ts), kept the same so that both say the same of an agent.

const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })
const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" })
const day = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" })

const startOfDay = (at: number) => new Date(at).setHours(0, 0, 0, 0)

/** When something was said, as a list of conversations has it: now, 9:20 AM, Yesterday, Fri, Oct 2. */
export function when(at: number, now: number): string {
  if (now - at < 60_000) return "now"
  // Rounded, so that a day an hour short or an hour long is still one day.
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000)
  if (days <= 0) return clock.format(at)
  if (days === 1) return "Yesterday"
  if (days < 7) return weekday.format(at)
  return day.format(at)
}

/** An agent's latest line in words, with who or what it is from in front where that says something. */
export function latestWords(
  latest: AgentLatest,
  meId: string,
  people: ReadonlyMap<string, Person>,
): string {
  if (latest.kind === "said") {
    if (latest.by === meId) return `You: ${latest.text}`
    const name = latest.by === undefined ? undefined : people.get(latest.by)?.name.split(" ")[0]
    return name === undefined ? latest.text : `${name}: ${latest.text}`
  }
  if (latest.from === undefined || latest.from === "") return latest.text
  if (latest.kind === "scheduled") return `${latest.from}: ${latest.text}`
  if (latest.kind === "agent") return `From ${latest.from}: ${latest.text}`
  if (latest.kind === "slack") return `#${latest.from}: ${latest.text}`
  return latest.text
}

/**
 * Whether an agent has something this person has not seen. What they wrote themselves is not
 * news to them. An agent they have never looked at has nothing to measure against, so nothing is
 * claimed of it.
 */
export function isUnread(
  agent: Pick<AgentSummary, "latest" | "seenAt">,
  meId: string,
  seenHere: number | undefined,
): boolean {
  const { latest } = agent
  if (latest === undefined) return false
  if (latest.kind === "said" && latest.by === meId) return false
  const seen = Math.max(agent.seenAt ?? 0, seenHere ?? 0)
  return seen > 0 && latest.at > seen
}

/** Agents with the one that was last spoken to or heard from first. One that never was counts from when it was made. */
export function latestFirst<T extends Pick<AgentSummary, "latest" | "createdAt">>(
  agents: readonly T[],
): T[] {
  const at = (agent: T) => agent.latest?.at ?? agent.createdAt
  return [...agents].sort((a, b) => at(b) - at(a))
}
