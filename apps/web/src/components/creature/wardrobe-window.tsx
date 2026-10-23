import {
  type AgentSummary,
  avatarSvg,
  type CreatureState,
  RARITIES,
  rarityOf,
  WEAR_ITEMS,
  WEAR_SLOTS,
  type WearItem,
  type WearSlot,
  wearItem,
} from "@do-computer/protocol"
import { LockIcon, XIcon } from "@phosphor-icons/react"
import { useAtomValue } from "jotai"
import { type ReactNode, useMemo, useRef, useState } from "react"
import { AgentAvatar } from "@/components/agent-avatar"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { useCreature, useWardrobeDoods, wear } from "@/lib/creature"
import { mascotMoodAtom } from "@/lib/mascot"
import { cn } from "@/lib/utils"
import { CreatureCare } from "./care.tsx"
import { SLOT_NAMES, Wearing } from "./wearing.tsx"

const tab =
  "relative flex h-full shrink-0 items-center gap-1.5 px-3 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 aria-selected:text-foreground aria-selected:after:absolute aria-selected:after:inset-x-2 aria-selected:after:bottom-0 aria-selected:after:h-0.5 aria-selected:after:rounded-full aria-selected:after:bg-primary"

/** A Dood as a small still picture: who found a thing, and who has it on. */
function DoodPicture({
  agent,
  className,
}: {
  agent: Pick<AgentSummary, "id" | "avatar">
  className?: string
}) {
  const src = useMemo(
    () => `data:image/svg+xml;utf8,${encodeURIComponent(avatarSvg(agent.avatar, agent.id))}`,
    [agent.avatar, agent.id],
  )
  return <img alt="" src={src} className={className} />
}

/**
 * One thing in the wardrobe: the creature wearing it if it has been found, and a blank if not.
 * A thing found says which Dood found it, and in its corner which of them have it on.
 */
function Tile({
  agent,
  item,
  owned,
  worn,
  foundBy,
  wornBy = [],
  onPick,
}: {
  agent: AgentSummary
  /** Undefined for the tile that takes off what is worn there. */
  item: WearItem | undefined
  owned: boolean
  worn: boolean
  foundBy?: AgentSummary | undefined
  wornBy?: readonly AgentSummary[]
  onPick: () => void
}) {
  const rarity = item === undefined ? undefined : rarityOf(item.rarity)
  const frame =
    "relative flex min-h-27 flex-col items-center gap-1 overflow-hidden rounded-xl border bg-surface px-1 pt-2.5 pb-3 text-center text-xs leading-tight"
  if (!owned && item !== undefined && rarity !== undefined) {
    return (
      <li
        aria-label={`Not found yet: ${rarity.label.toLowerCase()}`}
        className={cn(frame, "justify-center border-dashed text-muted-foreground")}
      >
        <span
          aria-hidden
          className="grid size-14 place-items-center text-2xl font-semibold opacity-80"
          style={{ color: rarity.color }}
        >
          ?
        </span>
        <span className="flex items-center gap-1">
          <LockIcon aria-hidden className="size-3" />
          {rarity.label}
        </span>
        <span
          aria-hidden
          className="absolute inset-x-2.5 bottom-0 h-0.75"
          style={{ background: rarity.color }}
        />
      </li>
    )
  }
  return (
    <li className="contents">
      <button
        type="button"
        aria-label={item?.name ?? "Nothing"}
        aria-pressed={worn}
        title={rarity?.label}
        onClick={onPick}
        className={cn(
          frame,
          "outline-none hover:border-input focus-visible:ring-3 focus-visible:ring-ring/40 aria-pressed:border-primary aria-pressed:ring-2 aria-pressed:ring-primary/35",
        )}
      >
        {wornBy.length === 0 ? null : (
          <span
            role="img"
            aria-label={`Worn by ${wornBy.map((dood) => dood.name ?? "a new Dood").join(", ")}`}
            title={`Worn by ${wornBy.map((dood) => dood.name ?? "a new Dood").join(", ")}`}
            className="absolute top-1 right-1 flex flex-row-reverse"
          >
            {wornBy.slice(0, 3).map((dood) => (
              <DoodPicture
                key={dood.id}
                agent={dood}
                className="-ml-1.5 size-4.5 rounded-full bg-surface ring-1 ring-border"
              />
            ))}
          </span>
        )}
        <Wearing agent={agent} item={item} className="size-14" />
        <span className="grid min-h-7.5 place-items-center">{item?.name ?? "Nothing"}</span>
        {foundBy === undefined ? null : (
          <span className="-mt-1 max-w-full truncate px-1 text-[0.625rem] text-muted-foreground">
            found by {foundBy.name ?? "a new Dood"}
          </span>
        )}
        {rarity === undefined ? null : (
          <span
            aria-hidden
            className="absolute inset-x-2.5 bottom-0 h-0.75"
            style={{ background: rarity.color }}
          />
        )}
      </button>
    </li>
  )
}

