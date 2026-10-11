import {
  type AgentSummary,
  type ComputerKind,
  type ComputerSummary,
  isPersonalWorkspace,
  PAIRED_COMPUTER,
  type WorkspaceSummary,
} from "@durable-computer/protocol"
import { ArrowsClockwiseIcon, CopyIcon, PlusIcon, TrashIcon, XIcon } from "@phosphor-icons/react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useRef, useState } from "react"
import { AgentFace } from "@/components/agent-avatar"
import {
  ComputerRequestCard,
  useAgentsById,
  useComputerRequests,
} from "@/components/computer-requests"
import { ComputerPicker } from "@/components/computer-picker"
import { useConfirm } from "@/components/confirm"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CardsPlaceholder } from "@/components/placeholders"
import { client } from "@/lib/client"
import { computerKindsKey, computersKey } from "@/lib/collections"
import { queryClient } from "@/lib/query"
import { cn } from "@/lib/utils"
import { useWorkspaces, workspaceOptionsKey } from "@/lib/workspaces"

const PLATFORMS: Record<string, string> = { darwin: "macOS", linux: "Linux", win32: "Windows" }

function ago(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`
}

function ComputerCard({
  computer,
  meId,
  agentId,
  workspaces,
  agents,
  kinds,
}: {
  computer: ComputerSummary
  meId: string
  /** The agent on screen, which is offered first. */
  agentId: string | undefined
  workspaces: readonly WorkspaceSummary[]
  agents: ReadonlyMap<string, AgentSummary>
  /** The kinds of machine this server makes, for what to call one. */
  kinds: readonly ComputerKind[]
}) {
  const settled = () => queryClient.invalidateQueries({ queryKey: computersKey })
  const remove = useMutation({
    mutationFn: () => client.removeComputer(computer.id),
    onSettled: settled,
  })
  const move = useMutation({
    mutationFn: (workspaceId: string) => client.moveComputer(computer.id, workspaceId),
    onSettled: settled,
  })
  const connect = useMutation({
    mutationFn: (agentId: string) => client.connectComputer(computer.id, agentId),
    onSettled: settled,
  })
  const disconnect = useMutation({
    mutationFn: (agentId: string) => client.disconnectComputer(computer.id, agentId),
    onSettled: settled,
  })
  const update = useMutation({
    mutationFn: () => client.updateComputerDaemon(computer.id),
    onSettled: settled,
  })
  const share = useMutation({
    mutationFn: (access: ComputerSummary["access"]) =>
      client.setComputerAccess(computer.id, access),
    onSettled: settled,
  })
  // A machine the app made for a workspace, as opposed to one somebody paired.
  const machine = computer.kind !== PAIRED_COMPUTER
  // Agents are connected one by one to a paired computer, and to a machine that is not open to
  // all of them. A machine that cannot be shared keeps the one agent it was made for.
  const chosen = machine ? computer.shareable && computer.access === "chosen" : true
  const personal = isPersonalWorkspace(computer.workspaceId)
  const mine = computer.pairedBy.id === meId
  const team = workspaces.find((workspace) => workspace.id === computer.workspaceId)
  const teams = workspaces.filter((workspace) => workspace.kind === "team")
  const everyone = `Every agent in ${personal ? "your workspace" : (team?.name ?? "the team")}`
  // One's own computer serves any agent one can use; a team's, and any machine, serves the
  // agents of its workspace.
  const connectable = chosen
    ? [...agents.values()]
        .filter(
          (agent) =>
            !computer.agentIds.includes(agent.id) &&
            ((personal && !machine) || agent.workspaceId === computer.workspaceId),
        )
        .sort((a, b) => Number(b.id === agentId) - Number(a.id === agentId))
    : []
  const problem = [remove, move, connect, disconnect, share, update].find(
    (mutation) => mutation.isError,
  )?.error
  const busy =
    move.isPending ||
    connect.isPending ||
    disconnect.isPending ||
    remove.isPending ||
    share.isPending ||
    update.isPending
  // A daemon from before daemons kept themselves up to date. It can be replaced from here by
  // whoever may remove the computer, unless it is read-only and so runs nothing it is sent.
  const stale = !machine && computer.online && computer.daemon === "outdated"
  const updatable = stale && computer.canManage && !computer.readOnly
  const [confirm, confirming] = useConfirm()
  const owners = workspaces.map((workspace) => ({
    value: workspace.id,
    label: workspace.kind === "personal" ? "You" : workspace.name,
  }))
  const open = [
    { value: "open", label: everyone },
    { value: "chosen", label: "Chosen agents" },
  ]
  return (
    <li>
      <Card>
        <CardHeader>
          <CardTitle className="font-mono text-[0.9375rem]">
            <h2 className="truncate">{computer.name}</h2>
          </CardTitle>
          <CardDescription>
            {machine ? (
              (kinds.find((kind) => kind.id === computer.kind)?.label ?? computer.kind)
            ) : (
              <>
                {PLATFORMS[computer.platform] ?? computer.platform} · {computer.hostname}
                {computer.readOnly ? " · read-only" : ""}
                {computer.screen ? " · screen" : ""}
                {computer.browser ? " · browser" : ""}
              </>
            )}
          </CardDescription>
          {/* A machine is started when an agent works on it, so it is never offline. */}
          {machine ? null : (
            <CardAction>
              <Badge
                variant="secondary"
                className={cn(
                  "gap-1.5",
                  computer.online
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                    : "bg-muted text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    computer.online ? "bg-emerald-500" : "bg-muted-foreground",
                  )}
                />
                {computer.online ? "Online" : "Offline"}
              </Badge>
            </CardAction>
          )}
        </CardHeader>

        <CardContent>
          <dl className="grid grid-cols-[5.5rem_1fr] items-center gap-x-3 gap-y-2.5 text-sm">
            <dt className="text-muted-foreground">Belongs to</dt>
            <dd className="min-w-0">
              {!machine && mine && teams.length > 0 ? (
                // Whoever paired it says whose it is: it is their account there that agents act as.
                <Select
                  items={owners}
                  value={computer.workspaceId}
                  disabled={busy}
                  onValueChange={async (next) => {
                    const to = workspaces.find((workspace) => workspace.id === next)
                    if (to === undefined || to.id === computer.workspaceId) return
                    const losing = computer.agentIds.filter(
                      (id) => to.kind === "team" && agents.get(id)?.workspaceId !== to.id,
                    )
                    if (
                      losing.length > 0 &&
                      !(await confirm({
                        title: `Give ${computer.name} to ${to.name}?`,
                        description: `Agents outside ${to.name} will be disconnected from it.`,
                        action: `Give to ${to.name}`,
                      }))
                    ) {
                      return
                    }
                    move.mutate(to.id)
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    aria-label={`Who ${computer.name} belongs to`}
                    className="max-w-full"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {owners.map((owner) => (
                        <SelectItem key={owner.value} value={owner.value}>
                          {owner.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              ) : personal ? (
                "You"
              ) : (
                <>
                  {team?.name ?? "A team"}
                  <span className="text-muted-foreground">
                    {" "}
                    · {machine ? "added" : "paired"} by {mine ? "you" : computer.pairedBy.name}
                  </span>
                </>
              )}
            </dd>
            {machine && computer.shareable ? (
              <>
                <dt className="text-muted-foreground">Open to</dt>
                <dd className="min-w-0">
                  <Select
                    items={open}
                    value={computer.access}
                    disabled={busy}
                    onValueChange={(next) => share.mutate(next === "open" ? "open" : "chosen")}
                  >
                    <SelectTrigger
                      size="sm"
                      aria-label={`Who can use ${computer.name}`}
                      className="max-w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {open.map((choice) => (
                          <SelectItem key={choice.value} value={choice.value}>
                            {choice.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </dd>
              </>
            ) : null}
            <dt className="self-start pt-1 text-muted-foreground">Agents</dt>
            <dd className="flex min-w-0 flex-wrap items-center gap-1.5">
              {computer.agentIds.map((id) => {
                const agent = agents.get(id)
                const name = agent?.name ?? "New agent"
                const folder = computer.folders.find((entry) => entry.agentId === id)?.path
                return (
                  <span
                    key={id}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg border bg-background py-0.5 pl-1.5",
                      chosen ? "pr-0.5" : "min-h-7 pr-2",
                    )}
                  >
                    {agent === undefined ? null : (
                      <AgentFace agent={agent} className="size-5" still />
                    )}
                    <span className="max-w-40 truncate">{name}</span>
                    {folder === undefined ? null : (
                      <span
                        title={`${name}’s folder on ${computer.name}`}
                        className="max-w-48 truncate font-mono text-xs text-muted-foreground"
                      >
                        {folder}
                      </span>
                    )}
                    {chosen ? (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="size-6 text-muted-foreground"
                        disabled={busy}
                        aria-label={`Disconnect ${name} from ${computer.name}`}
                        onClick={() => disconnect.mutate(id)}
                      >
                        <XIcon />
                      </Button>
                    ) : null}
                  </span>
                )
              })}
              {connectable.length > 0 ? (
                // Not a choice that is kept: each agent picked is connected, and leaves the list.
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        size="sm"
                        variant="outline"
                        className="font-normal text-muted-foreground"
                        disabled={busy}
                        aria-label={`Connect an agent to ${computer.name}`}
                      />
                    }
                  >
                    <PlusIcon />
                    {computer.agentIds.length === 0 ? "Connect an agent…" : "Connect another…"}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-auto max-w-72">
                    {connectable.map((agent) => (
                      <DropdownMenuItem key={agent.id} onClick={() => connect.mutate(agent.id)}>
                        <AgentFace agent={agent} className="size-5" still />
                        <span className="min-w-0 flex-1 truncate">{agent.name ?? "New agent"}</span>
                        {personal && teams.length > 0 ? (
                          <span className="text-xs font-normal text-muted-foreground">
                            {workspaces.find((workspace) => workspace.id === agent.workspaceId)
                              ?.name ?? ""}
                          </span>
                        ) : null}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : computer.agentIds.length === 0 ? (
                <span className="text-muted-foreground">None yet</span>
              ) : null}
            </dd>
          </dl>
        </CardContent>

        <CardFooter className="gap-2">
          <p className="text-sm text-muted-foreground">
            {machine && !computer.shareable
              ? "It keeps its files with its agent, so no other agent can work on it."
              : machine && computer.access === "open"
                ? `${everyone} can work on it, each in a folder of its own.`
                : computer.online
                  ? stale
                    ? update.isSuccess
                      ? "Its daemon is being replaced. It will be back in a moment."
                      : updatable
                        ? "Its daemon is out of date and does not update itself. Update it from here, or run the install command there again."
                        : "Its daemon is out of date and does not update itself. Run the install command there again."
                    : computer.agentIds.length === 0
                      ? "No agent can work on it until one is connected. An agent can also ask."
                      : "Its agents can work on it now."
                  : computer.lastSeenAt
                    ? `Last connected ${ago(computer.lastSeenAt)}. Start the daemon there to bring it back.`
                    : "Its daemon has not connected yet."}
          </p>
          {updatable && !update.isSuccess ? (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto shrink-0"
              disabled={busy}
              aria-label={`Update the daemon on ${computer.name}`}
              onClick={() => update.mutate()}
            >
              <ArrowsClockwiseIcon /> {update.isPending ? "Updating…" : "Update"}
            </Button>
          ) : null}
          {/* One whose files are with its agent goes when the agent is deleted, and not before. */}
          {computer.canManage && (!machine || computer.shareable) ? (
            <Button
              size="sm"
              variant="ghost"
              className={cn(
                "shrink-0 text-muted-foreground",
                !(updatable && !update.isSuccess) && "ml-auto",
              )}
              disabled={busy}
              aria-label={`Remove ${computer.name}`}
              onClick={async () => {
                // Removing a paired computer only ends access to it. Removing a machine ends the
                // machine.
                if (
                  machine &&
                  !(await confirm({
                    title: `Delete ${computer.name}?`,
                    description:
                      "The machine and everything on it is deleted. This cannot be undone.",
                    action: "Delete",
                    destructive: true,
                  }))
                ) {
                  return
                }
                remove.mutate()
              }}
            >
              <TrashIcon /> Remove
            </Button>
          ) : null}
        </CardFooter>
        {problem ? (
          <CardContent>
            <p role="alert" className="text-sm text-destructive">
              {problem.message}
            </p>
          </CardContent>
        ) : null}
      </Card>
      {confirming}
    </li>
  )
}

function Command({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState<string>()
  const code = useRef<HTMLElement>(null)
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2 rounded-lg border bg-background py-1.5 pr-1.5 pl-3">
        <code
          ref={code}
          className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs"
        >
          {command}
        </code>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Copy command"
          onClick={async () => {
            // The clipboard is only offered to pages on https or localhost. Elsewhere, select
            // the command so that one key press copies it.
            const copied = await navigator.clipboard
              ?.writeText(command)
              .then(() => true)
              .catch(() => false)
            if (copied) {
              setCopied("Copied")
            } else {
              const selection = window.getSelection()
              if (code.current && selection) selection.selectAllChildren(code.current)
              setCopied("Selected. Press Ctrl+C or ⌘C to copy.")
            }
            setTimeout(() => setCopied(undefined), 2500)
          }}
        >
          <CopyIcon />
        </Button>
      </div>
      {copied ? <p className="text-xs text-muted-foreground">{copied}</p> : null}
    </div>
  )
}

/**
 * Adding a machine to a workspace: the app makes it at a provider, and every agent of the
 * workspace can work on it until someone says otherwise.
 */
function AddComputer({
  kinds,
  preferred,
  workspaceId,
  workspaces,
}: {
  /** The kinds that can be added. There is at least one. */
  kinds: readonly ComputerKind[]
  /** The kind to start on, if it is one of them. */
  preferred: string | undefined
  /** The workspace the settings are open for. Without one, the user says which. */
  workspaceId: string | undefined
  workspaces: readonly WorkspaceSummary[]
}) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState(
    () => kinds.find((entry) => entry.id === preferred)?.id ?? kinds[0]!.id,
  )
  const [name, setName] = useState("")
  const [picked, setPicked] = useState<string>()
  // One's own workspace unless another is said, which is also what the server takes none to mean.
  const to =
    workspaceId ?? picked ?? workspaces.find((workspace) => workspace.kind === "personal")?.id
  const add = useMutation({
    mutationFn: () =>
      client.addComputer({
        kind,
        // As when pairing: one's own workspace is meant by naming none.
        ...(to === undefined || isPersonalWorkspace(to) ? {} : { workspaceId: to }),
        ...(name.trim() ? { name: name.trim() } : {}),
      }),
    onSuccess: () => {
      setOpen(false)
      setName("")
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: computersKey }),
  })
  const owners = workspaces.map((workspace) => ({
    value: workspace.id,
    label: workspace.kind === "personal" ? "You" : workspace.name,
  }))
  if (!open) {
    return (
      <Button variant="outline" className="self-start" onClick={() => setOpen(true)}>
        <PlusIcon /> Add a computer
      </Button>
    )
  }
  return (
    <form
      aria-labelledby="add-computer"
      className="flex flex-col gap-3 rounded-2xl bg-card shadow-raised p-4"
      onSubmit={(event) => {
        event.preventDefault()
        add.mutate()
      }}
    >
      <div>
        <h2 id="add-computer" className="text-sm font-medium">
          Add a computer
        </h2>
        <p className="text-sm text-muted-foreground">
          A machine made here for the workspace. Every agent in it can work there, each in a folder
          of its own, until you choose which ones may.
        </p>
      </div>
      {kinds.length > 1 ? (
        <ComputerPicker
          label="Kind of computer"
          kinds={kinds}
          value={kind}
          disabled={add.isPending}
          onChange={setKind}
        />
      ) : (
        <p className="text-sm">
          <span className="font-medium">{kinds[0]!.label}</span>{" "}
          <span className="text-muted-foreground">{kinds[0]!.description}</span>
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="add-computer-name">Name</Label>
        <Input
          id="add-computer-name"
          autoComplete="off"
          placeholder="Left empty, it is given one"
          className="font-mono"
          value={name}
          disabled={add.isPending}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      {workspaceId === undefined && workspaces.length > 1 ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="add-computer-workspace">For</Label>
          <Select
            items={owners}
            value={to ?? null}
            disabled={add.isPending}
            onValueChange={(next) => setPicked(next ?? undefined)}
          >
            <SelectTrigger id="add-computer-workspace" size="sm" className="max-w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {owners.map((owner) => (
                  <SelectItem key={owner.value} value={owner.value}>
                    {owner.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      ) : null}
      {add.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {add.error.message}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={add.isPending}>
          {add.isPending ? "Adding…" : "Add computer"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={add.isPending}
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}

/**
 * Whether the browser the workspace's agents use on a computer is shown there. Everyone in the
 * workspace sees what was chosen; those who may not change it see it as it is.
 */
function ShownBrowser({ workspaceId }: { workspaceId: string }) {
  const { data: options } = useQuery({
    queryKey: workspaceOptionsKey(workspaceId),
    queryFn: () => client.workspace(workspaceId).options(),
  })
  const save = useMutation({
    mutationFn: (showBrowser: boolean) => client.workspace(workspaceId).setOptions({ showBrowser }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: workspaceOptionsKey(workspaceId) }),
  })
  if (options === undefined) return null
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-dashed p-4">
      <div>
        <h2 className="text-sm font-medium">The browser agents use</h2>
        <p className="text-sm text-muted-foreground">
          On a computer with a screen, the browser an agent uses opens in a window you can watch.
          Off, it works out of sight.
        </p>
      </div>
      <Label className="font-normal">
        <Switch
          checked={save.isPending ? save.variables : options.showBrowser}
          disabled={save.isPending || !options.canChange}
          onCheckedChange={(next) => save.mutate(next)}
        />
        Show the browser agents use
      </Label>
      {save.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {save.error.message}
        </p>
      ) : null}
    </section>
  )
}

/** Whether a kind can be added: not no computer at all, nor one that is one agent's alone. */
const canBeAdded = (kind: ComputerKind) => kind.id !== "none" && kind.perAgent !== true

/**
 * The computers the user can see: the machines of their workspaces, and the ones people have
 * paired, their own and those of the teams they are in. Each says whose it is and which agents
 * can work on it, and an agent that asked for one is answered here.
 */
export function ComputersSettings({
  agentId,
  meId,
  workspaceId,
}: {
  /** The agent on screen, if there is one. */
  agentId?: string | undefined
  meId: string
  /** The workspace these settings are open for, which a computer added here is for. */
  workspaceId?: string | undefined
}) {
  const { data: computers } = useQuery({
    queryKey: computersKey,
    queryFn: () => client.listComputers(),
    // Whether a computer is online changes without any event reaching this page.
    refetchInterval: 5_000,
  })
  // The same for everyone, and it only changes with the deployment.
  const { data: kinds } = useQuery({
    queryKey: computerKindsKey,
    queryFn: () => client.computerKinds(),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const addable = (kinds?.kinds ?? []).filter(canBeAdded)
  const workspaces = useWorkspaces()?.workspaces ?? []
  const agents = useAgentsById()
  // As often as the list under it, which is looked at for the same reason.
  const requests = useComputerRequests(5_000).filter((request) => request.canAnswer)
  const install = `curl -fsSL ${location.origin}/install.sh | sh`

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Computers</h2>
        <p className="text-sm text-muted-foreground">
          Where agents run commands, and read and write files: machines made here for a workspace,
          and computers of your own or of a team that you connect. Everything an agent does on a
          connected computer is logged on that machine.
        </p>
      </div>

      {requests.length > 0 ? (
        <ul aria-label="Agents asking to use a computer" className="flex flex-col gap-2">
          {requests.map((request) => (
            <ComputerRequestCard
              key={request.id}
              request={request}
              agentName={agents.get(request.agentId)?.name ?? "An agent"}
            />
          ))}
        </ul>
      ) : null}

      {computers === undefined ? (
        <CardsPlaceholder />
      ) : computers.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {computers.map((computer) => (
            <ComputerCard
              key={computer.id}
              computer={computer}
              meId={meId}
              agentId={agentId}
              workspaces={workspaces}
              agents={agents}
              kinds={kinds?.kinds ?? []}
            />
          ))}
        </ul>
      ) : null}

      {addable.length > 0 ? (
        <AddComputer
          kinds={addable}
          preferred={kinds?.default}
          workspaceId={workspaceId}
          workspaces={workspaces}
        />
      ) : null}

      <section className="flex flex-col gap-3 rounded-2xl border border-dashed p-4">
        <h2 className="text-sm font-medium">Connect a computer of your own</h2>
        <Command
          label="Run this on the computer (macOS or Linux, with Node.js 20 or newer):"
          command={install}
        />
        <Command
          label="Or let agents read files there without being able to run commands or change anything:"
          command={`${install} -s -- --read-only`}
        />
        <p className="text-sm text-muted-foreground">
          It prints a link. Open it here to say whose the computer is and which agents get access.
          Stopping the daemon, or removing the computer on this page, ends that access at once. The
          daemon keeps itself up to date from this server; add{" "}
          <code className="font-mono text-xs">--no-auto-update</code> to the command to stop it
          doing so.
        </p>
      </section>

      {workspaceId !== undefined ? <ShownBrowser workspaceId={workspaceId} /> : null}
    </div>
  )
}
