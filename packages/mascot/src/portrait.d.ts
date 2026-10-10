import type { MascotCore, Orb } from "./orb-core.js"
import type { SkyCore } from "./sky.js"

/** The island of the first run in a square picture, and where on it a creature stands. */
export type Island = {
  /** The side of the picture, in pixels. */
  grid: number
  picture: HTMLCanvasElement
  /** The side of the picture a creature is drawn in to stand here. */
  body: number
  /** The ground under it, in pixels from the picture's left and top. */
  ground: { x: number; y: number }
}

export interface Portrait {
  /** The hours of the island's morning, as `Sky.dawn` counts them. */
  HOURS: { night: 0; first: 1; sunrise: 2; day: 3 }
  /**
   * The island in a square `grid` pixels across, or null where it cannot be drawn. `zoom` under
   * 1 stands further back, for a picture whose corners will be cut off.
   */
  island(options: { grid: number; hour?: number; zoom?: number }): Island | null
  /** A creature at rest on the island, or its egg. `dress` puts on it what it wears. */
  tile(
    island: Island,
    options: { seed: string; color: string; egg?: boolean; dress?: (orb: Orb) => void },
  ): HTMLCanvasElement
  /**
   * The tile with each pixel `scale` across, its corners rounded by `round` of its side, in
   * `inset` pixels of clear room.
   */
  framed(
    tile: HTMLCanvasElement,
    options: { scale?: number; round?: number; inset?: number },
  ): HTMLCanvasElement
}

/** Builds the app's picture from the drawing code of a creature and of the first run's sky. */
export function AgentOrbPortrait(core: MascotCore, sky: SkyCore): Portrait
