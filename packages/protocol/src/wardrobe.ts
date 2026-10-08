/**
 * What an agent's creature can be given and can wear. It earns treats by answering; treats fill a
 * box; a box holds one thing to wear that it does not have yet. None of it changes what the agent
 * can do: it is there to be enjoyed.
 */

/** Where on the creature a thing is worn. It wears one thing in each place at most. */
export const WEAR_SLOTS = ["hat", "glasses", "face", "neck"] as const
export type WearSlot = (typeof WEAR_SLOTS)[number]

/**
 * How rare a thing is, commonest first. `odds` is how many boxes in a hundred hold one of that
 * rarity, while there are still things of every rarity to find.
 */
export const RARITIES = [
  { id: "common", label: "Common", color: "#9aa3ad", odds: 60 },
  { id: "uncommon", label: "Uncommon", color: "#4fbf67", odds: 25 },
  { id: "rare", label: "Rare", color: "#4a9bff", odds: 10 },
  { id: "epic", label: "Epic", color: "#b266ff", odds: 4 },
  { id: "legendary", label: "Legendary", color: "#ffb92e", odds: 1 },
] as const
export type RarityId = (typeof RARITIES)[number]["id"]

export type WearItem = { id: string; slot: WearSlot; name: string; rarity: RarityId }

/**
 * Everything there is to find, in the order a wardrobe shows it. The creature's drawing code has
 * the shape of each under the same id; a test holds the two lists to each other.
 */
export const WEAR_ITEMS: readonly WearItem[] = (
  [
    ["party", "hat", "Party hat", "common"],
    ["party2", "hat", "Teal party hat", "common"],
    ["beanie", "hat", "Beanie", "common"],
    ["beanie2", "hat", "Blue beanie", "common"],
    ["bobble", "hat", "Bobble hat", "common"],
    ["sprout", "hat", "Sprout", "common"],
    ["cone", "hat", "Traffic cone", "common"],
    ["cap", "hat", "Cap", "common"],
    ["backcap", "hat", "Backwards cap", "common"],
    ["beret", "hat", "Beret", "common"],
    ["bow", "hat", "Bow", "common"],
    ["paperhat", "hat", "Paper hat", "common"],
    ["bucket", "hat", "Bucket hat", "common"],
    ["straw", "hat", "Straw hat", "common"],
    ["sweatband", "hat", "Sweatband", "common"],
    ["papercrown", "hat", "Paper crown", "common"],
    ["eggshell", "hat", "Eggshell", "common"],
    ["tophat", "hat", "Top hat", "uncommon"],
    ["bowler", "hat", "Bowler", "uncommon"],
    ["cowboy", "hat", "Cowboy hat", "uncommon"],
    ["fez", "hat", "Fez", "uncommon"],
    ["chef", "hat", "Chef's hat", "uncommon"],
    ["hardhat", "hat", "Hard hat", "uncommon"],
    ["headphones", "hat", "Headphones", "uncommon"],
    ["mortarboard", "hat", "Mortarboard", "uncommon"],
    ["daisy", "hat", "Daisy", "uncommon"],
    ["catears", "hat", "Cat ears", "uncommon"],
    ["devilhorns", "hat", "Little horns", "uncommon"],
    ["wizard", "hat", "Wizard hat", "rare"],
    ["propeller", "hat", "Propeller cap", "rare"],
    ["viking", "hat", "Viking helmet", "rare"],
    ["santa", "hat", "Santa hat", "rare"],
    ["bunny", "hat", "Bunny ears", "rare"],
    ["mushroom", "hat", "Mushroom cap", "rare"],
    ["frog", "hat", "Frog hat", "rare"],
    ["crown", "hat", "Crown", "epic"],
    ["halo", "hat", "Halo", "epic"],
    ["cloud", "hat", "Rain cloud", "epic"],
    ["spacehelmet", "hat", "Space helmet", "epic"],
    ["ufo", "hat", "Visitor", "legendary"],
    ["starcrown", "hat", "Crown of stars", "legendary"],
    ["round", "glasses", "Round glasses", "common"],
    ["wire", "glasses", "Wire rims", "common"],
    ["square", "glasses", "Square glasses", "common"],
    ["thick", "glasses", "Thick frames", "common"],
    ["halfmoon", "glasses", "Half-moons", "common"],
    ["sleepmask", "glasses", "Sleep mask", "common"],
    ["shades", "glasses", "Shades", "common"],
    ["eyepatch", "glasses", "Eye patch", "common"],
    ["aviators", "glasses", "Aviators", "uncommon"],
    ["monocle", "glasses", "Monocle", "uncommon"],
    ["threed", "glasses", "3D glasses", "uncommon"],
    ["hearts", "glasses", "Heart shades", "uncommon"],
    ["cateye", "glasses", "Cat-eye glasses", "uncommon"],
    ["shutter", "glasses", "Shutter shades", "uncommon"],
    ["visor", "glasses", "Visor", "rare"],
    ["stars", "glasses", "Star shades", "rare"],
    ["pixel", "glasses", "Pixel shades", "rare"],
    ["goggles", "glasses", "Goggles", "rare"],
    ["vr", "glasses", "Headset", "rare"],
    ["holo", "glasses", "Holo visor", "epic"],
    ["blush", "face", "Rosy cheeks", "common"],
    ["freckles", "face", "Freckles", "common"],
    ["nose", "face", "Red nose", "common"],
    ["moustache", "face", "Moustache", "common"],
    ["bandage", "face", "Plaster", "common"],
    ["sweat", "face", "Sweat drop", "common"],
    ["starsticker", "face", "Star sticker", "common"],
    ["heartsticker", "face", "Heart sticker", "common"],
    ["brows", "face", "Bushy brows", "common"],
    ["buckteeth", "face", "Buck teeth", "common"],
    ["carrot", "face", "Carrot nose", "uncommon"],
    ["snout", "face", "Snout", "uncommon"],
    ["whiskers", "face", "Whiskers", "uncommon"],
    ["curly", "face", "Curly moustache", "uncommon"],
    ["fangs", "face", "Fangs", "uncommon"],
    ["lollipop", "face", "Lollipop", "uncommon"],
    ["beard", "face", "Beard", "uncommon"],
    ["bubblegum", "face", "Bubblegum", "rare"],
    ["blower", "face", "Party blower", "rare"],
    ["bigbeard", "face", "Wise beard", "rare"],
    ["bowtie", "neck", "Bow tie", "common"],
    ["bowtie2", "neck", "Dotty bow tie", "common"],
    ["scarf", "neck", "Scarf", "common"],
    ["necktie", "neck", "Necktie", "common"],
    ["bandana", "neck", "Bandana", "common"],
    ["bib", "neck", "Bib", "common"],
    ["badge", "neck", "Name badge", "common"],
    ["whistle", "neck", "Whistle", "common"],
    ["key", "neck", "Key on a string", "common"],
    ["collar", "neck", "Collar", "common"],
    ["stripyscarf", "neck", "Stripy scarf", "uncommon"],
    ["bell", "neck", "Bell collar", "uncommon"],
    ["pearls", "neck", "Pearls", "uncommon"],
    ["medal", "neck", "Medal", "uncommon"],
    ["lei", "neck", "Lei", "uncommon"],
    ["cape", "neck", "Cape", "rare"],
    ["chain", "neck", "Gold chain", "rare"],
    ["float", "neck", "Pool float", "rare"],
    ["hoop", "neck", "Hula hoop", "epic"],
  ] as const
).map(([id, slot, name, rarity]) => ({ id, slot, name, rarity }))

