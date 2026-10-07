import { DesktopIcon, WarningIcon } from "@phosphor-icons/react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { AgentFace } from "@/components/agent-avatar"
import { Button } from "@/components/ui/button"
import { client } from "@/lib/client"
import { agentsKey, computersKey } from "@/lib/collections"
import { queryClient } from "@/lib/query"
import { cn } from "@/lib/utils"
import { useWorkspaces } from "@/lib/workspaces"

export const Route = createFileRoute("/_app/pair")({
  validateSearch: (search: Record<string, unknown>) => ({
    code: typeof search.code === "string" ? search.code : "",
  }),
  component: PairPage,
})

/**
 * Where the link a daemon prints leads: the user agrees to pair that computer, and says whose it
 * is and which agents can use it.
 */
function PairPage() {
  const { code } = Route.useSearch()
  const pairing = useQuery({
    queryKey: ["pairing", code],
    queryFn: () => client.pairingRequest(code),
    retry: false,
    enabled: code !== "",
  })
  const agents = useQuery({ queryKey: agentsKey, queryFn: () => client.listAgents() })
  const workspaces = useWorkspaces()?.workspaces ?? []
  const teams = workspaces.filter((workspace) => workspace.kind === "team")
  const own = workspaces.find((workspace) => workspace.kind === "personal")
  /** Whose it is to be. Undefined: the user's own. */
  const [teamId, setTeamId] = useState<string>()
  const [chosen, setChosen] = useState<readonly string[]>()
  // One's own computer can serve any agent one can use; a team's serves the team's agents.
  const offered = (agents.data ?? []).filter(
    (agent) => teamId === undefined || agent.workspaceId === teamId,
  )
  useEffect(() => {
    // With one agent there is nothing to choose between, so it is chosen.
    if (chosen === undefined && agents.data !== undefined) {
      setChosen(agents.data.length === 1 ? [agents.data[0]!.id] : [])
    }
  }, [agents.data, chosen])
  const agentIds = (chosen ?? []).filter((id) => offered.some((agent) => agent.id === id))
  const confirm = useMutation({
    mutationFn: () =>
      client.confirmPairing({
        code,
        agentIds,
        ...(teamId === undefined ? {} : { workspaceId: teamId }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: computersKey }),
  })
  const first = agentIds[0] ?? agents.data?.[0]?.id

  return (
    <main className="flex h-dvh items-center justify-center overflow-y-auto p-6">
      <div className="flex w-full max-w-md flex-col gap-5">
        <DesktopIcon className="size-8 text-muted-foreground" />
        {confirm.isSuccess ? (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">Connected</h1>
            <p className="text-sm text-muted-foreground">
              {agentIds.length === 0
                ? "No agent can use it yet: connect one under Computers, or let an agent ask. It is called "
                : agentIds.length === 1
                  ? "Your agent knows this computer as "
                  : "Your agents know this computer as "}
              <span className="font-mono text-foreground">{confirm.data.name}</span>. The daemon in
              your terminal will connect in a moment; you can close this page.
            </p>
            {first ? (
              <Link
                to="/a/$agentId"
                params={{ agentId: first }}
                search={{ workspace: "computers" }}
                className="text-sm underline underline-offset-3"
              >
                See your computers
              </Link>
            ) : null}
          </>
        ) : code === "" || pairing.isError ? (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">That code did not work</h1>
            <p className="text-sm text-muted-foreground">
              It may have expired; codes last ten minutes. Run the install command again on the
              computer to get a fresh link.
            </p>
          </>
        ) : pairing.data === undefined ? null : (
          <>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Connect this computer?</h1>
              <p className="text-sm text-muted-foreground">
                Check that this is the machine you just ran the command on.
              </p>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-2xl border bg-surface p-4 text-sm">
              <dt className="text-muted-foreground">Code</dt>
              <dd className="font-mono">{pairing.data.code}</dd>
              <dt className="text-muted-foreground">Name</dt>
              <dd className="font-mono">{pairing.data.name}</dd>
              <dt className="text-muted-foreground">Host</dt>
              <dd className="truncate">{pairing.data.hostname}</dd>
              <dt className="text-muted-foreground">Home</dt>
              <dd className="truncate font-mono text-xs leading-5">{pairing.data.home}</dd>
            </dl>
            <div className="flex gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
              <WarningIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p>
                {pairing.data.readOnly
                  ? "An agent connected to it will be able to read any file your account can read on this computer. It will not be able to run commands or change anything."
                  : "An agent connected to it will be able to run any command and read and change any file your account can on this computer, without asking first. Only connect a machine you are comfortable handing over."}
              </p>
            </div>
            {teams.length === 0 ? null : (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-sm font-medium">Whose computer is it?</legend>
                {[own, ...teams].map((workspace) => {
                  if (workspace === undefined) return null
                  const id = workspace.kind === "personal" ? undefined : workspace.id
                  return (
                    <label
                      key={workspace.id}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-xl border p-2.5 text-sm",
                        teamId === id && "border-primary bg-primary/10",
                      )}
                    >
                      <input
                        type="radio"
                        name="owner"
                        className="mt-0.5 size-4 shrink-0 accent-primary"
                        checked={teamId === id}
                        onChange={() => setTeamId(id)}
                      />
                      <span>
                        <span className="font-medium">
                          {workspace.kind === "personal" ? "Mine" : workspace.name}
                        </span>
                        <span className="block text-muted-foreground">
                          {workspace.kind === "personal"
                            ? "Only you decide which agents use it, in any of your workspaces."
                            : `Anyone in ${workspace.name} can connect its agents to it.`}
                        </span>
                      </span>
                    </label>
                  )
                })}
              </fieldset>
            )}
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">Which agents can use it?</legend>
              {offered.map((agent) => (
                <label
                  key={agent.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-xl border p-2.5 text-sm",
                    agentIds.includes(agent.id) && "border-primary bg-primary/10",
                  )}
                >
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 accent-primary"
                    checked={agentIds.includes(agent.id)}
                    onChange={(event) =>
                      setChosen(
                        event.target.checked
                          ? [...agentIds, agent.id]
                          : agentIds.filter((id) => id !== agent.id),
                      )
                    }
                  />
                  <AgentFace agent={agent} className="size-7" still />
                  <span className="min-w-0 flex-1 truncate">{agent.name ?? "New agent"}</span>
                  {teamId === undefined && teams.length > 0 ? (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {workspaces.find((workspace) => workspace.id === agent.workspaceId)?.name}
                    </span>
                  ) : null}
                </label>
              ))}
              <p className="text-xs text-muted-foreground">
                You can change this later under Computers, and an agent that is not connected can
                ask you for it.
              </p>
            </fieldset>
            {confirm.isError ? (
              <p role="alert" className="text-sm text-destructive">
                {confirm.error.message}
              </p>
            ) : null}
            <Button disabled={confirm.isPending} onClick={() => confirm.mutate()}>
              {confirm.isPending ? "Connecting…" : "Connect this computer"}
            </Button>
          </>
        )}
      </div>
    </main>
  )
}
