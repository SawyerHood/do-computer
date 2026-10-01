import type { AgentPatch, AgentState } from "@durable-computer/client"
import {
  type Avatar,
  AVATAR_ACCESSORIES,
  AVATAR_CHARACTERS,
  AVATAR_COLORS,
  defaultAvatar,
} from "@durable-computer/protocol"
import { ArrowLeftIcon } from "@phosphor-icons/react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { AgentAvatar } from "@/components/agent-avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { client } from "@/lib/client"
import { agentKey, agentsKey } from "@/lib/collections"
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
  return (
    <section className="flex flex-col gap-3 border-t pt-6">
      <div>
        <h2 className="text-sm font-medium">{title}</h2>
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
function ProfilePage() {
  const { agentId } = Route.useParams()
  const { data: state } = useQuery<AgentState>({
    queryKey: agentKey(agentId),
    queryFn: () => client.agent(agentId).state(),
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
          hint="Which model the agent thinks with. Applies from its next reply."
        >
          <select
            aria-label="Model"
            value={form.model}
            onChange={(event) => set("model", event.target.value)}
            className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
          >
            {state.models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
        </Section>

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
