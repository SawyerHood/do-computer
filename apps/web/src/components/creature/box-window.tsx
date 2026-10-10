import type { Gift, Orb } from "@durable-computer/mascot"
import {
  type AgentSummary,
  avatarLook,
  type CreatureState,
  RARITIES,
  rarityOf,
  WEAR_ITEMS,
  type WearItem,
  wearItem,
} from "@durable-computer/protocol"
import { useEffect, useImperativeHandle, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { openBox, wear } from "@/lib/creature"
import { isDark, loadMascot, mascotWardrobe, prefersCalm } from "@/lib/mascot"
import { cn } from "@/lib/utils"
import { Pixels } from "./pixels.tsx"
import { SLOT_NAMES, Wearing } from "./wearing.tsx"

/** What the window asks of the box it shows. */
export type BoxHandle = {
  /** It was pressed, and what is inside is being found out. */
  shake(): void
  /** It could not be opened after all. */
  calm(): void
  /** Open it on this thing, of this rarity. */
  open(item: WearItem): void
}

/** The colors of the rarities from the commonest up to a thing's own: the box steps through them. */
const tiersTo = (item: WearItem) =>
  RARITIES.slice(0, RARITIES.findIndex((rarity) => rarity.id === item.rarity) + 1).map(
    (rarity) => rarity.color,
  )

/**
 * The box itself, on the creature's own stage: drawn by what draws the creature, at its
 * resolution, and opened there. Where the creature cannot be drawn, a picture of a box stands in
 * and what was inside is simply said.
 */
export function BoxStage({
  agent,
  handle,
  onPop,
  onShown,
}: {
  agent: Pick<AgentSummary, "id" | "avatar">
  handle: React.Ref<BoxHandle>
  onPop: () => void
  onShown: () => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [drawn, setDrawn] = useState<boolean>()
  const box = useRef<Gift | null>(null)
  const heard = useRef({ onPop, onShown })
  heard.current = { onPop, onShown }
  const look = avatarLook(agent.avatar, agent.id)
  const first = useRef(look)

  useEffect(() => {
    let orb: Orb | undefined
    let gone = false
    void loadMascot().then((core) => {
      const wardrobe = mascotWardrobe()
      if (gone) return
      if (core === null || wardrobe === undefined || canvas.current === null) return setDrawn(false)
      orb = core.createOrb(canvas.current, {
        ...first.current,
        dark: isDark(),
        reduced: prefersCalm(),
        notice: false,
      })
      box.current = wardrobe.unwrap(orb, {
        onPop: () => heard.current.onPop(),
        onShown: () => heard.current.onShown(),
      })
      setDrawn(true)
    })
    return () => {
      gone = true
      box.current?.dispose()
      box.current = null
      orb?.dispose()
    }
  }, [])

  useImperativeHandle(
    handle,
    () => ({
      shake: () => box.current?.shake(),
      calm: () => box.current?.calm(),
      open: (item) => {
        if (box.current !== null) return box.current.open({ id: item.id, tiers: tiersTo(item) })
        // No box to play it on: it is open, and that is that.
        heard.current.onPop()
        heard.current.onShown()
      },
    }),
    [],
  )

  return (
    <>
      {drawn === false ? <Pixels art="box" className="absolute inset-[22%] size-[56%]" /> : null}
      <canvas
        ref={canvas}
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-[-12%] left-[-12%] size-[124%] max-w-none",
          drawn !== true && "invisible",
        )}
      />
    </>
  )
}

/**
 * A box being opened. It waits to be pressed; pressed, it rattles while the agent is asked what
 * is inside, and then opens on it: the rarer the thing, the longer it takes. What was inside can
 * be put on there and then, or kept for later.
 */
export function BoxWindow({
  agent,
  creature,
  onClose,
}: {
  agent: AgentSummary
  creature: CreatureState
  onClose: () => void
}) {
  const name = agent.name ?? "It"
  const [stage, setStage] = useState<"shut" | "opening" | "burst" | "shown">("shut")
  const [found, setFound] = useState<WearItem>()
  const [problem, setProblem] = useState<string>()
  /** Which box this is, of the ones opened in this window: each gets a stage of its own. */
  const [round, setRound] = useState(0)
  const box = useRef<BoxHandle>(null)
  const rarity = found === undefined ? undefined : rarityOf(found.rarity)

  const press = async () => {
    if (stage !== "shut") return
    setStage("opening")
    setProblem(undefined)
    box.current?.shake()
    try {
      const id = await openBox(agent.id)
      // A thing this page has not heard of yet is still a thing: it is named, and not drawn.
      const item = wearItem(id) ?? { id, slot: "hat", name: "Something new", rarity: "common" }
      setFound(item)
      box.current?.open(item)
    } catch (error) {
      box.current?.calm()
      setStage("shut")
      setProblem(error instanceof Error ? error.message : "The box would not open.")
    }
  }
  const again = () => {
    setFound(undefined)
    setStage("shut")
    setRound(round + 1)
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="flex flex-col items-center gap-0 overflow-hidden text-center sm:max-w-md">
        {/* The stage is drawn a little past its box, as the creature is, so room is left under it. */}
        <div className="relative mt-2 mb-8 size-64 max-w-full">
          {stage === "burst" || stage === "shown" ? (
            <>
              <span
                aria-hidden
                className="creature-glow absolute inset-[-18%] rounded-full"
                style={{ "--tier": rarity?.color } as React.CSSProperties}
              />
              <span aria-hidden className="creature-flash absolute inset-[-12%] rounded-full" />
            </>
          ) : null}
          <BoxStage
            key={round}
            agent={agent}
            handle={box}
            onPop={() => setStage("burst")}
            onShown={() => setStage("shown")}
          />
          {stage === "shut" ? (
            <button
              type="button"
              aria-label="Open the box"
              onClick={() => void press()}
              className="absolute inset-0 rounded-3xl outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
            />
          ) : null}
        </div>
        {stage === "shown" && found !== undefined && rarity !== undefined ? (
          <>
            {/* What it is, beside the creature with it on: some things are small by themselves. */}
            <div className="relative flex items-center gap-4 text-left">
              <Wearing agent={agent} item={found} className="size-18" />
              <div className="flex flex-col items-start">
                <span
                  className="mb-1.5 border px-2 py-0.5 text-[0.6875rem] font-bold tracking-widest uppercase"
                  style={{ color: rarity.color, borderColor: rarity.color }}
                >
                  {rarity.label}
                </span>
                <DialogTitle className="text-lg">{found.name}</DialogTitle>
                <DialogDescription className="mt-1">
                  {SLOT_NAMES[found.slot].one} · {creature.owned.length} of {WEAR_ITEMS.length}{" "}
                  found
                </DialogDescription>
              </div>
            </div>
            <div className="relative mt-5 flex flex-wrap justify-center gap-2">
              <Button
                onClick={() => {
                  void wear(agent.id, { ...creature.outfit, [found.slot]: found.id })
                  onClose()
                }}
              >
                Wear it
              </Button>
              <Button variant="outline" onClick={onClose}>
                Keep it for later
              </Button>
              {creature.boxes > 0 ? (
                <Button variant="ghost" onClick={again}>
                  Open another
                </Button>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <DialogTitle className="relative text-lg">{name} found a box</DialogTitle>
            <DialogDescription className="relative mt-1 min-h-5">
              {problem ?? (stage === "shut" ? "Press it to open." : "…")}
            </DialogDescription>
            {/* Holds the place of what is said once it is open, so that the window does not jump. */}
            <div className="mt-5 h-15" />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
