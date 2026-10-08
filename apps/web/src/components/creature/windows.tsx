import type { AgentSummary } from "@durable-computer/protocol"
import { useAtom } from "jotai"
import { useEffect } from "react"
import { creatureWindowAtom, useCreature } from "@/lib/creature"
import { BoxWindow } from "./box-window.tsx"
import { WardrobeWindow } from "./wardrobe-window.tsx"

/**
 * The creature's windows, over whichever of its agent's pages is showing: its wardrobe, and a box
 * of its being opened. Opened from beside the creature in its panel, and from its picture at the
 * top of the agent's pages.
 */
export function CreatureWindows({ agent }: { agent: AgentSummary }) {
  const [open, setOpen] = useAtom(creatureWindowAtom)
  const creature = useCreature(agent.id, agent.hatched && open !== null)
  // Another agent's pages start with nothing open over them.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the agent is what it is closed for
  useEffect(() => setOpen(null), [agent.id, setOpen])
  if (open === null || creature === undefined) return null
  const close = () => setOpen(null)
  return open === "box" ? (
    <BoxWindow agent={agent} creature={creature} onClose={close} />
  ) : (
    <WardrobeWindow agent={agent} creature={creature} onClose={close} />
  )
}
