import { type ConnectorSummary, MAX_SECRET_CHARS, type SecretRequest } from "@do-computer/protocol"
import { EyeIcon, EyeSlashIcon, KeyIcon, PlugsConnectedIcon } from "@phosphor-icons/react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useState } from "react"
import { PasswordInput, SitesField } from "@/components/login-fields"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { client } from "@/lib/client"
import { connectorsKey, savedLoginsKey, secretsKey } from "@/lib/collections"
import { loginAnswer } from "@/lib/passwords"
import { queryClient } from "@/lib/query"
import { useWorkspaceOfAgent } from "@/lib/workspaces"

/** Why a value cannot be saved, or undefined when it can. */
function problemWith(name: string, value: string): string | undefined {
  if (value === "") return `Type a value for ${name}.`
  if (/[\r\n]/.test(value)) return `${name} has to be a single line.`
  if (value.length > MAX_SECRET_CHARS) return `${name} is too long to save.`
  return undefined
}

/** Where a request came from, for one shown in another chat of the agent than the one it was made in. */
function AskedElsewhere({ agentId, chatId }: { agentId: string; chatId: string }) {
  return (
    <p className="text-xs text-muted-foreground">
      Asked in{" "}
      <Link
        to="/a/$agentId/c/$chatId"
        params={{ agentId, chatId }}
        className="underline underline-offset-3"
      >
        another chat
      </Link>
    </p>
  )
}

type FormProps = {
  agentId: string
  agentName: string
  request: SecretRequest
  /** Whether the request came from the chat on screen. */
  here: boolean
}

/**
 * The form for secrets an agent asked for. What is typed goes to where it is kept and is never
 * put in the chat: it is held here only until it is sent, and forgotten when the form goes.
 */
