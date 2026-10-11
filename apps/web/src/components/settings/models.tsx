import type {
  ModelLogin,
  ModelLoginMethod,
  ModelLoginPrompt,
  ModelProvider,
  WorkspaceRole,
  WorkspaceSummary,
} from "@durable-computer/protocol"
import {
  ArrowSquareOutIcon,
  CaretDownIcon,
  CaretRightIcon,
  CheckIcon,
  CopyIcon,
  CpuIcon,
  KeyIcon,
} from "@phosphor-icons/react"
import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { type ReactNode, useEffect, useState } from "react"
import { useConfirm } from "@/components/confirm"
import { Loads } from "@/components/loads"
import { CardsPlaceholder } from "@/components/placeholders"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { client } from "@/lib/client"
import { modelProvidersKey, modelsKey, workspaceModelsKey } from "@/lib/collections"
import { queryClient } from "@/lib/query"

const good = "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
const heading = "pb-2.5 text-[0.8125rem] font-medium text-muted-foreground"

/**
 * What a way of signing in is called on a button. pi names them for a list in a terminal,
 * "Anthropic (Claude Pro/Max)", where the provider is already said beside the button here.
 */
export function short(method: ModelLoginMethod): string {
  const inside = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(method.label)
  const name =
    inside === null
      ? method.label.replace(/ OAuth$/, "")
      : inside[2] === "subscription"
        ? inside[1]!
        : inside[2]!
  return name.replace(/ subscription$/, "").replace("/", " or ")
}

/**
 * Where a sign-in is kept, and so whose agents it is for: a workspace, or the deployment
 * itself, whose sign-ins are for everyone's.
 */
export type Scope = Pick<WorkspaceSummary, "id" | "name"> & {
  kind: WorkspaceSummary["kind"] | "deployment"
  role: WorkspaceRole
}

/** The name the deployment's own sign-ins are kept under, where a workspace's id would be. */
const DEPLOYMENT: Scope = {
  id: "deployment",
  name: "This server",
  kind: "deployment",
  role: "owner",
}

/** Whose agents these are, in a sentence: a team's by its name, one's own as "your". */
const whose = (workspace: Scope) =>
  workspace.kind === "deployment"
    ? "everyone's"
    : workspace.kind === "team"
      ? `${workspace.name}'s`
      : "your"

const day = (at: number) =>
  new Date(at).toDateString() === new Date().toDateString()
    ? "today"
    : `on ${new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`

/** A provider's mark, where a face would be: its first letter. */
function Mark({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden
      className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-sm font-semibold text-muted-foreground"
    >
      {children}
    </span>
  )
}

/** One step of a sign-in that has two: its number, what to do, and what it needs. */
function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3.5">
      <span
        aria-hidden
        className="mt-px grid size-6.5 shrink-0 place-items-center rounded-full border border-input text-xs font-semibold"
      >
        {number}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h3 className="font-medium">{title}</h3>
        {children}
      </div>
    </li>
  )
}

/** A provider's own choices, said the way they turn out from a page. Others keep pi's words. */
const WAYS: Record<string, { label: string; description: string }> = {
  browser: {
    label: "On a sign-in page",
    description: "Its page ends at an address that you paste back here.",
  },
  device_code: {
    label: "With a code",
    description: "Enter a short code on its page. Nothing to paste back.",
  },
}

/** What is pasted back from a provider's page, where a sign-in asks for that: by its name. */
const pasted = (prompt: ModelLoginPrompt) =>
  prompt.type !== "manual_code"
    ? undefined
    : /localhost|127\.0\.0\.1/.test(prompt.placeholder ?? "")
      ? "The address you end up at"
      : "The code it shows"

