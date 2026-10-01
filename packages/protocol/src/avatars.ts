import type { Avatar } from "./agent.ts"

/** Bundled characters. Clients draw them; the agent and the user only pick. */
export const AVATAR_CHARACTERS = [
  { id: "sprout", label: "Sprout", description: "a small leafy seedling" },
  { id: "ember", label: "Ember", description: "a warm little flame" },
  { id: "pebble", label: "Pebble", description: "a round, calm stone" },
  { id: "comet", label: "Comet", description: "a star with a trailing tail" },
  { id: "moth", label: "Moth", description: "a soft, fuzzy moth" },
  { id: "kelp", label: "Kelp", description: "a wavy sea plant" },
  { id: "biscuit", label: "Biscuit", description: "a friendly square cracker" },
  { id: "orbit", label: "Orbit", description: "a planet with a ring" },
] as const

export const AVATAR_COLORS = [
  { id: "clay", label: "Clay", hex: "#b8674a" },
  { id: "moss", label: "Moss", hex: "#5f8a4e" },
  { id: "tide", label: "Tide", hex: "#3f7f9c" },
  { id: "plum", label: "Plum", hex: "#7d5a9a" },
  { id: "honey", label: "Honey", hex: "#c9952c" },
  { id: "slate", label: "Slate", hex: "#5b6672" },
  { id: "rose", label: "Rose", hex: "#c0607a" },
  { id: "ink", label: "Ink", hex: "#2f3a52" },
] as const

export const AVATAR_ACCESSORIES = [
  { id: "glasses", label: "Glasses" },
  { id: "hat", label: "Hat" },
  { id: "bowtie", label: "Bow tie" },
  { id: "headphones", label: "Headphones" },
  { id: "scarf", label: "Scarf" },
] as const

export type AvatarCharacterId = (typeof AVATAR_CHARACTERS)[number]["id"]
export type AvatarColorId = (typeof AVATAR_COLORS)[number]["id"]
export type AvatarAccessoryId = (typeof AVATAR_ACCESSORIES)[number]["id"]

const has = (list: readonly { id: string }[], id: string) => list.some((item) => item.id === id)

/** The avatar if every choice names a bundled option, otherwise a description of what is wrong. */
export function parseAvatar(value: {
  character: string
  color: string
  accessory?: string
}): { avatar: Avatar } | { error: string } {
  if (!has(AVATAR_CHARACTERS, value.character)) {
    return { error: `Unknown character "${value.character}"` }
  }
  if (!has(AVATAR_COLORS, value.color)) return { error: `Unknown color "${value.color}"` }
  if (value.accessory !== undefined && !has(AVATAR_ACCESSORIES, value.accessory)) {
    return { error: `Unknown accessory "${value.accessory}"` }
  }
  const avatar: Avatar = { character: value.character, color: value.color }
  if (value.accessory !== undefined) avatar.accessory = value.accessory
  return { avatar }
}

/** A stable default for an agent that has not picked yet, so its avatar does not change on reload. */
export function defaultAvatar(seed: string): Avatar {
  let hash = 0
  for (let index = 0; index < seed.length; index++) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0
  }
  return {
    character: AVATAR_CHARACTERS[hash % AVATAR_CHARACTERS.length]!.id,
    color: AVATAR_COLORS[(hash >>> 8) % AVATAR_COLORS.length]!.id,
  }
}
