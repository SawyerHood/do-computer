import type { MascotState, MascotVariant } from "@durable-computer/mascot"
import {
  type Outfit,
  RARITIES,
  rarityOf,
  type WearItem,
  wearItem,
} from "@durable-computer/protocol"
import { ArrowRightIcon, GithubLogoIcon } from "@phosphor-icons/react"
import { Link } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"
import { AgentAvatar } from "@/components/agent-avatar"
import { type BoxHandle, BoxStage } from "@/components/creature/box-window"
import { cheerMascot } from "@/lib/mascot"
import { cn } from "@/lib/utils"

/** Where the source is. */
const REPOSITORY = "https://github.com/SawyerHood/durable-computer"

/** What a creature is shown doing: how it holds itself, and the line that says so. */
type Step = readonly [
  state: MascotState,
  variant: MascotVariant | undefined,
  says: string,
  about?: string,
]

type Character = {
  name: string
  /** What it is grown from, where that is not its name. */
  seed?: string
  color: string
  wear?: Outfit
  /** The job it stands for, and that job in a line. */
  job: string
  about: string
  steps: readonly Step[]
  /** Not out of its egg: the one a visitor would get. */
  egg?: boolean
}

/**
 * Who can be chosen. Each stands for something the one agent does, and the last is the egg a
 * new person's own comes in. Eight: two full rows of four, on a phone as on a desk.
 */
const ROSTER: readonly Character[] = [
  {
    name: "Pip",
    seed: "Sorrel",
    color: "tide",
    job: "The planner",
    about: "Trips, weeks, and what is for dinner.",
    steps: [
      ["working", "search", "Searching", "flights to Lisbon"],
      ["working", "file", "Writing", "trip-plan.md"],
      ["done", undefined, "Done. It is in your library."],
    ],
  },
  {
    name: "Biscuit",
    color: "honey",
    wear: { hat: "chef" },
    job: "The builder",
    about: "Writes the code, runs the tests, fixes what broke.",
    steps: [
      ["working", "file", "Writing", "src/checkout.ts"],
      ["working", "command", "Running", "pnpm test"],
      ["done", undefined, "Done · 14 passed"],
    ],
  },
  {
    name: "Scout",
    seed: "Tarn",
    color: "moss",
    wear: { glasses: "goggles" },
    job: "The researcher",
    about: "Reads the internet so you do not have to.",
    steps: [
      ["working", "search", "Searching", "best e-ink tablets"],
      ["thinking", undefined, "Comparing nine of them"],
      ["working", "file", "Writing", "tablets.md"],
    ],
  },
  {
    name: "Vesper",
    color: "plum",
    wear: { hat: "nightcap" },
    job: "The night shift",
    about: "Works to a schedule while you sleep.",
    steps: [
      ["asleep", undefined, "07:59 · asleep"],
      ["working", "search", "08:00 · reading the news"],
      ["done", undefined, "08:02 · brief is in your inbox"],
    ],
  },
  {
    name: "Juniper",
    color: "moss",
    wear: { hat: "headphones" },
    job: "The teammate",
    about: "Lives in Slack. Answers when it is asked for.",
    steps: [
      ["listening", undefined, "#launch · Maya is typing"],
      ["speaking", undefined, "#launch · replying"],
      ["idle", undefined, "#launch"],
    ],
  },
  {
    name: "Mochi",
    color: "rose",
    wear: { hat: "bunny", face: "blush" },
    job: "The note keeper",
    about: "Remembers what you said, and where you put it.",
    steps: [
      ["working", "memory", "Noting", "vegetarian"],
      ["working", "memory", "Noting", "likes a window seat"],
      ["idle", undefined, "Remembers"],
    ],
  },
  {
    name: "Sable",
    color: "clay",
    wear: { hat: "cowboy", neck: "bandana" },
    job: "The house guest",
    about: "Works on your own computer, when you let it in.",
    steps: [
      ["waiting", undefined, "Asking before", "brew upgrade"],
      ["working", "command", "Running", "brew upgrade"],
      ["done", undefined, "Done"],
    ],
  },
  {
    name: "Yours",
    seed: "Olive",
    color: "tide",
    job: "Not hatched yet",
    about: "It comes out of an egg, and is nobody else's.",
    steps: [["idle", undefined, "Waiting for you"]],
    egg: true,
  },
]

