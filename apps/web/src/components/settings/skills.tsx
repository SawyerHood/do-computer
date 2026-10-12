import type { SkillSummary } from "@do-computer/protocol"
import { CaretRightIcon, TrashIcon } from "@phosphor-icons/react"
import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { Loads } from "@/components/loads"
import { CardsPlaceholder } from "@/components/placeholders"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { client } from "@/lib/client"
import { skillsKey } from "@/lib/collections"
import { queryClient } from "@/lib/query"
import { cn } from "@/lib/utils"

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
    <li>
      <Card className={cn(!enabled && "opacity-70")}>
        <CardHeader>
          <CardTitle className="font-mono text-[0.9375rem]">
            <h2 className="truncate">{skill.name}</h2>
          </CardTitle>
          <CardDescription className="text-xs">
            {SOURCES[skill.source]}
            {skill.origin ? ` from ${skill.origin}` : ""}
            {skill.files.length > 1 ? ` · ${skill.files.length} files` : ""}
          </CardDescription>
          <CardAction>
            <Label className="font-normal text-muted-foreground">
              <Switch
                size="sm"
                checked={enabled}
                onCheckedChange={(next) => {
                  // Show the new state at once; the refetch then confirms or reverts it.
                  setEnabled(next)
                  toggle.mutate(next)
                }}
                aria-label={`Use ${skill.name}`}
              />
              In use
            </Label>
          </CardAction>
        </CardHeader>
        <CardContent>{skill.description}</CardContent>
        <Collapsible open={open} onOpenChange={setOpen}>
          <CardFooter className="gap-2">
            <CollapsibleTrigger render={<Button size="sm" variant="outline" />}>
              <CaretRightIcon className={cn("transition-transform", open && "rotate-90")} />
              {open ? "Hide" : "Read"}
            </CollapsibleTrigger>
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
          </CardFooter>
          <CollapsibleContent>
            {detail.data ? (
              <CardContent className="flex flex-col gap-3 pt-3">
                {Object.entries(detail.data.contents).map(([path, content]) => (
                  <div key={path} className="flex flex-col gap-1">
                    <p className="font-mono text-xs text-muted-foreground">{path}</p>
                    <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-background p-3 font-mono text-xs">
                      {content}
                    </pre>
                  </div>
                ))}
              </CardContent>
            ) : null}
          </CollapsibleContent>
        </Collapsible>
      </Card>
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
export function SkillsSettings({ agentId }: { agentId: string }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Skills</h2>
        <p className="text-sm text-muted-foreground">
          Saved instructions your agent loads when a task calls for them. It writes new ones as it
          learns; you can also ask it to “save that as a skill”.
        </p>
      </div>
      <InstallForm agentId={agentId} />
      <Loads key={agentId} fallback={<CardsPlaceholder />}>
        <SkillList agentId={agentId} />
      </Loads>
    </div>
  )
}

/** The skills themselves, which wait for the agent to list them. */
function SkillList({ agentId }: { agentId: string }) {
  const { data: skills } = useSuspenseQuery({
    queryKey: skillsKey(agentId),
    queryFn: () => client.agent(agentId).skills(),
  })
  return (
    <ul className="flex flex-col gap-3">
      {skills.map((skill) => (
        <SkillCard key={skill.name} agentId={agentId} skill={skill} />
      ))}
    </ul>
  )
}
