import type { ChatSummary } from "@do-computer/protocol"
import { useQueryClient } from "@tanstack/react-query"
import { useLocalSearchParams, useRouter } from "expo-router"
import { isAtWork, subagentSeed, subagentsOf, subagentWords } from "@/chat/chats"
import { keys, useAgentState } from "@/lib/queries"
import { useSession } from "@/lib/use-session"
import { Button, Empty, errorText, haptic, Row, Screen, Section, tell } from "@/ui"
import { Avatar } from "@/ui/avatar"

/**
 * The sub-agents at work in one chat, as a sheet from the pill under the chat's bar: each opens
 * its own chat, and can be stopped. One that has ended is in the transcript, where it was
 * started and where it reported back.
 */
export default function Subagents() {
  const { agentId, chatId } = useLocalSearchParams<{ agentId: string; chatId?: string }>()
  const router = useRouter()
  const { client } = useSession()
  const queryClient = useQueryClient()
  const state = useAgentState(agentId)
  const atWork = subagentsOf(state.data?.chats, chatId ?? "").filter((entry) =>
    isAtWork(entry.status),
  )

  const open = (subagent: ChatSummary) => {
    haptic.tap()
    router.back()
    router.push(`/a/${agentId}/c/${subagent.id}`)
  }
  // Its agent is told that it was stopped.
  const stop = async (subagent: ChatSummary) => {
    haptic.medium()
    try {
      await client.agent(agentId).abort(subagent.id)
    } catch (caught) {
      tell(`${subagent.title} was not stopped`, errorText(caught))
    } finally {
      void queryClient.invalidateQueries({ queryKey: keys.agent(agentId) })
    }
  }

  return (
    <Screen
      onRefresh={() => void state.refetch()}
      refreshing={state.isRefetching}
      accessibilityLabel="Sub-agents"
    >
      {atWork.length === 0 ? (
        <Empty title={state.data === undefined ? "Loading…" : "No sub-agents at work"}>
          {state.data === undefined
            ? undefined
            : "What each one did is in the chat, where it reported back."}
        </Empty>
      ) : (
        <Section>
          {atWork.map((subagent) => (
            <Row
              key={subagent.id}
              accessibilityLabel={`Open ${subagent.title}`}
              lead={
                <Avatar
                  avatar={null}
                  seed={subagentSeed(agentId, subagent.id)}
                  size={34}
                  mood={{ state: subagent.status === "waiting" ? "waiting" : "thinking" }}
                />
              }
              title={subagent.title}
              subtitle={subagentWords(subagent.status)}
              bold={subagent.status === "waiting"}
              tail={
                <Button
                  title="Stop"
                  accessibilityLabel={`Stop ${subagent.title}`}
                  kind="plain"
                  size="small"
                  destructive
                  onPress={() => void stop(subagent)}
                />
              }
              go
              onPress={() => open(subagent)}
            />
          ))}
        </Section>
      )}
    </Screen>
  )
}
