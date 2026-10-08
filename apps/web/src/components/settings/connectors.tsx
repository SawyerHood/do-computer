import type { ConnectorResult, ConnectorSummary } from "@durable-computer/protocol"
import { CaretRightIcon, TrashIcon } from "@phosphor-icons/react"
import { useMutation, useSuspenseQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
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
import { Input } from "@/components/ui/input"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Loads } from "@/components/loads"
import { CardsPlaceholder } from "@/components/placeholders"
import { client } from "@/lib/client"
import { connectorsKey } from "@/lib/collections"
import { queryClient } from "@/lib/query"
import { cn } from "@/lib/utils"

/** Set by the sign-in callback when it sends the user back here. */
export type ConnectorsSearch = { connected?: string; connector_error?: string }

const STATUS = {
  connected: {
    label: "Connected",
    tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  },
  needs_auth: {
    label: "Needs sign-in",
    tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  },
  error: { label: "Not connected", tone: "bg-destructive/15 text-destructive" },
} as const

/** A service that wants the user to sign in is reached by leaving this page for it. */
const follow = (result: ConnectorResult) => {
  if (result.authorizationUrl) window.location.assign(result.authorizationUrl)
}

function ConnectorCard({ agentId, connector }: { agentId: string; connector: ConnectorSummary }) {
  const api = client.agent(agentId)
  const refresh = () => queryClient.invalidateQueries({ queryKey: connectorsKey(agentId) })
  const [enabled, setEnabled] = useState(connector.enabled)
  useEffect(() => setEnabled(connector.enabled), [connector.enabled])
  const toggle = useMutation({
    mutationFn: (next: boolean) => api.setConnectorEnabled(connector.id, next),
    onError: () => setEnabled(connector.enabled),
    onSettled: refresh,
  })
  const reconnect = useMutation({
    mutationFn: () => api.reconnectConnector(connector.id),
    onSuccess: follow,
    onSettled: refresh,
  })
  const remove = useMutation({
    mutationFn: () => api.removeConnector(connector.id),
    onSettled: refresh,
  })
  const status = STATUS[connector.status]
  const error = toggle.error ?? reconnect.error ?? remove.error

  return (
    <li>
      <Card className={cn(!enabled && "opacity-70")}>
        <CardHeader>
          <CardTitle>
            <h2 className="truncate">{connector.name}</h2>
          </CardTitle>
          <CardDescription className="truncate">{new URL(connector.url).host}</CardDescription>
          <CardAction>
            <Badge variant="secondary" className={status.tone}>
              {status.label}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          {connector.status === "connected" ? (
            <p className="text-muted-foreground">
              {connector.tools.length === 0
                ? "It offers no tools."
                : `${connector.tools.length} tools: ${connector.tools.map((tool) => tool.name).join(", ")}`}
            </p>
          ) : connector.status === "needs_auth" ? (
            <p className="text-muted-foreground">
              Sign in to the service to let your agent use it.
            </p>
          ) : (
            <p className="text-destructive">{connector.error}</p>
          )}
        </CardContent>
        <CardFooter className="flex-wrap gap-2">
          <Button
            size="sm"
            variant={connector.status === "connected" ? "outline" : "default"}
            disabled={reconnect.isPending}
            onClick={() => reconnect.mutate()}
          >
            {connector.status === "needs_auth"
              ? "Sign in"
              : connector.status === "connected"
                ? "Refresh"
                : "Try again"}
          </Button>
          <Label className="font-normal text-muted-foreground">
            <Switch
              size="sm"
              checked={enabled}
              aria-label={`Use ${connector.name}`}
              onCheckedChange={(next) => {
                setEnabled(next)
                toggle.mutate(next)
              }}
            />
            In use
          </Label>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-muted-foreground"
            disabled={remove.isPending}
            aria-label={`Remove ${connector.name}`}
            onClick={() => remove.mutate()}
          >
            <TrashIcon /> Remove
          </Button>
        </CardFooter>
        {error ? (
          <CardContent>
            <p role="alert" className="text-destructive">
              {error.message}
            </p>
          </CardContent>
        ) : null}
      </Card>
    </li>
  )
}

