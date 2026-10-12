import {
  type AgentSummary,
  type ComputerRequest,
  isPersonalWorkspace,
} from "@do-computer/protocol"
import { DesktopIcon } from "@phosphor-icons/react"
import { useLiveQuery } from "@tanstack/react-db"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { client } from "@/lib/client"
import { agentsCollection, computerRequestsKey, computersKey } from "@/lib/collections"
import { queryClient } from "@/lib/query"
import { useWorkspace } from "@/lib/workspaces"

/** What the user's agents are waiting to hear about computers they asked to use. */
export function useComputerRequests(every = 15_000): ComputerRequest[] {
  const { data } = useQuery({
    queryKey: computerRequestsKey,
    queryFn: () => client.computerRequests(),
    // Someone else's agent may ask for a computer of the user's, and nothing tells this page.
    refetchInterval: every,
  })
  return data ?? []
}

/** The user's agents by id, for putting a name to one. */
export function useAgentsById(): Map<string, AgentSummary> {
  const { data } = useLiveQuery((q) => q.from({ agent: agentsCollection }))
  return new Map((data ?? []).map((agent) => [agent.id, agent]))
}

/** An agent asking to use a computer, with the answer for whoever the computer belongs to. */
export function ComputerRequestCard({
  request,
  agentName,
}: {
  request: ComputerRequest
  agentName: string
}) {
  const team = useWorkspace(
    isPersonalWorkspace(request.computer.workspaceId) ? undefined : request.computer.workspaceId,
  )
  const answer = useMutation({
    mutationFn: (approve: boolean) => client.answerComputerRequest(request.id, approve),
    // Prefix of the list of computers too, which gains an agent when the answer is yes.
    onSettled: () => queryClient.invalidateQueries({ queryKey: computersKey }),
  })
  return (
    <li className="flex flex-col gap-2.5 rounded-2xl bg-card p-3.5 shadow-raised">
      <div className="flex items-start gap-2.5">
        <DesktopIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            <span className="font-medium">{agentName}</span> asks to use the computer{" "}
            <span className="font-mono font-medium">{request.computer.name}</span>
          </p>
          {request.reason === "" ? null : (
            <p className="text-sm text-muted-foreground">“{request.reason}”</p>
          )}
        </div>
      </div>
      {answer.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {answer.error.message}
        </p>
      ) : null}
      {request.canAnswer ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={answer.isPending} onClick={() => answer.mutate(true)}>
            Allow
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={answer.isPending}
            onClick={() => answer.mutate(false)}
          >
            Don’t allow
          </Button>
          <span className="ml-auto self-center text-xs text-muted-foreground">
            {team !== undefined
              ? `Anyone in ${team.name} can answer`
              : request.computer.readOnly
                ? "It will be able to read files there"
                : "It will be able to run commands and change files there"}
          </span>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Waiting for {team?.name ?? request.computer.pairedBy.name} to answer.
        </p>
      )}
    </li>
  )
}

/**
 * The computers an agent has asked to use and not been answered about, shown above the composer
 * in every chat of the agent, as what it asks leave for is.
 */
export function PendingComputerRequests({
  agentId,
  agentName,
}: {
  agentId: string
  agentName: string
}) {
  const requests = useComputerRequests().filter((request) => request.agentId === agentId)
  if (requests.length === 0) return null
  return (
    <ul
      aria-label="Computers it asked to use"
      className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 pb-2"
    >
      {requests.map((request) => (
        <ComputerRequestCard key={request.id} request={request} agentName={agentName} />
      ))}
    </ul>
  )
}
