import { ApiError } from "@do-computer/client"
import type { Gift } from "@do-computer/mascot"
import {
  AVATAR_COLORS,
  type AvatarColorId,
  DOOD_NAME_MAX,
  DOOD_PATS_MAX,
  type Dood,
  dealPresent,
  parseDoodName,
  RARITIES,
  rarityOf,
  TREATS_PER_BOX,
  type WearItem,
} from "@do-computer/protocol"
import {
  type ComponentProps,
  type FormEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
} from "react"
import { Stage } from "@/components/welcome/stage"
import { client } from "@/lib/client"
import { dressMascot, loadMascot, loadSky, mascotWardrobe, prefersCalm } from "@/lib/mascot"
import { cn } from "@/lib/utils"

const hexOf = (id: AvatarColorId) => AVATAR_COLORS.find((color) => color.id === id)!.hex
/** A seed as `isDoodSeed` wants one: eight letters and digits. */
const newSeed = () => `${Math.random().toString(36).slice(2, 10)}dood`.slice(0, 8)
const tiersTo = (item: WearItem) =>
  RARITIES.slice(0, RARITIES.findIndex((rarity) => rarity.id === item.rarity) + 1).map(
    (rarity) => rarity.color,
  )
const wearing = (item: WearItem) => ({ [item.slot]: item.id })

/** How often the strokes made since the last time are told to the server. */
const PATS_EVERY_MS = 4000

/** The Dood this browser hatched last, and the key that claims it. */
const KEPT = "dc-dood"
type Kept = { id: string; key: string }

// Inside a post the page is in someone else's frame, where a browser may refuse to keep anything.
function kept(): Kept | undefined {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEPT) ?? "null")
    const { id, key } = (value ?? {}) as Partial<Kept>
    return typeof id === "string" && typeof key === "string" ? { id, key } : undefined
  } catch {
    return undefined
  }
}

function keep(made: Kept): void {
  try {
    localStorage.setItem(KEPT, JSON.stringify(made))
  } catch {
    // It is still theirs for as long as the page is open.
  }
}

function framed(): boolean {
  try {
    return window.top !== window
  } catch {
    return true
  }
}

const claimUrl = (made: Kept) =>
  `/welcome?dood=${encodeURIComponent(made.id)}&key=${encodeURIComponent(made.key)}`

type Step = "none" | "name" | "out" | "gift" | "choose" | "ready" | "meet"
type Said = { line: string; small?: string }

/**
 * A Dood on its island, filling the window: the whole of a page that X plays inside a post, in
 * a small square. With no Dood given, an egg comes down and whoever is here hatches it, names
 * it, and keeps one thing out of its present. With one, it is out, to be stroked and fed.
 */
