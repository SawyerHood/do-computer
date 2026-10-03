import { DesktopIcon, WarningIcon } from "@phosphor-icons/react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { AgentAvatar } from "@/components/agent-avatar"
import { Button } from "@/components/ui/button"
import { client } from "@/lib/client"
import { agentsKey, computersKey } from "@/lib/collections"
import { queryClient } from "@/lib/query"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/_app/pair")({
  validateSearch: (search: Record<string, unknown>) => ({
    code: typeof search.code === "string" ? search.code : "",
  }),
  component: PairPage,
})

/** Where the link a daemon prints leads: the user agrees to pair that computer, and picks the agent. */
function PairPage() {
  const { code } = Route.useSearch()
  const pairing = useQuery({
    queryKey: ["pairing", code],
    queryFn: () => client.pairingRequest(code),
    retry: false,
    enabled: code !== "",
  })
  const agents = useQuery({ queryKey: agentsKey, queryFn: () => client.listAgents() })
  const [agentId, setAgentId] = useState<string>()
  useEffect(() => {
    if (agentId === undefined && agents.data?.[0] !== undefined) setAgentId(agents.data[0].id)
  }, [agents.data, agentId])
  const confirm = useMutation({
    mutationFn: () => client.confirmPairing(code, agentId!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: computersKey }),
  })

  return (
    <main className="flex h-dvh items-center justify-center overflow-y-auto p-6">
      <div className="flex w-full max-w-md flex-col gap-5">
        <DesktopIcon className="size-8 text-muted-foreground" />
        {confirm.isSuccess ? (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">Connected</h1>
            <p className="text-sm text-muted-foreground">
              Your agent knows this computer as{" "}
              <span className="font-mono text-foreground">{confirm.data.name}</span>. The daemon in
              your terminal will connect in a moment; you can close this page.
            </p>
            {agentId ? (
              <Link
                to="/a/$agentId/computers"
                params={{ agentId }}
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
                  ? "The agent will be able to read any file your account can read on this computer. It will not be able to run commands or change anything."
                  : "The agent will be able to run any command and read and change any file your account can on this computer, without asking first. Only connect a machine you are comfortable handing over."}
              </p>
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">Which agent gets access?</legend>
              {(agents.data ?? []).map((agent) => (
                <label
                  key={agent.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-xl border p-2.5 text-sm",
                    agentId === agent.id && "border-primary bg-primary/10",
                  )}
                >
                  <input
                    type="radio"
                    name="agent"
                    className="sr-only"
                    checked={agentId === agent.id}
                    onChange={() => setAgentId(agent.id)}
                  />
                  <AgentAvatar avatar={agent.avatar} seed={agent.id} className="size-7" />
                  {agent.name ?? "New agent"}
                </label>
              ))}
            </fieldset>
            {confirm.isError ? (
              <p role="alert" className="text-sm text-destructive">
                {confirm.error.message}
              </p>
            ) : null}
            <Button
              disabled={agentId === undefined || confirm.isPending}
              onClick={() => confirm.mutate()}
            >
              {confirm.isPending ? "Connecting…" : "Connect this computer"}
            </Button>
          </>
        )}
      </div>
    </main>
  )
}
