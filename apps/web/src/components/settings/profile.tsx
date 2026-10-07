import type { AgentPatch, AgentState } from "@durable-computer/client"
import {
  type AgentUsage,
  type Avatar,
  AVATAR_COLORS,
  defaultAvatar,
  nearestThinking,
  PAIRED_COMPUTER,
  randomId,
  type ThinkingLevel,
} from "@durable-computer/protocol"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useEffect, useId, useState } from "react"
import { AgentAvatar } from "@/components/agent-avatar"
import { ModelPicker } from "@/components/model-picker"
import { ThinkingPicker } from "@/components/thinking-picker"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { client } from "@/lib/client"
import {
  agentKey,
  agentsCollection,
  agentsKey,
  computerKindsKey,
  computersKey,
  modelsKey,
  usageKey,
} from "@/lib/collections"
import { queryClient } from "@/lib/query"
import { useSettings } from "@/lib/settings"
import { cn } from "@/lib/utils"

import { refreshWorkspaces, useWorkspaceOfAgent, useWorkspaces } from "@/lib/workspaces"

type Form = {
  name: string
  tagline: string
  avatar: Avatar
  soul: string
  user: string
  memory: string
  model: string
  thinking: ThinkingLevel
}

function toForm(state: AgentState): Form {
  return {
    name: state.agent.name ?? "",
    tagline: state.agent.tagline ?? "",
    avatar: state.agent.avatar ?? defaultAvatar(state.agent.id),
    soul: state.soul,
    user: state.user,
    memory: state.memory,
    model: state.agent.model,
    thinking: state.agent.thinking,
  }
}

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint: string
  children: React.ReactNode
}) {
  const heading = useId()
  return (
    <section aria-labelledby={heading} className="flex flex-col gap-3 border-t pt-6">
      <div>
        <h2 id={heading} className="text-sm font-medium">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      {children}
    </section>
  )
}

function Counted({
  id,
  value,
  limit,
  rows,
  onChange,
}: {
  id: string
  value: string
  limit: number
  rows: number
  onChange: (value: string) => void
}) {
  const over = value.length > limit
  return (
    <div className="flex flex-col gap-1">
      <Textarea
        id={id}
        rows={rows}
        value={value}
        aria-invalid={over}
        className="font-mono text-[0.8125rem]"
        onChange={(event) => onChange(event.target.value)}
      />
      <p className={cn("self-end text-xs text-muted-foreground", over && "text-destructive")}>
        {value.length} / {limit}
      </p>
    </div>
  )
}

function Choice({
  selected,
  label,
  onClick,
  children,
}: {
  selected: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      title={label}
      onClick={onClick}
      className={cn(
        "rounded-full border-2 border-transparent p-0.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
        selected && "border-primary",
      )}
    >
      {children}
    </button>
  )
}

/** Who the agent is and what it remembers. The agent edits the same fields itself, in chat. */
const tokens = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })
/** Small amounts keep their cents' cents: a chat can cost a fraction of one. */
const dollars = (cost: number) =>
  cost === 0 ? "$0" : cost < 0.01 ? "under $0.01" : `$${cost.toFixed(cost < 10 ? 2 : 0)}`