const BY_ID = new Map(WEAR_ITEMS.map((item) => [item.id, item]))

export const wearItem = (id: string): WearItem | undefined => BY_ID.get(id)
export const rarityOf = (id: RarityId) => RARITIES.find((rarity) => rarity.id === id)!

/** What a creature has on: the id of a thing for each place it wears one. */
export type Outfit = Partial<Record<WearSlot, string>>

/** How many treats fill a box. */
export const TREATS_PER_BOX = 4

/** The treats there are. Which one a creature is handed next is only for show. */
export const TREAT_KINDS = ["cookie", "onigiri", "apple", "donut"] as const
export type TreatKind = (typeof TREAT_KINDS)[number]

export type CreatureState = {
  /** Treats it has earned and not been given yet. */
  treats: number
  /** Treats it has been given, ever. */
  fed: number
  /** Treats given since its last box, out of `TREATS_PER_BOX`. */
  joy: number
  /** Boxes it has found and not opened. */
  boxes: number
  /** The ids of the things it has, in the order it found them. */
  owned: string[]
  outfit: Outfit
}

/** A creature that has been given nothing yet. Its first box is waiting: a welcome. */
export const NEW_CREATURE: CreatureState = {
  treats: 0,
  fed: 0,
  joy: 0,
  boxes: 1,
  owned: [],
  outfit: {},
}

/**
 * The treat on top of its pile. Each treat a creature ever earns has a number, and its kind
 * follows from that number and the creature, so that the pile looks the same wherever it is shown.
 */
export function topTreat(agentId: string, state: Pick<CreatureState, "treats" | "fed">): TreatKind {
  let hash = state.fed + state.treats
  for (let index = 0; index < agentId.length; index++) {
    hash = (hash * 31 + agentId.charCodeAt(index)) >>> 0
  }
  return TREAT_KINDS[(hash >>> 3) % TREAT_KINDS.length]!
}

/** Whether there is anything left for a box to hold. */
export const hasEverything = (owned: readonly string[]): boolean =>
  WEAR_ITEMS.every((item) => owned.includes(item.id))

/**
 * What a box holds: something not owned yet. The rarity is drawn first, by its odds among the
 * rarities that still have something to find, and then a thing of that rarity, each as likely as
 * the next. `random` gives numbers from 0 up to 1. Undefined once everything is owned.
 */
export function rollItem(owned: readonly string[], random: () => number): WearItem | undefined {
  const left = WEAR_ITEMS.filter((item) => !owned.includes(item.id))
  if (left.length === 0) return undefined
  const tiers = RARITIES.filter((rarity) => left.some((item) => item.rarity === rarity.id))
  let at = random() * tiers.reduce((sum, rarity) => sum + rarity.odds, 0)
  let tier = tiers[tiers.length - 1]!
  for (const rarity of tiers) {
    at -= rarity.odds
    if (at < 0) {
      tier = rarity
      break
    }
  }
  const pool = left.filter((item) => item.rarity === tier.id)
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]
}

/** An outfit made only of things that are owned, each in its own place; or what is wrong with it. */
export function parseOutfit(
  value: unknown,
  owned: readonly string[],
): { outfit: Outfit } | { error: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { error: "An outfit names a thing for each place something is worn" }
  }
  const outfit: Outfit = {}
  for (const [slot, id] of Object.entries(value)) {
    if (!(WEAR_SLOTS as readonly string[]).includes(slot)) {
      return { error: `Nothing is worn on "${slot}"` }
    }
    if (id === null || id === undefined || id === "") continue
    const item = typeof id === "string" ? wearItem(id) : undefined
    if (item === undefined) return { error: `There is no such thing as "${String(id)}"` }
    if (item.slot !== slot) return { error: `${item.name} is not worn there` }
    if (!owned.includes(item.id)) return { error: `${item.name} has not been found yet` }
    outfit[slot as WearSlot] = item.id
  }
  return { outfit }
}
