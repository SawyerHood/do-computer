import { type AgentSummary, EMPTY_CHAT } from "@do-computer/protocol"
import { useAtomValue } from "jotai"
import { AgentFace } from "@/components/agent-avatar"
import { ComposerPlaceholder, TranscriptPlaceholder } from "@/components/placeholders"
import { AgentPanelPlaceholder } from "@/components/shell/app-skeleton"
import { agentPanelOpenAtom } from "@/lib/atoms"
import { agentPanelColumn } from "@/lib/columns"
import { useWide } from "@/lib/use-wide"
import { AgentPanel } from "./agent-panel.tsx"

/**
 * A chat's place before the chat can be opened: while the agent says which chat is its main one,
 * or before anything is known of the agent at all. It is laid out as the chat is, so that
 * nothing moves when the chat takes its place, and the agent is beside it as soon as it is known.
 */
export function ChatPlaceholder({ agent }: { agent: AgentSummary | undefined }) {
  const open = useAtomValue(agentPanelOpenAtom)
  const width = useAtomValue(agentPanelColumn.width)
  const wide = useWide()
  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden">
          <TranscriptPlaceholder className="mx-auto w-full max-w-[45rem] px-4 pb-6" />
        </div>
        <ComposerPlaceholder />
      </div>
      {!open || !wide ? null : agent === undefined ? (
        <AgentPanelPlaceholder width={width} />
      ) : (
        <AgentPanel
          agent={agent}
          state={EMPTY_CHAT}
          loading
          face={<AgentFace agent={agent} className="size-52" />}
          reconnecting={false}
          subagents={[]}
        />
      )}
    </div>
  )
}
