import { ApiError } from "@do-computer/client"
import type { Orb } from "@do-computer/mascot"
import {
  type AgentSummary,
  AVATAR_COLORS,
  type AvatarColorId,
  type Dood,
  type ModelOption,
  personalWorkspaceId,
} from "@do-computer/protocol"
import { useQueryClient } from "@tanstack/react-query"
import { type Href, useLocalSearchParams, useRouter } from "expo-router"
import { useAtomValue, useStore } from "jotai"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  useWindowDimensions,
  View,
} from "react-native"
import { useSharedValue, withTiming } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { keys } from "@/lib/queries"
import { DEFAULT_SERVER, serverAtom, sessionFor, setServer } from "@/lib/session"
import { AccountForm, useFrontDoor } from "@/start/account"
import { hexOf, Naming, Problem, Thinking } from "@/start/cards"
import { ISLAND } from "@/start/island"
import { rememberMeeting } from "@/chat/hello"
import { metAtom, nextAtom } from "@/start/met"
import { CARD_MS, Dock, NIGHT, Sky, useStanding, useTyped } from "@/start/scene"
import { Button, errorText, Glass, GlassButton, haptic, Text } from "@/ui"
import { Avatar } from "@/ui/avatar"

/** What the card under the egg is asking. `none` until it is known who is here. */
type Step = "none" | "hello" | "you" | "name" | "model" | "out" | "wait"

type Showing = {
  step: Step
  /** Whether the card is on show. It goes away between steps, and for the hatch. */
  on: boolean
  /** The "who are you" card is for signing in, not for making an account. */
  signingIn: boolean
  busy: boolean
  error?: string
  /** What its person is called. */
  first: string
  /** What the agent is called, once it is. */
  name: string
  color: AvatarColorId
  hatched: boolean
  /** It is a Dood that was hatched in a post, out already, and here to be claimed. */
  fromPost: boolean
  /** They are on the waiting list: what they hatch is theirs, and waits with them. */
  listed: boolean
}

const firstName = (full: string) => full.trim().split(/\s+/)[0] || "you"
const isColor = (id: string | undefined): id is AvatarColorId =>
  AVATAR_COLORS.some((entry) => entry.id === id)

/** What the egg, and then the creature, says at each step: the web's own lines. */
function lineOf(view: Showing): string {
  const { first, name } = view
  switch (view.step) {
    case "none":
      return ""
    case "hello":
      return "Oof. That was a long way down. Hello? Is somebody out there?"
    case "you":
      if (view.signingIn) return "Have we met before? Tell me who you are and I’ll know."
      return view.fromPost
        ? `I’m ${name}! I hatched in a post, and I’d like to be yours. Who are you?`
        : "Oh good, a voice! It’s dark inside this egg, so tell me: who are you?"
    case "name":
      return `Nice to meet you, ${first}. I don’t have a name yet. What will you call me?`
    case "model":
      return `${name}. I like that. What should I think with?`
    case "wait":
      return `You’re on the list, ${first}. I’ll be right here, and we’ll get started the moment it’s your turn.`
    case "out":
      return `There you are, ${first}! Shall we get started?`
  }
}

/**
 * The first run. An egg stands on a little island in the night and asks for what the app needs:
 * who its person is, what to call it, and what to think with. Each answer cracks its shell a
 * little more and brings the morning on; then it hatches, and takes its person to its chat.
 * Someone on the waiting list hatches theirs and waits with it here.
 */