/** How long the one on the pedestal does each thing, and how long each has the pedestal. */
const STEP_MS = 2_600
const TURN_MS = 7_800

/** A number that goes round, one on every so often, until it is stopped. */
function useRound(count: number, ms: number, stopped = false): [number, (at: number) => void] {
  const [at, setAt] = useState(0)
  useEffect(() => {
    if (stopped || count < 2) return
    const timer = setInterval(() => setAt((now) => (now + 1) % count), ms)
    return () => clearInterval(timer)
  }, [count, ms, stopped])
  return [at % count, setAt]
}

/** What a creature is doing, as the app says it beside one. */
function Line({ step, className }: { step: Step; className?: string }) {
  const quiet = step[0] === "idle" || step[0] === "asleep"
  return (
    <p className={cn("lp-line", className)} data-quiet={quiet}>
      <i />
      <span>
        {step[2]}
        {step[3] === undefined ? null : <code> {step[3]}</code>}
      </span>
    </p>
  )
}

/** One of them, by the name it has on this page. */
function Creature({
  name,
  seed = name,
  color,
  wear,
  step,
  egg = false,
  quiet = false,
  className,
}: {
  name: string
  seed?: string
  color: string
  wear?: Outfit
  step?: Step
  egg?: boolean
  quiet?: boolean
  className?: string
}) {
  return (
    <AgentAvatar
      avatar={{ color, seed }}
      seed={`landing:${name}`}
      outfit={wear}
      mood={step === undefined ? undefined : { state: step[0], variant: step[1] }}
      hatched={!egg}
      quiet={quiet}
      pettable={!quiet}
      className={className}
    />
  )
}

function GitHubLink({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <a href={REPOSITORY} target="_blank" rel="noreferrer" className={className}>
      <GithubLogoIcon weight="fill" />
      {children}
    </a>
  )
}

/** The one small way in that is left while nobody new can sign up. */
function HaveAccess() {
  return (
    <p className="lp-have">
      Already have access? <Link to="/login">Sign in</Link>
    </p>
  )
}

