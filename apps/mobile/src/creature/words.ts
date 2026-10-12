import {
  BOX_EVERY_MS,
  type CreatureState,
  hasEverything,
  WEAR_ITEMS,
  type WearSlot,
} from "@do-computer/protocol"

// What is said about a creature's things and its boxes: words only, so that they can be tested.

/** What each place is called: over a list of the things worn there, and for one of them. */
export const SLOT_NAMES: Record<WearSlot, { many: string; one: string }> = {
  hat: { many: "Hats", one: "Hat" },
  glasses: { many: "Glasses", one: "Glasses" },
  face: { many: "Face", one: "Face" },
  neck: { many: "Neck", one: "Neck" },
}

/** How far along its next box is, from 0 to 1, and about how long is left, in words. */
export function boxProgress(state: Pick<CreatureState, "nextBoxAt">, now = Date.now()) {
  const left = Math.max(0, (state.nextBoxAt ?? now + BOX_EVERY_MS) - now)
  const hours = Math.round(left / 3_600_000)
  const minutes = Math.max(1, Math.round(left / 60_000))
  return {
    part: Math.min(1, Math.max(0, 1 - left / BOX_EVERY_MS)),
    left:
      minutes < 60
        ? `${minutes} ${minutes === 1 ? "minute" : "minutes"}`
        : `${hours} ${hours === 1 ? "hour" : "hours"}`,
  }
}

/**
 * The line under the creature's name in its wardrobe: how much it has found, and what there is
 * to say about its boxes. Read from the clock when it is called, so call it when the page is shown.
 */
export function foundLine(creature: CreatureState, now = Date.now()): string {
  const found = `${creature.owned.length} of ${WEAR_ITEMS.length} found`
  if (hasEverything(creature.owned)) return found
  if (creature.boxes > 1) return `${found} · ${creature.boxes} boxes waiting`
  if (creature.boxes === 1) return `${found} · a box is waiting`
  return `${found} · next box in ${boxProgress(creature, now).left}`
}
