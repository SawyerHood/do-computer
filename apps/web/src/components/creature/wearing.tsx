import type { AgentSummary, WearItem, WearSlot } from "@do-computer/protocol"
import { AgentAvatar } from "@/components/agent-avatar"

/** What each place is called: over a list of the things worn there, and for one of them. */
export const SLOT_NAMES: Record<WearSlot, { many: string; one: string }> = {
  hat: { many: "Hats", one: "Hat" },
  glasses: { many: "Glasses", one: "Glasses" },
  face: { many: "Face", one: "Face" },
  neck: { many: "Neck", one: "Neck" },
}

/** A creature wearing one thing and nothing else, small: how a thing is shown in a list of them. */
export function Wearing({
  agent,
  item,
  className,
}: {
  agent: Pick<AgentSummary, "id" | "avatar">
  item: WearItem | undefined
  className?: string
}) {
  return (
    <AgentAvatar
      avatar={agent.avatar}
      seed={agent.id}
      outfit={item === undefined ? {} : { [item.slot]: item.id }}
      className={className}
      quiet
      still
    />
  )
}
