import type { Avatar } from "./agent.ts"

/**
 * The colors an agent's creature can be. Its features are not chosen: they are grown from its
 * seed, so only the color is a pick.
 */
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

export type AvatarColorId = (typeof AVATAR_COLORS)[number]["id"]

const MAX_SEED_CHARS = 64

/** The avatar if it names a bundled color, otherwise a description of what is wrong. */
export function parseAvatar(value: { color?: unknown; seed?: unknown }):
  | {
      avatar: Avatar
    }
  | { error: string } {
  if (!AVATAR_COLORS.some((color) => color.id === value.color)) {
    return { error: `Unknown color "${String(value.color)}"` }
  }
  const avatar: Avatar = { color: value.color as string }
  if (value.seed !== undefined) {
    if (typeof value.seed !== "string" || value.seed === "" || value.seed.length > MAX_SEED_CHARS) {
      return { error: `A seed is 1 to ${MAX_SEED_CHARS} characters` }
    }
    avatar.seed = value.seed
  }
  return { avatar }
}

/** A stable default for an agent that has not picked yet, so its color does not change on reload. */
export function defaultAvatar(agentId: string): Avatar {
  let hash = 0
  for (let index = 0; index < agentId.length; index++) {
    hash = (hash * 31 + agentId.charCodeAt(index)) >>> 0
  }
  return { color: AVATAR_COLORS[(hash >>> 8) % AVATAR_COLORS.length]!.id }
}

/**
 * What an agent's creature is drawn from: the seed its features grow from, and its color. An
 * agent that never rolled a new look grows from its own id, which was random to begin with.
 */
export function avatarLook(
  avatar: Avatar | null | undefined,
  agentId: string,
): { seed: string; color: string } {
  const resolved = avatar ?? defaultAvatar(agentId)
  const color =
    AVATAR_COLORS.find((entry) => entry.id === resolved.color)?.hex ??
    AVATAR_COLORS.find((entry) => entry.id === defaultAvatar(agentId).color)!.hex
  return { seed: resolved.seed ?? agentId, color }
}
