// Written by scripts/island.mjs: where an egg stands on the pictures of the first run's island.
export const ISLAND = {
  /** The pictures' size, in their own pixels. */
  width: 1056,
  height: 2288,
  /** The ground under the egg, as parts of the picture's width and height. */
  ground: { x: 0.5, y: 0.3792 },
  /** How much of the picture's height the egg is tall. */
  egg: 0.25,
  /** An egg in its own picture: how far down the ground is, and how much of it the egg is tall. */
  stance: { ground: 0.96, egg: 0.6072 },
} as const
