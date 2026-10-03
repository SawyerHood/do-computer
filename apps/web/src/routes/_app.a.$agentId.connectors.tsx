import type { ConnectorResult, ConnectorSummary } from "@durable-computer/protocol"
import { ArrowLeftIcon, TrashIcon } from "@phosphor-icons/react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { client } from "@/lib/client"
import { connectorsKey } from "@/lib/collections"
import { queryClient } from "@/lib/query"
import { cn } from "@/lib/utils"

/** Set by the sign-in callback when it sends the user back here. */
type ConnectorsSearch = { connected?: string; connector_error?: string }

export const Route = createFileRoute("/_app/a/$agentId/connectors")({
  validateSearch: (search: Record<string, unknown>): ConnectorsSearch => ({
    ...(typeof search.connected === "string" ? { connected: search.connected } : {}),
    ...(typeof search.connector_error === "string"
      ? { connector_error: search.connector_error }
      : {}),
  }),
  component: ConnectorsPage,
})

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
    <li
      className={cn(
        "flex flex-col gap-3 rounded-2xl border bg-surface p-4",
        !enabled && "opacity-70",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-medium">{connector.name}</h2>
          <p className="truncate text-sm text-muted-foreground">{new URL(connector.url).host}</p>
        </div>
        <span
          className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium", status.tone)}
        >
          {status.label}
        </span>
      </div>
      {connector.status === "connected" ? (
        <p className="text-sm text-muted-foreground">
          {connector.tools.length === 0
            ? "It offers no tools."
            : `${connector.tools.length} tools: ${connector.tools.map((tool) => tool.name).join(", ")}`}
        </p>
      ) : connector.status === "needs_auth" ? (
        <p className="text-sm text-muted-foreground">
          Sign in to the service to let your agent use it.
        </p>
      ) : (
        <p className="text-sm text-destructive">{connector.error}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
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
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={enabled}
            aria-label={`Use ${connector.name}`}
            className="size-4 accent-primary"
            onChange={(event) => {
              setEnabled(event.target.checked)
              toggle.mutate(event.target.checked)
            }}
          />
          In use
        </label>
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
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      ) : null}
    </li>
  )
}

function AddForm({ agentId }: { agentId: string }) {
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [token, setToken] = useState("")
  const add = useMutation({
    mutationFn: () => client.agent(agentId).addConnector({ name, url, token: token || undefined }),
    onSuccess: (result) => {
      setName("")
      setUrl("")
      setToken("")
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
function ConnectorsPage() {
  const { agentId } = Route.useParams()
  const search = Route.useSearch()
  const { data: connectors } = useQuery({
    queryKey: connectorsKey(agentId),
    queryFn: () => client.agent(agentId).connectors(),
  })
  const justConnected = connectors?.find((connector) => connector.id === search.connected)

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
          <h1 className="text-xl font-semibold tracking-tight">Connectors</h1>
          <p className="text-sm text-muted-foreground">
            Services your agent can use, such as a calendar or a task tracker, connected through
            MCP. Your agent uses them without asking first, with whatever access you grant.
          </p>
        </div>
        {search.connector_error ? (
          <p
            role="alert"
            className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm"
          >
            {search.connector_error}
          </p>
        ) : justConnected ? (
          <p
            role="status"
            className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm"
          >
            {justConnected.name} is connected.
          </p>
        ) : null}
        {connectors !== undefined && connectors.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {connectors.map((connector) => (
              <ConnectorCard key={connector.id} agentId={agentId} connector={connector} />
            ))}
          </ul>
        ) : null}
        <AddForm agentId={agentId} />
      </div>
    </div>
  )
}
