import type { MascotCore, Orb } from "./orb-core.js"

/** What a creature has on: the id of a thing for each place it wears one. */
export type WornOutfit = { hat?: string; glasses?: string; face?: string; neck?: string }

/**
 * A box on a creature's stage. `shut`, it rocks now and then. `shake` is for while what is inside
 * is being found out. `open` plays the opening, through `burst` to `shown`, where what was inside
 * hangs in the light until the box is disposed of.
 */
export interface Gift {
  readonly phase: "shut" | "shake" | "open" | "burst" | "shown"
  /** It was pressed and what is inside is not known yet: it rattles until `open` or `calm`. */
  shake(): void
  calm(): void
  /**
   * Open it on the thing with this id. `tiers` are the colors of the rarities from the commonest
   * up to and including the thing's own: it jolts once for each, and ends in the last.
   */
  open(options: { id: string; tiers: string[] }): void
  /** Take the box away and let the creature be drawn again. */
  dispose(): void
}

export interface Wardrobe {
  /** The places something is worn, in the order things are put on. */
  SLOTS: readonly ("hat" | "glasses" | "face" | "neck")[]
  /** Every thing there is a shape for, by its id: the place it is worn. */
  ITEMS: Readonly<Record<string, "hat" | "glasses" | "face" | "neck">>
  /** Put these on a creature, in place of whatever it wore. An id there is no shape for is left off. */
  dress(orb: Orb, outfit: WornOutfit | null | undefined): void
  /** Take everything off. */
  strip(orb: Orb): void
  /**
   * How far the deepest corner of anything it wears is inside its body, in body radii, measured
   * against the body at rest. Nothing is inside when this is zero or less.
   */
  audit(orb: Orb): number
  /** Show a box on this creature's stage, in its place, until the box is disposed of. */
  unwrap(orb: Orb, options?: { onPop?: () => void; onShown?: () => void }): Gift
}

/** Builds the wardrobe on the same copy of three.js as the core it is given. */
export function AgentOrbWardrobe(three: unknown, core: MascotCore): Wardrobe
