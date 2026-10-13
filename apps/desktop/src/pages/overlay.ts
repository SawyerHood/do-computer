// What is drawn on the computer itself while an agent uses its screen: the agent's pointer, a
// bar that says who it is with Pause and Stop, and a glow round the screen. The page is told
// what to show and draws it; what it says is worked out by the functions at the top, which
// need no page.

/** Everything the page draws, as the app sends it each time something changes. */
export type OverlayView = {
  agent: { name: string; color: string }
  /** What the agent is doing, in a few words. */
  say?: string
  /** True while the owner has paused the agent. */
  held: boolean
  /** Where the agent's pointer is, in the page's own points. None until it has been put somewhere. */
  pointer?: { x: number; y: number }
  /** Counts the agent's clicks, so that a new one can be seen to happen. */
  ripples: number
  /** How far down the bar sits, which is below a menu bar where the screen has one. */
  top: number
  /** False where the bar cannot be clicked, and Esc is the only way to pause. */
  buttons: boolean
  /**
   * True while the agent works in a window behind what its owner has in front. The screen is
   * then still theirs: there is no glow round it, and Esc is not taken from them.
   */
  behind?: boolean
}

/** What the page asks of the app, given to it by the preload script. */
export type OverlayApi = {
  watch(listener: (view: OverlayView) => void): void
  /** The mouse came over the bar, or left it: the window takes clicks only while it is there. */
  over(on: boolean): void
  act(what: OverlayAct): void
}

export type OverlayAct = "pause" | "carry-on" | "stop"

export type Bar = {
  title: string
  detail: string
  /** The first button: what it says and what it does. Stop is always the second. */
  button: { label: string; act: OverlayAct }
  /** Whether to show that Esc pauses. It does only while the agent is working. */
  esc: boolean
}

/** What the bar says. */
export function barOf(view: Pick<OverlayView, "agent" | "say" | "held" | "behind">): Bar {
  const name = view.agent.name.trim() || "A Dood"
  if (view.held) {
    return {
      title: `${name} is paused`,
      detail: "It carries on when you say.",
      button: { label: "Carry on", act: "carry-on" },
      esc: false,
    }
  }
  if (view.behind === true) {
    return {
      title: `${name} is working in the background`,
      detail: (view.say ?? "").trim(),
      button: { label: "Pause", act: "pause" },
      esc: false,
    }
  }
  return {
    title: `${name} is using this computer`,
    detail: (view.say ?? "").trim(),
    button: { label: "Pause", act: "pause" },
    esc: true,
  }
}

/** What the tag beside the agent's pointer says. */
export function tagOf(view: Pick<OverlayView, "agent" | "held">): string {
  const name = view.agent.name.trim() || "Dood"
  return view.held ? `${name} · waiting` : name
}

/** The colour to draw an agent in: its own where the page can draw it, and teal where not. */
export function colorOf(color: string, supports: (color: string) => boolean): string {
  const tidy = color.trim()
  return tidy !== "" && supports(tidy) ? tidy : "#2f9c95"
}

declare global {
  interface Window {
    overlay?: OverlayApi
  }
}

function draw(api: OverlayApi): void {
  const find = <T extends Element>(id: string) => document.getElementById(id) as unknown as T
  const root = document.documentElement
  const bar = find<HTMLElement>("bar")
  const title = find<HTMLElement>("title")
  const detail = find<HTMLElement>("detail")
  const hold = find<HTMLButtonElement>("hold")
  const holdLabel = find<HTMLElement>("hold-label")
  const stop = find<HTMLButtonElement>("stop")
  const esc = find<HTMLElement>("esc")
  const pointer = find<HTMLElement>("pointer")
  const tag = find<HTMLElement>("tag")

  let act: OverlayAct = "pause"
  let ripples: number | undefined

  api.watch((view) => {
    const says = barOf(view)
    act = says.button.act
    root.classList.toggle("held", view.held)
    root.classList.toggle("behind", view.behind === true)
    root.classList.toggle("no-buttons", !view.buttons)
    // The page's rules allow no styles written into it, and do allow these, set from a script.
    root.style.setProperty(
      "--c",
      colorOf(view.agent.color, (color) => CSS.supports("color", color)),
    )
    bar.style.setProperty("--top", `${view.top}px`)
    title.textContent = says.title
    detail.textContent = says.detail
    detail.hidden = says.detail === ""
    holdLabel.textContent = says.button.label
    esc.hidden = !says.esc
    tag.textContent = tagOf(view)

    if (view.pointer === undefined) {
      pointer.hidden = true
    } else {
      // The first place it is put, it is simply there: gliding in from the corner of the
      // screen would say it had been in the corner.
      const first = pointer.hidden !== false
      pointer.classList.toggle("jump", first)
      pointer.style.setProperty("--x", `${view.pointer.x}px`)
      pointer.style.setProperty("--y", `${view.pointer.y}px`)
      pointer.hidden = false
      if (first) {
        void pointer.offsetWidth
        pointer.classList.remove("jump")
      }
    }
    if (ripples !== undefined && view.ripples > ripples && view.pointer !== undefined) {
      // Taking the class away and reading the layout lets the same ripple run again.
      pointer.classList.remove("click")
      void pointer.offsetWidth
      pointer.classList.add("click")
    }
    ripples = view.ripples
    root.classList.add("drawn")
  })

  bar.addEventListener("mouseenter", () => api.over(true))
  bar.addEventListener("mouseleave", () => api.over(false))
  hold.addEventListener("click", () => api.act(act))
  stop.addEventListener("click", () => api.act("stop"))
}

if (typeof window !== "undefined" && window.overlay !== undefined) draw(window.overlay)
