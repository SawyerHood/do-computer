import type { SkillSummary } from "@durable-computer/protocol"
import { ArrowLeftIcon, CaretRightIcon, TrashIcon } from "@phosphor-icons/react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { client } from "@/lib/client"
import { skillsKey } from "@/lib/collections"
import { queryClient } from "@/lib/query"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/_app/a/$agentId/skills")({ component: SkillsPage })

const SOURCES = {
  bundled: "Built in",
  agent: "Written by the agent",
  installed: "Installed",
} as const

function SkillCard({ agentId, skill }: { agentId: string; skill: SkillSummary }) {
  const api = client.agent(agentId)
  const [open, setOpen] = useState(false)
  const refresh = () => queryClient.invalidateQueries({ queryKey: skillsKey(agentId) })
  const [enabled, setEnabled] = useState(skill.enabled)
  useEffect(() => setEnabled(skill.enabled), [skill.enabled])
  const toggle = useMutation({
    mutationFn: (next: boolean) => api.setSkillEnabled(skill.name, next),
    onError: () => setEnabled(skill.enabled),
    onSettled: refresh,
  })
  const remove = useMutation({ mutationFn: () => api.removeSkill(skill.name), onSettled: refresh })
  const detail = useQuery({
    queryKey: [...skillsKey(agentId), skill.name, skill.updatedAt],
    queryFn: () => api.skill(skill.name),
    enabled: open,
  })

  return (
    <li
      className={cn(
        "flex flex-col gap-3 rounded-2xl border bg-surface p-4",
        !enabled && "opacity-70",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-mono text-[0.9375rem] font-medium">{skill.name}</h2>
          <p className="text-xs text-muted-foreground">
            {SOURCES[skill.source]}
            {skill.origin ? ` from ${skill.origin}` : ""}
            {skill.files.length > 1 ? ` · ${skill.files.length} files` : ""}
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => {
              // Show the new state at once; the refetch then confirms or reverts it.
              setEnabled(event.target.checked)
              toggle.mutate(event.target.checked)
            }}
            aria-label={`Use ${skill.name}`}
            className="size-4 accent-primary"
          />
          In use
        </label>
      </div>
      <p className="text-sm">{skill.description}</p>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <CaretRightIcon className={cn("transition-transform", open && "rotate-90")} />
          {open ? "Hide" : "Read"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto text-muted-foreground"
          disabled={remove.isPending}
          aria-label={`Delete ${skill.name}`}
          onClick={() => remove.mutate()}
        >
          <TrashIcon /> Delete
        </Button>
      </div>
      {open && detail.data ? (
        <div className="flex flex-col gap-3">
          {Object.entries(detail.data.contents).map(([path, content]) => (
            <div key={path} className="flex flex-col gap-1">
              <p className="font-mono text-xs text-muted-foreground">{path}</p>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-background p-3 font-mono text-xs">
                {content}
              </pre>
            </div>
          ))}
        </div>
      ) : null}
    </li>
  )
}

function InstallForm({ agentId }: { agentId: string }) {
  const [url, setUrl] = useState("")
  const install = useMutation({
    mutationFn: () => client.agent(agentId).installSkill(url),
    onSuccess: () => {
      setUrl("")
      void queryClient.invalidateQueries({ queryKey: skillsKey(agentId) })
    },
  })
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        install.mutate()
      }}
    >
      <div className="flex gap-2">
        <Input
          type="url"
          required
          value={url}
          placeholder="https://github.com/owner/repo/tree/main/skills/name"
          aria-label="Skill URL"
          onChange={(event) => setUrl(event.target.value)}
        />
        <Button type="submit" disabled={install.isPending || url.trim() === ""}>
          {install.isPending ? "Installing…" : "Install"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        A GitHub folder containing a SKILL.md, or a direct link to one. A skill is instructions your
        agent will follow, so install only from sources you trust.
      </p>
      {install.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {install.error.message}
        </p>
      ) : null}
    </form>
  )
}

/** What the agent knows how to do. It writes skills itself; this page is for reading and pruning. */
function SkillsPage() {
  const { agentId } = Route.useParams()
  const { data: skills } = useQuery({
    queryKey: skillsKey(agentId),
    queryFn: () => client.agent(agentId).skills(),
  })

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 pt-16 pb-24 md:pt-10">
        <Link
          to="/a/$agentId"
          params={{ agentId }}
          className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon /> Back to chat
        </Link>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Skills</h1>
          <p className="text-sm text-muted-foreground">
            Saved instructions your agent loads when a task calls for them. It writes new ones as it
            learns; you can also ask it to “save that as a skill”.
          </p>
        </div>
        <InstallForm agentId={agentId} />
        <ul className="flex flex-col gap-3">
          {(skills ?? []).map((skill) => (
            <SkillCard key={skill.name} agentId={agentId} skill={skill} />
          ))}
        </ul>
      </div>
    </div>
  )
}
