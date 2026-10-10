/** Where the egg stands in the sky's picture, for the creature that is laid over it. */
export type EggPlace = {
  /** The ground under it, in CSS pixels from the picture's left and top. */
  x: number
  y: number
  /** How it leans as it comes down, in degrees. */
  lean: number
  /** How far it has spun about its long axis as it comes down, in radians. None once it is down. */
  turn: number
  /** How much of the picture's height it is tall, now and once the view has settled. */
  part: number
  heading: number
  /** How much of its shadow to draw: none while it is high. */
  shadow: number
}

/** The first run's scene: a sky, an island over a floor of cloud, and the light an egg comes down in. */
export interface Sky {
  /** Whether the egg is still on its way down. */
  readonly falling: boolean
  /** Less motion: no fall, no sparks, and the day comes at once. */
  calm: boolean
  /** Called as the egg touches the island. */
  onLand: (() => void) | null
  /** The size it is shown at, in CSS pixels. */
  resize(width: number, height: number): void
  /** One step of it, and its picture. */
  step(seconds: number): void
  render(): void
  /** The egg starts at the top of the sky and comes down. */
  fall(): void
  /** It is down at once. */
  land(): void
  /** How far the night has gone: 0 is night and 3 the sun is up. `now` is without the wait. */
  dawn(phase: number, now?: boolean): void
  /**
   * Keep the egg and the island's top above this many pixels from the top of the picture, by
   * standing back and looking higher. Null gives it all the room.
   */
  clear(top: number | null): void
  egg(): EggPlace
  /** Bits of shell, with some in this color. */
  chips(hex?: string): void
  /** What goes up when it is out. */
  confetti(hexes?: string[]): void
  /** A moment of light about the egg, and over the whole sky. */
  glow(amount: number): void
  flash(amount: number): void
  /** The island dips under something. */
  bump(speed: number): void
  dispose(): void
}

export interface SkyCore {
  /** The scene drawn into `canvas`, or null where WebGL is not to be had. */
  create(canvas: unknown, options?: { reduced?: boolean }): Sky | null
  /** CSS pixels to one of its own, which is the creature's too at the size it is here. */
  PIXEL: number
}

/** Builds the sky on a copy of three.js (r128's core is enough). Touches no page until used. */
export function AgentOrbSky(three: unknown): SkyCore
