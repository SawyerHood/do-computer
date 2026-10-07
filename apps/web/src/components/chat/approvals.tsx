import type { ApprovalDecision, ApprovalRequest, ApprovalsState } from "@durable-computer/protocol"
import { ShieldCheckIcon } from "@phosphor-icons/react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { client } from "@/lib/client"
import { approvalsKey } from "@/lib/collections"
import { useWorkspaceOfAgent } from "@/lib/workspaces"
import { queryClient } from "@/lib/query"

function RequestCard({
  agentId,
  agentName,
  request,
  here,
}: {
  agentId: string
  agentName: string
  request: ApprovalRequest
  /** Whether the request came from the chat on screen. */
  here: boolean
}) {
  const team = useWorkspaceOfAgent(agentId)
  const answer = useMutation({
    mutationFn: (decision: ApprovalDecision) =>
      client.agent(agentId).answerApproval(request.id, decision),
    onSettled: () => queryClient.invalidateQueries({ queryKey: approvalsKey(agentId) }),
  })
  return (
    <li className="flex flex-col gap-2.5 rounded-2xl border bg-surface p-3.5 shadow-sm">
      <div className="flex items-start gap-2.5">
        <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            <span className="font-medium">{agentName}</span> wants to:{" "}
            <span className="font-medium">{request.title}</span>
          </p>
          {here ? null : (
            <p className="text-xs text-muted-foreground">
              {request.chatKind === "schedule"
                ? "In the scheduled run "
                : request.chatKind === "subagent"
                  ? "From the sub-agent "
                  : "In the chat "}
              <Link
                to="/a/$agentId/c/$chatId"
                params={{ agentId, chatId: request.chatId }}
                className="underline underline-offset-3"
              >
                {request.chatTitle}
              </Link>
            </p>
          )}
        </div>
      </div>
      {request.detail === "" ? null : (
        <pre className="max-h-40 overflow-auto rounded-lg bg-muted px-3 py-2 text-xs whitespace-pre-wrap">
          {request.detail}
        </pre>
      )}
      {answer.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {answer.error.message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={answer.isPending} onClick={() => answer.mutate("once")}>
          Allow once
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={answer.isPending}
          onClick={() => answer.mutate("always")}
        >
          Always allow
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={answer.isPending}
          onClick={() => answer.mutate("deny")}
        >
          Don’t allow
        </Button>
        {team?.kind === "team" ? (
          <span className="ml-auto self-center text-xs text-muted-foreground">
            Anyone in {team.name} can answer
          </span>
        ) : null}
      </div>
    </li>
  )
}

/**
 * What the agent is waiting for the user to allow, shown above the composer in every chat of the
 * agent: a request from a scheduled run has no chat the user would otherwise be looking at.
 */
export function PendingApprovals({
  agentId,
  agentName,
  chatId,
}: {
  agentId: string
  agentName: string
  chatId: string
}) {
  const { data } = useQuery<ApprovalsState>({
    queryKey: approvalsKey(agentId),
    queryFn: () => client.agent(agentId).approvals(),
  })
  const pending = data?.pending ?? []
  if (pending.length === 0) return null
  return (
    <ul
      aria-label="Waiting for your OK"
      className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 pb-2"
    >
      {pending.map((request) => (
        <RequestCard
          key={request.id}
          agentId={agentId}
          agentName={agentName}
          request={request}
          here={request.chatId === chatId}
        />
      ))}
    </ul>
  )
}