/** What a sign-in asks to be typed: a key, or what the provider's page ended with. */
function Typed({
  prompt,
  provider,
  title,
  value,
  onChange,
}: {
  prompt: ModelLoginPrompt
  provider: ModelProvider
  /** What the window is called. A field that would only say the same again says "Key". */
  title: string
  value: string
  onChange: (value: string) => void
}) {
  // A page that ends at an address on the person's own machine, which does not load from here.
  const address = /localhost|127\.0\.0\.1/.test(prompt.placeholder ?? "")
  const secret = prompt.type === "secret"
  const asked = prompt.message.replace(/^Enter /, "").replace(/:$/, "")
  const label = asked === title ? "Key" : asked
  return (
    <div className="flex flex-col gap-1.5">
      {/* What a provider's page ends with is named by the step it is in. */}
      {prompt.type === "manual_code" ? null : (
        <Label htmlFor="model-sign-in-answer" className="first-letter:uppercase">
          {label}
        </Label>
      )}
      <Input
        id="model-sign-in-answer"
        aria-label={pasted(prompt)}
        required
        autoFocus
        autoComplete="off"
        spellCheck={false}
        type={secret ? "password" : "text"}
        className="font-mono"
        placeholder={prompt.placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="text-xs text-muted-foreground">
        {prompt.type !== "manual_code"
          ? secret
            ? "Kept on the server and never shown again. Agents never see it."
            : null
          : address
            ? `After you sign in, the tab goes to an address that starts with localhost and does not load. That is expected. Copy the whole address from the address bar.`
            : `${provider.name}'s page shows it once you have signed in.`}
      </p>
    </div>
  )
}

/**
 * Signing a workspace in to a provider, one way: a window that follows the provider's own
 * steps as the server leads them. What there is to show changes as it goes, so this draws
 * whatever the sign-in says it is at: a choice, a page to open, a code to enter there,
 * something to type here.
 */
export function ModelSignIn({
  workspace,
  provider,
  method,
  onClose,
}: {
  workspace: Scope
  provider: ModelProvider
  method: ModelLoginMethod
  onClose: () => void
}) {
  const [login, setLogin] = useState<ModelLogin>()
  const [failure, setFailure] = useState<string>()
  const [value, setValue] = useState("")
  const [copied, setCopied] = useState(false)
  /** Goes up to start the sign-in over. */
  const [attempt, setAttempt] = useState(0)
  /** Whether a choice of how was made, which starting over undoes. */
  const [chose, setChose] = useState(false)

  // Start it, then follow it: each answer from the server is held until there is something new.
  useEffect(() => {
    const api = client.workspace(workspace.id)
    let gone = false
    let current: ModelLogin | undefined
    setLogin(undefined)
    setFailure(undefined)
    setValue("")
    setChose(false)
    void (async () => {
      try {
        current = await api.startModelLogin({ providerId: provider.id, type: method.type })
        // Left while it was starting: it is stopped now that there is something to stop.
        if (gone) void api.cancelModelLogin(current.id).catch(() => {})
        while (!gone) {
          const next = current
          setLogin((shown) => (shown === undefined || next.rev >= shown.rev ? next : shown))
          if (current.status !== "waiting") return
          current = await api.modelLogin(current.id, { rev: current.rev, waitMs: 20_000 })
        }
      } catch (error) {
        if (!gone) setFailure(error instanceof Error ? error.message : String(error))
      }
    })()
    return () => {
      gone = true
      // Left before it was done: the server need not go on waiting for it.
      if (current?.status === "waiting") void api.cancelModelLogin(current.id).catch(() => {})
    }
  }, [workspace.id, provider.id, method.type, attempt])

  const answer = useMutation({
    mutationFn: (input: { promptId: string; value: string }) =>
      client.workspace(workspace.id).answerModelLogin(login!.id, input),
    onSuccess: (next) => {
      setValue("")
      setLogin((shown) => (shown === undefined || next.rev >= shown.rev ? next : shown))
    },
  })

  const done = login?.status === "done"
  useEffect(() => {
    if (!done) return
    // What the workspace's agents can run on has changed with it.
    void queryClient.invalidateQueries({ queryKey: modelProvidersKey(workspace.id) })
    void queryClient.invalidateQueries({ queryKey: modelsKey })
    onClose()
  }, [done, workspace.id, onClose])

  const way = short(method)
  const key = method.type === "api_key"
  const title = key ? method.label : `Sign in with ${way}`
  const description = key
    ? `Paid for by the token, on your account with ${provider.name}.`
    : method.subscription
      ? `Use a ${way} subscription for ${whose(workspace)} agents.`
      : `Use your own ${provider.name} account for ${whose(workspace)} agents.`
  const shared =
    workspace.kind === "deployment"
      ? "Everyone on this server can then set agents to these models, and what the agents use counts against your account there."
      : workspace.kind === "team"
        ? `Everyone in ${workspace.name} can then set agents to these models, and what the agents use counts against your account there.`
        : "Your agents can then be set to these models, and what they use counts against your account there."
  const prompt = login?.prompt ?? null
  const problem =
    failure ?? (login?.status === "failed" ? (login.error ?? "It failed.") : undefined)
  const again = (
    <Button type="button" variant="ghost" onClick={() => setAttempt((count) => count + 1)}>
      Choose another way
    </Button>
  )
  const cancel = (
    <Button type="button" variant="outline" onClick={onClose}>
      Cancel
    </Button>
  )

  let body: ReactNode
  if (problem !== undefined) {
    body = (
      <>
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
        <div className="flex items-center justify-end gap-2">
          {cancel}
          <Button type="button" onClick={() => setAttempt((count) => count + 1)}>
            Try again
          </Button>
        </div>
      </>
    )
  } else if (login === undefined) {
    body = (
      <p className="flex items-center gap-2 text-muted-foreground">
        <Spinner />
        Starting…
      </p>
    )
  } else if (prompt?.type === "select") {
    body = (
      <>
        <div role="group" aria-label={prompt.message} className="flex flex-col gap-2">
          {(prompt.options ?? []).map((option) => {
            const words = WAYS[option.id] ?? {
              label: option.label,
              description: option.description,
            }
            return (
              <button
                key={option.id}
                type="button"
                disabled={answer.isPending}
                className="rounded-xl border px-3.5 py-3 text-left outline-none hover:bg-accent focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
                onClick={() => {
                  setChose(true)
                  answer.mutate({ promptId: prompt.id, value: option.id })
                }}
              >
                <span className="block font-medium">{words.label}</span>
                {words.description === undefined ? null : (
                  <span className="block text-sm text-muted-foreground">{words.description}</span>
                )}
              </button>
            )
          })}
        </div>
        <div className="flex justify-end">{cancel}</div>
      </>
    )
  } else {
    const open =
      login.authUrl === null ? null : (
        <Button
          variant="outline"
          className="self-start"
          render={<a href={login.authUrl.url} target="_blank" rel="noreferrer" />}
        >
          Open the sign-in page
          <ArrowSquareOutIcon data-icon="inline-end" />
        </Button>
      )
    const typed =
      prompt === null ? null : (
        <Typed
          prompt={prompt}
          provider={provider}
          title={title}
          value={value}
          onChange={setValue}
        />
      )
    body = (
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault()
          if (prompt !== null) answer.mutate({ promptId: prompt.id, value })
        }}
      >
        {open !== null && typed !== null ? (
          <ol className="flex flex-col gap-5">
            <Step number={1} title={`Sign in at ${provider.name}`}>
              <p className="text-sm text-muted-foreground">
                {provider.name}'s page opens in a new tab. Sign in there and allow access.
              </p>
              {open}
            </Step>
            <Step
              number={2}
              title={`Paste ${(pasted(prompt!) ?? "what it ends with").toLowerCase()}`}
            >
              {typed}
            </Step>
          </ol>
        ) : (
          <>
            {open}
            {typed}
          </>
        )}
        {login.deviceCode === null ? null : (
          <div className="flex flex-col gap-3">
            <output
              aria-label="The code to enter"
              className="rounded-xl border bg-surface py-4 text-center font-mono text-3xl font-semibold tracking-widest select-all"
            >
              {login.deviceCode.userCode}
            </output>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                render={
                  <a href={login.deviceCode.verificationUri} target="_blank" rel="noreferrer" />
                }
              >
                Open the page to enter it
                <ArrowSquareOutIcon data-icon="inline-end" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  void navigator.clipboard?.writeText(login.deviceCode!.userCode)
                  setCopied(true)
                }}
              >
                {copied ? (
                  <CheckIcon data-icon="inline-start" />
                ) : (
                  <CopyIcon data-icon="inline-start" />
                )}
                {copied ? "Copied" : "Copy the code"}
              </Button>
            </div>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner />
              Waiting for you to enter it there. This closes by itself.
            </p>
          </div>
        )}
        {login.notes.map((note) => (
          <p key={note.message} className="text-sm text-muted-foreground">
            {note.message}
          </p>
        ))}
        {prompt === null && login.deviceCode === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            {login.progress ?? "Working…"}
          </p>
        ) : null}
        {answer.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {answer.error.message}
          </p>
        ) : null}
        <p className="text-xs leading-relaxed text-muted-foreground">
          {shared}
          {provider.id === "anthropic" && !key
            ? " Anthropic decides how use outside its own apps is billed; it may count as extra usage."
            : null}
        </p>
        <div className="flex items-center gap-2">
          {chose ? again : null}
          <span className="flex-1" />
          {cancel}
          {prompt === null ? null : (
            <Button type="submit" disabled={answer.isPending || value.trim() === ""}>
              {answer.isPending ? "Checking…" : key ? "Save" : "Sign in"}
            </Button>
          )}
        </div>
      </form>
    )
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent showCloseButton={false} className="gap-5 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  )
}

