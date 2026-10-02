import type { AgentPatch, AgentState } from "@durable-computer/client"
import {
  type AgentUsage,
  type Avatar,
  AVATAR_ACCESSORIES,
  AVATAR_CHARACTERS,
  AVATAR_COLORS,
  defaultAvatar,
} from "@durable-computer/protocol"
import { ArrowLeftIcon } from "@phosphor-icons/react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useEffect, useId, useState } from "react"
import { AgentAvatar } from "@/components/agent-avatar"
import { ModelPicker } from "@/components/model-picker"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { client } from "@/lib/client"
import { agentKey, agentsCollection, agentsKey, modelsKey, usageKey } from "@/lib/collections"
import { queryClient } from "@/lib/query"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/_app/a/$agentId/profile")({ component: ProfilePage })

type Form = {
  name: string
  tagline: string
  avatar: Avatar
  soul: string
  user: string
  memory: string
  model: string
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
  const remove = useMutation({
    mutationFn: () => client.deleteAgent(agentId),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: agentKey(agentId) })
      await agentsCollection.utils.refetch()
      // The index route picks another agent, or makes a new one if this was the last.
      await navigate({ to: "/" })
    },
  })
  return (
    <Section
      title="Delete this agent"
      hint="Removes its memory, chats, files, schedules, skills, connectors and its computer, and unpairs your computers from it. This cannot be undone."
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

function ProfilePage() {
  const { agentId } = Route.useParams()
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
    })
  }

  return (
    <div className="h-full overflow-y-auto">
      <form
        className="mx-auto flex max-w-2xl flex-col gap-6 px-6 pt-16 pb-24 md:pt-10"
        onSubmit={submit}
      >
        <Link
          to="/a/$agentId"
          params={{ agentId }}
          className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon /> Back to chat
        </Link>

        <div className="flex items-center gap-5">
          <AgentAvatar avatar={form.avatar} seed={agentId} className="size-24" />
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

        <Section title="Look" hint="Pick a character, a color and, if you like, an accessory.">
          <div className="flex flex-wrap gap-1.5">
            {AVATAR_CHARACTERS.map((character) => (
              <Choice
                key={character.id}
                label={character.label}
                selected={form.avatar.character === character.id}
                onClick={() => set("avatar", { ...form.avatar, character: character.id })}
              >
                <AgentAvatar
                  avatar={{ character: character.id, color: form.avatar.color }}
                  seed={agentId}
                  className="size-11"
                />
              </Choice>
            ))}
          </div>
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
          <div className="flex flex-wrap gap-2">
            {[{ id: undefined, label: "None" }, ...AVATAR_ACCESSORIES].map((accessory) => (
              <Button
                key={accessory.label}
                type="button"
                size="sm"
                variant={form.avatar.accessory === accessory.id ? "default" : "outline"}
                className="rounded-full"
                onClick={() => {
                  const { accessory: _previous, ...rest } = form.avatar
                  set("avatar", accessory.id ? { ...rest, accessory: accessory.id } : rest)
                }}
              >
                {accessory.label}
              </Button>
            ))}
          </div>
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
          title="About you"
          hint="What the agent knows about you. It reads this in every conversation, one entry per line."
        >
          <Counted
            id="user"
            rows={6}
            value={form.user}
            limit={state.limits.user}
            onChange={(value) => set("user", value)}
          />
        </Section>

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
        </Section>

        <Usage agentId={agentId} />
        <DeleteAgent agentId={agentId} name={state.agent.name} />

        <div className="sticky bottom-4 flex items-center justify-end gap-3">
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
      </form>
    </div>
  )
}