function AddForm({ agentId }: { agentId: string }) {
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [token, setToken] = useState("")
  const [clientId, setClientId] = useState("")
  const [clientSecret, setClientSecret] = useState("")
  const add = useMutation({
    mutationFn: () =>
      client.agent(agentId).addConnector({
        name,
        url,
        token: token || undefined,
        clientId: clientId || undefined,
        clientSecret: clientSecret || undefined,
      }),
    onSuccess: (result) => {
      setName("")
      setUrl("")
      setToken("")
      setClientId("")
      setClientSecret("")
      follow(result)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: connectorsKey(agentId) }),
  })
  return (
    <form
      className="flex flex-col gap-3 rounded-2xl border border-dashed p-4"
      onSubmit={(event) => {
        event.preventDefault()
        add.mutate()
      }}
    >
      <h2 className="text-sm font-medium">Add a connector</h2>
      <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="connector-name">Name</Label>
          <Input
            id="connector-name"
            required
            maxLength={60}
            value={name}
            placeholder="Calendar"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="connector-url">Server address</Label>
          <Input
            id="connector-url"
            type="url"
            required
            value={url}
            placeholder="https://mcp.example.com/mcp"
            onChange={(event) => setUrl(event.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="connector-token">Access token (optional)</Label>
        <Input
          id="connector-token"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Leave empty for a service you sign in to. A token is kept on the server and never shown to
          the agent.
        </p>
      </div>
      {/* For the few services whose sign-in does not let an app introduce itself. */}
      <Collapsible>
        <CollapsibleTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="group/more -ml-2 h-7 px-2 font-normal text-muted-foreground"
            />
          }
        >
          <CaretRightIcon
            data-icon="inline-start"
            className="transition-transform group-data-panel-open/more:rotate-90"
          />
          The service gave me a client ID
        </CollapsibleTrigger>
        <CollapsibleContent className="grid gap-3 pt-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="connector-client-id">Client ID</Label>
            <Input
              id="connector-client-id"
              autoComplete="off"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="connector-client-secret">Client secret</Label>
            <Input
              id="connector-client-secret"
              type="password"
              autoComplete="off"
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
            />
          </div>
        </CollapsibleContent>
      </Collapsible>
      {add.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {add.error.message}
        </p>
      ) : null}
      <Button type="submit" className="self-start" disabled={add.isPending}>
        {add.isPending ? "Connecting…" : "Add connector"}
      </Button>
    </form>
  )
}

/** Services the agent can use through MCP: each one's tools become tools of the agent. */
export function ConnectorsSettings({
  agentId,
  search,
}: {
  agentId: string
  /** What the address says after coming back from a service: which was connected, or why not. */
  search: ConnectorsSearch
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Connectors</h2>
        <p className="text-sm text-muted-foreground">
          Services your agent can use, such as a calendar or a task tracker, connected through MCP.
          Your agent uses them without asking first, with whatever access you grant.
        </p>
      </div>
      {search.connector_error ? (
        <Alert className="border-destructive/40 bg-destructive/10">
          <AlertDescription className="text-foreground">{search.connector_error}</AlertDescription>
        </Alert>
      ) : null}
      <Loads key={agentId} fallback={<CardsPlaceholder cards={1} />}>
        <Connected
          agentId={agentId}
          connected={search.connector_error ? undefined : search.connected}
        />
      </Loads>
      <AddForm agentId={agentId} />
    </div>
  )
}

/** The agent's connectors, which wait for it to list them, and word of one just connected. */
function Connected({ agentId, connected }: { agentId: string; connected: string | undefined }) {
  const { data: connectors } = useSuspenseQuery({
    queryKey: connectorsKey(agentId),
    queryFn: () => client.agent(agentId).connectors(),
  })
  const justConnected = connectors.find((connector) => connector.id === connected)
  return (
    <>
      {justConnected ? (
        <Alert role="status" className="border-emerald-500/40 bg-emerald-500/10">
          <AlertDescription className="text-foreground">
            {justConnected.name} is connected.
          </AlertDescription>
        </Alert>
      ) : null}
      {connectors.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {connectors.map((connector) => (
            <ConnectorCard key={connector.id} agentId={agentId} connector={connector} />
          ))}
        </ul>
      ) : null}
    </>
  )
}
