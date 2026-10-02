import type { ApprovalDecision, ApprovalRequest } from "@durable-computer/protocol"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ScrollView, View } from "react-native"
import { Button, Card, ErrorText, Text } from "@/components/ui"
import { radius, space, useTheme } from "@/lib/theme"
import { keys } from "@/lib/use-agent"
import { useSession } from "@/lib/use-session"

function RequestCard({
  agentId,
  agentName,
  request,
  here,
}: {
  agentId: string
  agentName: string
  request: ApprovalRequest
  here: boolean
}) {
  const theme = useTheme()
  const { client } = useSession()
  const queryClient = useQueryClient()
  const answer = useMutation({
    mutationFn: (decision: ApprovalDecision) =>
      client.agent(agentId).answerApproval(request.id, decision),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.approvals(agentId) }),
  })
  return (
    <Card style={{ gap: space(2.5) }}>
      <Text size={14}>
        <Text size={14} weight="500">
          {agentName}
        </Text>{" "}
        wants to:{" "}
        <Text size={14} weight="500">
          {request.title}
        </Text>
      </Text>
      {here ? null : (
        <Text tone="muted" size={12}>
          {request.chatKind === "schedule" ? "In the scheduled run " : "In the chat "}
          {request.chatTitle}
        </Text>
      )}
      {request.detail === "" ? null : (
        <ScrollView
          style={{
            maxHeight: 120,
            backgroundColor: theme.raised,
            borderRadius: radius.sm,
            padding: space(2.5),
          }}
        >
          <Text size={12} style={{ fontFamily: "monospace" }}>
            {request.detail}
          </Text>
        </ScrollView>
      )}
      {answer.isError ? <ErrorText>{answer.error.message}</ErrorText> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
        <Button label="Allow once" busy={answer.isPending} onPress={() => answer.mutate("once")} />
        <Button
          label="Always allow"
          variant="outline"
          disabled={answer.isPending}
          onPress={() => answer.mutate("always")}
        />
        <Button
          label="Don’t allow"
          variant="ghost"
          disabled={answer.isPending}
          onPress={() => answer.mutate("deny")}
        />
      </View>
    </Card>
  )
}

/**
 * What the agent is waiting for the user to allow. Shown in every chat of the agent, so a request
 * that arrived as a notification can be answered wherever the app opened.
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
  const { client } = useSession()
  const { data } = useQuery({
    queryKey: keys.approvals(agentId),
    queryFn: () => client.agent(agentId).approvals(),
  })
  const pending = data?.pending ?? []
  if (pending.length === 0) return null
  return (
    <View
      accessibilityLabel="Waiting for your OK"
      style={{ gap: space(2), paddingHorizontal: space(3), paddingBottom: space(2) }}
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
    </View>
  )
}
