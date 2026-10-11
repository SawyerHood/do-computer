import type { MascotState, MascotVariant } from "@durable-computer/mascot"
import {
  type Outfit,
  RARITIES,
  rarityOf,
  type WearItem,
  wearItem,
} from "@durable-computer/protocol"
import {
  ArrowRightIcon,
  BrowserIcon,
  DesktopIcon,
  DeviceMobileIcon,
  GithubLogoIcon,
  NotePencilIcon,
  SlackLogoIcon,
} from "@phosphor-icons/react"
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
  egg = false,
  quiet = false,
  className,
}: {
  name: string
  seed?: string
  color: string
  wear?: Outfit
  egg?: boolean
  quiet?: boolean
  className?: string
}) {
  return (
    <AgentAvatar
      avatar={{ color, seed }}
      seed={`landing:${name}`}
      outfit={wear}
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

/** A picture that plays through its steps: where it is now, and whether a step has been reached. */
function usePlay(steps: number, ms: number): [at: number, reached: (step: number) => boolean] {
  const [at] = useRound(steps, ms)
  return [at, (step) => at >= step]
}

/** Where the pointer is on the page it is reading, and what the agent says it is doing there. */
const ERRAND = [
  ["field", "Searching for e-ink tablets"],
  ["first", "Reading the reviews"],
  ["third", "Comparing nine of them"],
  ["shell", "Writing tablets.md"],
  ["shell", "Done. It is in your library."],
] as const

/** Its own computer: a browser it clicks through, and the commands it runs under it. */
function ComputerPicture() {
  const [at, reached] = usePlay(ERRAND.length, 2_600)
  const [where, says] = ERRAND[at]!
  const done = at === ERRAND.length - 1
  return (
    <div className="lp-vis" style={{ "--tone": "#17727c" } as React.CSSProperties} aria-hidden>
      <div className="lp-ui lp-computer">
        <p className="lp-ui-bar">
          <b>Computer</b>
          <span className="lp-tag" data-quiet={done}>
            <i />
            {done ? "Done" : "Pip is working"}
          </span>
        </p>
        <p className="lp-ui-says">{says}</p>
        <div className="lp-browser">
          <p className="lp-browser-bar">
            <i />
            <i />
            <i />
            <span>search</span>
          </p>
          <div className="lp-browser-page">
            <p className="lp-field">{reached(0) ? "best e-ink tablets" : ""}</p>
            {[
              "The nine best e-ink tablets",
              "Paper tablets, compared",
              "Which one to write on",
            ].map((title, row) => (
              <p
                key={title}
                className="lp-result"
                data-lit={(row === 0 && at === 1) || (row === 2 && at === 2)}
              >
                <b>{title}</b>
                <i />
                <i />
              </p>
            ))}
          </div>
          <span className="lp-pointer" data-at={where}>
            <svg viewBox="0 0 16 16" role="presentation">
              <path d="M2 1.5 13.5 7 8.6 8.6 7 13.5Z" />
            </svg>
            <b>Pip</b>
          </span>
        </div>
        <pre className="lp-shell">
          <span data-shown={reached(2)}>
            <i>$</i> python compare.py reviews/
          </span>
          {"\n"}
          <span data-shown={reached(3)}>{"  "}wrote library/tablets.md</span>
        </pre>
      </div>
    </div>
  )
}

/** What the phone in a pocket shows while it works: the time, and what it sends when it is done. */
const AWAY = [
  ["6:12", "Running the deploy"],
  ["6:19", "Checking the page"],
  ["6:24", undefined],
  ["6:24", undefined],
] as const

function AwayPicture() {
  const [at] = usePlay(AWAY.length, 2_800)
  const [time, doing] = AWAY[at]!
  return (
    <div className="lp-vis" style={{ "--tone": "#5b3d8f" } as React.CSSProperties} aria-hidden>
      <div className="lp-lock">
        <p className="lp-lock-date">Friday, March 6</p>
        <p className="lp-lock-time">{time}</p>
        <div className="lp-notes">
          <p className="lp-note" data-shown={doing === undefined}>
            <img src="/favicon.svg" alt="" />
            <span>
              <b>
                Pip <em>now</em>
              </b>
              The deploy is live. All 14 tests pass.
            </span>
          </p>
          <p className="lp-note lp-note-old">
            <img src="/favicon.svg" alt="" />
            <span>
              <b>
                Pip <em>12m ago</em>
              </b>
              On it. I will tell you when it is out.
            </span>
          </p>
        </div>
        <p className="lp-lock-doing" data-quiet={doing === undefined}>
          <i />
          {doing ?? "Done"}
        </p>
      </div>
    </div>
  )
}

/** One of the two things the rest stands on, said beside a picture of it. */
function Feature({
  eyebrow,
  title,
  text,
  ticks,
  flip = false,
  children,
}: {
  eyebrow: string
  title: string
  text: string
  ticks?: readonly string[]
  flip?: boolean
  children: React.ReactNode
}) {
  return (
    <article className={cn("lp-feature", flip && "lp-flip")}>
      <div>
        <p className="lp-eyebrow">{eyebrow}</p>
        <h3>{title}</h3>
        <p className="lp-lead">{text}</p>
        {ticks === undefined ? null : (
          <ul className="lp-ticks">
            {ticks.map((tick) => (
              <li key={tick}>{tick}</li>
            ))}
          </ul>
        )}
      </div>
      {children}
    </article>
  )
}

/** Something said once, kept, and used weeks later. */
function MemoryPicture() {
  const [, reached] = usePlay(4, 2_600)
  return (
    <div className="lp-chat">
      <p className="lp-bubble lp-you">Dana signs off on copy. Invoices go out on the 1st.</p>
      <p className="lp-saved" data-shown={reached(1)}>
        <NotePencilIcon weight="bold" />
        Saved to memory
      </p>
      <p className="lp-when" data-shown={reached(2)}>
        Three weeks later
      </p>
      <p className="lp-bubble" data-shown={reached(2)}>
        Copy is with Dana for sign-off, and the invoices are queued for the 1st.
      </p>
    </div>
  )
}

/** The clock, and what the first job on the list says as it comes round. */
const MORNING = [
  ["07:59", "In 1 min", "waiting"],
  ["08:00", "Reading the news", "running"],
  ["08:01", "Writing brief.md", "running"],
  ["08:02", "In your inbox", "done"],
] as const

function SchedulePicture() {
  const [at] = usePlay(MORNING.length, 2_600)
  const [clock, says, state] = MORNING[at]!
  return (
    <div className="lp-plan">
      <p className="lp-plan-clock">
        <b>{clock}</b>
        <span>Tuesday</span>
      </p>
      <ul>
        <li data-state={state}>
          <i />
          <b>Morning brief</b>
          <span>Weekdays · 08:00</span>
          <em>{says}</em>
        </li>
        <li>
          <i />
          <b>Week plan</b>
          <span>Mondays · 09:00</span>
          <em>In 6 days</em>
        </li>
        <li>
          <i />
          <b>Invoices</b>
          <span>The 1st · 10:00</span>
          <em>In 3 weeks</em>
        </li>
      </ul>
    </div>
  )
}

/** The places it can be talked to, and something said to it in each. */
const PLACES = [
  [BrowserIcon, "Web", "do.computer", "Plan my week around the offsite."],
  [DesktopIcon, "Desktop", "Do Computer", "Tidy up my downloads folder."],
  [DeviceMobileIcon, "Phone", "On the train", "Is the brief ready yet?"],
  [SlackLogoIcon, "Slack", "#launch", "@Pip is the pricing page live?"],
] as const

function PlacesPicture() {
  const [at] = usePlay(PLACES.length, 2_400)
  const [, , where, said] = PLACES[at]!
  return (
    <div className="lp-places">
      <p>
        {PLACES.map(([Icon, name], place) => (
          <span key={name} data-lit={place === at}>
            <Icon weight={place === at ? "fill" : "regular"} />
            {name}
          </span>
        ))}
      </p>
      <p className="lp-said" key={at}>
        <b>{where}</b>
        {said}
      </p>
    </div>
  )
}

/** Three of a team's agents, and the job as it goes from one to the next. */
const RELAY = [
  [0, "Pip is asking Scout"],
  [1, "Scout is reading the pricing page"],
  [1, "Scout is looping in Ledger"],
  [2, "Ledger is adding up March"],
] as const

const TEAM = [
  ["Pip", "Planner", "#3f7f9c"],
  ["Scout", "Research", "#6f8f4e"],
  ["Ledger", "Numbers", "#c9952c"],
] as const

function TeamPicture() {
  const [at] = usePlay(RELAY.length, 2_600)
  const [who, says] = RELAY[at]!
  return (
    <div className="lp-relay">
      <p className="lp-relay-row" data-at={who}>
        {TEAM.map(([name, does, color], place) => (
          <span
            key={name}
            data-lit={place === who}
            style={{ "--tone": color } as React.CSSProperties}
          >
            <i />
            <b>{name}</b>
            {does}
          </span>
        ))}
      </p>
      <p className="lp-relay-says" key={at}>
        <i />
        <i />
        <i />
        {says}
      </p>
    </div>
  )
}

/** The rest of what it does, each with a small picture of the app doing it. */
const CARDS = [
  [
    "It remembers",
    "It keeps notes on you and the work, so Tuesday starts where Monday ended.",
    "#6b3a5c",
    MemoryPicture,
  ],
  [
    "Up before you are",
    "Give it a schedule. The morning brief is written before the coffee is.",
    "#7a5526",
    SchedulePicture,
  ],
  [
    "Wherever you are",
    "In a browser, as an app on your desktop, on your phone, and in Slack when someone asks for it by name.",
    "#1f5a46",
    PlacesPicture,
  ],
  [
    "One for the whole team",
    "Share one with your team or keep one to yourself. They hand work to each other while you get on with yours.",
    "#24507a",
    TeamPicture,
  ],
] as const

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
        <Feature
          eyebrow="Its own machine"
          title="A computer of its own"
          text="It has a machine in the cloud to do the job on, so the answer is the finished thing and not a list of steps for you."
          ticks={[
            "Runs commands and writes files",
            "Clicks through a real browser",
            "Works on your Mac or PC too, when you let it in",
          ]}
        >
          <ComputerPicture />
        </Feature>
        <Feature
          flip
          eyebrow="In the background"
          title="Still at it when you leave"
          text="Close the laptop. It keeps going, and your phone buzzes when the job is done."
        >
          <AwayPicture />
        </Feature>
        <div className="lp-cards">
          {CARDS.map(([title, text, tone, Picture]) => (
            <article key={title} className="lp-card">
              <h3>{title}</h3>
              <p>{text}</p>
              <div
                className="lp-screen"
                style={{ "--tone": tone } as React.CSSProperties}
                aria-hidden
              >
                <Picture />
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

/** That it is open source, said with the three lines that run it. */
function OpenSource() {
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
