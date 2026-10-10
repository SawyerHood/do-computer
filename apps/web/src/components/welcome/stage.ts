import type { MascotCore, Orb, Sky, SkyCore } from "@durable-computer/mascot"

/** The side of the creature's picture is kept between these, whatever the window. */
const MIN_SIDE = 60
const MAX_SIDE = 600

/**
 * The sky and the creature over it, kept in step. The sky is one picture and the creature
 * another, laid over it: every frame the creature's is put where the sky says the egg stands,
 * at the size the sky's view makes it.
 */
export class Stage {
  /** The card under the egg. While it shows, the view keeps the egg clear of it. */
  card: HTMLElement | null = null
  readonly #root: HTMLElement
  readonly #egg: HTMLElement
  readonly #pixel: number
  #side = 0
  #sizedFor = 0
  #width = 0
  #height = 0
  #raf = 0
  #last = 0
  #flying = false

  private constructor(
    readonly sky: Sky,
    readonly orb: Orb,
    root: HTMLElement,
    egg: HTMLElement,
    pixel: number,
  ) {
    this.#root = root
    this.#egg = egg
    this.#pixel = pixel
    this.#raf = requestAnimationFrame(this.#frame)
  }

  /** Null where the sky cannot be drawn. */
  static make(
    drawing: { core: MascotCore; sky: SkyCore },
    at: {
      root: HTMLElement
      sky: HTMLCanvasElement
      egg: HTMLElement
      creature: HTMLCanvasElement
    },
    look: { seed: string; color: string },
    calm: boolean,
  ): Stage | null {
    const sky = drawing.sky.create(at.sky, { reduced: calm })
    if (sky === null) return null
    const orb = drawing.core.createOrb(at.creature, {
      seed: look.seed,
      color: look.color,
      size: 300,
      dark: true,
      reduced: calm,
      // It looks about once it is out. An egg has nothing to look with.
      notice: false,
    })
    orb.setState("egg")
    return new Stage(sky, orb, at.root, at.egg, drawing.sky.PIXEL)
  }

  /** Its look changed, and with it how tall its egg stands: it is measured again. */
  measure(): void {
    this.#sizedFor = 0
  }

  #frame = (now: number) => {
    this.#raf = requestAnimationFrame(this.#frame)
    const seconds = Math.min(0.05, (now - this.#last) / 1000 || 0)
    this.#last = now
    const { sky, orb } = this
    const width = this.#root.clientWidth
    const height = this.#root.clientHeight
    if (width === 0 || height === 0) return
    if (width !== this.#width || height !== this.#height) {
      this.#width = width
      this.#height = height
      this.#sizedFor = 0
      sky.resize(width, height)
    }
    if (this.card?.dataset.on === "true") sky.clear(this.card.offsetTop)
    sky.step(seconds)
    sky.render()
    if (this.#flying) return
    const place = sky.egg()
    const stance = orb.stance()
    // Its picture is sized for where the view is heading, and scaled while the view gets there.
    if (Math.abs(place.heading - this.#sizedFor) > 0.004) {
      this.#sizedFor = place.heading
      const side = Math.round((place.heading * height) / stance.egg / this.#pixel) * this.#pixel
      this.#side = Math.max(MIN_SIDE, Math.min(MAX_SIDE, side))
      this.#egg.style.width = this.#egg.style.height = `${this.#side}px`
      orb.resize(this.#side)
    }
    orb.shadow = place.shadow
    const side = this.#side
    // While it is still above the picture it is kept just over the top edge: a creature far
    // off the screen is not drawn at all, and would come into view a moment before its picture.
    const top = Math.max(1 - side, Math.round(place.y - side * stance.ground))
    this.#egg.style.transformOrigin = `50% ${(stance.ground * 100).toFixed(2)}%`
    this.#egg.style.transform =
      `translate(${Math.round(place.x - side / 2)}px, ${top}px) ` +
      `rotate(${place.lean.toFixed(2)}deg) scale(${(place.part / this.#sizedFor).toFixed(4)})`
  }

  /**
   * The creature leaves the island for somewhere else on the page: its picture goes to where
   * another picture of it is, and comes to be that one's size.
   */
  fly(to: DOMRect, ms: number): void {
    const egg = this.#egg
    const from = egg.getBoundingClientRect()
    const base = this.#root.getBoundingClientRect()
    this.#flying = true
    egg.style.transformOrigin = "0 0"
    egg.style.transform = `translate(${from.left - base.left}px, ${from.top - base.top}px) scale(${from.width / this.#side})`
    // Read back, so that the move starts from where it is and not from where it was last put.
    void egg.offsetWidth
    egg.style.transition = `transform ${ms}ms cubic-bezier(0.55, 0, 0.2, 1)`
    egg.style.transform = `translate(${to.left - base.left}px, ${to.top - base.top}px) scale(${to.width / this.#side})`
  }

  dispose(): void {
    cancelAnimationFrame(this.#raf)
    this.orb.dispose()
    this.sky.dispose()
  }
}