/** What the agent has spent on models. Read-only: it is a record, not a setting. */
function Usage({ agentId }: { agentId: string }) {
  const { data: usage } = useQuery<AgentUsage>({
    queryKey: usageKey(agentId),
    queryFn: () => client.agent(agentId).usage(),
  })
  if (usage === undefined) return null
  const used = usage.total.inputTokens + usage.total.outputTokens
  return (
    <Section
      title="Usage"
      hint="What this agent's thinking has cost so far, across its chats and scheduled runs."
    >
      {used === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing yet.</p>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Cost</dt>
              <dd className="text-lg font-medium tabular-nums">{dollars(usage.total.cost)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Read</dt>
              <dd className="text-lg font-medium tabular-nums">
                {tokens.format(usage.total.inputTokens)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Written</dt>
              <dd className="text-lg font-medium tabular-nums">
                {tokens.format(usage.total.outputTokens)}
              </dd>
            </div>
          </dl>
          <table className="w-full text-sm">
            <caption className="sr-only">Usage by model</caption>
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1 font-normal">Model</th>
                <th className="py-1 text-right font-normal">Tokens</th>
                <th className="py-1 text-right font-normal">Cost</th>
              </tr>
            </thead>
            <tbody>
              {usage.models.map((entry) => (
                <tr key={entry.model} className="border-t">
                  <td className="py-1.5 break-all">{entry.model}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {tokens.format(entry.inputTokens + entry.outputTokens)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{dollars(entry.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {usage.scheduled.inputTokens + usage.scheduled.outputTokens > 0 ? (
            <p className="text-xs text-muted-foreground">
              Scheduled runs account for {dollars(usage.scheduled.cost)} of the cost and{" "}
              {tokens.format(usage.scheduled.inputTokens + usage.scheduled.outputTokens)} of the
              tokens.
            </p>
          ) : null}
        </>
      )}
    </Section>
  )
}

/**
 * Deleting an agent cannot be undone, so it asks for the agent's name first. That is slower than
 * a second click, and it makes sure the agent on screen is the one being deleted.
 */
function DeleteAgent({ agentId, name }: { agentId: string; name: string | null }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState("")
  const expected = name ?? "delete"
  const { data: computers } = useQuery({
    queryKey: computersKey,
    queryFn: () => client.listComputers(),
  })
  // Machines no other agent can use, which nothing would work on once this agent is gone.
  const alone = (computers ?? []).filter(
    (computer) =>
      computer.kind !== PAIRED_COMPUTER &&
      computer.access === "chosen" &&
      computer.agentIds.length === 1 &&
      computer.agentIds[0] === agentId,
  )
  const [withComputers, setWithComputers] = useState(true)
  const remove = useMutation({
    mutationFn: () =>
      client.deleteAgent(
        agentId,
        alone.length > 0 && !withComputers ? { keepComputers: true } : {},
      ),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: agentKey(agentId) })
      void queryClient.invalidateQueries({ queryKey: computersKey })
      await agentsCollection.utils.refetch()
      // The index route picks another agent, or makes a new one if this was the last.
      await navigate({ to: "/" })
    },
  })
  return (
    <Section
      title="Delete this agent"
      hint="Removes its memory, chats, schedules, skills and connectors, and disconnects it from every computer. Files in the library stay with the workspace. This cannot be undone."
    >
      {open ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-destructive/40 p-4">
          <Label htmlFor="confirm-delete">
            Type <span className="font-semibold">{expected}</span> to confirm
          </Label>
          <Input
            id="confirm-delete"
            autoComplete="off"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
          {alone.length > 0 ? (
            <div className="flex flex-col gap-1">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                  checked={withComputers}
                  disabled={remove.isPending}
                  onChange={(event) => setWithComputers(event.target.checked)}
                />
                <span>
                  Also delete{" "}
                  <span className="font-mono">
                    {new Intl.ListFormat("en").format(alone.map((computer) => computer.name))}
                  </span>
                </span>
              </label>
              <p className="pl-6 text-sm text-muted-foreground">
                {alone.length === 1
                  ? "No other agent can use this computer. Deleting it deletes everything on it."
                  : "No other agent can use these computers. Deleting them deletes everything on them."}
              </p>
            </div>
          ) : null}
          {remove.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {remove.error.message}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="destructive"
              disabled={typed.trim() !== expected || remove.isPending}
              onClick={() => remove.mutate()}
            >
              {remove.isPending ? "Deleting…" : "Delete for good"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={remove.isPending}
              onClick={() => {
                setOpen(false)
                setTyped("")
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="self-start text-destructive"
          onClick={() => setOpen(true)}
        >
          Delete agent…
        </Button>
      )}
    </Section>
  )
}

/**
 * What a message does that arrives while the agent is working. Saved as it is chosen, apart from
 * the form above: it is about how the agent is used, not who it is.
 */
function WhenBusy({ agentId, state }: { agentId: string; state: AgentState }) {
  const save = useMutation({
    mutationFn: (whenBusy: "steer" | "queue") => client.agent(agentId).update({ whenBusy }),
    onSuccess: (next) => queryClient.setQueryData(agentKey(agentId), next),
  })
  const chosen = save.isPending ? save.variables : (state.whenBusy ?? "steer")
  const options = [
    ["queue", "Wait its turn", "It finishes what it is doing, then answers the new message."],
    [
      "steer",
      "Join in",
      "It takes the new message into what it is doing, as a correction would be.",
    ],
  ] as const
  return (
    <Section
      title="When a message arrives while it is working"
      hint={
        state.team
          ? "In a team the next message is often someone else's, so it waits unless you say otherwise."
          : "Whether a message you send mid-answer changes the answer or waits for it."
      }
    >
      <div role="radiogroup" aria-label="When it is busy" className="flex flex-col gap-2">
        {options.map(([value, label, words]) => (
          <label key={value} className="flex items-start gap-3 rounded-xl border px-3 py-2.5">
            <input
              type="radio"
              name="when-busy"
              checked={chosen === value}
              disabled={save.isPending}
              onChange={() => save.mutate(value)}
              className="mt-1 accent-primary"
            />
            <span>
              <span className="block text-sm font-medium">{label}</span>
              <span className="block text-sm text-muted-foreground">{words}</span>
            </span>
          </label>
        ))}
      </div>
      {save.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {save.error.message}
        </p>
      ) : null}
    </Section>
  )
}

/** Where the agent lives, and moving it: to a team, to share it, or back to oneself. */
function Workspace({ agentId, name }: { agentId: string; name: string }) {
  const workspace = useWorkspaceOfAgent(agentId)
  const all = useWorkspaces()?.workspaces ?? []
  const [target, setTarget] = useState("")
  const move = useMutation({
    mutationFn: () => client.moveAgent(agentId, target),
    onSuccess: async () => {
      setTarget("")
      refreshWorkspaces()
      await agentsCollection.utils.refetch()
      await queryClient.invalidateQueries({ queryKey: agentKey(agentId) })
    },
  })
  if (workspace === undefined) return null
  const elsewhere = all.filter((entry) => entry.id !== workspace.id)
  // Its owner, or an admin of the team it is in.
  const may = workspace.role !== "member"
  const to = all.find((entry) => entry.id === target)
  return (
    <Section
      title="Workspace"
      hint={
        workspace.kind === "team"
          ? `${name} is in ${workspace.name}: everyone there can use it and read its chats.`
          : `${name} is yours alone. Move it to a team to share it.`
      }
    >
      {!may ? (
        <p className="text-sm text-muted-foreground">Only an admin of the team can move it.</p>
      ) : elsewhere.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Start a team from the workspace menu, at the top of the rail, to have somewhere to move
          it.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Move to"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
          >
            <option value="">Move to…</option>
            {elsewhere.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="outline"
            disabled={target === "" || move.isPending}
            onClick={() => move.mutate()}
          >
            {move.isPending ? "Moving…" : "Move"}
          </Button>
        </div>
      )}
      {to === undefined ? null : (
        <p role="note" className="rounded-xl bg-muted px-3 py-2 text-sm">
          {to.kind === "team"
            ? `Everyone in ${to.name} will be able to use ${name}, read all of its chats and what it remembers, and use its connectors and paired computers. Machines it shares with other agents stay behind, and it can work on the ones ${to.name} has open to every agent.`
            : `Only you will be able to use ${name}. Everyone else loses its chats. Machines it shares with other agents stay with the team.`}
        </p>
      )}
      {move.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {move.error.message}
        </p>
      ) : null}
    </Section>
  )
}

/**
 * The computers an agent can work on. They belong to its workspace and not to the agent, so
 * this only lists them: adding one, and saying which agents may use it, is done for the workspace.
 */
function Computers({ agentId }: { agentId: string }) {
  const { openWorkspace } = useSettings()
  const { data: computers } = useQuery({
    queryKey: computersKey,
    queryFn: () => client.listComputers(),
  })
  // The same for every agent, and it only changes with the deployment.
  const { data: kinds } = useQuery({
    queryKey: computerKindsKey,
    queryFn: () => client.computerKinds(),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const usable = (computers ?? []).filter((computer) => computer.agentIds.includes(agentId))
  return (
    <Section
      title="Computers"
      hint="Where this agent can keep files and run commands. Computers belong to the workspace, and an agent has a folder of its own on each machine it has worked on."
    >
      {computers === undefined ? null : usable.length === 0 ? (
        <p className="text-sm text-muted-foreground">It has no computer to work on.</p>
      ) : (
        <ul aria-label="Computers this agent can use" className="flex flex-col gap-2">
          {usable.map((computer) => {
            const folder = computer.folders.find((entry) => entry.agentId === agentId)?.path
            return (
              <li
                key={computer.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-xl border p-3 text-sm"
              >
                <span className="font-mono font-medium">{computer.name}</span>
                <span className="text-muted-foreground">
                  {computer.kind === PAIRED_COMPUTER
                    ? "paired"
                    : (kinds?.kinds.find((kind) => kind.id === computer.kind)?.label ??
                      computer.kind)}
                </span>
                {folder === undefined ? null : (
                  <span className="ml-auto min-w-0 truncate font-mono text-xs text-muted-foreground">
                    {folder}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <p className="text-sm text-muted-foreground">
        Computers are added, removed and shared under{" "}
        <button
          type="button"
          className="font-medium text-foreground underline underline-offset-4"
          onClick={() => openWorkspace("computers")}
        >
          Computers
        </button>{" "}
        in the workspace settings.
      </p>
    </Section>
  )
}

/** The parts of an agent's settings that are kept on the agent itself. */
export type ProfileSection = "identity" | "memory" | "model" | "usage" | "manage"

/**
 * What an agent is like, a section at a time. The sections that are typed into share one form,
 * so it stays mounted while another section is shown and what was typed is not lost.
 */
export function ProfileSettings({
  agentId,
  section,
}: {
  agentId: string
  /** The section to show. With none, the form is kept but nothing of it is shown. */
  section: ProfileSection | undefined
}) {
  const workspace = useWorkspaceOfAgent(agentId)
  const { data: state } = useQuery<AgentState>({
    queryKey: agentKey(agentId),
    queryFn: () => client.agent(agentId).state(),
  })
  // The same list for every agent, and it only changes with the deployment.
  const { data: models } = useQuery({
    queryKey: modelsKey,
    queryFn: () => client.models(),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const [form, setForm] = useState<Form>()
  const [dirty, setDirty] = useState(false)

  // Follow the agent's own edits until the user starts typing.
  useEffect(() => {
    if (state !== undefined && !dirty) setForm(toForm(state))
  }, [state, dirty])

  const save = useMutation({
    mutationFn: (change: AgentPatch) => client.agent(agentId).update(change),
    onSuccess: (next) => {
      queryClient.setQueryData(agentKey(agentId), next)
      void queryClient.invalidateQueries({ queryKey: agentsKey })
      setDirty(false)
    },
  })

  if (state === undefined || form === undefined) return null
  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm({ ...form, [key]: value })
    setDirty(true)
  }
  // Which levels there are to choose from depends on the model, so it waits for the list of them.
  const chosen = models?.find((model) => model.id === form.model)
  const over = form.user.length > state.limits.user || form.memory.length > state.limits.memory

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    save.mutate({
      ...(form.name.trim() ? { name: form.name.trim() } : {}),
      tagline: form.tagline,
      avatar: form.avatar,
      soul: form.soul,
      user: form.user,
      memory: form.memory,
      model: form.model,
      // What is saved is what the picker showed as chosen, which is what the model will do.
      thinking: nearestThinking(chosen?.thinking ?? [], form.thinking) ?? form.thinking,
    })
  }

  const typed = section === "identity" || section === "memory" || section === "model"
  const name = state.agent.name ?? "this agent"
  return (
    <form hidden={section === undefined} className="flex flex-col gap-6" onSubmit={submit}>
      <div hidden={section !== "identity"} className="flex flex-col gap-6">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Identity</h2>
          <p className="text-sm text-muted-foreground">{`Who ${name} is: how it looks and how it talks.`}</p>
        </div>
        <div className="flex items-center gap-5">
          <AgentAvatar
            avatar={form.avatar}
            seed={agentId}
            className="size-24"
            hatched={state.agent.hatched}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={form.name}
                maxLength={40}
                placeholder="Not named yet"
                onChange={(event) => set("name", event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tagline">Tagline</Label>
              <Input
                id="tagline"
                value={form.tagline}
                maxLength={120}
                onChange={(event) => set("tagline", event.target.value)}
              />
            </div>
          </div>
        </div>

        <Section
          title="Look"
          hint="Its shape and face were not chosen: they grew from a roll of the dice. Pick its color, or roll again for a different creature."
        >
          <div className="flex flex-wrap gap-1.5">
            {AVATAR_COLORS.map((color) => (
              <Choice
                key={color.id}
                label={color.label}
                selected={form.avatar.color === color.id}
                onClick={() => set("avatar", { ...form.avatar, color: color.id })}
              >
                <span
                  className="block size-7 rounded-full"
                  style={{ backgroundColor: color.hex }}
                />
              </Choice>
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="self-start"
            // Shown at once, above. It is only kept once the changes are saved.
            onClick={() => set("avatar", { ...form.avatar, seed: randomId().slice(0, 12) })}
          >
            Roll a new look
          </Button>
        </Section>

        <Section
          title="Personality"
          hint="How the agent talks and behaves, written to it in the second person."
        >
          <Textarea
            id="soul"
            rows={6}
            value={form.soul}
            maxLength={4000}
            placeholder="You are…"
            onChange={(event) => set("soul", event.target.value)}
          />
        </Section>

        <Section
          title={state.team ? "About the team" : "About you"}
          hint={
            state.team
              ? `What the agent knows about ${state.team} and the people in it. It reads this in every conversation, one entry per line.`
              : "What the agent knows about you. It reads this in every conversation, one entry per line."
          }
        >
          <Counted
            id="user"
            rows={6}
            value={form.user}
            limit={state.limits.user}
            onChange={(value) => set("user", value)}
          />
        </Section>
      </div>
      <div hidden={section !== "memory"} className="flex flex-col gap-6">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Memory</h2>
          <p className="text-sm text-muted-foreground">{`What ${name} has learned and keeps between chats.`}</p>
        </div>
        <Section
          title="Memory"
          hint="The agent's own long-term notes, also read in every conversation."
        >
          <Counted
            id="memory"
            rows={8}
            value={form.memory}
            limit={state.limits.memory}
            onChange={(value) => set("memory", value)}
          />
        </Section>
      </div>
      <div hidden={section !== "model"} className="flex flex-col gap-6">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Model and computer</h2>
          <p className="text-sm text-muted-foreground">{`What ${name} thinks with, the computers it can work on, and what it does with a message that arrives while it is busy.`}</p>
        </div>
        <Section
          title="Model"
          hint="Which model this agent thinks with. Applies from its next reply. New agents start on your default, which is under Settings."
        >
          <ModelPicker
            label="Model"
            models={models ?? []}
            value={form.model}
            onChange={(model) => set("model", model)}
          />
          {chosen ? (
            <ThinkingPicker
              label="Thinking"
              levels={chosen.thinking ?? []}
              value={form.thinking}
              onChange={(thinking) => set("thinking", thinking)}
            />
          ) : null}
        </Section>

        <Computers agentId={agentId} />
        <WhenBusy agentId={agentId} state={state} />
      </div>
      {section === "usage" ? <Usage agentId={agentId} /> : null}
      {section === "manage" ? (
        <>
          <Workspace agentId={agentId} name={state.agent.name ?? "This agent"} />
          {/* A team's agent is everyone's, so deleting it is for the people who run the team. */}
          {workspace?.role === "member" ? null : (
            <DeleteAgent agentId={agentId} name={state.agent.name} />
          )}
        </>
      ) : null}
      {typed || dirty ? (
        <div className="sticky bottom-0 flex items-center justify-end gap-3">
          {save.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {save.error.message}
            </p>
          ) : null}
          {save.isSuccess && !dirty ? <p className="text-sm text-muted-foreground">Saved</p> : null}
          <Button type="submit" disabled={!dirty || over || save.isPending} className="shadow-md">
            {save.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      ) : null}
    </form>
  )
}
