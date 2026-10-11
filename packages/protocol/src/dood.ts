import type { Avatar } from "./agent.ts"
import { AVATAR_COLORS, type AvatarColorId } from "./avatars.ts"
import { type Outfit, WEAR_ITEMS, type WearItem } from "./wardrobe.ts"

/**
 * A Dood: a creature someone hatched without an account, in a post or on its own page. It has a
 * name, a look and at most one thing on, and anyone who opens its page can stroke it and give it
 * a treat. Claimed by someone who signs in, it becomes their first agent, as it looks.
 */
export type Dood = {
  id: string
  name: string
  avatar: Avatar & { seed: string }
  outfit: Outfit
  /** How often it has been stroked and fed, by anyone. */
  pats: number
  treats: number
  /** Whether someone has made it theirs. */
  claimed: boolean
  /** Treats toward its owner's next present, out of `TREATS_PER_BOX`. Absent until it is claimed. */
  joy?: number
}

/** What whoever hatched one says about it. `item` is the thing they kept out of its present. */
export type NewDood = { name: string; color: AvatarColorId; seed: string; item?: string }

/** What making one answers: the Dood, and the key that lets whoever hatched it claim it. */
export type MadeDood = { dood: Dood; key: string }

export const DOOD_NAME_MAX = 20
/** How many strokes one call may count. */
export const DOOD_PATS_MAX = 20

/**
 * A name as it is kept: letters, digits and a little punctuation in any script, with single
 * spaces. Undefined where nothing is left, or where it reads as an address, since a name is shown
 * to anyone under the deployment's own.
 */
export function parseDoodName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const name = value
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\p{M} '’.!?-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, DOOD_NAME_MAX)
    .trim()
  if (name === "" || !/[\p{L}\p{N}]/u.test(name)) return undefined
  if (/\b(?:https?|www)\b|\.[a-z]{2,}$/i.test(name)) return undefined
  return name
}

export const isDoodColor = (value: unknown): value is AvatarColorId =>
  AVATAR_COLORS.some((color) => color.id === value)

/** A seed as the egg's page makes one. */
export const isDoodSeed = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z0-9-]{4,32}$/.test(value)

function hashOf(text: string): number {
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619) >>> 0
  }
  return hash
}

/**
 * What is in a new Dood's present: three things to choose one from, a common one, an uncommon
 * one and a rarer one. They follow from its seed, so that whoever is told which was kept can say
 * whether it was in the box.
 */
export function dealPresent(seed: string): [WearItem, WearItem, WearItem] {
  const of = (rarity: WearItem["rarity"], salt: string) => {
    const pool = WEAR_ITEMS.filter((item) => item.rarity === rarity)
    return pool[hashOf(`${seed}:${salt}`) % pool.length]!
  }
  const rarest = hashOf(`${seed}:tier`) % 10 < 7 ? "rare" : "epic"
  return [of("common", "first"), of("uncommon", "second"), of(rarest, "third")]
}

/** The thing kept out of a Dood's present, if it was one of the three in it. */
export const keptFrom = (seed: string, item: unknown): WearItem | undefined =>
  dealPresent(seed).find((dealt) => dealt.id === item)
