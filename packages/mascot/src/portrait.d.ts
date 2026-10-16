import type { MascotCore, MascotState, Orb } from "./orb-core.js"
import type { SkyCore } from "./sky.js"

/**
 * What a creature stands on in a square picture, and where on it: a plain square of its own
 * color, or the island of the first run.
 */
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
   * A plain square `grid` pixels across to stand a creature of this color on: its color, made
   * deep. `zoom` under 1 draws the creature smaller.
   */
  backdrop(options: { grid: number; color: string; zoom?: number }): Island
  /**
   * The island in a square `grid` pixels across, or null where it cannot be drawn, which is
   * also where no sky was given. `zoom` under
   * 1 stands further back, for a picture whose corners will be cut off.
   */
  island(options: { grid: number; hour?: number; zoom?: number }): Island | null
  /** A creature at rest where it stands, or its egg. `dress` puts on it what it wears. */
  tile(
    where: Island,
    options: { seed: string; color: string; egg?: boolean; dress?: (orb: Orb) => void },
  ): HTMLCanvasElement
  /**
   * The creature alone, as large as fits `wide` by `tall` pixels, on a canvas it fills: what a
   * tray shows. `ball` keeps the ball that floats over its head. Null where it does not fit.
   */
  sprite(options: {
    seed: string
    color: string
    wide: number
    tall: number
    state?: MascotState
    dress?: (orb: Orb) => void
    ball?: boolean
  }): HTMLCanvasElement | null
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
export function AgentOrbPortrait(core: MascotCore, sky?: SkyCore | null): Portrait
