/** What a creature can be shown doing. `done` goes back to `idle` by itself. */
export type MascotState =
  | "idle"
  | "listening"
  | "thinking"
  | "working"
  | "speaking"
  | "waiting"
  | "done"
  | "error"
  | "asleep"
  /** Not hatched yet: the waiting egg. */
  | "egg"

/** The kind of work, for `working`. */
export type MascotVariant = "command" | "file" | "search" | "memory"

export type OrbOptions = {
  /** What its features grow from. The same seed always grows the same creature. */
  seed?: string
  /** `#rrggbb`. */
  color?: string
  /** Its size in CSS pixels. Measured from the canvas when left out. */
  size?: number
  style?: "retro" | "glass"
  /** Whether the page behind it is dark. */
  dark?: boolean
  /** Reduced motion. */
  reduced?: boolean
  /** Whether it looks toward the pointer. Default true. */
  notice?: boolean
  pixelRatio?: number
  /** Draw at the lower frame rate, for one among many. */
  slow?: boolean
}

export interface Orb {
  setSeed(seed: string): void
  setColor(hex: string): void
  setTheme(dark: boolean): void
  setState(state: MascotState, variant?: MascotVariant): void
  getState(): MascotState | "hatching"
  /** One token of the answer being written, or one keystroke of the user's. */
  feed(kind: "token", amount?: number): void
  feed(kind: "key"): void
  /**
   * A hand on it. `x` is where across it, from -1 at its left edge to 1 at its right; `amount` is
   * how much of a stroke, 1 for a whole pat. It comes out of it by itself once left alone.
   */
  pet(x: number, amount?: number): void
  /** Point its attention at a place on the page; null lets go. */
  setPointer(clientX: number | null, clientY?: number): void
  /** The same without a page: a direction, and how strongly. */
  attend(x: number, y: number, strength: number): void
  /** Play the hatch. `onDone` is called once, whether it played through or was skipped. */
  hatch(options?: { onDone?: () => void }): void
  skipHatch(): void
  resize(size?: number): void
  /** One step of its life, for a host that draws it itself. */
  update(seconds: number): void
  render(): void
  dispose(): void
  paused: boolean
  reduced: boolean
  notice: boolean
  /** Called when it changes state by itself: `done` to `idle`, and after hatching. */
  onAuto: ((state: MascotState) => void) | null
  /** Its side in CSS pixels, and in pixels actually drawn. */
  readonly css: number
  readonly px: number
  readonly scene: unknown
}

export interface MascotCore {
  /** A creature drawn into `canvas`, updated by the shared loop until it is disposed. */
  createOrb(canvas: unknown, options?: OrbOptions): Orb
  Orb: new (canvas: unknown, options?: OrbOptions) => Orb
  Runner: {
    orbs: Orb[]
    add(orb: Orb, slow?: boolean): Orb
    remove(orb: Orb): void
    start(): void
    stop(): void
    /** One frame for every creature, for a host with its own loop. Milliseconds. */
    tick(time: number): void
  }
  Stage: {
    /** The shared renderer of a look, or null where WebGL is not to be had. */
    get(key: "px" | "aa"): { renderer: unknown } | null
    /** Give the stage a renderer of the host's own, instead of letting it make one. */
    provide(key: "px" | "aa", renderer: unknown, own?: boolean): { renderer: unknown }
    /** Draw one creature into a square of any renderer, from the bottom left. */
    drawAt(orb: Orb, renderer: unknown, x: number, y: number): void
    release(key: "px" | "aa"): void
  }
  /** Everything a seed decides, as plain data. */
  makeGenome(seed: string): Record<string, unknown>
  /** The same as rows of label and value, for people. */
  describeGenome(genome: Record<string, unknown>, mascot?: boolean): [string, string][]
  PALETTE: Record<string, string>
  STATES: MascotState[]
  VARIANTS: MascotVariant[]
}

/** Builds the mascot on a copy of three.js (r128's core is enough). Touches no page until used. */
export function AgentOrbCore(three: unknown): MascotCore
