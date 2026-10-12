import { type AgentSummary, EMPTY_CHAT } from "@do-computer/protocol"
import { useAtomValue } from "jotai"
import { AgentFace } from "@/components/agent-avatar"
import { agentPanelOpenAtom } from "@/lib/atoms"
import { useWide } from "@/lib/use-wide"
import { AgentPanel } from "./agent-panel.tsx"

/**
 * The agent's panel beside a page of its that is not a chat. It is where the panel is beside a
 * chat and as wide, so that going from one tab to another moves nothing.
 */
export function AgentAside({ agent }: { agent: AgentSummary }) {
  const open = useAtomValue(agentPanelOpenAtom)
  const wide = useWide()
  if (!open || !wide) return null
  return (
    <AgentPanel
      agent={agent}
      state={EMPTY_CHAT}
      face={<AgentFace agent={agent} className="size-52" pettable />}
      reconnecting={false}
      startFresh={undefined}
      subagents={[]}
      chatless
    />
  )
}