/**
 * The wardrobe of the creature's workspace, and where it is looked after on a screen with no
 * panel: the creature with its treats and its box, and under or beside it everything there is to
 * wear, a place at a time. What any of the workspace's Doods has found is shown on the creature
 * itself, with who found it and who has it on; what none has is a blank in the color of its
 * rarity. Picking a thing puts it on, and picking it again takes it off. Where the workspace has
 * other Doods, any of them can be picked to be dressed instead.
 */
export function WardrobeWindow({
  agent,
  creature,
  onClose,
  children,
}: {
  agent: AgentSummary
  creature: CreatureState
  onClose: () => void
  /** A window opened from this one, which is over it until it is closed. */
  children?: ReactNode
}) {
  const [slot, setSlot] = useState<WearSlot>("hat")
  const title = useRef<HTMLHeadingElement>(null)
  const doods = useWardrobeDoods(agent.id)
  // Whose outfit is being picked: the Dood it was opened from, unless another is picked.
  const [dressedId, setDressedId] = useState(agent.id)
  const dressed =
    dressedId === agent.id ? agent : (doods.find((dood) => dood.id === dressedId) ?? agent)
  const own = dressed.id === agent.id
  const theirs = useCreature(dressed.id, !own)
  const outfit = (own ? creature.outfit : (theirs?.outfit ?? dressed.outfit)) ?? {}
  const mood = useAtomValue(mascotMoodAtom(dressed.id))
  const name = dressed.name ?? "New Dood"
  const owned = useMemo(() => new Set(creature.owned), [creature.owned])
  const byId = useMemo(() => new Map(doods.map((dood) => [dood.id, dood])), [doods])
  // Who has each thing on, by its id. The one being dressed as it is now, the rest as listed.
  const wornBy = useMemo(() => {
    const worn = new Map<string, AgentSummary[]>()
    for (const dood of doods.some((one) => one.id === dressed.id) ? doods : [...doods, dressed]) {
      const on = dood.id === dressed.id ? outfit : (dood.outfit ?? {})
      for (const id of Object.values(on)) {
        if (id !== undefined) worn.set(id, [...(worn.get(id) ?? []), dood])
      }
    }
    return worn
  }, [doods, dressed, outfit])
  // What it has first, in the order of the catalog; then what it has not, commonest first.
  const items = useMemo(() => {
    const here = WEAR_ITEMS.filter((item) => item.slot === slot)
    const rank = (item: WearItem) => RARITIES.findIndex((rarity) => rarity.id === item.rarity)
    return [
      ...here.filter((item) => owned.has(item.id)),
      ...here.filter((item) => !owned.has(item.id)).sort((a, b) => rank(a) - rank(b)),
    ]
  }, [slot, owned])
  const put = (place: WearSlot, id: string | undefined) => {
    const { [place]: _off, ...rest } = outfit
    void wear(dressed.id, id === undefined ? rest : { ...rest, [place]: id })
  }
  const others = doods.length - 1

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent
        // Its name, and not the first button in it, which would be the treats.
        initialFocus={title}
        className="flex h-dvh max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-[min(43rem,calc(100dvh-3rem))] sm:max-w-5xl sm:flex-row sm:rounded-2xl"
      >
        <div className="flex shrink-0 flex-col items-center border-b bg-rail/50 px-14 pt-9 pb-5 text-center sm:w-76 sm:border-r sm:border-b-0 sm:px-5 sm:pt-12">
          {own ? (
            <CreatureCare agent={agent}>
              <AgentAvatar
                avatar={agent.avatar}
                seed={agent.id}
                outfit={outfit}
                mood={mood}
                className="size-36 sm:size-48"
                pettable
              />
            </CreatureCare>
          ) : (
            <AgentAvatar
              key={dressed.id}
              avatar={dressed.avatar}
              seed={dressed.id}
              outfit={outfit}
              mood={mood}
              className="size-36 sm:size-48"
              pettable
            />
          )}
          <DialogTitle ref={title} tabIndex={-1} className="mt-4 text-lg outline-none">
            {name}
          </DialogTitle>
          <DialogDescription className="mt-1">
            {creature.owned.length} of {WEAR_ITEMS.length} found
            {others > 0 ? " by your Doods" : ""}
          </DialogDescription>
          <ul
            aria-label={`What ${name} has on`}
            className="mt-5 hidden w-full flex-col gap-1.5 sm:flex"
          >
            {WEAR_SLOTS.map((place) => {
              const item = wearItem(outfit[place] ?? "")
              return (
                <li
                  key={place}
                  className="flex h-8.5 items-center gap-2 rounded-lg border px-2.5 text-left text-sm"
                >
                  <span className="w-14 shrink-0 text-xs text-muted-foreground">
                    {SLOT_NAMES[place].one}
                  </span>
                  {item === undefined ? (
                    <span className="text-muted-foreground">Nothing</span>
                  ) : (
                    <>
                      <span
                        aria-hidden
                        className="size-2 shrink-0"
                        style={{ background: rarityOf(item.rarity).color }}
                      />
                      <span className="min-w-0 flex-1 truncate">{item.name}</span>
                      <button
                        type="button"
                        aria-label={`Take off the ${item.name.toLowerCase()}`}
                        title="Take it off"
                        onClick={() => put(place, undefined)}
                        className="-mr-1 grid size-6 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
                      >
                        <XIcon className="size-3.5" />
                      </button>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
          <p className="mt-4 hidden text-xs text-muted-foreground sm:block">
            {others > 0
              ? "Six hours after a box is opened another turns up, with something new inside. Any of your Doods can open it, and all of them can wear what it held."
              : `Six hours after ${name}'s box is opened another turns up, with something new to wear inside. Treats are only because it likes them.`}
          </p>
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col px-4 pt-3 pb-3 sm:px-7 sm:pt-7">
          <h2 className="hidden pb-3 text-xl font-semibold sm:block">Wardrobe</h2>
          {others > 0 ? (
            <div
              role="radiogroup"
              aria-label="Who to dress"
              className="-mx-0.5 flex shrink-0 gap-1.5 overflow-x-auto px-0.5 pb-3"
            >
              {doods.map((dood) => (
                <button
                  key={dood.id}
                  type="button"
                  role="radio"
                  aria-checked={dood.id === dressed.id}
                  onClick={() => setDressedId(dood.id)}
                  className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border pr-3 pl-1 text-sm outline-none hover:border-input focus-visible:ring-3 focus-visible:ring-ring/40 aria-checked:border-primary aria-checked:ring-2 aria-checked:ring-primary/35"
                >
                  <DoodPicture agent={dood} className="size-6" />
                  {dood.name ?? "New Dood"}
                </button>
              ))}
            </div>
          ) : null}
          <div role="tablist" aria-label="Where it is worn" className="flex h-10 shrink-0 border-b">
            {WEAR_SLOTS.map((place) => {
              const here = WEAR_ITEMS.filter((item) => item.slot === place)
              return (
                <button
                  key={place}
                  type="button"
                  role="tab"
                  aria-selected={place === slot}
                  onClick={() => setSlot(place)}
                  className={tab}
                >
                  {SLOT_NAMES[place].many}
                  <span className="text-[0.6875rem] font-normal text-muted-foreground">
                    {here.filter((item) => owned.has(item.id)).length}/{here.length}
                  </span>
                </button>
              )
            })}
          </div>
          <ul
            aria-label={SLOT_NAMES[slot].many}
            className="grid min-h-0 flex-1 auto-rows-min grid-cols-3 gap-2 overflow-y-auto px-0.5 pt-4 pb-2 sm:grid-cols-5 lg:grid-cols-6"
          >
            <Tile
              agent={dressed}
              item={undefined}
              owned
              worn={outfit[slot] === undefined}
              onPick={() => put(slot, undefined)}
            />
            {items.map((item) => {
              const worn = outfit[slot] === item.id
              const finder = creature.foundBy?.[item.id]
              return (
                <Tile
                  key={item.id}
                  agent={dressed}
                  item={item}
                  owned={owned.has(item.id)}
                  worn={worn}
                  foundBy={others > 0 && finder !== undefined ? byId.get(finder) : undefined}
                  wornBy={others > 0 ? (wornBy.get(item.id) ?? []) : []}
                  // Picked while it is on, it comes off.
                  onPick={() => put(slot, worn ? undefined : item.id)}
                />
              )
            })}
          </ul>
          <ul
            aria-label="Rarities"
            className="flex shrink-0 flex-wrap justify-center gap-x-4 gap-y-1 pt-2.5 text-[0.6875rem] text-muted-foreground"
          >
            {RARITIES.map((rarity) => (
              <li key={rarity.id} className="flex items-center gap-1.5">
                <span aria-hidden className="size-2" style={{ background: rarity.color }} />
                {rarity.label}
              </li>
            ))}
          </ul>
        </div>
        {children}
      </DialogContent>
    </Dialog>
  )
}