function SecretForm({
  agentId,
  agentName,
  request,
  destination,
  here,
}: FormProps & {
  destination: Exclude<SecretRequest["destination"], { kind: "login" }>
}) {
  const team = useWorkspaceOfAgent(agentId)
  const api = client.agent(agentId)
  const [values, setValues] = useState<Record<string, string>>({})
  const [shown, setShown] = useState<Record<string, boolean>>({})
  const [problem, setProblem] = useState<string | undefined>()
  const settle = () => queryClient.invalidateQueries({ queryKey: secretsKey(agentId) })
  const save = useMutation({
    mutationFn: () => api.answerSecretRequest(request.id, values),
    onSuccess: () => setValues({}),
    onSettled: settle,
  })
  const decline = useMutation({
    mutationFn: () => api.declineSecretRequest(request.id),
    onSettled: settle,
  })
  const busy = save.isPending || decline.isPending
  const error = problem ?? save.error?.message ?? decline.error?.message
  const one = request.fields.length === 1
  return (
    <li className="rounded-2xl bg-card p-3.5 shadow-raised">
      <form
        className="flex flex-col gap-3"
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault()
          const wrong = request.fields
            .map((field) => problemWith(field.name, values[field.name] ?? ""))
            .find((found) => found !== undefined)
          setProblem(wrong)
          if (wrong === undefined) save.mutate()
        }}
      >
        <div className="flex items-start gap-2.5">
          <KeyIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-sm">
              <span className="font-medium">{agentName}</span>{" "}
              {destination.kind === "connector" ? (
                <>
                  asks for the access token of{" "}
                  <span className="font-medium">{destination.name}</span>
                </>
              ) : one ? (
                "asks for a secret"
              ) : (
                `asks for ${request.fields.length} secrets`
              )}
            </p>
            {request.purpose === null ? null : (
              <p className="text-sm text-muted-foreground">“{request.purpose}”</p>
            )}
            <p className="mt-1 text-xs wrap-anywhere text-muted-foreground">
              {destination.kind === "connector" ? (
                <>
                  Kept with the connector at{" "}
                  <span className="font-mono">{new URL(destination.url).host}</span> and sent only
                  there.
                </>
              ) : (
                <>
                  Saved to <span className="font-mono text-foreground">{destination.path}</span> on{" "}
                  <span className="font-mono">{destination.computer}</span>.
                </>
              )}{" "}
              What you type is not put in the chat or shown to {agentName}.
            </p>
            {here ? null : <AskedElsewhere agentId={agentId} chatId={request.chatId} />}
          </div>
        </div>
        <div className="flex flex-col gap-3">
          {request.fields.map((field) => {
            const id = `secret-${request.id}-${field.name}`
            const visible = shown[field.name] === true
            return (
              <div key={field.name} className="flex min-w-0 flex-col gap-1">
                <Label htmlFor={id} className="font-mono text-xs" translate="no">
                  {destination.kind === "connector" ? "Access token" : field.name}
                </Label>
                {field.description === null ? null : (
                  <p className="text-xs text-muted-foreground">{field.description}</p>
                )}
                <div className="relative">
                  <Input
                    id={id}
                    name={field.name}
                    type={visible ? "text" : "password"}
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    data-1p-ignore
                    data-lpignore="true"
                    disabled={busy}
                    value={values[field.name] ?? ""}
                    onChange={(event) => {
                      setProblem(undefined)
                      setValues((current) => ({ ...current, [field.name]: event.target.value }))
                    }}
                    className="pr-10 font-mono"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="absolute top-1/2 right-1 size-7 -translate-y-1/2 text-muted-foreground"
                    aria-label={`${visible ? "Hide" : "Show"} ${field.name}`}
                    aria-pressed={visible}
                    disabled={busy}
                    onClick={() => setShown((current) => ({ ...current, [field.name]: !visible }))}
                  >
                    {visible ? <EyeSlashIcon /> : <EyeIcon />}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
        {error === undefined ? null : (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={busy}>
            {save.isPending ? "Saving…" : one ? "Save secret" : "Save secrets"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => decline.mutate()}
          >
            Not now
          </Button>
          {team?.kind === "team" ? (
            <span className="ml-auto self-center text-xs text-muted-foreground">
              Anyone in {team.name} can answer
            </span>
          ) : null}
        </div>
      </form>
    </li>
  )
}

/**
 * The form for a login an agent asked for, to sign in on a site with. It is kept by the
 * workspace and typed only on the sites named here, the one that asked always among them. What
 * is typed is held here only until it is sent, and forgotten when the form goes.
 */
function LoginForm({ agentId, agentName, request, site, here }: FormProps & { site: string }) {
  const team = useWorkspaceOfAgent(agentId)
  const api = client.agent(agentId)
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [sites, setSites] = useState<string[]>([site])
  const [typed, setTyped] = useState("")
  const [problem, setProblem] = useState<string | undefined>()
  const settle = () => queryClient.invalidateQueries({ queryKey: secretsKey(agentId) })
  const save = useMutation({
    mutationFn: (answer: { values: Record<string, string>; sites: string[] }) =>
      api.answerSecretRequest(request.id, answer.values, answer.sites),
    onSuccess: () => {
      setPassword("")
      // The workspace has one more login, wherever its list is on screen.
      if (team !== undefined) {
        void queryClient.invalidateQueries({ queryKey: savedLoginsKey(team.id) })
      }
    },
    onSettled: settle,
  })
  const decline = useMutation({
    mutationFn: () => api.declineSecretRequest(request.id),
    onSettled: settle,
  })
  const busy = save.isPending || decline.isPending
  const error = problem ?? save.error?.message ?? decline.error?.message
  const id = `login-${request.id}`
  return (
    <li className="rounded-2xl bg-card p-3.5 shadow-raised">
      <form
        className="flex flex-col gap-3"
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault()
          const answer = loginAnswer(site, { username, password, sites, site: typed })
          if ("problem" in answer) return setProblem(answer.problem)
          setProblem(undefined)
          save.mutate(answer)
        }}
      >
        <div className="flex items-start gap-2.5">
          <KeyIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-sm wrap-anywhere">
              <span className="font-medium">{agentName}</span> needs a login for{" "}
              <span className="font-medium">{site}</span>
            </p>
            {request.purpose === null ? null : (
              <p className="text-sm text-muted-foreground">“{request.purpose}”</p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              Kept encrypted by Do Computer. {agentName} can sign in with it on the sites below and
              cannot read it.
            </p>
            {here ? null : <AskedElsewhere agentId={agentId} chatId={request.chatId} />}
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor={`${id}-username`}>Username or email</Label>
          <Input
            id={`${id}-username`}
            name="username"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            disabled={busy}
            value={username}
            onChange={(event) => {
              setProblem(undefined)
              setUsername(event.target.value)
            }}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor={`${id}-password`}>Password</Label>
          <PasswordInput
            id={`${id}-password`}
            name="password"
            disabled={busy}
            value={password}
            onChange={(value) => {
              setProblem(undefined)
              setPassword(value)
            }}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Label id={`${id}-sites-label`} htmlFor={`${id}-sites`}>
            Used only on
          </Label>
          <SitesField
            id={`${id}-sites`}
            sites={sites}
            fixed={site}
            typed={typed}
            disabled={busy}
            onSites={setSites}
            onTyped={setTyped}
            onProblem={setProblem}
          />
        </div>
        {error === undefined ? null : (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={busy}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => decline.mutate()}
          >
            Not now
          </Button>
          {team?.kind === "team" ? (
            <span className="ml-auto self-center text-xs text-muted-foreground">
              Anyone in {team.name} can answer
            </span>
          ) : null}
        </div>
      </form>
    </li>
  )
}

/**
 * The secrets an agent is waiting for someone to type, as forms above the composer in every
 * chat of the agent, as what it asks leave for is.
 */
export function PendingSecrets({
  agentId,
  agentName,
  chatId,
}: {
  agentId: string
  agentName: string
  chatId: string
}) {
  const { data } = useQuery<SecretRequest[]>({
    queryKey: secretsKey(agentId),
    queryFn: () => client.agent(agentId).secretRequests(),
  })
  const workspace = useWorkspaceOfAgent(agentId)
  // A login is asked for only where the workspace keeps logins and this person may give one.
  const requests = (data ?? []).filter(
    (request) => request.destination.kind !== "login" || workspace?.savedLogins === true,
  )
  if (requests.length === 0) return null
  return (
    <ul
      aria-label="Secrets it asked for"
      className="mx-auto flex max-h-[60vh] w-full max-w-3xl flex-col gap-2 overflow-y-auto px-4 pb-2"
    >
      {requests.map((request) => {
        const { destination } = request
        const form = {
          agentId,
          agentName,
          request,
          here: request.chatId === chatId,
        }
        return destination.kind === "login" ? (
          <LoginForm key={request.id} {...form} site={destination.site} />
        ) : (
          <SecretForm key={request.id} {...form} destination={destination} />
        )
      })}
    </ul>
  )
}

/** A connector the agent added that someone has to sign in to before it can be used. */
function SignInCard({
  agentId,
  agentName,
  connector,
}: {
  agentId: string
  agentName: string
  connector: ConnectorSummary
}) {
  const api = client.agent(agentId)
  const settle = () => queryClient.invalidateQueries({ queryKey: connectorsKey(agentId) })
  const signIn = useMutation({
    mutationFn: () => api.reconnectConnector(connector.id),
    // The service is reached by leaving this page for it, and sends them back to this chat.
    // The desktop app sends its owner's browser there instead, and stays where it is.
    onSuccess: (result) => {
      if (result.authorizationUrl) window.location.assign(result.authorizationUrl)
    },
    onSettled: settle,
  })
  const dismiss = useMutation({
    mutationFn: () => api.dismissConnector(connector.id),
    onSettled: settle,
  })
  const busy = signIn.isPending || dismiss.isPending
  const error = signIn.error ?? dismiss.error
  return (
    <li className="flex flex-col gap-2.5 rounded-2xl bg-card p-3.5 shadow-raised">
      <div className="flex items-start gap-2.5">
        <PlugsConnectedIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            <span className="font-medium">{agentName}</span> added the connector{" "}
            <span className="font-medium">{connector.name}</span>, which needs you to sign in
          </p>
          <p className="text-xs wrap-anywhere text-muted-foreground">
            You sign in at <span className="font-mono">{new URL(connector.url).host}</span> and come
            back here. {agentName} never sees your password.
          </p>
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => signIn.mutate()}>
          Sign in
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => dismiss.mutate()}>
          Not now
        </Button>
      </div>
    </li>
  )
}

/**
 * The connectors an agent added that are waiting for someone to sign in, shown above the
 * composer in every chat of the agent.
 */
export function PendingSignIns({ agentId, agentName }: { agentId: string; agentName: string }) {
  const { data } = useQuery<ConnectorSummary[]>({
    queryKey: connectorsKey(agentId),
    queryFn: () => client.agent(agentId).connectors(),
  })
  const waiting = (data ?? []).filter(
    (connector) => connector.status === "needs_auth" && connector.askedIn !== undefined,
  )
  if (waiting.length === 0) return null
  return (
    <ul
      aria-label="Connectors to sign in to"
      className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 pb-2"
    >
      {waiting.map((connector) => (
        <SignInCard
          key={connector.id}
          agentId={agentId}
          agentName={agentName}
          connector={connector}
        />
      ))}
    </ul>
  )
}
