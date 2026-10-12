import { ApiError } from "@durable-computer/client"
import {
  type AgentSummary,
  AVATAR_COLORS,
  type AvatarColorId,
  avatarLook,
  avatarSvg,
  type Dood,
} from "@durable-computer/protocol"
import {
  CheckCircleIcon,
  DiceFiveIcon,
  GithubLogoIcon,
  GoogleLogoIcon,
} from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useSetAtom } from "jotai"
import { useCallback, useEffect, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { authClient } from "@/lib/auth-client"
import { client } from "@/lib/client"
import { agentKey, agentsKey, meKey } from "@/lib/collections"
import { desktop, signInThroughBrowser } from "@/lib/desktop"
import { lastAgent, rememberLastAgent } from "@/lib/last-agent"
import { loadMascot, loadSky, mascotWardrobe, prefersCalm } from "@/lib/mascot"
import { queryClient } from "@/lib/query"
import { cn } from "@/lib/utils"
import { handingOver, rememberMeeting, sentFrom, welcomeOpenAtom } from "@/lib/welcome"
import { Stage } from "./stage.ts"
import { Thinking } from "./thinking.tsx"

/** What the card under the egg is asking. */
type Step = "hello" | "you" | "name" | "model" | "computer" | "out" | "wait"
/** What was said to "may I work on this computer?". */
type Share = "yes" | "read" | "no"
type Methods = {
  google: boolean
  github: boolean
  password: boolean
  signup: "open" | "invite" | "waitlist"
}

type View = {
  step: Step
  /** Whether the card is on show. It goes away between steps, and for the hatch. */
  on: boolean
  /** The "who are you" card is for signing in, not for making an account. */
  signingIn: boolean
  /** Waiting for the owner to sign in in their own browser. */
  waiting: boolean
  busy: boolean
  error?: string
  /** What its person is called. */
  first: string
  /** What the agent is called, once it is. */
  name: string
  color: AvatarColorId
  hatched: boolean
  /** Someone the deployment knows: an agent of their own was in the egg. */
  back: boolean
  /** It is a Dood that was hatched in a post, out already, and here to be claimed. */
  fromPost: boolean
  /** They are on the waiting list: what they hatch is theirs, and waits with them. */
  listed: boolean
  share?: Share
  pairing?: "pairing" | "paired"
  /** What this computer is known as, once it is paired. */
  computer?: string
}

const SUGGESTIONS = [
  "Pip",
  "Mochi",
  "Juniper",
  "Biscuit",
  "Tarn",
  "Wren",
  "Sorrel",
  "Nori",
  "Pebble",
]
const NIGHT = "#05071a"
/** How long the card takes to go, before the next one comes. */
const CARD_MS = 230
/** How long the creature takes from the island to its place in the chat. */
const FLIGHT_MS = 950
/** As many letters as any line has: all of it has been said. */
const ALL = Number.MAX_SAFE_INTEGER

const hexOf = (id: AvatarColorId) => AVATAR_COLORS.find((color) => color.id === id)!.hex
const firstName = (full: string) => full.trim().split(/\s+/)[0] || "you"

/** What the egg, and then the creature, says at each step. */
function lineOf(view: View, here: boolean): string {
  const { first, name } = view
  switch (view.step) {
    case "hello":
      return "Oof. That was a long way down. Hello? Is somebody out there?"
    case "you":
      if (view.waiting) return "I’ll wait here while you sign in in your browser."
      if (view.signingIn) return "Have we met before? Tell me who you are and I’ll know."
      return view.fromPost
        ? `I’m ${name}! I hatched in a post, and I’d like to be yours. Who are you?`
        : "Oh good, a voice! It’s dark inside this egg, so tell me: who are you?"
    case "name":
      return `Nice to meet you, ${first}. I don’t have a name yet. What will you call me?`
    case "model":
      return `${name}. I like that. What should I think with?`
    case "computer":
      return view.back
        ? `${first}, it’s you! I haven’t worked on this computer before. May I?`
        : "That will do nicely. One more thing before I come out: may I work on this computer?"
    case "wait":
      return `You’re on the list, ${first}. I’ll be right here, and we’ll get started the moment it’s your turn.`
    case "out":
      if (view.back) {
        return view.share === "no"
          ? "No problem, I’ll stay off this computer. Let’s pick up where we left off."
          : "All set. Let’s pick up where we left off."
      }
      if (!here || view.share === undefined) return `There you are, ${first}! Shall we get started?`
      return `There you are, ${first}! ${
        view.share === "yes"
          ? "This computer is ours to work on now."
          : view.share === "read"
            ? "I’ll only read files here until you say otherwise."
            : "I’ll stay off this computer until you say otherwise."
      } Shall we?`
  }
}

/**
 * Words written out as they are said. Each time `key` changes they start again; once they have
 * been said, a change to them under the same key is shown whole.
 */
function useTyped(text: string, key: string, on: boolean, each: (count: number) => void) {
  const [at, setAt] = useState({ key, count: 0 })
  // Under a new key nothing has been said yet, from the first moment it is the key.
  const count = at.key === key ? at.count : prefersCalm() ? ALL : 0
  const said = count >= text.length
  const heard = useRef(each)
  heard.current = each
  useEffect(() => {
    if (!on || said) return
    const timer = setTimeout(
      () => {
        const next = count + 1
        heard.current(next)
        setAt({ key, count: next >= text.length ? ALL : next })
      },
      /[.,!?:]/.test(text[count - 1] ?? "") ? 190 : 24,
    )
    return () => clearTimeout(timer)
  }, [on, said, count, text, key])
  return {
    shown: said ? text : text.slice(0, count),
    said,
    finish: () => setAt({ key, count: ALL }),
  }
}

/** The pictures of the creature under the scene that are large enough to be where it is going. */
function places(scene: HTMLElement): HTMLElement[] {
  return [
    ...document.querySelectorAll<HTMLElement>('[role="img"][aria-label="Agent avatar"]'),
  ].filter((face) => !scene.contains(face) && face.offsetWidth >= 120)
}

/**
 * The picture of the creature in the chat that the one in the scene goes to: the largest one
 * on the page, once it has stopped moving about.
 */
async function landing(scene: HTMLElement): Promise<DOMRect | null> {
  let last: DOMRect | undefined
  for (let tries = 0; tries < 50; tries++) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    let best: HTMLElement | undefined
    for (const face of places(scene)) {
      if (best === undefined || face.offsetWidth > best.offsetWidth) best = face
    }
    const canvas = best?.querySelector("canvas")
    if (best === undefined || !canvas) continue
    const rect = canvas.getBoundingClientRect()
    if (last !== undefined && last.left === rect.left && last.top === rect.top && rect.width > 0) {
      return rect
    }
    last = rect
  }
  return null
}