export function DoodCard({ origin, dood }: { origin: string; dood?: Dood }) {
  const root = useRef<HTMLDivElement>(null)
  const skyCanvas = useRef<HTMLCanvasElement>(null)
  const egg = useRef<HTMLDivElement>(null)
  const creature = useRef<HTMLCanvasElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const stage = useRef<Stage | null>(null)
  const gift = useRef<Gift | null>(null)
  const phase = useRef<"wait" | "fall" | "tap" | "busy">("wait")
  const taps = useRef(0)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const first = useRef(dood)

  const [drawn, setDrawn] = useState<boolean>()
  const [placed, setPlaced] = useState(false)
  const [step, setStep] = useState<Step>("none")
  const [said, setSaid] = useState<Said | null>(null)
  const [typed, setTyped] = useState("")
  const [name, setName] = useState(dood?.name ?? "")
  const [color, setColor] = useState<AvatarColorId>(
    () => AVATAR_COLORS.find((each) => each.id === dood?.avatar.color)?.id ?? "tide",
  )
  const [seed, setSeed] = useState(() => dood?.avatar.seed ?? newSeed())
  const [picked, setPicked] = useState<WearItem | null>(null)
  const [made, setMade] = useState<Kept | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ line: string; name?: boolean } | null>(null)
  // The one being met, as it is after what was done here.
  const [met, setMet] = useState(dood)
  const [given, setGiven] = useState(false)
  const [full, setFull] = useState(false)
  const [mine, setMine] = useState<Kept>()
  const pats = useRef({ stroke: 0, unsent: 0 })
  // Where its feet are in its picture, once it is out: what it is made smaller toward.
  const [feet, setFeet] = useState<number>()
  const [short, setShort] = useState(false)

  const three = dealPresent(seed)
  const hex = hexOf(color)

  const later = (run: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      run()
    }, ms)
    timers.current.add(timer)
  }

  const landed = () => {
    if (phase.current !== "fall") return
    phase.current = "tap"
    stage.current?.orb.cheer()
    setSaid({ line: "Tap the egg", small: "It hatches for whoever is here" })
  }
  const heard = useRef(landed)
  heard.current = landed

  // Set up once, with the look it starts with. What changes after is told to the creature as
  // it changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, as it opens
  useEffect(() => {
    let gone = false
    const pending = timers.current
    const meeting = first.current
    void Promise.all([loadMascot(), loadSky()]).then(([core, sky]) => {
      if (gone) return
      const calm = prefersCalm()
      const drawing =
        core !== null &&
        sky !== null &&
        root.current &&
        skyCanvas.current &&
        egg.current &&
        creature.current
          ? Stage.make(
              { core, sky },
              {
                root: root.current,
                sky: skyCanvas.current,
                egg: egg.current,
                creature: creature.current,
              },
              { seed, color: hex },
              calm,
            )
          : null
      setDrawn(drawing !== null)
      if (meeting !== undefined) setStep("meet")
      if (drawing === null) return
      stage.current = drawing
      drawing.card = panel.current
      // The creature's picture is put in its place by the next frame, and shown after it.
      requestAnimationFrame(() => requestAnimationFrame(() => !gone && setPlaced(true)))
      if (meeting !== undefined) {
        drawing.orb.setState("idle")
        dressMascot(drawing.orb, meeting.outfit)
        drawing.orb.notice = true
        drawing.measure()
        setFeet(drawing.orb.stance().ground)
        drawing.sky.land()
        drawing.sky.dawn(3, true)
        return
      }
      phase.current = "fall"
      setSaid({ line: "An egg is on its way down" })
      drawing.sky.onLand = () => heard.current()
      if (calm) {
        drawing.sky.land()
        heard.current()
      } else drawing.sky.fall()
    })
    return () => {
      gone = true
      for (const timer of pending) clearTimeout(timer)
      gift.current?.dispose()
      stage.current?.dispose()
      stage.current = null
    }
  }, [])

  useEffect(() => {
    const query = matchMedia("(max-height: 560px)")
    const hear = () => setShort(query.matches)
    hear()
    query.addEventListener("change", hear)
    return () => query.removeEventListener("change", hear)
  }, [])

  // Strokes are counted here as they are made, and told to the server a few at a time.
  const id = first.current?.id
  useEffect(() => {
    if (id === undefined) return
    setMine(kept())
    const send = () => {
      const count = Math.min(DOOD_PATS_MAX, pats.current.unsent)
      if (count === 0) return
      pats.current.unsent -= count
      void client.doods.pat(id, count).catch(() => {})
    }
    // Seldom enough that someone who strokes it for a whole minute is not taken for a flood.
    const timer = setInterval(send, PATS_EVERY_MS)
    return () => {
      clearInterval(timer)
      send()
    }
  }, [id])

  function tap() {
    const drawing = stage.current
    if (drawing === null) return
    if (phase.current === "fall") {
      drawing.sky.land()
      return landed()
    }
    if (phase.current !== "tap") return
    taps.current++
    drawing.orb.crack(taps.current === 1 ? 0.34 : 0.67)
    drawing.sky.chips(hex)
    drawing.sky.dawn(taps.current)
    drawing.sky.bump(0.5)
    if (taps.current === 1) return setSaid({ line: "Again" })
    phase.current = "busy"
    setSaid(null)
    setStep("name")
  }

  const burst = () => {
    const sky = stage.current?.sky
    sky?.flash(0.55)
    sky?.dawn(3)
    sky?.bump(0.9)
    sky?.confetti(AVATAR_COLORS.map((each) => each.hex))
  }
  const born = () => {
    if (stage.current === null) return
    stage.current.orb.notice = true
    setFeet(stage.current.orb.stance().ground)
    setStep("out")
  }

  function hatch(event: FormEvent) {
    event.preventDefault()
    const parsed = parseDoodName(typed)
    if (parsed === undefined) return setError({ line: "Try a name of letters and numbers." })
    setError(null)
    setName(parsed)
    setTyped(parsed)
    setStep("none")
    stage.current?.orb.hatch({ onOut: burst, onDone: born })
  }

  // Another one: the same name and colour, and whatever the new egg holds.
  function again() {
    const drawing = stage.current
    if (drawing === null) return
    const next = newSeed()
    setSeed(next)
    setFeet(undefined)
    setStep("none")
    const { orb, sky } = drawing
    orb.notice = false
    sky.flash(0.35)
    sky.bump(0.7)
    orb.setSeed(next)
    orb.setColor(hex)
    orb.setState("egg")
    orb.crack(0.67)
    drawing.measure()
    later(() => sky.chips(hex), 350)
    later(() => orb.hatch({ onOut: burst, onDone: born }), 1000)
  }

  const choose = () => {
    gift.current?.dispose()
    gift.current = null
    setStep("choose")
  }

  // What it came with: a box of the app's, with three things in it and one to keep.
  function present() {
    const drawing = stage.current
    const wardrobe = mascotWardrobe()
    if (drawing !== null && wardrobe !== undefined) {
      gift.current = wardrobe.unwrap(drawing.orb, {
        onPop: () => {
          drawing.sky.flash(0.4)
          drawing.sky.bump(0.6)
        },
        onShown: () => later(choose, 700),
      })
    }
    setStep("gift")
  }

  function open() {
    const box = gift.current
    if (box === null) return choose()
    setStep("none")
    box.shake()
    later(() => box.open({ id: three[2].id, tiers: tiersTo(three[2]) }), 800)
  }

  function tryOn(item: WearItem) {
    setPicked(item)
    const drawing = stage.current
    if (drawing === null) return
    dressMascot(drawing.orb, wearing(item))
    drawing.orb.cheer()
    drawing.sky.glow(0.6)
  }

  async function keepIt(event: FormEvent) {
    event.preventDefault()
    if (picked === null) return
    const parsed = parseDoodName(typed)
    if (parsed === undefined)
      return setError({ line: "Try a name of letters and numbers.", name: true })
    setBusy(true)
    setError(null)
    try {
      const { dood: one, key } = await client.doods.make({
        name: parsed,
        color,
        seed,
        item: picked.id,
      })
      setName(one.name)
      keep({ id: one.id, key })
      setMade({ id: one.id, key })
      setStep("ready")
    } catch (failure) {
      const refused = failure instanceof ApiError
      setError({
        line: refused ? failure.message : "That did not go through. Try again.",
        name: refused && failure.code === "bad_name",
      })
    } finally {
      setBusy(false)
    }
  }

  function stroke(event: PointerEvent) {
    const drawing = stage.current
    if (step !== "meet" || drawing === null || egg.current === null) return
    const box = egg.current.getBoundingClientRect()
    const x = ((event.clientX - box.left) / box.width) * 2 - 1
    if (
      Math.abs(x) > 0.7 ||
      event.clientY < box.top + box.height * 0.2 ||
      event.clientY > box.bottom
    )
      return
    drawing.orb.pet(x, 0.08)
    if ((pats.current.stroke += 0.08) < 1) return
    pats.current.stroke = 0
    pats.current.unsent++
    setMet((now) => now && { ...now, pats: now.pats + 1 })
  }

  async function feed() {
    if (met === undefined) return
    setBusy(true)
    setError(null)
    try {
      const fed = await client.doods.treat(met.id)
      const orb = stage.current?.orb
      orb?.offer(true)
      later(() => orb?.bite(), 650)
      later(() => orb?.bite(), 1050)
      later(() => {
        orb?.offer(false)
        orb?.cheer()
        // The strokes made here meanwhile are kept: the answer may not have them yet.
        setMet((now) => ({ ...fed, pats: Math.max(fed.pats, now?.pats ?? 0) }))
        setGiven(true)
        if (!fed.claimed || fed.joy !== 0) return
        setFull(true)
        stage.current?.sky.confetti([hex, "#ffb92e"])
      }, 1500)
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === "treat_given") setGiven(true)
      else setError({ line: "That did not go through. Try again." })
      setBusy(false)
    }
  }

  const shareUrl =
    made === null
      ? ""
      : `https://x.com/intent/post?text=${encodeURIComponent(`I hatched ${name} 🥚 Hatch yours:`)}&url=${encodeURIComponent(`${origin}/dood/${made.id}`)}`
  function share(event: { preventDefault(): void }) {
    event.preventDefault()
    window.open(shareUrl, "_blank", "noopener")
  }

  const on = step !== "none"
  // An egg cannot be hatched where nothing can be drawn. A Dood can still be met and fed there.
  const bare = drawn === false && dood === undefined
  const joy = full ? TREATS_PER_BOX : (met?.joy ?? 0)
  const claimable = met !== undefined && !met.claimed && mine?.id === met.id ? mine : undefined
  const outside = typeof window !== "undefined" && framed() ? "_blank" : undefined

  return (
    <main
      ref={root}
      data-dood-card
      data-step={step}
      className="relative h-dvh w-screen touch-manipulation overflow-hidden bg-[#05071a] text-white select-none"
      onClick={tap}
      onPointerMove={stroke}
    >
      <canvas
        ref={skyCanvas}
        aria-hidden
        className={cn(
          "absolute inset-0 size-full transition-opacity duration-700 [image-rendering:pixelated]",
          drawn !== true && "opacity-0",
        )}
      />
      <div
        ref={egg}
        aria-hidden
        data-egg
        className={cn(
          "pointer-events-none absolute top-0 left-0 will-change-transform",
          !(drawn && placed) && "invisible",
        )}
      >
        {/* The view leaves an egg just enough room. In the square of a post a Dood that is out
            stands a little smaller than that, so that what it has on its head is in the picture. */}
        <canvas
          ref={creature}
          className="block size-full transition-transform duration-300"
          style={
            feet !== undefined && short
              ? { transform: "scale(0.8)", transformOrigin: `50% ${(feet * 100).toFixed(2)}%` }
              : undefined
          }
        />
      </div>
      <span className="absolute top-3 left-3.5 text-xs font-semibold text-white/60">
        do.computer
      </span>
      {said !== null && step === "none" && phase.current === "fall" && (
        <button
          type="button"
          className="absolute top-2 right-2.5 rounded-full px-3 py-1 text-xs text-white/60 hover:bg-white/10 hover:text-white"
        >
          Skip
        </button>
      )}
      <p
        role="status"
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-[9%] text-center text-[22px] font-bold tracking-tight transition-opacity duration-300 [text-shadow:0_2px_0_rgb(0_0_0/0.35)]",
          (on || (said === null && !bare)) && "opacity-0",
        )}
      >
        {bare ? "This needs WebGL." : said?.line}
        {said?.small && (
          <small className="mt-1 block text-[13px] font-medium opacity-75">{said.small}</small>
        )}
      </p>

      <div
        ref={panel}
        data-on={on}
        inert={!on}
        // In the square of a post the panel is kept low, so that the Dood and its hat have room.
        className={cn(
          "absolute bottom-3 left-1/2 w-[min(27.5rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-[14px] bg-white p-3.5 text-neutral-900 shadow-[0_10px_30px_rgb(0_0_0/0.35)] transition-[opacity,translate] duration-300 select-text [@media(max-height:560px)]:p-2.5",
          !on && "pointer-events-none translate-y-[calc(100%+1.5rem)] opacity-0",
        )}
        onClick={(event) => event.stopPropagation()}
        onPointerMove={(event) => event.stopPropagation()}
      >
        {step === "name" && (
          <form onSubmit={hatch}>
            <Line>What will you call it?</Line>
            <div className="mt-3 flex gap-2">
              <NameInput
                value={typed}
                onChange={(event) => {
                  setTyped(event.target.value)
                  setError(null)
                  if (event.target.value.length % 6 === 1)
                    stage.current?.orb.pet(typed.length % 12 < 6 ? 1 : -1)
                }}
              />
              <Pill dark type="submit" className="flex-none" disabled={typed.trim() === ""}>
                Hatch
              </Pill>
            </div>
            <div role="radiogroup" aria-label="Its color" className="mt-3 flex gap-[7px]">
              {AVATAR_COLORS.map((each) => (
                <button
                  key={each.id}
                  type="button"
                  role="radio"
                  aria-label={each.label}
                  aria-checked={each.id === color}
                  style={{ background: each.hex }}
                  className="size-[26px] rounded-full shadow-[inset_0_0_0_2px_rgb(255_255_255/0.45)] outline-offset-2 outline-neutral-900 aria-checked:outline-2"
                  onClick={() => {
                    setColor(each.id)
                    stage.current?.orb.setColor(each.hex)
                    stage.current?.orb.pet(1)
                    stage.current?.sky.glow(0.6)
                  }}
                />
              ))}
            </div>
            <Wrong error={error} />
          </form>
        )}
        {step === "out" && (
          <>
            <Line>{name} is out.</Line>
            <Sub>
              Not the one? Another egg has a different Dood in it, with the same name and colour.
            </Sub>
            <div className="mt-3 flex gap-2">
              <Pill onClick={again}>Hatch another</Pill>
              <Pill dark onClick={present}>
                Keep {name}
              </Pill>
            </div>
          </>
        )}
        {step === "gift" && (
          <>
            <Line>{name} came with a present.</Line>
            <Sub>Three things are inside. One is {name}'s to keep.</Sub>
            <div className="mt-3 flex">
              <Pill dark onClick={open}>
                Open it
              </Pill>
            </div>
          </>
        )}
        {step === "choose" && (
          <form onSubmit={keepIt}>
            <Line className="[@media(max-height:400px)]:hidden">Which one is {name}'s?</Line>
            <div className="mt-2.5 grid grid-cols-3 gap-2 [@media(max-height:400px)]:mt-0 [@media(max-height:560px)]:gap-1.5">
              {three.map((item) => (
                <Tile
                  key={item.id}
                  item={item}
                  seed={seed}
                  color={hex}
                  pressed={picked?.id === item.id}
                  onPick={() => tryOn(item)}
                />
              ))}
            </div>
            {error?.name && (
              <div className="mt-2 flex">
                <NameInput value={typed} onChange={(event) => setTyped(event.target.value)} />
              </div>
            )}
            <Wrong error={error} />
            <div className="mt-3 flex [@media(max-height:560px)]:mt-2">
              <Pill dark type="submit" disabled={picked === null || busy}>
                {picked === null ? "Pick one" : `Keep the ${picked.name.toLowerCase()}`}
              </Pill>
            </div>
          </form>
        )}
        {step === "ready" && made !== null && (
          <>
            <Line>{name} is ready.</Line>
            <Sub>
              Show it to everyone, or keep it. Once it is claimed, the treats people give it in the
              post fill presents for you.
            </Sub>
            <div className="mt-3 flex gap-2">
              <Pill as="a" target="_blank" rel="noopener" href={shareUrl} onClick={share}>
                Share {name}
              </Pill>
              <Pill dark as="a" href={claimUrl(made)} target={outside}>
                Claim {name}
              </Pill>
            </div>
          </>
        )}
        {step === "meet" && met !== undefined && (
          <>
            <div className="flex items-center gap-2">
              <Line>{met.name}</Line>
              <span className="ml-auto text-xs text-neutral-500 tabular-nums">
                {met.pats} pats · {met.treats} treats
              </span>
            </div>
            {met.claimed && (
              <div
                className={cn(
                  "mt-2 flex items-center gap-2 text-[13px] text-neutral-500",
                  full && "font-semibold text-neutral-900",
                )}
              >
                <span className="flex gap-1">
                  {Array.from({ length: TREATS_PER_BOX }, (_, index) => (
                    <i
                      key={index}
                      className={cn(
                        "size-3.5 rounded-[4px] transition-colors duration-300",
                        index < joy ? "bg-[#c9952c]" : "bg-neutral-200",
                      )}
                    />
                  ))}
                </span>
                <span>
                  {full
                    ? `That makes a present for ${met.name}'s owner`
                    : `${joy} of ${TREATS_PER_BOX} treats to its next present`}
                </span>
              </div>
            )}
            <Wrong error={error} />
            <div className="mt-3 flex gap-2">
              <Pill onClick={feed} disabled={busy || given}>
                {given ? "Given for today" : "Give a treat"}
              </Pill>
              {claimable === undefined ? (
                <Pill dark as="a" href="/hatch">
                  Hatch your own
                </Pill>
              ) : (
                <Pill dark as="a" href={claimUrl(claimable)} target={outside}>
                  Claim {met.name}
                </Pill>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  )
}

const Line = ({ className, ...rest }: ComponentProps<"p">) => (
  <p
    className={cn("text-base font-semibold [@media(max-height:560px)]:text-[15px]", className)}
    {...rest}
  />
)

const Sub = (props: ComponentProps<"p">) => (
  <p
    className="mt-0.5 text-[13px] text-neutral-500 [@media(max-height:400px)]:text-xs"
    {...props}
  />
)

const Wrong = ({ error }: { error: { line: string } | null }) =>
  error === null ? null : (
    <p role="alert" className="mt-2 text-[13px] text-red-700">
      {error.line}
    </p>
  )

const NameInput = (props: ComponentProps<"input">) => (
  <input
    aria-label="Its name"
    placeholder="Name your Dood"
    maxLength={DOOD_NAME_MAX}
    autoComplete="off"
    spellCheck={false}
    className="h-10 min-w-0 flex-1 rounded-[10px] border border-neutral-300 bg-white px-3 text-base text-neutral-900 outline-none focus:border-neutral-900"
    {...props}
  />
)

/** The panel's buttons: dark for what goes on, light for the other way. */
function Pill({
  dark,
  as: Tag = "button",
  className,
  ...rest
}: {
  dark?: boolean
  as?: "button" | "a"
  onClick?: (event: { preventDefault(): void }) => void
} & Pick<ComponentProps<"button">, "disabled" | "type"> &
  Omit<ComponentProps<"a">, "onClick" | "type">) {
  return (
    <Tag
      {...(Tag === "button" ? { type: "button" } : {})}
      className={cn(
        "inline-flex h-10 min-w-0 flex-1 items-center justify-center rounded-full px-4 text-sm font-semibold whitespace-nowrap disabled:opacity-40 [@media(max-height:560px)]:h-9",
        dark
          ? "bg-neutral-900 text-white hover:bg-black"
          : "bg-neutral-100 text-neutral-900 hover:bg-neutral-200",
        className,
      )}
      {...(rest as object)}
    />
  )
}

/** One thing out of the present, on a small one of the same Dood. */
function Tile({
  item,
  seed,
  color,
  pressed,
  onPick,
}: {
  item: WearItem
  seed: string
  color: string
  pressed: boolean
  onPick: () => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let gone = false
    let dispose = () => {}
    void loadMascot().then((core) => {
      if (gone || core === null || canvas.current === null) return
      const orb = core.createOrb(canvas.current, {
        seed,
        color,
        size: 72,
        dark: false,
        notice: false,
        slow: true,
        reduced: prefersCalm(),
      })
      dressMascot(orb, wearing(item))
      dispose = () => orb.dispose()
    })
    return () => {
      gone = true
      dispose()
    }
  }, [item, seed, color])
  return (
    <button
      type="button"
      aria-pressed={pressed}
      data-slot={item.slot}
      className="flex flex-col items-center rounded-xl bg-neutral-100 px-1 pt-1.5 pb-2 -outline-offset-2 outline-neutral-900 hover:bg-neutral-200 aria-pressed:bg-white aria-pressed:outline-2 [@media(max-height:560px)]:pt-1 [@media(max-height:560px)]:pb-1.5"
      onClick={onPick}
    >
      <canvas
        ref={canvas}
        className="size-[72px]! [@media(max-height:400px)]:size-10! [@media(min-height:401px)_and_(max-height:560px)]:size-[52px]!"
      />
      <b className="text-center text-xs leading-tight font-semibold">{item.name}</b>
      <i
        className="text-[11px] font-semibold not-italic [@media(max-height:400px)]:hidden"
        style={{ color: rarityOf(item.rarity).color }}
      >
        {rarityOf(item.rarity).label}
      </i>
    </button>
  )
}