export default function Welcome() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const queryClient = useQueryClient()
  const store = useStore()
  const server = useAtomValue(serverAtom) ?? DEFAULT_SERVER
  const { client, auth } = sessionFor(server)
  const { data: methods } = useFrontDoor(server)
  /** A Dood the address asks to be made theirs, with the key its hatcher was given. Read once. */
  const asked = useLocalSearchParams<{ dood?: string; key?: string }>()
  const claim = useRef(asked.dood ? { id: asked.dood, key: asked.key ?? "" } : undefined)
  /** The page that sent them here to come back to it, as an invitation does. */
  const next = useAtomValue(nextAtom)
  const agent = useRef<AgentSummary | undefined>(undefined)
  /** The Dood this is about: one hatched in a post, or the one someone waiting has. */
  const [dood, setDood] = useState<Dood>()
  /** What the egg of a new agent grows from. Its agent is given the same, so it hatches as itself. */
  const seed = useRef(Math.random().toString(36).slice(2, 10).padEnd(8, "0"))
  const [models, setModels] = useState<ModelOption[]>([])
  const gone = useRef(false)
  const orb = useRef<Orb | null | undefined>(undefined)
  /** Where the ground is in the creature's own picture, once it is drawn and can say. */
  const [ground, setGround] = useState<number>(ISLAND.stance.ground)
  const place = useStanding({ ground, egg: ISLAND.stance.egg })
  /** How far the night has gone: 0 the night, 1 the sunrise, 2 the day. */
  const light = useSharedValue(0)
  const dawn = useCallback(
    (to: number, now = false) => {
      light.value = now ? to : withTiming(to, { duration: 1800 })
    },
    [light],
  )
  const [view, setView] = useState<Showing>({
    step: "none",
    on: false,
    signingIn: false,
    busy: false,
    first: "",
    name: "",
    color: "tide",
    hatched: false,
    fromPost: false,
    listed: false,
  })
  const seen = useRef(view)
  seen.current = view
  const patch = useCallback(
    (change: Partial<Showing>) => setView((was) => ({ ...was, ...change })),
    [],
  )
  const later = useCallback((act: () => void, ms: number) => {
    setTimeout(() => {
      if (!gone.current) act()
    }, ms)
  }, [])
  /** The card goes, and comes back asking the next thing. */
  const say = useCallback(
    (step: Step, change: Partial<Showing> = {}) => {
      patch({ on: false })
      later(() => patch({ ...change, step, on: true, busy: false, error: change.error }), CARD_MS)
    },
    [patch, later],
  )
  /** Where the creature stands in its picture is asked of it once it has taken up its pose. */
  const measure = useCallback(() => {
    later(() => {
      const stance = orb.current?.stance()
      if (stance !== undefined && Number.isFinite(stance.ground)) setGround(stance.ground)
    }, 400)
  }, [later])
  /** The shell breaks, the sun comes up, and then it is out and has something to say. */
  const hatch = useCallback(
    (then: () => void) => {
      patch({ on: false })
      const out = () => {
        haptic.medium()
        dawn(2)
      }
      const done = () => {
        if (gone.current) return
        haptic.done()
        patch({ hatched: true })
        measure()
        then()
      }
      later(() => {
        // Where it cannot be drawn there is nothing to watch: it is simply out.
        if (orb.current == null) {
          out()
          return done()
        }
        orb.current.hatch({ onOut: out, onDone: done })
      }, CARD_MS)
    },
    [patch, later, dawn, measure],
  )
  /** A Dood is on the island, out of its egg, as it was when it was last seen. */
  const show = useCallback(
    (shown: Dood) => {
      setDood(shown)
      dawn(2, true)
      measure()
      patch({
        name: shown.name,
        hatched: true,
        ...(isColor(shown.avatar.color) ? { color: shown.avatar.color } : {}),
      })
    },
    [patch, dawn, measure],
  )
  /** The first run is over for them: on to the page that sent them, or to their agents. */
  const leave = useCallback(() => {
    const back = store.get(nextAtom)
    store.set(nextAtom, null)
    router.replace(back === null ? "/(app)" : (back as Href))
  }, [router, store])

  /** Someone is signed in here now. What comes next depends on whether they have an agent. */
  const arrived = useCallback(async () => {
    queryClient.removeQueries({ queryKey: keys.me })
    const [me, agents] = await Promise.all([
      client.me(),
      // Someone on the waiting list has no agents to list, and is told so.
      client.listAgents().catch((error: unknown) => {
        if (error instanceof ApiError && error.code === "waitlisted") return []
        throw error
      }),
    ])
    const first = firstName(me.user.name)
    // A Dood they hatched in a post is made theirs before anything is asked.
    let theirs = me.dood
    let problem: string | undefined
    const wanted = claim.current
    if (wanted !== undefined) {
      claim.current = undefined
      try {
        theirs = await client.doods.claim(wanted.id, wanted.key)
      } catch (error) {
        problem = error instanceof Error ? error.message : undefined
      }
    }
    if (gone.current) return
    // What is kept says they have it, until it is their agent.
    const { dood: _was, ...rest } = me
    queryClient.setQueryData(keys.me, theirs === undefined ? rest : { ...rest, dood: theirs })
    const settled = { first, signingIn: false, error: problem }
    if (me.waiting === true) {
      if (theirs !== undefined) {
        show(theirs)
        return say("wait", { ...settled, listed: true })
      }
      // Someone new, who will wait: what they hatch now is theirs, and waits with them.
      orb.current?.crack(0.34)
      dawn(0.45)
      return say("name", { ...settled, listed: true })
    }
    if (theirs !== undefined) {
      // It is theirs, and the app is theirs to use: it becomes their agent as it is.
      show(theirs)
      const agentId = await client.doods.wake(theirs.id)
      queryClient.setQueryData(keys.me, rest)
      const state = await client.agent(agentId).state()
      queryClient.setQueryData(keys.agent(agentId), state)
      agent.current = state.agent
      return say("out", settled)
    }
    if (agents.length === 0) {
      // Someone new. Knowing who they are is the first crack.
      orb.current?.crack(0.34)
      dawn(0.45)
      return say("name", settled)
    }
    // They have been here before, and there is nothing to ask them.
    leave()
  }, [client, queryClient, show, say, dawn, leave])

  /** Whatever went wrong, in words, with the card ready to be tried again. */
  const failed = useCallback(
    (error: unknown) => {
      haptic.fail()
      patch({ busy: false, error: errorText(error, "That did not work. Try again.") })
    },
    [patch],
  )

  // The scene is set up once: who is signed in, and so where it starts.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, as it opens
  useEffect(() => {
    gone.current = false
    const begin = async () => {
      const signedIn = await client.me().then(
        () => true,
        (error: unknown) => {
          if (error instanceof ApiError && error.status === 401) return false
          throw error
        },
      )
      if (gone.current) return
      if (signedIn) return arrived()
      // A Dood that was hatched in a post is out already, and is the one asking.
      const posted =
        claim.current === undefined
          ? undefined
          : await client.doods.get(claim.current.id).catch(() => undefined)
      if (gone.current) return
      if (posted !== undefined) {
        show(posted)
        return say("you", { fromPost: true })
      }
      claim.current = undefined
      later(() => orb.current?.cheer(), 300)
      later(() => say("hello"), 900)
    }
    begin().catch(() => {
      if (!gone.current) say("you", { error: "Something went wrong. Try again." })
    })
    return () => {
      gone.current = true
    }
  }, [])

  const line = lineOf(view)
  const typed = useTyped(line, view.step, view.on, (count) => {
    const drawn = orb.current
    if (drawn == null) return
    // It talks with its whole self once it is out. An egg can only rock.
    if (seen.current.hatched) drawn.feed("token")
    else if (count % 14 === 1) drawn.pet(count % 28 === 1 ? 1 : -1)
  })

  const named = async (name: string) => {
    if (name === "" || view.busy) return
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
      orb.current?.crack(0.67)
      patch({ name: made.name })
      return hatch(() => {
        setDood(made)
        say("wait")
      })
    }
    let offered: ModelOption[] = []
    try {
      const made = agent.current ?? (await client.createAgent())
      agent.current = made
      const me = queryClient.getQueryData<{ user: { id: string; name: string } }>(keys.me)
      // It knows from the start what it is called, how it looks, and who named it.
      const state = await client.agent(made.id).update({
        name,
        avatar: { color: view.color, seed: seed.current },
        user: `Their name is ${me?.user.name ?? view.first}.`,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
      queryClient.setQueryData(keys.agent(made.id), state)
      agent.current = { ...made, name, avatar: { color: view.color, seed: seed.current } }
      // With nothing to choose between, what it thinks with is not asked.
      if (me !== undefined) {
        offered = await client.models(personalWorkspaceId(me.user.id)).catch(() => [])
      }
    } catch (error) {
      return failed(error)
    }
    if (gone.current) return
    orb.current?.crack(0.67)
    dawn(1)
    setModels(offered)
    if (offered.length === 0) {
      patch({ name })
      return hatch(() => say("out"))
    }
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
        queryClient.setQueryData(keys.agent(made.id), state)
        agent.current = { ...made, model }
      }
    } catch (error) {
      return failed(error)
    }
    orb.current?.pet(1)
    hatch(() => say("out"))
  }

  const colored = (color: AvatarColorId) => {
    patch({ color })
    orb.current?.pet(1)
  }

  /** The scene is over: on to its chat, where it says hello with things to try. */
  const finish = async () => {
    const met = agent.current
    if (met === undefined) return
    patch({ busy: true })
    // Its owner has watched it hatch: it is never shown as an egg again.
    await client
      .agent(met.id)
      .update({ hatched: true })
      .then((state) => queryClient.setQueryData(keys.agent(met.id), state))
      .catch(() => {})
    store.set(metAtom, met.id)
    // The chat it opens on greets its person by name and offers a few things to start with.
    const person = queryClient.getQueryData<{ user: { name: string } }>(keys.me)?.user.name
    rememberMeeting({ agentId: met.id, first: firstName(person ?? "") })
    await queryClient.invalidateQueries({ queryKey: keys.agents })
    if (store.get(nextAtom) !== null) return leave()
    router.replace("/(app)")
    router.push(`/a/${met.id}` as Href)
  }

  /** "Skip": nothing is named. An agent is made if there is none, so that there is one to open. */
  const skip = async () => {
    if (view.busy) return
    patch({ busy: true, on: false })
    try {
      if (agent.current === undefined) agent.current = await client.createAgent()
      await queryClient.invalidateQueries({ queryKey: keys.agents })
      leave()
    } catch (error) {
      patch({ on: true })
      failed(error)
    }
  }

  /** Someone waiting signs out, and is shown the front door again. */
  const signOut = async () => {
    await auth.signOut().catch(() => {})
    queryClient.clear()
    router.replace("/connect")
  }

  /** Their Dood's own page, handed to whatever they share things with. */
  const share = async (shared: Dood) => {
    const address = `${server}/dood/${encodeURIComponent(shared.id)}`
    const text = `I hatched ${shared.name} 🥚 Hatch yours:`
    if (Platform.OS === "web") {
      // A browser has no share sheet to count on: X's composer, with the words filled in.
      const words = new URLSearchParams({ text, url: address })
      return void Linking.openURL(`https://x.com/intent/post?${words}`)
    }
    await Share.share(
      Platform.OS === "ios" ? { message: text, url: address } : { message: `${text} ${address}` },
    ).catch(() => {})
  }

  const hex = hexOf(view.color)
  const tag = view.hatched ? view.name : view.name ? `${view.name}, in the egg` : "The egg"
  const ending = next?.startsWith("/invite/")
    ? "On to your invitation"
    : next != null
      ? "Continue"
      : `Start chatting with ${view.name}`

  const card =
    !view.on || !typed.said ? null : view.step === "hello" ? (
      <View style={{ paddingHorizontal: 16 }}>
        <Button title="Hello!" onPress={() => say("you")} />
      </View>
    ) : view.step === "you" ? (
      <ScrollView
        style={{ maxHeight: Math.round(height * 0.52) }}
        keyboardShouldPersistTaps="handled"
      >
        <AccountForm
          key={view.signingIn ? "in" : "up"}
          server={server}
          mode={view.signingIn ? "sign-in" : "sign-up"}
          words={{ name: "Your name", signIn: "Sign in", signUp: "That’s me" }}
          back="/welcome"
          onDone={async (_how, at) => {
            setServer(at)
            await arrived().catch(failed)
          }}
        />
        <View style={{ paddingHorizontal: 16, paddingTop: 10, gap: 6, alignItems: "center" }}>
          <Problem said={view.error} />
          {!view.signingIn && methods?.signup === "invite" ? (
            <Text variant="footnote" tone="ink2">
              New accounts are by invitation here.
            </Text>
          ) : null}
          {!view.signingIn && methods?.signup === "waitlist" ? (
            <Text variant="footnote" tone="ink2">
              New accounts join a waiting list.
            </Text>
          ) : null}
          <Button
            kind="plain"
            size="medium"
            title={view.signingIn ? "I’m new here" : "I already have an account"}
            onPress={() => patch({ signingIn: !view.signingIn, error: undefined })}
          />
        </View>
      </ScrollView>
    ) : view.step === "name" ? (
      <Naming
        color={view.color}
        busy={view.busy}
        error={view.error}
        onColor={colored}
        onNamed={(name) => void named(name)}
      />
    ) : view.step === "model" ? (
      <Thinking
        models={models}
        current={agent.current?.model ?? ""}
        color={view.color}
        busy={view.busy}
        error={view.error}
        onChosen={(model) => void thinks(model)}
      />
    ) : view.step === "wait" ? (
      <View style={{ paddingHorizontal: 16, gap: 12 }}>
        <Text variant="subhead" tone="ink2">
          Come back any time. {view.name} waits here, and is your Dood from the day you are let in.
        </Text>
        {dood === undefined ? null : (
          <Button
            title={`Share ${view.name}`}
            icon="share"
            color={hex}
            onPress={() => void share(dood)}
          />
        )}
        <Button kind="grey" title="Sign out" onPress={() => void signOut()} />
      </View>
    ) : view.step === "out" ? (
      <View style={{ paddingHorizontal: 16, gap: 12 }}>
        <Problem said={view.error} />
        <Button title={ending} color={hex} busy={view.busy} onPress={() => void finish()} />
      </View>
    ) : null

  // Nothing can be skipped by someone who is not signed in, or who is waiting to be let in.
  const skippable = (view.step === "name" || view.step === "model") && !view.listed
  return (
    <View style={{ flex: 1, backgroundColor: NIGHT, overflow: "hidden" }}>
      <Sky light={light}>
        <Pressable
          accessible={false}
          onPress={() => orb.current?.cheer()}
          style={{
            position: "absolute",
            left: place.left,
            top: place.top,
            width: place.size,
            height: place.size,
          }}
        >
          <Avatar
            avatar={dood?.avatar ?? { color: view.color, seed: seed.current }}
            seed="welcome"
            outfit={dood?.outfit}
            size={place.size}
            hatched={view.hatched}
            mood={{ state: view.on && !typed.said ? "speaking" : "idle" }}
            onOrb={(drawn) => {
              orb.current = drawn
              if (drawn !== null) measure()
            }}
          />
        </Pressable>
      </Sky>
      {view.step === "none" ? (
        <ActivityIndicator
          color="#ffffff"
          style={{ position: "absolute", left: 0, right: 0, top: place.ground + 36 }}
        />
      ) : null}
      <View
        style={{
          position: "absolute",
          top: insets.top + 8,
          left: 16,
          right: 16,
          flexDirection: "row",
          justifyContent: "space-between",
        }}
        pointerEvents="box-none"
      >
        {view.step === "hello" || view.step === "you" ? (
          <GlassButton icon="close" label="Close" onPress={() => router.replace("/connect")} />
        ) : (
          <View />
        )}
        {skippable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Skip"
            onPress={() => void skip()}
            hitSlop={8}
          >
            <Glass
              interactive
              style={{
                height: 36,
                borderRadius: 18,
                paddingHorizontal: 14,
                justifyContent: "center",
              }}
            >
              <Text variant="subhead" weight="600">
                Skip
              </Text>
            </Glass>
          </Pressable>
        ) : null}
      </View>
      <Dock
        tag={tag}
        swatch={hex}
        words={view.on ? line : ""}
        shown={typed.shown}
        onHurry={typed.finish}
        id={view.step}
        card={card}
      />
    </View>
  )
}
