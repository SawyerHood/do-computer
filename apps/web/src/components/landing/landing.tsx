import type { MascotState, MascotVariant } from "@durable-computer/mascot"
import {
  AVATAR_COLORS,
  type Outfit,
  rarityOf,
  type WearItem,
  wearItem,
} from "@durable-computer/protocol"
import {
  ArrowUpRightIcon,
  BrowserIcon,
  DesktopIcon,
  DeviceMobileIcon,
  GithubLogoIcon,
  NotePencilIcon,
} from "@phosphor-icons/react"
import { Link } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"
import { AgentAvatar } from "@/components/agent-avatar"
import { type BoxHandle, BoxStage } from "@/components/creature/box-window"
import { cheerMascot } from "@/lib/mascot"
import { cn } from "@/lib/utils"

/** Where the source is, and where the desktop app is given out. */
const REPOSITORY = "https://github.com/SawyerHood/do-computer"
const DOWNLOADS = `${REPOSITORY}/releases/latest`

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
  /** What it was asked, which the steps are its answer to. */
  ask?: string
  steps: readonly Step[]
  /** Not out of its egg: the one a visitor would get. */
  egg?: boolean
}

/**
 * Who can be chosen. The page calls an agent a Dood. Each of these stands for something the one
 * agent does, and the last is the egg a new person's own comes in. Eight: two full rows of four, on a phone as on a desk.
 */