/** What a provider offers, in a few words, for one the workspace is not signed in to. */
function offer(provider: ModelProvider, deployment: boolean): string {
  if (deployment) return "Already here. Sign in to use your own account."
  const account = provider.methods.find((method) => method.type === "oauth")
  const key = provider.methods.some((method) => method.type === "api_key")
  const first =
    account === undefined ? undefined : account.subscription ? "A subscription" : "An account"
  return `${[first, key ? (first === undefined ? "A key" : "a key") : undefined]
    .filter((part) => part !== undefined)
    .join(" or ")}.`
}

function ProviderRow({
  provider,
  workspace,
  meId,
  deployment,
  onSignIn,
  onSignOut,
  busy,
}: {
  provider: ModelProvider
  workspace: Scope
  meId: string
  /** Whether the deployment already offers this provider's models, on its own key. */
  deployment: boolean
  onSignIn: (method: ModelLoginMethod) => void
  onSignOut: () => void
  busy: boolean
}) {
  const { signedIn } = provider
  const method = provider.methods.find((entry) => entry.type === signedIn?.type)
  // Whoever signed in can sign out, since it is theirs, and so can an admin of the team.
  const maySignOut = workspace.role !== "member" || signedIn?.byId === meId
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3.5">
      <Mark>{provider.name[0]}</Mark>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 font-medium">
          <span className="truncate">{provider.name}</span>
          {signedIn === null ? null : (
            <Badge variant="secondary" className={good}>
              Signed in
            </Badge>
          )}
        </p>
        <p className="text-sm text-muted-foreground">
          {signedIn === null
            ? offer(provider, deployment)
            : [
                signedIn.type === "api_key"
                  ? "A key"
                  : method?.subscription
                    ? `${short(method)} subscription`
                    : "An account",
                `by ${signedIn.byId === meId ? "you" : (signedIn.by ?? "someone")}, ${day(signedIn.at)}`,
                `${signedIn.models} model${signedIn.models === 1 ? "" : "s"}`,
              ].join(" · ")}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {signedIn !== null ? (
          maySignOut ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              disabled={busy}
              onClick={onSignOut}
            >
              Sign out
            </Button>
          ) : null
        ) : (
          provider.methods.map((entry) =>
            entry.type === "oauth" ? (
              <Button key="oauth" size="sm" variant="outline" onClick={() => onSignIn(entry)}>
                Sign in with {short(entry)}
              </Button>
            ) : (
              <Button
                key="key"
                size="sm"
                variant="ghost"
                className="text-muted-foreground"
                aria-label={`Use a key for ${provider.name}`}
                onClick={() => onSignIn(entry)}
              >
                <KeyIcon data-icon="inline-start" />
                Use a key
              </Button>
            ),
          )
        )}
      </div>
    </li>
  )
}