/** The top of the page: a console's character select. */
function Select({ open }: { open: boolean }) {
  const [chosen, setChosen] = useState(false)
  const [at, pick] = useRound(ROSTER.length, TURN_MS, chosen)
  const character = ROSTER[at]!
  const [doing, restart] = useRound(character.steps.length, STEP_MS)
  const choose = (index: number) => {
    setChosen(true)
    pick(index)
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: whoever takes the pedestal starts from the top, with a hop
  useEffect(() => {
    restart(0)
    cheerMascot("landing:stage")
  }, [at])
  const step = character.steps[doing] ?? character.steps[0]!

  return (
    <section className="lp-select">
      <header className="lp-top">
        <span className="lp-brand">
          <img src="/favicon.svg" alt="" />
          Do Computer
        </span>
        <span className="grow" />
        <GitHubLink className="lp-gh">
          <span>GitHub</span>
        </GitHubLink>
        {open ? <Link to="/login">Sign in</Link> : null}
      </header>

      <div className="lp-select-main">
        <div className="lp-stage">
          <span className="lp-beam" />
          <AgentAvatar
            avatar={{ color: character.color, seed: character.seed ?? character.name }}
            seed="landing:stage"
            outfit={character.wear ?? {}}
            mood={{ state: step[0], variant: step[1] }}
            hatched={character.egg !== true}
            pettable
            className="lp-stage-creature"
          />
          <p className="lp-plate">
            <b>{character.egg ? "???" : character.name}</b>
            <span>{character.job}</span>
          </p>
          <Line step={step} />
        </div>

        <div className="lp-side">
          <p className="lp-eyebrow">Open source · MIT</p>
          <h1>
            Your open source
            <br />
            personal assistant.
          </h1>
          <p className="lp-about">
            <b>{character.job}.</b> {character.about}
          </p>
          <p className="lp-choose">
            <i>▶</i>Choose yours
          </p>
          <div className="lp-roster">
            {ROSTER.map((each, index) => (
              <button
                key={each.name}
                type="button"
                aria-label={`${each.name}: ${each.job}`}
                aria-pressed={index === at}
                onClick={() => choose(index)}
                onPointerEnter={(event) => {
                  if (event.pointerType === "mouse") choose(index)
                }}
              >
                <Creature
                  name={each.name}
                  seed={each.seed}
                  color={each.color}
                  wear={each.wear}
                  egg={each.egg}
                  quiet
                  className="lp-tile"
                />
                <span>{each.egg ? "???" : each.name}</span>
              </button>
            ))}
          </div>
          {open ? (
            <div className="lp-cta">
              <Link to="/welcome" className="lp-button lp-start">
                <i>▶</i>Press start
              </Link>
              <p>Any of them can do all of it. Yours comes in an egg.</p>
            </div>
          ) : (
            <div className="lp-cta lp-shut">
              <p className="lp-soon">Coming soon</p>
              <HaveAccess />
            </div>
          )}
        </div>
      </div>

      <a className="lp-more" href="#the-app">
        ▼ What is this?
      </a>
    </section>
  )
}

/** The pictures of the app, and what each is a picture of. */
const VIEWS = [
  [
    "chat",
    "Chat",
    "A real conversation: a trip planned, a document written, a reminder set for Mondays.",
  ],
  [
    "library",
    "Library",
    "What it writes is yours: documents and pages you can read, edit and share.",
  ],
  ["automations", "Automations", "Everything it does on a schedule, in one list you can pause."],
] as const

/**
 * The app itself, in a window whose tabs change the picture, with a phone beside it. On a phone
 * the window would be too small to read: its tabs stay, and the phone is the picture.
 */
function TheApp() {
  const [chosen, setChosen] = useState(false)
  const [at, show] = useRound(VIEWS.length, 6_500, chosen)
  const [view, label, caption] = VIEWS[at]!
  return (
    <section className="lp-band" id="the-app">
      <div className="lp-wrap">
        <div className="lp-head">
          <p className="lp-eyebrow">The app</p>
          <h2>Here is Pip, at work.</h2>
          <p>
            You talk to it in a chat. What it makes lands in a library. What it does on its own is a
            list you can pause.
          </p>
        </div>
        <div className="lp-shots">
          <div className="lp-window">
            <div className="lp-window-bar">
              <i />
              <i />
              <i />
              <div role="tablist" aria-label="Pictures of the app">
                {VIEWS.map(([id, name], index) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={index === at}
                    onClick={() => {
                      setChosen(true)
                      show(index)
                    }}
                  >
                    {name}
                  </button>
                ))}
              </div>
              <span>do.computer</span>
            </div>
            <img
              src={`/landing/${view}.jpg`}
              alt={`Do Computer: ${label}`}
              width={2040}
              height={1350}
              loading="lazy"
            />
          </div>
          <div className="lp-phone">
            <img
              src={`/landing/phone-${view}.jpg`}
              alt={`Do Computer on a phone: ${label}`}
              width={780}
              height={1560}
              loading="lazy"
            />
          </div>
          <p className="lp-caption">{caption}</p>
        </div>
      </div>
    </section>
  )
}

type Act = {
  title: string
  text: string
  /** The color its little screen fades into. */
  glow: string
  who: readonly { name: string; color: string; wear?: Outfit }[]
  /** What is said, and how each of them holds itself while it is. */
  steps: readonly (readonly [says: string, about: string | undefined, ...Step[]])[]
  ms: number
  chips?: readonly string[]
}

const still = (state: MascotState, variant?: MascotVariant): Step => [state, variant, ""]

