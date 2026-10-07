import {
  type AgentSummary,
  type ComputerSummary,
  isPersonalWorkspace,
  type WorkspaceSummary,
} from "@durable-computer/protocol"
import { CopyIcon, TrashIcon, XIcon } from "@phosphor-icons/react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useRef, useState } from "react"
import { AgentFace } from "@/components/agent-avatar"
import {
  ComputerRequestCard,
  useAgentsById,
  useComputerRequests,
} from "@/components/computer-requests"
import { Button } from "@/components/ui/button"
import { client } from "@/lib/client"
import { computersKey } from "@/lib/collections"
import { queryClient } from "@/lib/query"
import { cn } from "@/lib/utils"
import { useWorkspaces } from "@/lib/workspaces"

const SELECT =
  "h-8 max-w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"

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
}: {
  computer: ComputerSummary
  meId: string
  /** The agent on screen, which is offered first. */
  agentId: string | undefined
  workspaces: readonly WorkspaceSummary[]
  agents: ReadonlyMap<string, AgentSummary>
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
  const personal = isPersonalWorkspace(computer.workspaceId)
  const mine = computer.pairedBy.id === meId
  const team = workspaces.find((workspace) => workspace.id === computer.workspaceId)
  const teams = workspaces.filter((workspace) => workspace.kind === "team")
  // One's own computer serves any agent one can use; a team's serves the team's agents.
  const connectable = [...agents.values()]
    .filter(
      (agent) =>
        !computer.agentIds.includes(agent.id) &&
        (personal || agent.workspaceId === computer.workspaceId),
    )
    .sort((a, b) => Number(b.id === agentId) - Number(a.id === agentId))
  const problem = [remove, move, connect, disconnect].find((mutation) => mutation.isError)?.error
  const busy = move.isPending || connect.isPending || disconnect.isPending || remove.isPending
  return (
    <li className="flex flex-col gap-3 rounded-2xl border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-mono text-[0.9375rem] font-medium">{computer.name}</h2>
          <p className="text-sm text-muted-foreground">
            {PLATFORMS[computer.platform] ?? computer.platform} · {computer.hostname}
            {computer.readOnly ? " · read-only" : ""}
          </p>
        </div>
        <span
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium",
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
        </span>
      </div>

      <dl className="grid grid-cols-[5.5rem_1fr] items-center gap-x-3 gap-y-2.5 text-sm">
        <dt className="text-muted-foreground">Belongs to</dt>
        <dd className="min-w-0">
          {mine && teams.length > 0 ? (
            // Whoever paired it says whose it is: it is their account there that agents act as.
            <select
              aria-label={`Who ${computer.name} belongs to`}
              value={computer.workspaceId}
              disabled={busy}
              onChange={(event) => {
                const to = workspaces.find((workspace) => workspace.id === event.target.value)
                if (to === undefined) return
                const losing = computer.agentIds.filter(
                  (id) => to.kind === "team" && agents.get(id)?.workspaceId !== to.id,
                )
                if (
                  losing.length > 0 &&
                  !confirm(
                    `Give ${computer.name} to ${to.name}? Agents outside ${to.name} will be disconnected from it.`,
                  )
                ) {
                  return
                }
                move.mutate(to.id)
              }}
              className={SELECT}
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.kind === "personal" ? "You" : workspace.name}
                </option>
              ))}
            </select>
          ) : personal ? (
            "You"
          ) : (
            <>
              {team?.name ?? "A team"}
              <span className="text-muted-foreground">
                {" "}
                · paired by {mine ? "you" : computer.pairedBy.name}
              </span>
            </>
          )}
        </dd>
        <dt className="self-start pt-1 text-muted-foreground">Agents</dt>
        <dd className="flex min-w-0 flex-wrap items-center gap-1.5">
          {computer.agentIds.map((id) => {
            const agent = agents.get(id)
            const name = agent?.name ?? "New agent"
            return (
              <span
                key={id}
                className="flex items-center gap-1.5 rounded-lg border bg-background py-0.5 pr-0.5 pl-1.5"
              >
                {agent === undefined ? null : <AgentFace agent={agent} className="size-5" still />}
                <span className="max-w-40 truncate">{name}</span>
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
              </span>
            )
          })}
          {connectable.length > 0 ? (
            <select
              aria-label={`Connect an agent to ${computer.name}`}
              value=""
              disabled={busy}
              onChange={(event) => {
                if (event.target.value !== "") connect.mutate(event.target.value)
              }}
              className={cn(SELECT, "text-muted-foreground")}
            >
              <option value="">
                {computer.agentIds.length === 0 ? "Connect an agent…" : "Connect another…"}
              </option>
              {connectable.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name ?? "New agent"}
                  {personal && teams.length > 0
                    ? ` · ${workspaces.find((workspace) => workspace.id === agent.workspaceId)?.name ?? ""}`
                    : ""}
                </option>
              ))}
            </select>
          ) : computer.agentIds.length === 0 ? (
            <span className="text-muted-foreground">None yet</span>
          ) : null}
        </dd>
      </dl>

      <div className="flex items-center gap-2">
        <p className="text-sm text-muted-foreground">
          {computer.online
            ? computer.agentIds.length === 0
              ? "No agent can work on it until one is connected. An agent can also ask."
              : "Its agents can work on it now."
            : computer.lastSeenAt
              ? `Last connected ${ago(computer.lastSeenAt)}. Start the daemon there to bring it back.`
              : "Its daemon has not connected yet."}
        </p>
        {computer.canManage ? (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto shrink-0 text-muted-foreground"
            disabled={busy}
            aria-label={`Remove ${computer.name}`}
            onClick={() => remove.mutate()}
          >
            <TrashIcon /> Remove
          </Button>
        ) : null}
      </div>
      {problem ? (
        <p role="alert" className="text-sm text-destructive">
          {problem.message}
        </p>
      ) : null}
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
 * The computers people have paired: the user's own, and those of the teams they are in. Each
 * says whose it is and which agents can work on it, and an agent that asked for one is answered
 * here.
 */
export function ComputersSettings({
  agentId,
  meId,
}: {
  /** The agent on screen, if there is one. */
  agentId?: string | undefined
  meId: string
}) {
  const { data: computers } = useQuery({
    queryKey: computersKey,
    queryFn: () => client.listComputers(),
    // Whether a computer is online changes without any event reaching this page.
    refetchInterval: 5_000,
  })
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
          Machines of your own or of a team, connected so agents can work on them: run commands, and
          read and write files. Everything an agent does there is logged on that machine.
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

      {computers !== undefined && computers.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {computers.map((computer) => (
            <ComputerCard
              key={computer.id}
              computer={computer}
              meId={meId}
              agentId={agentId}
              workspaces={workspaces}
              agents={agents}
            />
          ))}
        </ul>
      ) : null}

      <section className="flex flex-col gap-3 rounded-2xl border border-dashed p-4">
        <h2 className="text-sm font-medium">Connect a computer</h2>
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
          Stopping the daemon, or removing the computer on this page, ends that access at once.
        </p>
      </section>
    </div>
  )
}