/**
 * The providers there are, each with the ways of signing a workspace in to it, the ones most
 * asked for first and the rest behind one line. Signing in is a window over it.
 */
export function ModelProviderList({
  workspace,
  meId,
  through = [],
}: {
  workspace: Scope
  meId: string
  /** The providers the deployment already offers models of, on its own account, by name. */
  through?: readonly string[]
}) {
  const { data: providers } = useSuspenseQuery({
    queryKey: modelProvidersKey(workspace.id),
    queryFn: () => client.workspace(workspace.id).modelProviders(),
  })
  const [more, setMore] = useState(false)
  const [signingIn, setSigningIn] = useState<{
    provider: ModelProvider
    method: ModelLoginMethod
  }>()
  const [confirm, confirming] = useConfirm()
  const signOut = useMutation({
    mutationFn: (providerId: string) =>
      client.workspace(workspace.id).signOutOfModelProvider(providerId),
    onSuccess: (next) => {
      queryClient.setQueryData(modelProvidersKey(workspace.id), next)
      void queryClient.invalidateQueries({ queryKey: modelsKey })
    },
  })
  const server = workspace.kind === "deployment"
  // With none set apart, as where there are only a few, all of them are shown.
  const any = providers.some((provider) => provider.featured)
  const first = providers.filter(
    (provider) => !any || provider.featured || provider.signedIn !== null,
  )
  const rest = providers.filter((provider) => !first.includes(provider))
  const row = (provider: ModelProvider) => (
    <ProviderRow
      key={provider.id}
      provider={provider}
      workspace={workspace}
      meId={meId}
      deployment={!server && through.includes(provider.name)}
      busy={signOut.isPending}
      onSignIn={(method) => setSigningIn({ provider, method })}
      onSignOut={async () => {
        const agreed = await confirm({
          title: `Sign out of ${provider.name}?`,
          description: server
            ? "Agents set to one of its models stop answering until they are set to another."
            : "An agent set to one of its models stops answering until it is set to another.",
          action: "Sign out",
          destructive: true,
        })
        if (agreed) signOut.mutate(provider.id)
      }}
    />
  )
  return (
    <>
      <ul className="divide-y rounded-2xl border">
        {first.map(row)}
        {more ? rest.map(row) : null}
        {rest.length === 0 ? null : (
          <li>
            <button
              type="button"
              aria-expanded={more}
              className="flex w-full items-center gap-1.5 px-3.5 py-2.5 text-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:bg-accent"
              onClick={() => setMore(!more)}
            >
              {more ? <CaretDownIcon /> : <CaretRightIcon />}
              {more ? "Fewer" : `${rest.length} more`}
            </button>
          </li>
        )}
      </ul>
      {signOut.isError ? (
        <p role="alert" className="pt-2 text-sm text-destructive">
          {signOut.error.message}
        </p>
      ) : null}
      {signingIn === undefined ? null : (
        <ModelSignIn
          workspace={workspace}
          provider={signingIn.provider}
          method={signingIn.method}
          onClose={() => setSigningIn(undefined)}
        />
      )}
      {confirming}
    </>
  )
}

