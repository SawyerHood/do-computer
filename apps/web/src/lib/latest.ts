import type { AgentLatest, AgentSummary, FeedEvent, Person } from "@do-computer/protocol"
import { atom, getDefaultStore, useAtomValue } from "jotai"
import { useEffect, useState } from "react"
import { client } from "./client.ts"
import { agentsCollection, agentsKey } from "./collections.ts"
import { queryClient } from "./query.ts"

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

/**
 * Agents in the order someone put them in by hand: `order` is their ids, the top one first.
 * One that is not in it came after they were last put in order, and is above the rest, the one
 * last heard from first. With no order they are all the one last heard from first.
 */
export function inOrder<T extends Pick<AgentSummary, "id" | "latest" | "createdAt">>(
  agents: readonly T[],
  order: readonly string[] | undefined,
): T[] {
  if (order === undefined) return latestFirst(agents)
  const place = new Map(order.map((id, index) => [id, index]))
  const placed = agents
    .filter((agent) => place.has(agent.id))
    .sort((a, b) => place.get(a.id)! - place.get(b.id)!)
  return [...latestFirst(agents.filter((agent) => !place.has(agent.id))), ...placed]
}

const store = getDefaultStore()

/**
 * When each agent was last looked at from this tab, by the server's clock. The list of agents
 * says the same once it is asked for again; until then this is ahead of it.
 */
const seenHereAtom = atom<Readonly<Record<string, number>>>({})

export const useSeenHere = () => useAtomValue(seenHereAtom)

const note = (agentId: string, at: number) =>
  store.set(seenHereAtom, (kept) => ({ ...kept, [agentId]: Math.max(kept[agentId] ?? 0, at) }))

/** Whether the page is the one being looked at, and not behind another tab or a shut lid. */
export function useVisible(): boolean {
  const [visible, setVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState === "visible",
  )
  useEffect(() => {
    const changed = () => setVisible(document.visibilityState === "visible")
    document.addEventListener("visibilitychange", changed)
    return () => document.removeEventListener("visibilitychange", changed)
  }, [])
  return visible
}

/**
 * Say that the agent on screen has been looked at: when it is opened, and again whenever
 * something comes from it while the page is being looked at. `seenAt` is what the list of
 * agents has for it.
 */
export function useMarkSeen(
  agentId: string | undefined,
  latestAt: number | undefined,
  seenAt: number | undefined,
): void {
  const here = useSeenHere()
  const visible = useVisible()
  const seen = Math.max(seenAt ?? 0, agentId === undefined ? 0 : (here[agentId] ?? 0))
  const due = agentId !== undefined && visible && (seen === 0 || (latestAt ?? 0) > seen)
  useEffect(() => {
    if (!due || agentId === undefined) return
    // Noted before the server answers, as of the latest thing there is to have seen: this
    // clock is not the server's, and the mark must not be asked for twice while it is on its way.
    note(agentId, Math.max(latestAt ?? 0, 1))
    client
      .agent(agentId)
      .seen()
      .then(({ seenAt }) => note(agentId, seenAt))
      // It is said again the next time something comes, or the agent is opened.
      .catch(() => {})
  }, [due, agentId, latestAt])
}

/** One that fails is asked for again the next time the feed connects, or the page is loaded. */
const askAgain = () => void agentsCollection.utils.refetch().catch(() => {})

/**
 * Put what the feed said of an agent into the list of agents, where every row is drawn from.
 * Into the list as it was fetched, under its own key and no other: the collection follows that.
 */
function take(event: FeedEvent): void {
  const listed = queryClient.getQueryData<AgentSummary[]>(agentsKey)
  // An agent the list does not have yet, made a moment ago by someone else or by another
  // agent: the list is asked for, which has it whole.
  if (listed === undefined || !listed.some((agent) => agent.id === event.agentId)) {
    return askAgain()
  }
  queryClient.setQueryData<AgentSummary[]>(
    agentsKey,
    listed.map((agent) => {
      if (agent.id !== event.agentId) return agent
      if (event.type === "seen") return { ...agent, seenAt: event.seenAt }
      const { latest, working, asking } = event
      return { ...agent, working, asking, ...(latest === undefined ? {} : { latest }) }
    }),
  )
}

/** How lately the list has to have been asked for to be taken as it is when the feed connects. */
const FRESH_MS = 3_000

/**
 * Keep the list of agents current for as long as the component is mounted. Each agent says
 * what it is up to as that changes, and the server passes it on over one socket of the user's
 * own, so nothing is asked for on a timer. What is said while the socket is down is said to
 * nobody, so the list is asked for whenever it comes back up.
 */
export function useFeed(userId: string): void {
  useEffect(() => {
    const feed = client.feed(userId, {
      event: take,
      connected: (again) => {
        // The first time, the page has usually just asked for the list itself, or is asking.
        const list = queryClient.getQueryState(agentsKey)
        const fresh =
          list?.fetchStatus === "fetching" || Date.now() - (list?.dataUpdatedAt ?? 0) < FRESH_MS
        if (again || !fresh) askAgain()
      },
    })
    return () => feed.close()
  }, [userId])
}