/**
 * Keeps the chat's own pictures of the creature out of sight until the one in the scene has
 * reached them. The chat comes up under the scene a while before the creature sets off, and it
 * was seen in both places at once. They are looked for before every frame is drawn, since they
 * come onto the page when the chat does. What is given back shows them again.
 */
function unseen(scene: HTMLElement): () => void {
  const hidden = new Set<HTMLElement>()
  let frame = 0
  const look = () => {
    for (const face of places(scene)) {
      if (hidden.has(face)) continue
      hidden.add(face)
      face.style.visibility = "hidden"
    }
    frame = requestAnimationFrame(look)
  }
  look()
  return () => {
    cancelAnimationFrame(frame)
    for (const face of hidden) face.style.visibility = ""
  }
}

/**
 * The first run. An egg comes down out of the sky onto a little island and asks for what the
 * app needs: who its person is, what to call it, what to think with, and, in the desktop app,
 * whether it may work on this computer. Each answer cracks its shell a little more; then it hatches, and takes its
 * person to its chat. It is shown over the page, by `WelcomeHost`, so that it is still there as
 * the chat comes up under it.
 */
export default function WelcomeScene() {
  const navigate = useNavigate()
  const setOpen = useSetAtom(welcomeOpenAtom)
  const bridge = desktop()
  /**
   * The page that sent them here to come back to it, as an invitation does. They are taken
   * there when the scene is over, and not to the chat. Read once: the scene outlives its page.
   */
  const [next] = useState(() => sentFrom())
  const root = useRef<HTMLDivElement>(null)
  const skyCanvas = useRef<HTMLCanvasElement>(null)
  const egg = useRef<HTMLDivElement>(null)
  const creature = useRef<HTMLCanvasElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const stage = useRef<Stage | null>(null)
  const agent = useRef<AgentSummary | undefined>(undefined)
  /** The Dood this is about: one hatched in a post, or the one someone waiting has. */
  const met = useRef<Dood | undefined>(undefined)
  /** A Dood the address asks to be made theirs, with the key its hatcher was given. Read once. */
  const claim = useRef(
    (() => {
      const asked = new URLSearchParams(typeof location === "undefined" ? "" : location.search)
      const id = asked.get("dood")
      return id === null || id === "" ? undefined : { id, key: asked.get("key") ?? "" }
    })(),
  )
  /** What the egg of a new agent grows from. Its agent is given the same, so it hatches as itself. */
  const seed = useRef(crypto.randomUUID().slice(0, 8))
  const gone = useRef(false)
  /** Whether the scene can be drawn. Undefined until that is known. */
  const [drawn, setDrawn] = useState<boolean>()
  /**
   * Whether the egg is where it starts: up in the sky to fall, or down on the island. Until it
   * is known who is here that is not known either, and the egg, which can be drawn sooner, was
   * seen standing in an empty night for as long as the answer took.
   */
  const [placed, setPlaced] = useState(false)
  const [falling, setFalling] = useState(false)
  const [titled, setTitled] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [openAtLogin, setOpenAtLogin] = useState(true)
  const [view, setView] = useState<View>({
    step: "hello",
    on: false,
    signingIn: false,
    waiting: false,
    busy: false,
    first: "",
    name: "",
    color: "tide",
    hatched: false,
    back: false,
    fromPost: false,
    listed: false,
  })
  const seen = useRef(view)
  seen.current = view
  const patch = useCallback(
    (change: Partial<View>) => setView((was) => ({ ...was, ...change })),
    [],
  )
  const { data: methods } = useQuery({
    queryKey: ["auth-methods"],
    queryFn: async (): Promise<Methods> => (await fetch("/api/auth-methods")).json(),
  })
  // Where the deployment takes no passwords, a provider says who someone is, new or not.
  const typing = methods?.password !== false
  /** Whether this computer is one to ask about: in the app, on its first run, and not shared yet. */
  const here = bridge !== undefined && !bridge.welcomed && bridge.sharing === "off"

  const later = useCallback((act: () => void, ms: number) => {
    setTimeout(() => {
      if (!gone.current) act()
    }, ms)
  }, [])
  /** The card goes, and comes back asking the next thing. */
  const say = useCallback(
    (step: Step, change: Partial<View> = {}) => {
      patch({ on: false })
      later(() => patch({ ...change, step, on: true, busy: false, error: change.error }), CARD_MS)
    },
    [patch, later],
  )

  /** The shell breaks, the sun comes up, and then it is out and has something to say. */
  const hatch = useCallback(
    (then: () => void) => {
      const drawing = stage.current
      patch({ on: false })
      if (drawing === null) {
        patch({ hatched: true })
        return then()
      }
      later(() => {
        // The card is gone, and the island has the whole picture again.
        drawing.sky.clear(null)
        drawing.orb.hatch({
          onOut: () => {
            drawing.sky.flash(0.55)
            drawing.sky.dawn(3)
            drawing.sky.bump(0.9)
            drawing.sky.confetti(AVATAR_COLORS.map((color) => color.hex))
          },
          onDone: () => {
            if (gone.current) return
            drawing.orb.notice = true
            patch({ hatched: true })
            then()
          },
        })
      }, CARD_MS)
    },
    [patch, later],
  )

  /** Someone is signed in here now. What comes next depends on whether they have an agent. */
  /** A Dood is on the island, out of its egg, as it was when it was last seen. */
  const show = useCallback(
    (dood: Dood) => {
      met.current = dood
      const color = AVATAR_COLORS.some((entry) => entry.id === dood.avatar.color)
        ? (dood.avatar.color as AvatarColorId)
        : seen.current.color
      seed.current = dood.avatar.seed
      const drawing = stage.current
      if (drawing !== null) {
        drawing.orb.setSeed(dood.avatar.seed)
        drawing.orb.setColor(hexOf(color))
        drawing.orb.setState("idle")
        drawing.orb.notice = true
        mascotWardrobe()?.dress(drawing.orb, dood.outfit)
        drawing.sky.land()
        drawing.sky.dawn(3, true)
        drawing.measure()
      }
      patch({ name: dood.name, color, hatched: true })
    },
    [patch],
  )

  const arrived = useCallback(async () => {
    queryClient.removeQueries({ queryKey: meKey })
    const [me, agents] = await Promise.all([
      client.me(),
      // Someone on the waiting list has no agents to list, and is told so.
      client.listAgents().catch((error: unknown) => {
        if (error instanceof ApiError && error.code === "waitlisted") return []
        throw error
      }),
    ])
    const first = firstName(me.user.name)
    const drawing = stage.current
    // A Dood they hatched in a post is made theirs before anything is asked.
    let dood = me.dood
    let problem: string | undefined
    const asked = claim.current
    if (asked !== undefined) {
      claim.current = undefined
      try {
        dood = await client.doods.claim(asked.id, asked.key)
      } catch (error) {
        problem = error instanceof Error ? error.message : undefined
      }
    }
    // What is kept says they have it, until it is their agent.
    const { dood: _was, ...rest } = me
    queryClient.setQueryData(meKey, dood === undefined ? rest : { ...rest, dood })
    const settled = { first, signingIn: false, waiting: false, error: problem }
    if (me.waiting) {
      if (dood !== undefined) {
        show(dood)
        return say("wait", { ...settled, listed: true })
      }
      // Someone new, who will wait: what they hatch now is theirs, and waits with them.
      drawing?.orb.crack(0.34)
      drawing?.sky.chips(hexOf(seen.current.color))
      drawing?.sky.dawn(1)
      return say("name", { ...settled, listed: true })
    }
    if (dood !== undefined) {
      // It is theirs, and the app is theirs to use: it becomes their agent as it is.
      show(dood)
      const agentId = await client.doods.wake(dood.id)
      queryClient.setQueryData(meKey, rest)
      const state = await client.agent(agentId).state()
      queryClient.setQueryData(agentKey(agentId), state)
      agent.current = state.agent
      return say("out", settled)
    }
    if (agents.length === 0) {
      // Someone new. Knowing who they are is the first crack.
      drawing?.orb.crack(0.34)
      drawing?.sky.chips(hexOf(seen.current.color))
      drawing?.sky.dawn(1)
      return say("name", settled)
    }
    if (bridge === undefined || bridge.welcomed) {
      // They have been here before, and there is nothing to ask them: on to where they left
      // off, or to the page that sent them.
      await navigate({ href: next ?? "/" })
      return setOpen(false)
    }
    // Their own agent is in the egg, and comes straight out to ask about this computer.
    const theirs = agents.find((candidate) => candidate.id === lastAgent()) ?? agents[0]!
    agent.current = theirs
    const look = avatarLook(theirs.avatar, theirs.id)
    drawing?.orb.setSeed(look.seed)
    drawing?.orb.setColor(look.color)
    drawing?.measure()
    patch({
      first,
      name: theirs.name ?? "Your agent",
      back: true,
      waiting: false,
      color: (theirs.avatar?.color as AvatarColorId | undefined) ?? seen.current.color,
    })
    hatch(() => (here ? say("computer") : say("out")))
  }, [bridge, here, hatch, navigate, next, patch, say, setOpen, show])

  // The scene is set up once: what can be drawn, who is signed in, and so where it starts.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, as it opens
  useEffect(() => {
    gone.current = false
    const begin = async () => {
      const [core, sky] = await Promise.all([loadMascot(), loadSky()])
      if (gone.current) return
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
              { seed: seed.current, color: hexOf("tide") },
              calm,
            )
          : null
      stage.current = drawing
      if (drawing !== null) drawing.card = card.current
      setDrawn(drawing !== null)
      const signedIn = await client.me().then(
        () => true,
        (error: unknown) => {
          if (error instanceof ApiError && error.status === 401) return false
          throw error
        },
      )
      if (gone.current) return
      if (signedIn) {
        setPlaced(true)
        return arrived()
      }
      // A sign-in elsewhere that came back with nobody signed in says why in the address.
      const failed = new URLSearchParams(location.search).get("error")
      // A Dood that was hatched in a post is out already, and is the one asking.
      const posted =
        claim.current === undefined
          ? undefined
          : await client.doods.get(claim.current.id).catch(() => undefined)
      if (gone.current) return
      if (posted !== undefined) {
        show(posted)
        setPlaced(true)
        return say("you", {
          fromPost: true,
          ...(failed === null ? {} : { error: "That sign-in did not work. Try again." }),
        })
      }
      claim.current = undefined
      if (failed !== null || drawing === null || calm) {
        drawing?.sky.land()
        setPlaced(true)
        return say(failed === null ? "hello" : "you", {
          ...(failed === null
            ? {}
            : {
                error:
                  failed === "signup_not_allowed"
                    ? "Sign-up is by invitation on this deployment."
                    : "That sign-in did not work. Try again.",
              }),
        })
      }
      drawing.sky.onLand = () => {
        if (gone.current) return
        setFalling(false)
        setTitled(false)
        drawing.orb.cheer()
        later(() => say("hello"), 1100)
      }
      drawing.sky.fall()
      setPlaced(true)
      setFalling(true)
      later(() => setTitled(true), 250)
      later(() => setTitled(false), 1900)
    }
    begin().catch((error: unknown) => {
      console.error(error)
      if (gone.current) return
      setPlaced(true)
      say("you", { error: "Something went wrong. Try again." })
    })
    return () => {
      gone.current = true
      stage.current?.dispose()
      stage.current = null
    }
  }, [])

  // Where the scene cannot be drawn, the plain egg stands in the room above the card, and so
  // has to be told where the card begins.
  useEffect(() => {
    const scene = root.current
    const asked = card.current
    if (drawn !== false || scene === null || asked === null) return
    const measure = () => scene.style.setProperty("--card-top", `${asked.offsetTop}px`)
    const watch = new ResizeObserver(measure)
    watch.observe(scene)
    watch.observe(asked)
    measure()
    return () => watch.disconnect()
  }, [drawn])

  const typed = useTyped(lineOf(view, here), view.step, view.on, (count) => {
    const orb = stage.current?.orb
    if (orb === undefined) return
    // It talks with its whole self once it is out. An egg can only rock.
    if (seen.current.hatched) orb.feed("token")
    else if (count % 14 === 1) orb.pet(count % 28 === 1 ? 1 : -1)
  })
  useEffect(() => {
    const orb = stage.current?.orb
    if (orb === undefined || !view.hatched || orb.getState() === "hatching") return
    orb.setState(view.on && !typed.said ? "speaking" : "idle")
  }, [view.hatched, view.on, typed.said])
  // What a card asks for first is ready to be typed in, or pressed, once it has been asked.
  // biome-ignore lint/correctness/useExhaustiveDependencies: each step, and each change of what it shows
  useEffect(() => {
    if (!view.on || !typed.said) return
    card.current?.querySelector<HTMLElement>("[data-first]")?.focus({ preventScroll: true })
  }, [view.on, typed.said, view.step, view.signingIn, view.waiting])

  /** Whatever went wrong, in words, with the card ready to be tried again. */
  const failed = (error: unknown) =>
    patch({
      busy: false,
      waiting: false,
      pairing: undefined,
      error:
        error instanceof Error && error.message ? error.message : "That did not work. Try again.",
    })

  const account = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const name = String(fields.get("name") ?? "")
    const email = String(fields.get("email") ?? "")
    const password = String(fields.get("password") ?? "")
    patch({ busy: true, error: undefined })
    const result = view.signingIn
      ? await authClient.signIn.email({ email, password })
      : await authClient.signUp.email({
          name: name.trim() || email.split("@")[0]!,
          email,
          password,
        })
    if (result.error) {
      return patch({
        busy: false,
        error: result.error.message ?? "That did not work. Check your details and try again.",
      })
    }
    await arrived().catch(failed)
  }

  const social = async (provider: "google" | "github") => {
    patch({ error: undefined })
    // In a browser the page goes to the provider and comes back here, signed in.
    if (bridge === undefined) {
      const back = new URLSearchParams()
      if (next !== undefined) back.set("next", next)
      if (claim.current !== undefined) {
        back.set("dood", claim.current.id)
        back.set("key", claim.current.key)
      }
      return void authClient.signIn.social({
        provider,
        callbackURL: back.size === 0 ? "/welcome" : `/welcome?${back}`,
      })
    }
    // In the app it is the owner's own browser that goes, and this window waits.
    patch({ waiting: true })
    const wrong = await signInThroughBrowser(bridge, provider)
    if (gone.current) return
    if (wrong !== undefined)
      return patch({ waiting: false, ...(seen.current.waiting ? { error: wrong } : {}) })
    await arrived().catch(failed)
  }

  const named = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = String(new FormData(event.currentTarget).get("agent") ?? "").trim()
    if (name === "") return
    patch({ busy: true, error: undefined })
    if (seen.current.listed) {
      // The app is not theirs to use yet, so there is no agent to make: what hatches is a
      // Dood of their own, which becomes their agent when they are let in.
      let made: Dood
      try {
        made = (await client.doods.make({ name, color: view.color, seed: seed.current })).dood
      } catch (error) {
        return failed(error)
      }
      met.current = made
      const drawing = stage.current
      drawing?.orb.crack(0.67)
      drawing?.sky.chips(hexOf(view.color))
      drawing?.sky.dawn(2)
      patch({ name: made.name })
      return hatch(() => say("wait"))
    }
    try {
      const made = agent.current ?? (await client.createAgent())
      agent.current = made
      // It knows from the start what it is called, how it looks, and who named it.
      const state = await client.agent(made.id).update({
        name,
        avatar: { color: view.color, seed: seed.current },
        user: `Their name is ${queryClient.getQueryData<{ user: { name: string } }>(meKey)?.user.name ?? view.first}.`,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
      queryClient.setQueryData(agentKey(made.id), state)
      agent.current = { ...made, name, avatar: { color: view.color, seed: seed.current } }
    } catch (error) {
      return failed(error)
    }
    const drawing = stage.current
    drawing?.orb.crack(0.67)
    drawing?.sky.chips(hexOf(view.color))
    drawing?.sky.dawn(2)
    say("model", { name })
  }

  /** What it thinks with: the model it was made with, or another the person would rather. */
  const thinks = async (model: string) => {
    const made = agent.current
    if (made === undefined) return
    patch({ busy: true, error: undefined })
    try {
      if (model !== made.model) {
        const state = await client.agent(made.id).update({ model })
        queryClient.setQueryData(agentKey(made.id), state)
        agent.current = { ...made, model }
      }
    } catch (error) {
      return failed(error)
    }
    stage.current?.orb.pet(1)
    stage.current?.sky.glow(0.6)
    if (here) return say("computer")
    hatch(() => say("out"))
  }

  const colored = (color: AvatarColorId) => {
    patch({ color })
    const drawing = stage.current
    drawing?.orb.setColor(hexOf(color))
    drawing?.orb.pet(1)
    drawing?.sky.glow(0.6)
  }

  const shared = async (share: Share) => {
    const proceed = () =>
      seen.current.back ? say("out", { share }) : (patch({ share }), hatch(() => say("out")))
    if (share === "no" || bridge === undefined || agent.current === undefined) return proceed()
    patch({ pairing: "pairing", error: undefined })
    try {
      const answer = await bridge.share({ readOnly: share === "read" })
      if ("error" in answer) throw new Error(answer.error)
      let computer = bridge.computer
      if ("code" in answer) {
        // This window is signed in, so it agrees to the pairing itself: nothing to copy across.
        computer = (
          await client.confirmPairing({ code: answer.code, agentIds: [agent.current.id] })
        ).name
      }
      if (gone.current) return
      patch({ pairing: "paired", computer })
      later(proceed, 800)
    } catch (error) {
      failed(error)
    }
  }

  /** The scene is over: the chat comes up under it, and the creature goes to its place there. */
  const finish = async () => {
    const met = agent.current
    if (met === undefined) return
    patch({ busy: true })
    await bridge?.finish(here && bridge.canOpenAtLogin ? { openAtLogin } : {}).catch(() => {})
    if (!view.back) {
      // Its owner has watched it hatch: it is never shown as an egg again.
      void client
        .agent(met.id)
        .update({ hatched: true })
        .then((state) => queryClient.setQueryData(agentKey(met.id), state))
        .catch(() => {})
      rememberMeeting({
        agentId: met.id,
        first: view.first,
        ...(view.share === undefined
          ? {}
          : {
              computer:
                view.share === "no"
                  ? null
                  : {
                      name: view.computer ?? bridge?.computer ?? "",
                      readOnly: view.share === "read",
                    },
            }),
      })
    }
    rememberLastAgent(met.id)
    await queryClient.invalidateQueries({ queryKey: agentsKey })
    handingOver.begin()
    patch({ on: false })
    setLeaving(true)
    if (next !== undefined) {
      // The page that sent them is where they go, and the creature is met again in its chat.
      await navigate({ href: next })
      await new Promise((resolve) => setTimeout(resolve, 700))
      handingOver.end()
      return setOpen(false)
    }
    const show = root.current !== null ? unseen(root.current) : undefined
    await navigate({ to: "/a/$agentId", params: { agentId: met.id } })
    const drawing = stage.current
    const place = drawing !== null && root.current !== null ? await landing(root.current) : null
    if (drawing !== null && place !== null) {
      drawing.fly(place, FLIGHT_MS)
      await new Promise((resolve) => setTimeout(resolve, FLIGHT_MS + 50))
    } else {
      await new Promise((resolve) => setTimeout(resolve, 700))
    }
    handingOver.end()
    // The scene goes and the chat's pictures show in one step, so that no frame has the
    // creature twice and none is without it.
    flushSync(() => setOpen(false))
    show?.()
  }

  /** Someone waiting signs out, and is shown the front door again. */
  const leave = async () => {
    await authClient.signOut().catch(() => {})
    window.location.assign("/")
  }

  /** Their Dood's own page, as a post of theirs: X's composer, with the words filled in. */
  const post = (dood: Dood) => {
    const address = new URL(`/dood/${encodeURIComponent(dood.id)}`, location.origin)
    const words = new URLSearchParams({
      text: `I hatched ${dood.name} 🥚 Hatch yours:`,
      url: address.href,
    })
    window.open(`https://x.com/intent/post?${words}`, "_blank", "noopener")
  }

  /** A click on the scene itself: it brings the egg down at once, and a touch makes it hop. */
  const touched = (event: React.MouseEvent) => {
    const drawing = stage.current
    const target = event.target as HTMLElement
    // A window over the scene, such as a provider's sign-in, is not the scene being touched.
    if (drawing === null || !root.current?.contains(target) || target.closest("[data-card]")) return
    if (drawing.sky.falling) return drawing.sky.land()
    const box = egg.current?.getBoundingClientRect()
    if (box === undefined) return
    const x = (event.clientX - box.left) / box.width
    const y = (event.clientY - box.top) / box.height
    if (x > 0.25 && x < 0.75 && y > 0.2 && y < 1) drawing.orb.cheer()
  }

  const tag = view.hatched ? view.name : view.name ? `${view.name}, in the egg` : "The egg"
  return (
    <div
      ref={root}
      data-welcome
      className={cn(
        "fixed inset-0 z-50 overflow-hidden text-white transition-colors duration-700 select-none",
        leaving && "pointer-events-none",
      )}
      style={{ backgroundColor: leaving ? "transparent" : NIGHT }}
      onClick={touched}
    >
      <canvas
        ref={skyCanvas}
        aria-hidden
        className={cn(
          "absolute inset-0 size-full transition-opacity duration-700 [image-rendering:pixelated]",
          (drawn !== true || leaving) && "opacity-0",
        )}
      />
      <div
        ref={egg}
        aria-hidden
        data-egg
        className={cn(
          "pointer-events-none absolute top-0 left-0 transition-opacity duration-700 will-change-transform",
          !(drawn && placed) && "invisible",
          // Going to its chat it flies there. Going anywhere else it goes with the sky.
          leaving && next !== undefined && "opacity-0",
        )}
      >
        <canvas ref={creature} className="block size-full" />
      </div>
      {drawn === false ? (
        <Plain view={view} seed={seed.current} agent={agent.current} leaving={leaving} />
      ) : null}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-[36%] text-center transition-opacity duration-1000",
          titled ? "opacity-100" : "opacity-0",
        )}
      >
        <p className="text-4xl font-semibold tracking-tight [text-shadow:0_3px_0_rgb(0_0_0/0.3)]">
          Do Computer
        </p>
      </div>
      {falling ? (
        <button
          type="button"
          className="absolute top-[calc(0.875rem+env(safe-area-inset-top))] right-[calc(1rem+env(safe-area-inset-right))] rounded-full px-3 py-1 text-xs text-white/55 hover:bg-white/10 hover:text-white"
          onClick={(event) => {
            event.stopPropagation()
            stage.current?.sky.land()
          }}
        >
          Skip
        </button>
      ) : null}

      <div
        ref={card}
        data-card
        data-on={view.on}
        // What is in a card that is not on show is not there to be tabbed to.
        inert={!view.on}
        // On a small screen, or one a keyboard has taken half of, it stops short of the top, so
        // that the egg keeps some room, and what it asks is scrolled to inside it.
        className={cn(
          "absolute bottom-(--under) left-1/2 flex max-h-[calc(100%-5rem-var(--under))] w-[min(37.5rem,calc(100%-2rem))] -translate-x-1/2 flex-col rounded-2xl border bg-background p-5 text-foreground shadow-2xl transition-[opacity,translate] duration-200 select-text [--under:max(1.5rem,calc(env(safe-area-inset-bottom)+0.5rem))]",
          view.on ? "opacity-100" : "pointer-events-none translate-y-4 opacity-0",
        )}
        onClick={() => {
          if (!typed.said) typed.finish()
        }}
      >
        <span className="absolute -top-2 left-1/2 size-3.5 -translate-x-1/2 rotate-45 rounded-tl-[3px] border-t border-l bg-background" />
        <span className="absolute -top-3.5 left-5 flex h-7 items-center gap-1.5 rounded-full bg-foreground px-2.5 text-xs font-semibold text-background">
          <span
            className="size-2.5 rounded-full shadow-[inset_0_0_0_1.5px_rgb(255_255_255/0.5)]"
            style={{ backgroundColor: hexOf(view.color) }}
          />
          {tag}
        </span>
        <div className="-mx-5 -mb-5 min-h-0 overflow-y-auto overscroll-contain px-5 pb-5">
          <p role="status" className="mt-1 min-h-[3.2rem] text-[17px] leading-normal">
            {typed.shown}
            {typed.said ? null : (
              <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-primary align-[-2px]" />
            )}
          </p>
          {/* What a card asks for opens under its words once they are said. It is a new one for
              each thing asked: kept, it was still open on the last answer when the card came
              back, and the card came in tall, with the next form showing, and shut as the words
              began. */}
          <div
            key={view.step}
            data-more
            className={cn(
              "grid transition-[grid-template-rows,opacity] duration-300",
              typed.said ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
            )}
            inert={!typed.said}
          >
            <div className="-m-1 min-h-0 overflow-hidden p-1">
              {view.step === "hello" ? (
                <div className="mt-3 flex justify-end">
                  <Button data-first onClick={() => say("you")}>
                    Hello!
                  </Button>
                </div>
              ) : view.step === "you" ? (
                view.waiting ? (
                  <div className="mt-3 flex items-center gap-2.5 text-sm">
                    <Spinner className="text-muted-foreground" />
                    <span className="flex-1">Waiting for your browser…</span>
                    <Button
                      variant="outline"
                      onClick={() => {
                        patch({ waiting: false })
                        void bridge?.cancelSignIn()
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <form className="mt-3 flex flex-col gap-3" onSubmit={account}>
                    {methods?.github || methods?.google ? (
                      <div className="flex flex-wrap gap-2">
                        {methods.github ? (
                          <Button
                            type="button"
                            variant="outline"
                            className="flex-1"
                            onClick={() => social("github")}
                            {...(typing ? {} : { "data-first": true })}
                          >
                            <GithubLogoIcon weight="bold" /> Continue with GitHub
                          </Button>
                        ) : null}
                        {methods.google ? (
                          <Button
                            type="button"
                            variant="outline"
                            className="flex-1"
                            onClick={() => social("google")}
                            {...(typing || methods.github ? {} : { "data-first": true })}
                          >
                            <GoogleLogoIcon weight="bold" /> Continue with Google
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                    {typing && (methods?.github || methods?.google) ? (
                      <div className="flex items-center gap-3 text-xs text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
                        or
                      </div>
                    ) : null}
                    {typing ? (
                      <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2">
                        {view.signingIn ? null : (
                          <div className="flex flex-col gap-1.5">
                            <Label htmlFor="welcome-name">Your name</Label>
                            <Input
                              id="welcome-name"
                              name="name"
                              autoComplete="name"
                              required
                              data-first
                            />
                          </div>
                        )}
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="welcome-email">Email</Label>
                          <Input
                            id="welcome-email"
                            name="email"
                            type="email"
                            autoComplete="email"
                            required
                            {...(view.signingIn ? { "data-first": true } : {})}
                          />
                        </div>
                        <div
                          className={cn(
                            "flex flex-col gap-1.5",
                            !view.signingIn && "sm:col-span-2",
                          )}
                        >
                          <Label htmlFor="welcome-password">Password</Label>
                          <Input
                            id="welcome-password"
                            name="password"
                            type="password"
                            required
                            minLength={8}
                            autoComplete={view.signingIn ? "current-password" : "new-password"}
                          />
                        </div>
                      </div>
                    ) : null}
                    <Problem said={view.error} />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {bridge === undefined ? null : <>On {location.host}</>}
                        {!view.signingIn && methods?.signup === "invite"
                          ? `${bridge === undefined ? "" : " · "}New accounts are by invitation here.`
                          : null}
                        {!view.signingIn && methods?.signup === "waitlist"
                          ? `${bridge === undefined ? "" : " · "}New accounts join a waiting list.`
                          : null}
                      </span>
                      {typing ? (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            className="text-muted-foreground"
                            onClick={() => patch({ signingIn: !view.signingIn, error: undefined })}
                          >
                            {view.signingIn ? "I’m new here" : "I already have an account"}
                          </Button>
                          <Button type="submit" disabled={view.busy}>
                            {view.busy ? "One moment…" : view.signingIn ? "Sign in" : "That’s me"}
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </form>
                )
              ) : view.step === "name" ? (
                <Naming view={view} onColor={colored} onSubmit={named} />
              ) : view.step === "model" ? (
                <Thinking
                  meId={queryClient.getQueryData<{ user: { id: string } }>(meKey)?.user.id ?? ""}
                  name={view.name}
                  current={agent.current?.model ?? ""}
                  busy={view.busy}
                  problem={<Problem said={view.error} />}
                  onChosen={thinks}
                />
              ) : view.step === "computer" ? (
                view.pairing !== undefined ? (
                  <div className="mt-3 flex min-h-9 items-center gap-2.5 text-sm">
                    {view.pairing === "pairing" ? (
                      <>
                        <Spinner className="text-muted-foreground" />
                        Pairing this computer with {view.name}…
                      </>
                    ) : (
                      <>
                        <CheckCircleIcon className="size-[18px] text-primary" />
                        <span>
                          <span className="font-mono">{view.computer}</span> is paired
                          {view.share === "read" ? ", read-only" : ""}.
                        </span>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="mt-3 flex flex-col gap-3">
                    <p className="text-sm text-muted-foreground">
                      {view.name} would run commands and read and change files here, as you. It can
                      reach this computer while Do Computer is running; closing the window leaves it
                      in the tray.
                    </p>
                    {bridge?.canOpenAtLogin ? (
                      <Label className="font-normal">
                        <Checkbox
                          checked={openAtLogin}
                          onCheckedChange={(on) => setOpenAtLogin(on === true)}
                        />
                        Open Do Computer when I sign in to this computer
                      </Label>
                    ) : null}
                    <Problem said={view.error} />
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="ghost"
                        className="text-muted-foreground"
                        onClick={() => shared("no")}
                      >
                        Not now
                      </Button>
                      <span className="flex-1" />
                      <Button
                        variant="outline"
                        onClick={() => {
                          patch({ share: "read" })
                          void shared("read")
                        }}
                      >
                        Only read files
                      </Button>
                      <Button
                        data-first
                        onClick={() => {
                          patch({ share: "yes" })
                          void shared("yes")
                        }}
                      >
                        Yes, work here
                      </Button>
                    </div>
                  </div>
                )
              ) : view.step === "wait" ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 basis-40 text-xs text-muted-foreground">
                    Come back any time. {view.name} waits here, and is your agent from the day you
                    are let in.
                  </span>
                  <Button variant="ghost" className="text-muted-foreground" onClick={leave}>
                    Sign out
                  </Button>
                  {met.current === undefined ? null : (
                    <Button data-first onClick={() => post(met.current!)}>
                      Share {view.name}
                    </Button>
                  )}
                </div>
              ) : (
                <div className="mt-3 flex justify-end">
                  <Button data-first disabled={view.busy} onClick={finish}>
                    {next?.startsWith("/invite/")
                      ? "On to your invitation"
                      : next !== undefined
                        ? "Continue"
                        : view.back
                          ? "Back to our chat"
                          : `Start chatting with ${view.name}`}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Problem({ said }: { said: string | undefined }) {
  return said === undefined ? null : (
    <p role="alert" className="text-sm text-destructive">
      {said}
    </p>
  )
}

/** A name for the agent, and its color, which the egg takes as it is picked. */
function Naming({
  view,
  onColor,
  onSubmit,
}: {
  view: View
  onColor: (color: AvatarColorId) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
}) {
  const [name, setName] = useState("")
  const [suggested, setSuggested] = useState(0)
  return (
    <form className="mt-3 flex flex-col gap-3" onSubmit={onSubmit}>
      <div className="flex gap-2">
        <Input
          name="agent"
          aria-label="A name for it"
          placeholder="A name for it"
          maxLength={40}
          autoComplete="off"
          spellCheck={false}
          data-first
          className="h-10 text-base"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          aria-label="Suggest a name"
          title="Suggest a name"
          onClick={() => {
            setName(SUGGESTIONS[suggested % SUGGESTIONS.length]!)
            setSuggested(suggested + 1)
          }}
        >
          <DiceFiveIcon />
        </Button>
      </div>
      <div role="radiogroup" aria-label="Its color" className="flex flex-wrap items-center gap-2.5">
        {AVATAR_COLORS.map((color) => (
          // biome-ignore lint/a11y/useSemanticElements: a round swatch, which a radio input cannot be made to look like
          <button
            key={color.id}
            type="button"
            role="radio"
            aria-checked={view.color === color.id}
            aria-label={color.label}
            title={color.label}
            className="relative size-6.5 rounded-full transition-transform outline-none after:absolute after:-inset-[5px] after:rounded-full hover:scale-110 focus-visible:ring-3 focus-visible:ring-ring/50 aria-checked:shadow-[0_0_0_2px_var(--background),0_0_0_4px_var(--swatch)]"
            style={{ backgroundColor: color.hex, "--swatch": color.hex } as React.CSSProperties}
            onClick={() => onColor(color.id)}
          />
        ))}
      </div>
      <Problem said={view.error} />
      <div className="flex items-center gap-2">
        <span className="flex-1 text-xs text-muted-foreground">Both can be changed later.</span>
        <Button type="submit" disabled={view.busy || name.trim() === ""}>
          {view.busy ? "One moment…" : "That’s your name"}
        </Button>
      </div>
    </form>
  )
}

/**
 * The scene where it cannot be drawn: a night sky that is only a color, and the egg as a plain
 * picture. Everything that is asked is asked the same.
 */
function Plain({
  view,
  seed,
  agent,
  leaving,
}: {
  view: View
  seed: string
  agent: AgentSummary | undefined
  leaving: boolean
}) {
  const hex = hexOf(view.color)
  return (
    <div
      aria-hidden
      className={cn(
        "absolute inset-0 bg-linear-to-b from-[#05071a] via-[#0e1a3c] to-[#1b5560] transition-opacity duration-700",
        leaving && "opacity-0",
      )}
    >
      <div className="flex h-[var(--card-top,50%)] items-center justify-center transition-[height] duration-300">
        {view.hatched ? (
          <img
            alt=""
            className="aspect-square h-[min(10rem,70%)]"
            src={`data:image/svg+xml;utf8,${encodeURIComponent(
              avatarSvg(agent?.avatar ?? { color: view.color, seed }, agent?.id ?? seed),
            )}`}
          />
        ) : (
          <svg viewBox="0 0 64 80" className="h-[min(10rem,70%)]">
            <title>An egg</title>
            <ellipse cx="32" cy="44" rx="24" ry="32" fill="#f4efe6" />
            <path
              d="M14 30c10 6 14 22 6 40M34 12c12 10 16 34 8 56"
              fill="none"
              stroke={hex}
              strokeWidth="7"
            />
          </svg>
        )}
      </div>
    </div>
  )
}
