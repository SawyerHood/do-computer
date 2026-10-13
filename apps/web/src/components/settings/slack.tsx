import type { AgentSummary, SlackApp, SlackState } from "@do-computer/protocol"
import {
  ArrowSquareOutIcon,
  CaretLeftIcon,
  DownloadSimpleIcon,
  SlackLogoIcon,
} from "@phosphor-icons/react"
import { useMutation, useSuspenseQuery } from "@tanstack/react-query"
import { useState } from "react"
import { AgentFace } from "@/components/agent-avatar"
import { SlackMark } from "@/components/chat/slack-threads"
import { Loads } from "@/components/loads"
import { FormPlaceholder } from "@/components/placeholders"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { agentPicture, download } from "@/lib/agent-picture"
import { client } from "@/lib/client"
import { slackKey } from "@/lib/collections"
import { queryClient } from "@/lib/query"

const good = "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
const heading = "pb-2.5 text-[0.8125rem] font-medium text-muted-foreground"

/** One step of putting the agent in Slack: its number, what to do, and what it needs. */
function Step({
  number,
  title,
  children,
}: {
  number: number
  title: string
  children: React.ReactNode
}) {
  return (
    <li className="flex gap-3.5">
      <span
        aria-hidden
        className="mt-px grid size-6.5 shrink-0 place-items-center rounded-full border border-input text-xs font-semibold"
      >
        {number}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <h3 className="font-medium">{title}</h3>
        {children}
      </div>
    </li>
  )
}

/**
 * The agent's face for Slack. Slack lets nobody but a person set an app's icon, so the picture
 * is handed over as a file, to be put on the app's page by hand.
 */
function BotPicture({ agent, name }: { agent: AgentSummary; name: string }) {
  const save = useMutation({
    mutationFn: async () => {
      const file =
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") || "agent"
      download(await agentPicture(agent.avatar, agent.id, agent.outfit), `${file}.png`)
    },
  })
  return (
    <div className="flex items-center gap-3">
      <AgentFace agent={agent} className="size-10" still />
      <div className="min-w-0 flex-1 text-sm text-muted-foreground">
        <p>
          To give it {name}'s face, set this picture as the app's icon: on the app's page in Slack,
          Basic Information, then Display Information.
        </p>
        {save.isError ? (
          <p role="alert" className="text-destructive">
            {save.error.message}
          </p>
        ) : null}
      </div>
      <Button size="sm" variant="outline" disabled={save.isPending} onClick={() => save.mutate()}>
        <DownloadSimpleIcon data-icon="inline-start" />
        Download picture
      </Button>
    </div>
  )
}

