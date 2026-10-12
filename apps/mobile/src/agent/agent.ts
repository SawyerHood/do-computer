// What the pages of one agent share: who it is, which workspace it is in, saving a change to
// it, moving it, and the words and numbers that more than one of them shows. The words are the
// web app's (apps/web/src/components/settings/profile.tsx, model-picker.tsx, thinking-picker.tsx).
import type { AgentPatch, AgentState } from "@durable-computer/client"
import {
  type AgentSummary,
  AVATAR_COLORS,
  type ChatMessage,
  continuesMain,
  type JobSummary,
  type ModelOption,
  type ThinkingLevel,
  type WorkspaceSummary,
} from "@durable-computer/protocol"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useState } from "react"
import { keys, useAgentState, useAgentSummary, useWorkspaces } from "@/lib/queries"
import { type Accent, useAgentAccent as useKitAccent } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import { confirm, errorText, haptic, tell } from "@/ui"

/** The agent as its pages need it: its state once that has come, and its summary until then. */
export function useAgentPage(agentId: string) {
  const query = useAgentState(agentId)
  const summary = useAgentSummary(agentId)
  const agent: AgentSummary | undefined = query.data?.agent ?? summary
  const workspace = useWorkspaceOf(agentId, agent)
  return { state: query.data, query, agent, workspace, name: agent?.name ?? "New agent" }
}

/** The workspace an agent lives in, if the list of workspaces has come. */
export function useWorkspaceOf(
  agentId: string,
  agent?: AgentSummary | undefined,
): WorkspaceSummary | undefined {
  const listed = useAgentSummary(agentId)
  const id = listed?.workspaceId ?? agent?.workspaceId
  return useWorkspaces().data?.workspaces.find((workspace) => workspace.id === id)
}

/**
 * Save a change to the agent. What comes back is its new state, which every page of it then
 * shows, and the list of agents is asked for again since its name or look may have changed.
 */
export function useSaveAgent(agentId: string) {
  const { client } = useSession()
  const queryClient = useQueryClient()
  const [saving, setSaving] = useState(false)
  const save = useCallback(
    async (change: AgentPatch): Promise<AgentState | undefined> => {
      setSaving(true)
      try {
        const next = await client.agent(agentId).update(change)
        queryClient.setQueryData(keys.agent(agentId), next)
        void queryClient.invalidateQueries({ queryKey: keys.agents, exact: true })
        haptic.done()
        return next
      } catch (error) {
        haptic.fail()
        tell("It could not be saved", errorText(error))
        return undefined
      } finally {
        setSaving(false)
      }
    },
    [client, queryClient, agentId],
  )
  return { save, saving }
}

/**
 * Moving an agent to another workspace. `may` is false for a member of a team, who cannot;
 * `elsewhere` is where it could go; `moveTo` says what will follow and, if they go ahead, moves it.
 */
export function useMoveAgent(agentId: string, name: string) {
  const { client } = useSession()
  const queryClient = useQueryClient()
  const workspace = useWorkspaceOf(agentId)
  const all = useWorkspaces().data?.workspaces ?? []
  const [moving, setMoving] = useState(false)
  const elsewhere = workspace === undefined ? [] : all.filter((entry) => entry.id !== workspace.id)
  const moveTo = async (to: WorkspaceSummary): Promise<boolean> => {
    const went = await confirm({
      title: `Move ${name} to ${to.name}?`,
      message:
        to.kind === "team"
          ? `Everyone in ${to.name} will be able to use ${name}, read all of its chats and what it remembers, and use its connectors and paired computers. Machines it shares with other agents stay behind, and it can work on the ones ${to.name} has open to every agent.`
          : `Only you will be able to use ${name}. Everyone else loses its chats. Machines it shares with other agents stay with the team.`,
      action: "Move",
      destructive: false,
    })
    if (!went) return false
    setMoving(true)
    try {
      await client.moveAgent(agentId, to.id)
      haptic.done()
      void queryClient.invalidateQueries({ queryKey: keys.workspaces })
      void queryClient.invalidateQueries({ queryKey: keys.computers })
      await queryClient.invalidateQueries({ queryKey: keys.agents, exact: true })
      await queryClient.invalidateQueries({ queryKey: keys.of(agentId) })
      return true
    } catch (error) {
      haptic.fail()
      tell("It could not be moved", errorText(error))
      return false
    } finally {
      setMoving(false)
    }
  }
  return {
    workspace,
    may: workspace !== undefined && workspace.role !== "member",
    elsewhere,
    moveTo,
    moving,
  }
}