const ACTS: readonly Act[] = [
  {
    title: "A computer of its own",
    text: "It runs commands, writes files and clicks through a browser on its own machine in the cloud. Share your Mac or PC and it can work there too.",
    glow: "#1d4a5a",
    who: [{ name: "Tarn", color: "tide" }],
    ms: 2_600,
    steps: [
      ["Thinking", undefined, still("thinking")],
      ["Running", "git status", still("working", "command")],
      ["Writing", "src/checkout.ts", still("working", "file")],
      ["Running", "pnpm test", still("working", "command")],
      ["Done · 14 passed", undefined, still("done")],
    ],
  },
  {
    title: "Still at it when you leave",
    text: "Close the laptop. It keeps going, and your phone buzzes when the job is done.",
    glow: "#3a2f6a",
    who: [{ name: "Vesper", color: "plum", wear: { hat: "nightcap" } }],
    ms: 3_200,
    steps: [
      ["You left 12 min ago ·", "deploy", still("working", "command")],
      ["You left 19 min ago · checking the page", undefined, still("working", "search")],
      ["Done · told your phone", undefined, still("done")],
    ],
  },
  {
    title: "It remembers",
    text: "It keeps notes on you and the work, so Tuesday starts where Monday ended.",
    glow: "#5a3350",
    who: [{ name: "Pilar", color: "rose", wear: { glasses: "reading" } }],
    ms: 2_800,
    steps: [
      ["Noting", "invoices go out on the 1st", still("working", "memory")],
      ["Remembers", undefined, still("idle")],
      ["Noting", "Maya signs off on copy", still("working", "memory")],
      ["Remembers", undefined, still("idle")],
    ],
  },
  {
    title: "Up before you are",
    text: "Give it a schedule. The morning brief is written before the coffee is.",
    glow: "#6a4a30",
    who: [{ name: "Wren", color: "honey" }],
    ms: 2_800,
    steps: [
      ["07:59 · asleep", undefined, still("asleep")],
      ["08:00 · reading the news", undefined, still("working", "search")],
      ["08:01 · writing", "brief.md", still("working", "file")],
      ["08:02 · in your inbox", undefined, still("done")],
    ],
  },
  {
    title: "Wherever you are",
    text: "In a browser, as an app on your desktop, on your phone, and in Slack when someone asks for it by name.",
    glow: "#1f5a46",
    who: [{ name: "Juniper", color: "moss", wear: { hat: "headphones" } }],
    chips: ["Web", "Desktop", "Phone", "Slack"],
    ms: 2_800,
    steps: [
      ["#launch · Maya is typing", undefined, still("listening")],
      ["#launch · replying", undefined, still("speaking")],
      ["#launch", undefined, still("idle")],
    ],
  },
  {
    title: "One for the whole team",
    text: "Share one with your team or keep one to yourself. They hand work to each other while you get on with yours.",
    glow: "#24507a",
    who: [
      { name: "Juniper", color: "moss", wear: { hat: "sprout" } },
      { name: "Wren", color: "honey", wear: { glasses: "browline" } },
      { name: "Tarn", color: "tide", wear: { neck: "necktie" } },
    ],
    ms: 3_200,
    steps: [
      [
        "Pip → Scout · can you check the pricing page?",
        undefined,
        still("speaking"),
        still("idle"),
        still("listening"),
      ],
      [
        "Scout · reading the pricing page",
        undefined,
        still("idle"),
        still("idle"),
        still("working", "search"),
      ],
      [
        "Scout → Ledger · the March numbers, please",
        undefined,
        still("idle"),
        still("listening"),
        still("speaking"),
      ],
      [
        "Ledger · adding up March",
        undefined,
        still("idle"),
        still("working", "command"),
        still("idle"),
      ],
    ],
  },
]

/** One thing it does, with whoever acts it out on a little screen. */
function ActCard({ act, index }: { act: Act; index: number }) {
  const [at] = useRound(act.steps.length, act.ms)
  const [says, about, ...poses] = act.steps[at]!
  const lead = poses[0]!
  return (
    <article className="lp-card">
      <div className="lp-screen" style={{ "--glow": act.glow } as React.CSSProperties}>
        {act.chips === undefined ? null : (
          <p className="lp-chips">
            {act.chips.map((chip) => (
              <span key={chip}>{chip}</span>
            ))}
          </p>
        )}
        {act.who.map((who, place) => (
          <AgentAvatar
            key={who.name}
            avatar={{ color: who.color, seed: who.name }}
            seed={`landing:act${index}:${who.name}`}
            outfit={who.wear}
            mood={{ state: (poses[place] ?? lead)[0], variant: (poses[place] ?? lead)[1] }}
            pettable
            className={act.who.length > 1 ? "lp-cast" : "lp-solo"}
          />
        ))}
        <Line step={[lead[0], lead[1], says, about]} />
      </div>
      <h3>{act.title}</h3>
      <p>{act.text}</p>
    </article>
  )
}

