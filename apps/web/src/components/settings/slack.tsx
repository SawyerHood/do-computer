import {
  type AgentSummary,
  type ConnectorSummary,
  SLACK_MCP_URL,
  type SlackApp,
  type SlackState,
} from "@durable-computer/protocol"
import { ArrowSquareOutIcon, PlugsIcon, SlackLogoIcon } from "@phosphor-icons/react"
import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { useState } from "react"
import { SlackMark } from "@/components/chat/slack-threads"
import { Loads } from "@/components/loads"
import { FaceStack } from "@/components/people"
import { FormPlaceholder } from "@/components/placeholders"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { client } from "@/lib/client"
import { connectorsKey, slackKey } from "@/lib/collections"
import { queryClient } from "@/lib/query"
import { useSettings } from "@/lib/settings"
import { cn } from "@/lib/utils"
import { usePeople, useWorkspaceOfAgent } from "@/lib/workspaces"

const badge = "shrink-0 rounded-md px-2 py-0.5 text-xs font-medium"
const good = "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
const heading = "pb-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase"

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

/** The three steps, and the box the Slack app's credentials are pasted into. */
function AddToSlack({
  agentId,
  name,
  state,
}: {
  agentId: string
  name: string
  state: SlackState
}) {
  const [botToken, setBotToken] = useState("")
  const [signingSecret, setSigningSecret] = useState("")
  const [clientId, setClientId] = useState("")
  const [clientSecret, setClientSecret] = useState("")
  const connect = useMutation({
    mutationFn: () =>
      client.agent(agentId).connectSlack({
        botToken,
        signingSecret,
        clientId: clientId || undefined,
        clientSecret: clientSecret || undefined,
      }),
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
            <p className={cn(heading, "pt-1 pb-0")}>Only for searching Slack as you · optional</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="slack-client-id">Client ID</Label>
                <Input
                  id="slack-client-id"
                  autoComplete="off"
                  className="font-mono"
                  value={clientId}
                  onChange={(event) => setClientId(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="slack-client-secret">Client secret</Label>
                <Input
                  id="slack-client-secret"
                  type="password"
                  autoComplete="off"
                  value={clientSecret}
                  onChange={(event) => setClientSecret(event.target.value)}
                />
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

/** What the agent is in Slack, who it works for there, and the connector that goes with it. */
function InSlack({ agent, name, app }: { agent: AgentSummary; name: string; app: SlackApp }) {
  const api = client.agent(agent.id)
  const { openAgent } = useSettings()
  const workspace = useWorkspaceOfAgent(agent.id)
  const team = workspace?.kind === "team" ? workspace : undefined
  const people = [...usePeople(team).values()]
  const remove = useMutation({
    mutationFn: () => api.disconnectSlack(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: slackKey(agent.id) }),
  })
  // Asked for beside the rest, not waited for: the section is about the bot first.
  const { data: connectors } = useQuery({
    queryKey: connectorsKey(agent.id),
    queryFn: () => api.connectors(),
  })
  const connector = connectors?.find((entry: ConnectorSummary) => entry.url === SLACK_MCP_URL)
  const asYou = useMutation({
    mutationFn: () => api.addSlackConnector(),
    onSuccess: (result) => {
      // Slack's own sign-in is reached by leaving this page for it.
      if (result.authorizationUrl) window.location.assign(result.authorizationUrl)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: connectorsKey(agent.id) }),
  })
  const teamHost = host(app.teamUrl)
  return (
    <>
      <div>
        <div className="flex items-center gap-3 rounded-2xl border bg-surface p-3.5">
          <SlackMark />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 font-medium">
              <span className="truncate">@{app.bot}</span>
              <span className={cn(badge, good)}>In Slack</span>
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
            Remove from Slack
          </Button>
        </div>
        <p className="pt-2 text-xs text-muted-foreground">
          Each thread it is spoken to in shows up in {name}'s panel, under From Slack.
        </p>
      </div>

      <section aria-label="Who it works for there">
        <h3 className={heading}>Who it works for there</h3>
        <ul className="divide-y rounded-2xl border">
          <li className="flex items-center gap-3 p-3.5">
            {people.length > 0 ? <FaceStack people={people} className="size-6.5" /> : null}
            <div className="min-w-0 flex-1">
              <p className="font-medium">{team === undefined ? "You" : `People in ${team.name}`}</p>
              <p className="text-sm text-muted-foreground">
                Found by {team === undefined ? "your" : "their"} email address. {name} works for{" "}
                {team === undefined ? "you" : "them"} in Slack as it does here.
              </p>
            </div>
          </li>
          <li className="flex items-center gap-3 p-3.5">
            <SlackMark className="size-6.5 rounded-full" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">Everyone else in the Slack workspace</p>
              <p className="text-sm text-muted-foreground">
                {name} answers them. Using a connector or one of your own computers for them waits
                for an OK here.
              </p>
            </div>
          </li>
        </ul>
      </section>

      <section aria-label="Search and write as you">
        <h3 className={heading}>Search and write as you</h3>
        <div className="flex items-center gap-3 rounded-2xl border p-3.5">
          <PlugsIcon className="size-4.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 font-medium">
              Slack connector
              {connector?.status === "connected" ? (
                <span className={cn(badge, good)}>Connected</span>
              ) : connector?.status === "needs_auth" ? (
                <span className={cn(badge, "bg-amber-500/15 text-amber-700 dark:text-amber-300")}>
                  Needs sign-in
                </span>
              ) : connector !== undefined ? (
                <span className={cn(badge, "bg-destructive/15 text-destructive")}>
                  Not connected
                </span>
              ) : null}
            </p>
            <p className="text-sm text-muted-foreground">
              {connector?.status === "connected"
                ? `${name} can search Slack, read channels and send messages as whoever signed in.`
                : app.hasClient || connector !== undefined
                  ? `Lets ${name} search Slack, read channels and send messages as whoever signs in.`
                  : `This needs the Slack app's Client ID and Client secret. Remove ${name} from Slack and add it again with both.`}
            </p>
            {asYou.isError ? (
              <p role="alert" className="pt-1 text-sm text-destructive">
                {asYou.error.message}
              </p>
            ) : null}
          </div>
          {connector !== undefined ? (
            <Button size="sm" variant="outline" onClick={() => openAgent("connectors")}>
              Open in Connectors
            </Button>
          ) : app.hasClient ? (
            <Button
              size="sm"
              variant="outline"
              disabled={asYou.isPending}
              onClick={() => asYou.mutate()}
            >
              Connect Slack as you
            </Button>
          ) : null}
        </div>
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
    <AddToSlack agentId={agent.id} name={name} state={state} />
  ) : (
    <InSlack agent={agent} name={name} app={state.app} />
  )
}

/**
 * The agent in Slack, as a bot under its own name: the steps that put it there, and once it is
 * there, what it is called, who it works for, and the connector that lets it act as a person.
 */
export function SlackSettings({ agent }: { agent: AgentSummary }) {
  const name = agent.name ?? "your agent"
  return (
    <div className="flex flex-col gap-6">
      <div>
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