function Section({ workspace, meId }: { workspace: Scope; meId: string }) {
  const server = workspace.kind === "deployment"
  const { data: models } = useQuery({
    queryKey: workspaceModelsKey(workspace.id),
    // The deployment's own are among what anyone can choose, wherever they are.
    queryFn: () => client.models(server ? undefined : workspace.id),
    staleTime: Number.POSITIVE_INFINITY,
  })
  // The deployment's own models: the ones nobody signed in for.
  const own = (models ?? []).filter((model) => model.signIn === undefined)
  const through = [...new Set(own.map((model) => model.provider).filter(Boolean))] as string[]
  return (
    <>
      {models === undefined ? null : (
        <div className="flex items-center gap-3 rounded-2xl border p-3.5">
          <Mark>
            <CpuIcon />
          </Mark>
          <div className="min-w-0 flex-1">
            <p className="font-medium">Do Computer's models</p>
            <p className="text-sm text-muted-foreground">
              {through.length === 0
                ? "A built-in echo model that repeats what it is told: this deployment has no model key and is signed in to nothing."
                : `${own.length} model${own.length === 1 ? "" : "s"} through ${through.join(" and ")}, ${
                    server ? "offered to everyone" : "paid for by this deployment. Always there"
                  }.`}
            </p>
          </div>
        </div>
      )}
      <section aria-label="Model providers">
        <h3 className={heading}>Model providers</h3>
        <ModelProviderList workspace={workspace} meId={meId} through={through} />
        <p className="pt-2 text-xs text-muted-foreground">
          {server
            ? "A sign-in here is the server's: everyone's agents can then be set to its models, and what they use counts against whoever signed in. Where the server's settings name the models it offers, only those of them are."
            : workspace.kind === "team"
              ? `A sign-in belongs to the workspace: everyone in ${workspace.name} can then set agents to its models, and what the agents use counts against whoever signed in.`
              : "A sign-in belongs to this workspace: your agents here can then be set to its models."}{" "}
          Nobody is shown a key or a token again, and agents never see one.
        </p>
      </section>
    </>
  )
}

/**
 * The models a workspace's agents can run on: the deployment's own, and those of the providers
 * the workspace is signed in to, with a subscription someone in it has or with a key.
 */
export function ModelsSettings({ workspace, meId }: { workspace: WorkspaceSummary; meId: string }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Models</h2>
        <p className="text-sm text-muted-foreground">
          What {whose(workspace)} agents can run on. Sign in with a subscription or a key, and every
          agent of the workspace can be set to its models.
        </p>
      </div>
      <Loads key={workspace.id} fallback={<CardsPlaceholder cards={3} />}>
        <Section workspace={workspace} meId={meId} />
      </Loads>
    </div>
  )
}

/**
 * What the deployment itself offers everyone's agents, for whoever looks after it: the same
 * sign-ins a workspace has, kept for all of them.
 */
export function ServerModelsSettings({ meId }: { meId: string }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Server models</h2>
        <p className="text-sm text-muted-foreground">
          What everyone's agents can run on without signing in to anything. Sign the server in with
          a subscription or a key, and its models are offered to every workspace.
        </p>
      </div>
      <Loads fallback={<CardsPlaceholder cards={3} />}>
        <Section workspace={DEPLOYMENT} meId={meId} />
      </Loads>
    </div>
  )
}