/** The three steps, and the box the Slack app's credentials are pasted into. */
function AddToSlack({
  agent,
  name,
  state,
}: {
  agent: AgentSummary
  name: string
  state: SlackState
}) {
  const agentId = agent.id
  const [botToken, setBotToken] = useState("")
  const [signingSecret, setSigningSecret] = useState("")
  const connect = useMutation({
    mutationFn: () => client.agent(agentId).connectSlack({ botToken, signingSecret }),
    onSuccess: (next) => queryClient.setQueryData(slackKey(agentId), next),
  })
  return (
    <>
      <ol className="flex flex-col gap-6">
        <Step number={1} title="Create the Slack app">
          <p className="text-sm text-muted-foreground">
            Slack's page opens already filled in for {name}. Choose your workspace there and press
            Create.
          </p>
          <Button
            variant="outline"
            className="self-start"
            render={<a href={state.createUrl} target="_blank" rel="noreferrer" />}
          >
            <SlackLogoIcon data-icon="inline-start" />
            Create {name}'s Slack app
            <ArrowSquareOutIcon data-icon="inline-end" />
          </Button>
          <BotPicture agent={agent} name={name} />
        </Step>
        <Step number={2} title="Install it">
          <p className="text-sm text-muted-foreground">
            On the app's page in Slack, press <b className="font-medium">Install to Workspace</b>.
            If Slack asks you to verify the address it sends events to, press Verify.
          </p>
        </Step>
        <Step number={3} title="Paste what Slack gives you">
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              connect.mutate()
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="slack-bot-token">Bot token</Label>
                <Input
                  id="slack-bot-token"
                  required
                  autoComplete="off"
                  className="font-mono"
                  placeholder="xoxb-…"
                  value={botToken}
                  onChange={(event) => setBotToken(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">Under OAuth &amp; Permissions</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="slack-signing-secret">Signing secret</Label>
                <Input
                  id="slack-signing-secret"
                  required
                  type="password"
                  autoComplete="off"
                  value={signingSecret}
                  onChange={(event) => setSigningSecret(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">Under Basic Information</p>
              </div>
            </div>
            {connect.isError ? (
              <p role="alert" className="text-sm text-destructive">
                {connect.error.message}
              </p>
            ) : null}
            <Button type="submit" className="mt-1 self-start" disabled={connect.isPending}>
              {connect.isPending ? "Connecting…" : "Connect"}
            </Button>
          </form>
        </Step>
      </ol>
      {/* Slack's page already has it. It is here for an app that is set up by hand. */}
      <p className="truncate border-t pt-3.5 text-xs text-muted-foreground">
        Slack sends what is said to <span className="font-mono">{state.eventsUrl}</span>
      </p>
    </>
  )
}

const host = (url: string | null) => {
  try {
    return url === null ? undefined : new URL(url).host
  } catch {
    return undefined
  }
}

/** What the agent is in Slack: what it is called there, its picture, and what it does. */
function InSlack({ agent, name, app }: { agent: AgentSummary; name: string; app: SlackApp }) {
  const remove = useMutation({
    mutationFn: () => client.agent(agent.id).disconnectSlack(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: slackKey(agent.id) }),
  })
  const teamHost = host(app.teamUrl)
  return (
    <>
      <div>
        <div className="flex items-center gap-3 rounded-2xl bg-card shadow-raised p-3.5">
          <SlackMark />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 font-medium">
              <span className="truncate">@{app.bot}</span>
              <Badge variant="secondary" className={good}>
                In Slack
              </Badge>
            </p>
            <p className="truncate text-sm text-muted-foreground">
              {app.team}
              {teamHost === undefined ? null : (
                <>
                  {" · "}
                  <a
                    href={app.teamUrl!}
                    target="_blank"
                    rel="noreferrer"
                    className="underline-offset-3 hover:underline"
                  >
                    {teamHost}
                  </a>
                </>
              )}
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            {remove.isPending ? "Removing…" : "Remove from Slack"}
          </Button>
        </div>
        <p className="pt-2 text-xs text-muted-foreground">
          Each thread it is spoken to in shows up in {name}'s panel, under From Slack.
        </p>
      </div>

      <section aria-label="Its picture">
        <h3 className={heading}>Its picture</h3>
        <div className="rounded-2xl border p-3.5">
          <BotPicture agent={agent} name={name} />
        </div>
      </section>

      <section aria-label="What it does there">
        <h3 className={heading}>What it does there</h3>
        <ul className="divide-y rounded-2xl border">
          <li className="p-3.5">
            <p className="font-medium">Works for everyone in the Slack workspace</p>
            <p className="text-sm text-muted-foreground">
              Anyone there can mention {name} or write to it, and it works for them as it does for
              you here, with everything it knows and can do.
            </p>
          </li>
          <li className="p-3.5">
            <p className="font-medium">Writes and reads on its own</p>
            <p className="text-sm text-muted-foreground">
              From any chat or automation, {name} can read the channels it has been added to and
              write in them, or to one person. Add it to a channel by typing{" "}
              <span className="font-mono text-xs">/invite @{app.bot}</span> there.
            </p>
          </li>
        </ul>
      </section>
    </>
  )
}

function Section({ agent, name }: { agent: AgentSummary; name: string }) {
  const { data: state } = useSuspenseQuery({
    queryKey: slackKey(agent.id),
    queryFn: () => client.agent(agent.id).slack(),
  })
  return state.app === null ? (
    <AddToSlack agent={agent} name={name} state={state} />
  ) : (
    <InSlack agent={agent} name={name} app={state.app} />
  )
}

/**
 * The agent in Slack, as a bot under its own name: the steps that put it there, and once it is
 * there, what it is called, who it works for, and the connector that lets it act as a person.
 */
export function SlackSettings({
  agent,
  onBack,
}: {
  agent: AgentSummary
  /** Back to the connectors, which this page is reached from. */
  onBack: () => void
}) {
  const name = agent.name ?? "your agent"
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="mb-2 -ml-2 h-7 gap-1 px-2 font-normal text-muted-foreground"
        >
          <CaretLeftIcon className="size-3.5" />
          Connectors
        </Button>
        <h2 className="text-lg font-semibold tracking-tight">Slack</h2>
        <p className="text-sm text-muted-foreground">
          Put {name} in Slack as a bot. Mention it in a channel or message it, and it answers there.
        </p>
      </div>
      <Loads key={agent.id} fallback={<FormPlaceholder fields={2} />}>
        <Section agent={agent} name={name} />
      </Loads>
    </div>
  )
}