/** The models an agent of this workspace can be set to. They do not change while the app is open. */
export function useModels(workspaceId: string | undefined) {
  const { client } = useSession()
  return useQuery<ModelOption[]>({
    queryKey: keys.models(workspaceId),
    queryFn: () => client.models(workspaceId),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/** A model's name as people say it, or the end of its id where the list does not have it. */
export const modelName = (models: readonly ModelOption[] | undefined, id: string): string =>
  models?.find((model) => model.id === id)?.name ?? id.split("/").at(-1) ?? id

/** An agent's background commands, oldest first. Kept fresh by the agent's own events. */
export function useJobs(agentId: string) {
  const { client } = useSession()
  return useQuery<JobSummary[]>({
    queryKey: keys.jobs(agentId),
    queryFn: () => client.agent(agentId).jobs(),
  })
}

/** The time now, told again every `everyMs`, for a count of how long something has run. */
export function useNow(everyMs = 1000, on = true): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(timer)
  }, [everyMs, on])
  return now
}

export const firstLine = (command: string) => command.split("\n")[0] ?? command

/** A chat whose transcript starts at a summary or a fresh start has more before it. */
export const startsMidway = (first: ChatMessage | undefined) =>
  first?.role === "notice" && !continuesMain([first])

export const THINKING_LABELS: Record<ThinkingLevel, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
}

const perMillion = (cost: number) =>
  cost === 0 ? "free" : `$${cost < 1 ? cost.toFixed(2) : cost.toFixed(cost < 10 ? 1 : 0)}`

const context = (tokens: number | undefined) =>
  tokens === undefined
    ? ""
    : tokens >= 1_000_000
      ? `${Math.round(tokens / 100_000) / 10}M context`
      : `${Math.round(tokens / 1000)}K context`

/** What a model costs and can hold, in one short line. A subscription's has no price to show. */
export const modelFacts = (model: ModelOption) =>
  [
    model.signIn?.subscription
      ? "on the subscription"
      : model.inputCost === 0 && model.outputCost === 0
        ? "free"
        : `${perMillion(model.inputCost)} in, ${perMillion(model.outputCost)} out per million tokens`,
    context(model.contextWindow),
  ]
    .filter(Boolean)
    .join(" · ")

/** Models that come from one place, under what that place is called. */
export type ModelSource = { title: string; items: ModelOption[] }

const sourceOf = (model: ModelOption) =>
  model.signIn === undefined
    ? "own"
    : `${model.provider ?? ""}/${model.signIn.subscription ? "subscription" : "key"}`

/**
 * The models under where each comes from, the workspace's own sign-ins first: the same model
 * can be had on a subscription and paid for by the token, and this is what tells the two apart.
 * Those from one place only come back as one list with no title.
 */
export function modelsBySource(models: readonly ModelOption[]): ModelSource[] {
  const found = new Map<string, ModelOption[]>()
  for (const model of models) {
    const key = sourceOf(model)
    found.set(key, [...(found.get(key) ?? []), model])
  }
  if (found.size < 2) return models.length === 0 ? [] : [{ title: "", items: [...models] }]
  const title = (key: string, items: ModelOption[]) => {
    const first = items[0]
    if (key === "own" || first?.signIn === undefined) {
      const through = [...new Set(items.map((model) => model.provider).filter(Boolean))]
      return ["Do Computer", ...through].join(" · ")
    }
    const { subscription, by } = first.signIn
    return `${first.provider ?? ""} ${subscription ? "subscription" : "key"}${
      by === null ? "" : ` · signed in by ${by}`
    }`
  }
  return [...found]
    .sort(([a], [b]) => Number(a === "own") - Number(b === "own"))
    .map(([key, items]) => ({ title: title(key, items), items }))
}

/** The color itself of one of the eight an agent can have, which is kept by its name. */
export const colorHex = (color: string | undefined | null): string | undefined =>
  AVATAR_COLORS.find((entry) => entry.id === color)?.hex ?? color ?? undefined

/** The agent's accent, for what is its own on its pages. */
export const useAgentAccent = (agent: Pick<AgentSummary, "id" | "avatar"> | undefined): Accent =>
  useKitAccent(agent)