function WhatItDoes() {
  return (
    <section className="lp-band">
      <div className="lp-wrap">
        <div className="lp-head">
          <p className="lp-eyebrow">What it does</p>
          <h2>
            It does the work,
            <br />
            not just the talking.
          </h2>
          <p>
            Ask in plain words. It works the job out on a real computer, and tells you when it is
            done.
          </p>
        </div>
        <div className="lp-cards">
          {ACTS.map((act, index) => (
            <ActCard key={act.title} act={act} index={index} />
          ))}
        </div>
      </div>
    </section>
  )
}

/** That it is open source, said with the three lines that run it. */
function OpenSource() {
  const [at] = useRound(3, 3_400)
  const pose = ([still("working", "command"), still("done"), still("idle")] as const)[at]!
  return (
    <section className="lp-band">
      <div className="lp-wrap lp-split">
        <div>
          <p className="lp-eyebrow">Open source</p>
          <h2>Yours, all the way down.</h2>
          <p className="lp-lead">
            Do Computer is open source under the MIT license. Read every line, change what you like,
            and run it yourself: on a box in the cupboard or on your own Cloudflare account, with
            your own model keys.
          </p>
          <ul className="lp-ticks">
            <li>
              <b>Your data stays yours.</b> One SQLite file for each agent, wherever you put it.
            </li>
            <li>
              <b>Any model.</b> Through OpenRouter, or a provider you are signed in to.
            </li>
            <li>
              <b>Or skip all that.</b> We run it for you, right here.
            </li>
          </ul>
          <div className="lp-cta">
            <GitHubLink className="lp-button lp-ghost">Star on GitHub</GitHubLink>
          </div>
        </div>
        <div className="lp-terminal">
          <Creature
            name="Biscuit"
            color="honey"
            wear={{ hat: "chef" }}
            step={pose}
            className="lp-perched"
          />
          <p className="lp-terminal-bar">
            <i />
            <i />
            <i />
            <span>~/durable-computer</span>
          </p>
          <pre>
            <span>$</span> git clone {REPOSITORY}
            {"\n"}
            <span>$</span> pnpm install && pnpm build
            {"\n"}
            <span>$</span> OPENROUTER_API_KEY=sk-or-… pnpm start
            {"\n\n"}
            <em>{"  "}Listening on http://127.0.0.1:3000</em>
            {"\n"}
            <em>{"  "}Open it, and say hello to your agent.</em> <b />
          </pre>
        </div>
      </div>
    </section>
  )
}

/** What the boxes on this page have in them, in the order they are opened. */
const IN_THE_BOXES = ["wizard", "pixel", "cape", "crown", "party", "bubblegum", "wings", "galaxy"]
  .map(wearItem)
  .filter((item): item is WearItem => item !== undefined)