const ROSTER: readonly Character[] = [
  {
    name: "Pip",
    seed: "Sorrel",
    color: "tide",
    job: "The planner",
    about: "Trips, weeks, and what is for dinner.",
    ask: "Three days in Lisbon in March.",
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
    ask: "The checkout test is failing again.",
    steps: [
      ["working", "file", "Writing", "src/checkout.ts"],
      ["working", "command", "Running", "pnpm test"],
      ["done", undefined, "Done. 14 passed."],
    ],
  },
  {
    name: "Scout",
    seed: "Tarn",
    color: "moss",
    wear: { glasses: "goggles" },
    job: "The researcher",
    about: "Reads the internet so you do not have to.",
    ask: "Which e-ink tablet should I get?",
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
    ask: "Every weekday at 8, brief me on the news.",
    steps: [
      ["asleep", undefined, "07:59, asleep"],
      ["working", "search", "08:00, reading the news"],
      ["done", undefined, "08:02, the brief is in your inbox"],
    ],
  },
  {
    name: "Juniper",
    color: "moss",
    wear: { hat: "headphones" },
    job: "The teammate",
    about: "Lives in Slack. Answers when it is asked for.",
    ask: "@Juniper is the pricing page live?",
    steps: [
      ["listening", undefined, "#launch, Maya is typing"],
      ["speaking", undefined, "#launch, replying"],
      ["idle", undefined, "It is. Live since 9:12."],
    ],
  },
  {
    name: "Mochi",
    color: "rose",
    wear: { hat: "bunny", face: "blush" },
    job: "The note keeper",
    about: "Remembers what you said, and where you put it.",
    ask: "I am vegetarian, and I like a window seat.",
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
    ask: "Update everything on my Mac.",
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

/** How long the large one does each thing, and how long each is the large one. */
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

/**
 * The way in, or while nobody new can sign up, that it is coming and the one small way left.
 * Where there is a waiting list the way in is open: what is behind it is a Dood, and a wait.
 */
function WayIn({
  open,
  waitlist,
  children,
}: {
  open: boolean
  waitlist?: boolean
  children?: React.ReactNode
}) {
  return open ? (
    <div className="lp-cta">
      <Link to="/welcome" className="lp-button lp-dark">
        {waitlist ? "Hatch your Dood" : "Get started"}
      </Link>
      {children}
      {waitlist ? (
        <p className="lp-have lp-wait">
          The app has a waiting list. Your Dood keeps your place in it.
        </p>
      ) : null}
    </div>
  ) : (
    <div className="lp-cta lp-shut">
      <p className="lp-soon">
        <i />
        Coming soon
      </p>
      <HaveAccess />
    </div>
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
 * The app itself, in a window whose tabs change the picture. On a phone the window would be too
 * small to read: its tabs stay, and a phone is the picture.
 */
function TheApp() {
  const [chosen, setChosen] = useState(false)
  const [at, show] = useRound(VIEWS.length, 6_500, chosen)
  const [view, label] = VIEWS[at]!
  return (
    <div className="lp-shots" id="the-app">
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
        </div>
        <img
          src={`/landing/${view}.jpg`}
          alt={`Do Computer: ${label}`}
          width={2040}
          height={1350}
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
      {/* Set one over the other, as the eight are: the page under it does not move with the tabs. */}
      <div className="lp-caption">
        {VIEWS.map(([id, , caption], index) => (
          <p key={id} data-shown={index === at} aria-hidden={index !== at}>
            {caption}
          </p>
        ))}
      </div>
    </div>
  )
}

/**
 * The top of the page: what it is and the way in, beside whoever it is just now. One creature is
 * large, and is each of the eight in turn until somebody chooses; the eight are under it.
 */
function Hero({ open, waitlist }: { open: boolean; waitlist: boolean }) {
  const [chosen, setChosen] = useState(false)
  const [at, pick] = useRound(ROSTER.length, TURN_MS, chosen)
  const character = ROSTER[at]!
  const [doing, restart] = useRound(character.steps.length, STEP_MS)
  const choose = (index: number) => {
    setChosen(true)
    pick(index)
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: whoever becomes the large one starts from the top, with a hop
  useEffect(() => {
    restart(0)
    cheerMascot("landing:stage")
  }, [at])
  const step = character.steps[doing] ?? character.steps[0]!
  const tint = AVATAR_COLORS.find((color) => color.id === character.color)?.hex

  return (
    <section className="lp-hero">
      <div className="lp-top">
        <div className="lp-pitch">
          <a className="lp-flag" href="#open-source">
            <b>Open source</b> under the MIT license
            <span>
              <ArrowUpRightIcon weight="bold" />
            </span>
          </a>
          <h1>Meet your Dood.</h1>
          <p className="lp-sub">
            An open source assistant with a computer of its own. Ask in plain words, and it comes
            back with the work done.
          </p>
          <WayIn open={open} waitlist={waitlist}>
            <a className="lp-button" href={DOWNLOADS} target="_blank" rel="noreferrer">
              Download for Mac
            </a>
          </WayIn>
        </div>

        <div className="lp-pick" style={{ "--tint": tint } as React.CSSProperties}>
          <div className="lp-stage">
            {character.ask === undefined ? null : (
              <p key={at} className="lp-bubble lp-you lp-ask">
                {character.ask}
              </p>
            )}
            <AgentAvatar
              avatar={{ color: character.color, seed: character.seed ?? character.name }}
              seed="landing:stage"
              outfit={character.wear ?? {}}
              mood={{ state: step[0], variant: step[1] }}
              hatched={character.egg !== true}
              pettable
              className="lp-stage-creature"
            />
            <p
              key={`${at}:${doing}`}
              className="lp-doing"
              data-quiet={step[0] === "idle" || step[0] === "asleep"}
            >
              <i />
              <span>
                {step[2]}
                {step[3] === undefined ? null : ` ${step[3]}`}
              </span>
            </p>
          </div>
          {/* All eight are set, one over the other, and only the one chosen shows: the panel is
              as tall as the longest of them needs, whoever is on it. */}
          <div className="lp-about">
            {ROSTER.map((each, index) => (
              <p key={each.name} data-shown={index === at} aria-hidden={index !== at}>
                <b>{each.egg ? "Your Dood." : `${each.name}, ${each.job.toLowerCase()}.`}</b>{" "}
                {each.about}
              </p>
            ))}
          </div>
          <div className="lp-roster" role="group" aria-label="Doods to choose from">
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
                <span>{each.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <TheApp />
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
  ["rest", "Writing tablets.md"],
  ["rest", "Done. It is in your library."],
] as const

/** Its own computer: a browser it clicks through, and the commands it runs under it. */
function ComputerPicture() {
  const [at, reached] = usePlay(ERRAND.length, 2_600)
  const [where, says] = ERRAND[at]!
  const done = at === ERRAND.length - 1
  return (
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
          <p className="lp-field">best e-ink tablets</p>
          {["The nine best e-ink tablets", "Paper tablets, compared", "Which one to write on"].map(
            (title, row) => (
              <p
                key={title}
                className="lp-result"
                data-lit={(row === 0 && at === 1) || (row === 2 && at === 2)}
              >
                <b>{title}</b>
                <i />
                <i />
              </p>
            ),
          )}
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
  )
}

/** What the phone in a pocket shows while it works: the time, and what it is sent when it is done. */
function AwayPicture() {
  const [at, reached] = usePlay(4, 2_800)
  return (
    <div className="lp-lock">
      <p className="lp-lock-date">Friday, March 6</p>
      <p className="lp-lock-time">{["6:12", "6:19", "6:24", "6:24"][at]}</p>
      <div className="lp-notes">
        <p className="lp-note" data-shown={reached(2)}>
          <img src="/favicon.svg" alt="" />
          <span>
            <b>
              Pip <em>now</em>
            </b>
            The deploy is live. All 14 tests pass.
          </span>
        </p>
        <p className="lp-note">
          <img src="/favicon.svg" alt="" />
          <span>
            <b>
              Pip <em>12m ago</em>
            </b>
            On it. I will tell you when it is out.
          </span>
        </p>
      </div>
    </div>
  )
}

/** What the first job on the list says as its time comes round. */
const MORNING = [
  ["Weekdays at 08:00", "In 1 min", "waiting"],
  ["Reading the news", "08:00", "running"],
  ["Writing brief.md", "08:01", "running"],
  ["In your inbox", "Done", "done"],
] as const

function PlanPicture() {
  const [at] = usePlay(MORNING.length, 2_600)
  const [says, when, state] = MORNING[at]!
  return (
    <div className="lp-ui lp-plan">
      <p className="lp-ui-label">Running</p>
      <p className="lp-row" data-state={state}>
        <i />
        <span>
          <b>Morning brief</b>
          <em>{says}</em>
        </span>
        <time>{when}</time>
      </p>
      <p className="lp-ui-label">Scheduled</p>
      <p className="lp-row">
        <i />
        <span>
          <b>Week plan</b>
          <em>Mondays at 09:00</em>
        </span>
        <time>In 6 days</time>
      </p>
      <p className="lp-row">
        <i />
        <span>
          <b>Invoices</b>
          <em>The 1st at 10:00</em>
        </span>
        <time>In 3 weeks</time>
      </p>
    </div>
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
        Updated memory
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

/** Three of a team's agents, and the job as it goes from one to the next. */
const RELAY = [
  [0, "Pip is asking Scout"],
  [1, "Scout is reading the pricing page"],
  [1, "Scout is looping in Ledger"],
  [2, "Ledger is adding up March"],
] as const

const TEAM = [
  ["Pip", "#3f7f9c"],
  ["Scout", "#5f8a4e"],
  ["Ledger", "#c9952c"],
] as const

function TeamPicture() {
  const [at] = usePlay(RELAY.length, 2_600)
  const [who, says] = RELAY[at]!
  return (
    <div className="lp-relay">
      <p className="lp-team">
        {TEAM.map(([name, color], place) => (
          <span key={name} data-lit={place === who}>
            <i style={{ background: color }} />
            {name}
          </span>
        ))}
      </p>
      <p className="lp-bubble lp-you">Is the pricing page right for March?</p>
      <p className="lp-handoff">
        <i />
        <i />
        <i />
        {says}
      </p>
    </div>
  )
}

/** One thing it does, said beside a picture of it on a panel of its own color. */
function Feature({
  tone,
  title,
  text,
  flip = false,
  children,
}: {
  tone: "teal" | "plum" | "honey"
  title: string
  text: string
  flip?: boolean
  children: React.ReactNode
}) {
  return (
    <article className={cn("lp-feature", flip && "lp-flip")}>
      <div className="lp-panel" data-tone={tone} aria-hidden>
        {children}
      </div>
      <div>
        <h3>{title}</h3>
        <p>{text}</p>
      </div>
    </article>
  )
}

function WhatItDoes() {
  return (
    <section className="lp-band" id="does">
      <div className="lp-head">
        <h2>
          It does the work,
          <br />
          not just the talking.
        </h2>
        <p>
          Ask in plain words. Your Dood works the job out on a real computer, and tells you when it
          is done.
        </p>
      </div>
      <Feature
        tone="teal"
        title="A computer of its own"
        text="Every Dood has a machine in the cloud to do the job on. It runs commands, writes files and clicks through a real browser, and can work on your Mac or PC when you let it in."
      >
        <ComputerPicture />
      </Feature>
      <Feature
        flip
        tone="plum"
        title="Still at it when you leave"
        text="Close the laptop. It keeps going, and your phone buzzes when the job is done."
      >
        <AwayPicture />
      </Feature>
      <Feature
        tone="honey"
        title="Up before you are"
        text="Give it a schedule. What it does on its own is a list you can read and pause."
      >
        <PlanPicture />
      </Feature>
      <div className="lp-pair">
        <article className="lp-tile-card">
          <h3>It remembers</h3>
          <p>It keeps notes on you and the work, so Tuesday starts where Monday ended.</p>
          <div className="lp-tile-picture" aria-hidden>
            <MemoryPicture />
          </div>
        </article>
        <article className="lp-tile-card">
          <h3>One for the whole team</h3>
          <p>
            Share a Dood with your team or keep one to yourself. Doods hand work to each other while
            you get on with yours.
          </p>
          <div className="lp-tile-picture" aria-hidden>
            <TeamPicture />
          </div>
        </article>
      </div>
    </section>
  )
}

/** Slack's own mark, in its own four colors. */
function SlackMark() {
  return (
    <svg viewBox="0 0 122.8 122.8" role="presentation">
      <path
        fill="#e01e5a"
        d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z"
      />
      <path
        fill="#36c5f0"
        d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z"
      />
      <path
        fill="#2eb67d"
        d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z"
      />
      <path
        fill="#ecb22e"
        d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z"
      />
    </svg>
  )
}

/** The places it can be talked to. */
function Places() {
  return (
    <section className="lp-band" id="places">
      <div className="lp-head">
        <h2>Right where you need it</h2>
        <p>The same Dood, wherever you happen to be.</p>
      </div>
      <div className="lp-places">
        <article>
          <span className="lp-mark">
            <BrowserIcon />
          </span>
          <h3>Web</h3>
          <p>Open it in any browser. Nothing to install.</p>
        </article>
        <article>
          <span className="lp-mark">
            <DesktopIcon />
          </span>
          <h3>Desktop</h3>
          <p>An app for Mac, Windows and Linux, which can also let it work on that computer.</p>
        </article>
        <article>
          <span className="lp-mark">
            <DeviceMobileIcon />
          </span>
          <h3>Phone</h3>
          <p>Add it to your home screen. It buzzes when the job is done.</p>
        </article>
        <article>
          <span className="lp-mark">
            <SlackMark />
          </span>
          <h3>Slack</h3>
          <p>
            Give your Dood a seat in your workspace. It answers when someone asks for it by name.
          </p>
        </article>
      </div>
    </section>
  )
}

/** That it is open source, said with the three lines that run it. */
function OpenSource() {
  return (
    <section className="lp-band lp-oss" id="open-source">
      <div>
        <h2>Yours, all the way down</h2>
        <p className="lp-lead">
          Do Computer is open source under the MIT license. Read every line, change what you like,
          and run it yourself, with your own model keys.
        </p>
        <div className="lp-cta">
          <GitHubLink className="lp-button">Star on GitHub</GitHubLink>
        </div>
      </div>
      <div className="lp-terminal">
        <p className="lp-terminal-bar">
          <i />
          <i />
          <i />
          <span>~/do-computer</span>
        </p>
        <pre>
          <span>$</span> git clone {REPOSITORY}
          {"\n"}
          <span>$</span> pnpm install && pnpm build
          {"\n"}
          <span>$</span> OPENROUTER_API_KEY=sk-or-… pnpm start
          {"\n\n"}
          <em>{"  "}Listening on http://127.0.0.1:3000</em>
        </pre>
      </div>
      <div className="lp-plain">
        <article>
          <h3>Your data stays yours</h3>
          <p>One SQLite file for each Dood, wherever you put it.</p>
        </article>
        <article>
          <h3>Any model</h3>
          <p>Through OpenRouter, or a provider you are signed in to.</p>
        </article>
        <article>
          <h3>Or skip all that</h3>
          <p>We run it for you, right here.</p>
        </article>
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
      <div className="lp-hats">
        <div className="lp-hats-stage">
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
          {found === undefined || rarity === undefined ? null : (
            <p className="lp-found" style={{ "--tier": rarity.color } as React.CSSProperties}>
              <b>{rarity.label}</b>
              {found.name}
            </p>
          )}
        </div>
        <div>
          <h3>Also, Doods wear hats</h3>
          <p>
            Work with yours and it earns treats. Enough treats and a box turns up, with one of 200
            things to wear inside.
          </p>
          <div className="lp-cta">
            <button
              type="button"
              className="lp-button"
              disabled={opening || item === undefined}
              onClick={() => setOpening(true)}
            >
              {opened === 0 ? "Open a box" : "Open another"}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

/** What people ask, and the answers. */
const QUESTIONS = [
  [
    "What is a Dood?",
    "An assistant of your own, with a name, a memory and a computer. You ask it for things in plain words, and it does them.",
  ],
  [
    "How is a Dood different from a chatbot?",
    "A chatbot answers. A Dood has a computer of its own: it runs commands, writes files and uses a browser, so what comes back is the finished thing. It keeps working after you close the tab, and tells you when it is done.",
  ],
  [
    "Where does it do the work?",
    "On its own machine in the cloud. If you install the desktop app and let it in, it can also work on your Mac or PC.",
  ],
  [
    "Which models does it use?",
    "Any model through OpenRouter, or a provider you are signed in to.",
  ],
  [
    "Where is my data?",
    "Each Dood keeps its data in one SQLite file. If you host it yourself, that file is wherever you put it.",
  ],
  [
    "Can I run it myself?",
    "Yes. Do Computer is open source under the MIT license. Clone it, add a model key and start it, on a machine of your own or on your own Cloudflare account.",
  ],
  [
    "Can a team share one?",
    "Yes. Share a Dood with your team or keep one to yourself. Doods in the same workspace can hand work to each other.",
  ],
] as const

function Questions() {
  return (
    <section className="lp-band lp-faq" id="faq">
      <h2>Questions</h2>
      <div>
        {QUESTIONS.map(([question, answer]) => (
          <details key={question}>
            <summary>{question}</summary>
            <p>{answer}</p>
          </details>
        ))}
      </div>
    </section>
  )
}

/** The last word, and the way in once more. */
function Ending({ open, waitlist }: { open: boolean; waitlist: boolean }) {
  return (
    <section className="lp-band">
      <div className="lp-end">
        <img src="/favicon.svg" alt="" />
        <h2>{open ? "Get your Dood" : "Nearly here"}</h2>
        <p>
          {waitlist
            ? "It comes out of an egg and asks your name. Then it waits with you for your turn."
            : open
              ? "It comes out of an egg, asks your name, and gets to work."
              : "Do Computer is not open to everyone yet. It will be soon."}
        </p>
        <WayIn open={open} waitlist={waitlist} />
      </div>
    </section>
  )
}

/**
 * What someone who is not signed in is shown at the deployment's own address, where it has a
 * landing page: who the agent is, what it does, that it is open source, and the way in. While
 * nobody new can sign up (`open` is false) the way in is "Coming soon", and one small link for
 * whoever has an account already. With a waiting list anyone can come in as far as their Dood.
 */
export function Landing({ open, waitlist = false }: { open: boolean; waitlist?: boolean }) {
  return (
    <main
      className="lp"
      // The creatures are drawn only while they are in view, which they find out when the window
      // scrolls. Here it is this that scrolls, so the window is told.
      onScroll={() => window.dispatchEvent(new Event("scroll"))}
    >
      <header className="lp-nav">
        <span className="lp-brand">
          <img src="/favicon.svg" alt="" />
          Do Computer
        </span>
        <nav>
          <a href="#does">What it does</a>
          <a href="#places">Where it is</a>
          <a href="#open-source">Open source</a>
          <a href="#faq">Questions</a>
        </nav>
        <span className="grow" />
        <Link to="/login">Sign in</Link>
        {open ? (
          <Link to="/welcome" className="lp-button lp-dark lp-small">
            {waitlist ? "Hatch your Dood" : "Get started"}
          </Link>
        ) : (
          <span className="lp-soon lp-small">
            <i />
            Coming soon
          </span>
        )}
      </header>
      <Hero open={open} waitlist={waitlist} />
      <WhatItDoes />
      <Places />
      <OpenSource />
      <Hats />
      <Questions />
      <Ending open={open} waitlist={waitlist} />
      <footer className="lp-foot">
        <span className="lp-brand">
          <img src="/favicon.svg" alt="" />
          Do Computer
        </span>
        <span>Open source, MIT</span>
        <span className="grow" />
        <a href={REPOSITORY} target="_blank" rel="noreferrer">
          GitHub
        </a>
        <a href={DOWNLOADS} target="_blank" rel="noreferrer">
          Download
        </a>
        <Link to="/login">Sign in</Link>
      </footer>
    </main>
  )
}
