import type { AgentSummary } from "@durable-computer/protocol"
import { useAtom } from "jotai"
import { useEffect } from "react"
import { creatureBoxAtom, creatureWardrobeAtom, useCreature } from "@/lib/creature"
import { BoxWindow } from "./box-window.tsx"
import { WardrobeWindow } from "./wardrobe-window.tsx"

/**
 * The creature's windows, over whichever of its agent's pages is showing: its wardrobe, and a box
 * of its being opened. Opened from beside the creature in its panel, and from its picture at the
 * top of the agent's pages. A box opened in the wardrobe opens over it, and the wardrobe is still
 * there once the box is done with.
 */
export function CreatureWindows({ agent }: { agent: AgentSummary }) {
  const [wardrobe, setWardrobe] = useAtom(creatureWardrobeAtom)
  const [box, setBox] = useAtom(creatureBoxAtom)
  const creature = useCreature(agent.id, agent.hatched && (wardrobe || box))
  // Another agent's pages start with nothing open over them.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the agent is what it is closed for
  useEffect(() => {
    setWardrobe(false)
    setBox(false)
  }, [agent.id, setWardrobe, setBox])
  if (creature === undefined) return null
  const opening = box ? (
    <BoxWindow agent={agent} creature={creature} onClose={() => setBox(false)} />
  ) : null
  if (!wardrobe) return opening
  // The box is inside the wardrobe and not beside it: a press in a window beside it would be a
  // press outside the wardrobe, which shuts it.
  return (
    <WardrobeWindow agent={agent} creature={creature} onClose={() => setWardrobe(false)}>
      {opening}
    </WardrobeWindow>
  )
}