/** A box, opened on the creature's own stage as it is in the app, and what was inside put on. */
function Hats() {
  const [outfit, setOutfit] = useState<Outfit>({ hat: "party" })
  const [opened, setOpened] = useState(0)
  /** The box being opened, and what was in it once that shows. */
  const [opening, setOpening] = useState(false)
  const [found, setFound] = useState<WearItem>()
  const box = useRef<BoxHandle>(null)
  const item = IN_THE_BOXES[opened % IN_THE_BOXES.length]

  useEffect(() => {
    if (!opening || item === undefined) return
    // The box is given a moment to be drawn, rattles, and opens.
    const rattle = setTimeout(() => box.current?.shake(), 200)
    const open = setTimeout(() => box.current?.open(item), 950)
    return () => {
      clearTimeout(rattle)
      clearTimeout(open)
    }
  }, [opening, item])

  useEffect(() => {
    if (found === undefined) return
    // What was inside hangs in the light a while, and is then put on.
    const timer = setTimeout(() => {
      setOutfit((worn) => ({ ...worn, [found.slot]: found.id }))
      setOpening(false)
      setFound(undefined)
      setOpened((count) => count + 1)
      cheerMascot("landing:Mochi")
    }, 1_800)
    return () => clearTimeout(timer)
  }, [found])

  const rarity = found === undefined ? undefined : rarityOf(found.rarity)
  return (
    <section className="lp-band">
      <div className="lp-wrap lp-split lp-hats">
        <div>
          <p className="lp-eyebrow">Also, hats</p>
          <h2>Feed it. Dress it up.</h2>
          <p className="lp-lead">
            Work with it and it earns treats. Enough treats and a box turns up, with one of 200
            things to wear inside. Some are much rarer than others.
          </p>
          <p className="lp-rarities">
            {RARITIES.map((each) => (
              <span key={each.id} style={{ "--tier": each.color } as React.CSSProperties}>
                <i />
                {each.label}
              </span>
            ))}
          </p>
          <div className="lp-cta">
            <button
              type="button"
              className="lp-button lp-ghost"
              disabled={opening || item === undefined}
              onClick={() => setOpening(true)}
            >
              {opened === 0 ? "Open a box" : "Open another"}
            </button>
          </div>
        </div>
        <div className="lp-pad">
          <div className="lp-pad-stage">
            {opening ? (
              <BoxStage
                key={opened}
                agent={{ id: "landing:box", avatar: { color: "honey", seed: "Mochi" } }}
                handle={box}
                onPop={() => undefined}
                onShown={() => setFound(item)}
              />
            ) : (
              <Creature name="Mochi" color="honey" wear={outfit} className="size-full" />
            )}
          </div>
          {found === undefined || rarity === undefined ? null : (
            <p className="lp-found" style={{ "--tier": rarity.color } as React.CSSProperties}>
              <b>{rarity.label}</b>
              {found.name}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

/** The egg at the end: pressed three times while the door is open, it hatches. Shut, it only rocks. */
function Ending({ open }: { open: boolean }) {
  const [presses, setPresses] = useState(0)
  const [out, setOut] = useState(false)
  return (
    <section className="lp-end">
      <button
        type="button"
        aria-label={out ? "The one that hatched" : "The egg"}
        onClick={() => setPresses((count) => count + 1)}
      >
        <AgentAvatar
          avatar={{ color: "tide", seed: "Fig" }}
          seed="landing:egg"
          hatched={out}
          hatching={open && presses >= 3 && !out}
          onHatched={() => setOut(true)}
          pettable
          className="lp-egg"
        />
      </button>
      <h2>{out ? "There you are." : "Yours has not hatched yet."}</h2>
      {open ? (
        <>
          <p className="lp-lead">It comes down out of the sky, asks your name, and gets to work.</p>
          <div className="lp-cta">
            <Link to="/welcome" className="lp-button lp-start">
              Hatch yours
              <ArrowRightIcon weight="bold" />
            </Link>
          </div>
        </>
      ) : (
        <>
          <p className="lp-lead">Soon. The eggs are nearly ready.</p>
          <div className="lp-cta lp-shut">
            <p className="lp-pill">
              <i />
              Coming soon
            </p>
            <HaveAccess />
          </div>
        </>
      )}
    </section>
  )
}

/**
 * What someone who is not signed in is shown at the deployment's own address, where it has a
 * landing page: who the agent is, what it does, that it is open source, and the way in. While
 * nobody new can sign up (`open` is false) the way in is "Coming soon", and one small link for
 * whoever has an account already.
 */
export function Landing({ open }: { open: boolean }) {
  return (
    <main
      className="lp"
      // The creatures are drawn only while they are in view, which they find out when the window
      // scrolls. Here it is this that scrolls, so the window is told.
      onScroll={() => window.dispatchEvent(new Event("scroll"))}
    >
      <Select open={open} />
      <TheApp />
      <WhatItDoes />
      <OpenSource />
      <Hats />
      <Ending open={open} />
      <footer className="lp-wrap lp-foot">
        <span className="lp-brand">
          <img src="/favicon.svg" alt="" />
          Do Computer
        </span>
        <span>Open source, MIT</span>
        <span className="grow" />
        <a href={REPOSITORY} target="_blank" rel="noreferrer">
          GitHub
        </a>
        <Link to="/login">Sign in</Link>
      </footer>
    </main>
  )
}
