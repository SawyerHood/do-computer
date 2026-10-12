import {
  type LiveView,
  type ShotPoint,
  spanOf,
  type ToolPart,
  type Use,
  type UseStep,
  type UseWhat,
  // Not a hook, whatever its name says: the words for a use in a sentence.
  useWords as wordsOf,
} from "@do-computer/protocol"
import { Image } from "expo-image"
import { atom, useAtomValue, useSetAtom } from "jotai"
import {
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import {
  ActivityIndicator,
  Animated,
  AppState,
  Easing,
  type LayoutChangeEvent,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import Svg, { Path } from "react-native-svg"
import { useAgentSummary } from "@/lib/queries"
import { authHeaders, type Session } from "@/lib/session"
import { type Accent, accentOf, mono, radius, useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import { Button, haptic, Icon, Text } from "@/ui"
import { Card, Fold, NoticeLine, useChatScope, UsesContext } from "./shared"

/* ---------- how a screen or browser looks now ---------- */

/** The pause between one picture and asking for the next: two or three pictures a second. */
const BETWEEN_MS = 300
/**
 * How long to leave it after hearing that nobody is using it, or hearing nothing. Doubles to
 * the longest.
 */
const IDLE_MS = 2_000
const LONGEST_IDLE_MS = 30_000

/** One screen or browser of one computer, and what is needed to ask about it. */
type Spot = {
  /** What it is kept under: the server, the agent, the computer and which of its two things. */
  key: string
  client: Session["client"]
  agentId: string
  computerId: string
  what: UseWhat
}

/**
 * One screen or browser being watched. However many places show it, it is asked about by one
 * loop, which runs only while something is showing it.
 */
type Watch = {
  view: LiveView | undefined
  watchers: number
  listeners: Set<() => void>
  stop: AbortController | undefined
}

const watches = new Map<string, Watch>()

function watchOf(key: string): Watch {
  let watch = watches.get(key)
  if (watch === undefined) {
    watch = { view: undefined, watchers: 0, listeners: new Set(), stop: undefined }
    watches.set(key, watch)
  }
  return watch
}

const tellAll = (watch: Watch) => {
  for (const listener of watch.listeners) listener()
}

/** Whether nobody is looking at the app: it is behind another, or its tab is. */
const away = () => AppState.currentState === "background"

/** Waits, unless it is stopped first or the app comes back into view. */
const rest = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)
      woke.remove()
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener("abort", done)
    const woke = AppState.addEventListener("change", done)
  })

/** Asks how it looks, over and over, until it is stopped. The same loop as the web app's. */
async function run(watch: Watch, spot: Spot) {
  const stop = new AbortController()
  watch.stop = stop
  let idle = IDLE_MS
  while (!stop.signal.aborted) {
    // An app nobody is looking at asks for nothing.
    if (away()) {
      await rest(LONGEST_IDLE_MS, stop.signal)
      continue
    }
    let wait = BETWEEN_MS
    try {
      // The server answers at once with what it has when asked from zero, and otherwise holds
      // the question until there is a newer picture.
      const view = await spot.client
        .agent(spot.agentId)
        .view(
          spot.computerId,
          spot.what,
          watch.view?.active === true ? watch.view.seq : 0,
          stop.signal,
        )
      if (stop.signal.aborted) break
      // An answer with no picture means nothing changed: the one on screen still stands.
      const before = watch.view
      watch.view =
        view.active && view.shot === undefined && before?.shot !== undefined
          ? { ...view, shot: before.shot }
          : view
      tellAll(watch)
      if (view.active) idle = IDLE_MS
      else wait = idle
    } catch {
      if (stop.signal.aborted) break
      wait = idle
    }
    if (wait === idle) idle = Math.min(idle * 2, LONGEST_IDLE_MS)
    await rest(wait, stop.signal)
  }
}

/** Pauses the agent there, or lets it carry on. Shown at once, and put right by the next answer. */
async function holdUse(spot: Spot, held: boolean) {
  const watch = watchOf(spot.key)
  if (watch.view !== undefined) {
    watch.view = { ...watch.view, held }
    tellAll(watch)
  }
  await spot.client.agent(spot.agentId).hold(spot.computerId, spot.what, held)
}

/** Forgets what was last seen there, once the agent has been stopped: it is not using it now. */
function endUse(spot: Spot) {
  const watch = watchOf(spot.key)
  if (watch.view === undefined) return
  watch.view = { active: false, seq: watch.view.seq }
  tellAll(watch)
}

/** Forgets that nobody was using it, when the agent has done something there since. */
function askAgain(spot: Spot) {
  const watch = watchOf(spot.key)
  if (watch.view === undefined || watch.view.active) return
  watch.view = undefined
  tellAll(watch)
}

/** What was last heard of a screen or browser. Reading it asks for nothing. */
function useView(spot: Spot | undefined): LiveView | undefined {
  const key = spot?.key
  const subscribe = useCallback(
    (changed: () => void) => {
      if (key === undefined) return () => {}
      const { listeners } = watchOf(key)
      listeners.add(changed)
      return () => {
        listeners.delete(changed)
      }
    },
    [key],
  )
  return useSyncExternalStore(
    subscribe,
    () => (key === undefined ? undefined : watches.get(key)?.view),
    () => undefined,
  )
}

/** Keeps a screen or browser asked about while `on`: the caller says whether it can be seen. */
function useWatching(spot: Spot | undefined, on: boolean) {
  useEffect(() => {
    if (spot === undefined || !on) return
    const watch = watchOf(spot.key)
    watch.watchers += 1
    if (watch.watchers === 1) void run(watch, spot)
    return () => {
      watch.watchers -= 1
      if (watch.watchers === 0) watch.stop?.abort()
    }
  }, [spot, on])
}

/* ---------- a use in the chat ---------- */

/**
 * The uses someone stopped. A screen counts as in use a while longer; a stopped one is not
 * shown as such.
 */
const stoppedUsesAtom = atom<ReadonlySet<string>>(new Set<string>())

/** The shape of a screen whose size is not known yet. */
const UNKNOWN_SHAPE = 16 / 10
/** How wide a picture of the film is. */
const FRAME_WIDTH = 208
const FRAME_GAP = 8
/** The room kept beside the pointer for the agent's name. */
const NAME_ROOM = 220
/** Animations run off the JavaScript thread wherever there is another to run them on. */
const NATIVE = Platform.OS !== "web"
const GLIDE = Easing.bezier(0.3, 0.1, 0.2, 1)

type Box = { width: number; height: number }

/**
 * The screen or browser a use is on, where it may still be in use: the one going, and the last
 * of the chat. The others are over for good, and are never asked about. It is the same thing
 * from one message of the chat to the next, so that nothing keyed on it starts again.
 */
function useSpot(use: Use): Spot | undefined {
  const { agentId } = useChatScope()
  const { client, server } = useSession()
  const computerId = use.going || use.last ? use.computer.id : undefined
  const { what } = use
  return useMemo(
    () =>
      computerId === undefined
        ? undefined
        : {
            key: [server, agentId, computerId, what].join("\n"),
            client,
            agentId,
            computerId,
            what,
          },
    [server, client, agentId, computerId, what],
  )
}

/**
 * Whether the agent is on the screen or browser of a use, and how that looks now. A use that
 * the chat no longer says is going may still be: the screen stays the agent's for a while after
 * its last step, so the last use of a chat is asked about once, and watched while it is.
 */
function useWatched(use: Use, seen: boolean) {
  const spot = useSpot(use)
  const stopped = useAtomValue(stoppedUsesAtom).has(use.id)
  const view = useView(spot)
  const count = use.steps.length
  // Asked about again at each new step: what was last heard may be from before it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: each new step asks again
  useEffect(() => {
    if (spot !== undefined) askAgain(spot)
  }, [spot, count])
  const over = view !== undefined && !view.active
  useWatching(spot, seen && !stopped && (use.going || (use.last && !over)))
  return { spot, view, live: !stopped && (use.going || (use.last && view?.active === true)) }
}

/** Stops the agent, as the chat's own stop does, and takes the use for ended at once. */
function useStop(use: Use, spot: Spot | undefined) {
  const { agentId, chatId } = useChatScope()
  const { client } = useSession()
  const setStopped = useSetAtom(stoppedUsesAtom)
  return () => {
    setStopped((before) => new Set(before).add(use.id))
    if (spot !== undefined) endUse(spot)
    void client
      .agent(agentId)
      .abort(chatId)
      .catch(() => {})
  }
}

const CAN_OBSERVE = Platform.OS === "web" && typeof IntersectionObserver !== "undefined"

/**
 * Whether what the ref is on can be seen. In a browser that is asked of the page. A phone has
 * nothing to ask, so there whatever is drawn counts as seen: a use that is still going is at
 * the foot of its chat, which is where its reader is.
 */
function useSeen() {
  const ref = useRef<View>(null)
  const [seen, setSeen] = useState(!CAN_OBSERVE)
  useEffect(() => {
    if (!CAN_OBSERVE || ref.current === null) return
    const observer = new IntersectionObserver((entries) =>
      setSeen(entries.at(-1)?.isIntersecting === true),
    )
    // In a browser a view is an element of the page.
    observer.observe(ref.current as unknown as Element)
    return () => observer.disconnect()
  }, [])
  return [ref, seen] as const
}

/** How long ago `since` was, kept up to the second while it is on screen. */
function Clock({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])
  return (
    <Text variant="footnote" tone="ink2" style={{ fontVariant: ["tabular-nums"] }}>
      {" · "}
      {spanOf(Math.max(0, now - since))}
    </Text>
  )
}

/** A spinner smaller than the system's small one. */
function Spin({ size, color }: { size: number; color: string }) {
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator size="small" color={color} style={{ transform: [{ scale: size / 20 }] }} />
    </View>
  )
}

/** A color at a quarter of its strength, where it is one that can be thinned. */
const faint = (color: string) => (/^#[0-9a-f]{6}$/i.test(color) ? `${color}40` : "transparent")

/** A ring that spreads from the pointer and is gone: one click of the agent's. */
function Ripple({ color }: { color: string }) {
  const [spread] = useState(() => new Animated.Value(0))
  useEffect(() => {
    const ripple = Animated.timing(spread, {
      toValue: 1,
      duration: 500,
      easing: Easing.out(Easing.ease),
      useNativeDriver: NATIVE,
    })
    ripple.start()
    return () => ripple.stop()
  }, [spread])
  return (
    <Animated.View
      style={{
        position: "absolute",
        left: -16,
        top: -16,
        width: 32,
        height: 32,
        borderRadius: 16,
        borderWidth: 2,
        borderColor: color,
        backgroundColor: faint(color),
        opacity: spread.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
        transform: [{ scale: spread.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1.6] }) }],
      }}
    />
  )
}

/**
 * The agent's pointer, drawn over a picture that does not have it in it: an arrow in the
 * agent's color with its name. It glides to where it goes next, and ripples at each click.
 */
function Pointer({
  at,
  size,
  box,
  name,
  ink,
  clicks,
  held = false,
}: {
  at: ShotPoint
  /** The picture's size in its own pixels, which `at` is in. */
  size: Box
  /** The size the picture is drawn at. */
  box: Box
  name: string | undefined
  /** The agent's color, and what reads on it. */
  ink: Accent
  clicks?: number | undefined
  held?: boolean | undefined
}) {
  const x = (at.x / size.width) * box.width
  const y = (at.y / size.height) * box.height
  const [place] = useState(() => new Animated.ValueXY({ x, y }))
  useEffect(() => {
    const glide = Animated.timing(place, {
      toValue: { x, y },
      duration: 700,
      easing: GLIDE,
      useNativeDriver: NATIVE,
    })
    glide.start()
    return () => glide.stop()
  }, [place, x, y])
  const far = at.x / size.width > 0.78
  const low = at.y / size.height > 0.88
  return (
    <Animated.View
      aria-hidden
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 18,
        height: 20,
        pointerEvents: "none",
        opacity: held ? 0.55 : 1,
        transform: place.getTranslateTransform(),
      }}
    >
      {clicks === undefined || clicks === 0 ? null : (
        // Made anew at each click, so that each one ripples.
        <Ripple key={clicks} color={ink.a} />
      )}
      <Svg width={18} height={20} viewBox="0 0 18 20">
        <Path
          d="M1 1l5.2 16 2.6-6.4L15.5 8z"
          fill={ink.a}
          stroke={ink.onA}
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      </Svg>
      {name === undefined ? null : (
        // The room its name may take, of a width of its own: words in something placed like
        // this would otherwise wrap at the width of the arrow.
        <View
          style={[
            { position: "absolute", width: NAME_ROOM },
            // Its name goes to whichever side of the pointer has room for it.
            low ? { bottom: 20 } : { top: 15 },
            far
              ? { left: -NAME_ROOM, alignItems: "flex-end" }
              : { left: 13, alignItems: "flex-start" },
          ]}
        >
          <View
            style={[
              { borderRadius: radius.pill, paddingHorizontal: 6, backgroundColor: ink.a },
              low || far ? null : { borderTopLeftRadius: 4 },
            ]}
          >
            <Text
              numberOfLines={1}
              color={ink.onA}
              weight="600"
              style={{ fontSize: 11, lineHeight: 16.5 }}
            >
              {name}
              {held ? " · waiting" : ""}
            </Text>
          </View>
        </View>
      )}
    </Animated.View>
  )
}

/** Notes the size something is laid out at, and only says so when it changes. */
function useBox() {
  const [box, setBox] = useState<Box>()
  const measure = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout
    setBox((before) =>
      before?.width === width && before.height === height ? before : { width, height },
    )
  }, [])
  return [box, measure] as const
}

/** The last picture kept of a use, for before the first live one arrives. */
const keptOf = (use: Use) => use.steps.findLast((step) => step.shot !== undefined)

/**
 * The screen or page as it is now, with the agent's pointer over it. Its shape is known before
 * its picture is, so that nothing moves when the picture comes. The one picture view stays as
 * each new picture arrives, and shows the last until the next is ready.
 */
function LivePicture({ use, view }: { use: Use; view: LiveView | undefined }) {
  const theme = useTheme()
  const { agentId, accent } = useChatScope()
  const { client, auth } = useSession()
  const me = useAgentSummary(agentId)
  const [box, measure] = useBox()
  const kept = keptOf(use)
  const keptShot = kept?.shot
  const shot = view?.shot
  const width = shot?.width ?? kept?.width
  const height = shot?.height ?? kept?.height
  // The picture is a long string: it is only put together again when there is a new one.
  const source = useMemo(
    () =>
      shot !== undefined
        ? { uri: `data:${shot.mimeType};base64,${shot.data}` }
        : keptShot !== undefined
          ? { uri: client.agent(agentId).shotUrl(keptShot), headers: authHeaders(auth) }
          : undefined,
    [shot, keptShot, client, agentId, auth],
  )
  const pointer = shot !== undefined ? view?.pointer : kept?.pointer
  const using = view?.agent?.color
  const ink = useMemo(
    () => (using === undefined ? accent : accentOf(using, theme.dark)),
    [using, accent, theme.dark],
  )
  const held = view?.held === true
  return (
    <View
      onLayout={measure}
      style={{
        width: "100%",
        aspectRatio: width && height ? width / height : UNKNOWN_SHAPE,
        overflow: "hidden",
        backgroundColor: theme.fill,
      }}
    >
      {source === undefined ? null : (
        <Image
          source={source}
          alt={`${use.what === "screen" ? "The screen of" : "A browser on"} ${use.computer.name}`}
          contentFit="fill"
          transition={0}
          // A live picture is never asked for twice: keeping each would fill the phone.
          cachePolicy={shot === undefined ? "disk" : "none"}
          style={StyleSheet.absoluteFill}
        />
      )}
      {held ? <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.scrim }]} /> : null}
      {pointer === undefined || !width || !height || box === undefined ? null : (
        <Pointer
          at={pointer}
          size={{ width, height }}
          box={box}
          name={view?.agent?.name ?? me?.name ?? undefined}
          ink={ink}
          clicks={view?.clicks}
          held={view?.held}
        />
      )}
      {held ? (
        <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              borderRadius: radius.pill,
              paddingHorizontal: 14,
              paddingVertical: 6,
              backgroundColor: theme.card,
            }}
          >
            <Icon name="pause" size={14} color={theme.ink} />
            <Text variant="footnote" weight="500">
              Paused
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  )
}

/** What the agent is doing there, in a few words: what the screen says, else its last step. */
const sayOf = (use: Use, view: LiveView | undefined) =>
  view?.say ?? use.steps.at(-1)?.say ?? "Getting started"

/** The address of the page in front, without what every address begins with. */
const pageOf = (use: Use, view: LiveView | undefined) =>
  (view?.url ?? use.steps.findLast((step) => step.url !== undefined)?.url)?.replace(
    /^https?:\/\//,
    "",
  )

/** The steps so far, and the one under way, in a box that keeps the newest in view. */
function StepList({ use, view, live }: { use: Use; view: LiveView | undefined; live: boolean }) {
  const theme = useTheme()
  const scroll = useRef<ScrollView>(null)
  const count = use.steps.length
  return (
    <ScrollView
      ref={scroll}
      nestedScrollEnabled
      onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
      style={{
        maxHeight: 224,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.sep,
      }}
      contentContainerStyle={{ padding: 8 }}
    >
      <View role="list" accessibilityLabel="Steps so far" style={{ gap: 1 }}>
        {use.steps.map((step, index) => {
          const now = live && index === count - 1
          const going = step.status === "pending" || step.status === "running"
          return (
            <View
              key={step.toolCallId}
              role="listitem"
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                borderRadius: 8,
                paddingHorizontal: 8,
                paddingVertical: 6,
                backgroundColor: now ? theme.fill : undefined,
              }}
            >
              <View style={{ width: 14, alignItems: "center" }}>
                {going ? (
                  <Spin size={12} color={theme.ink2} />
                ) : (
                  <Icon name="check" size={12} color={now ? theme.ink : theme.ink2} />
                )}
              </View>
              <Text
                variant="footnote"
                tone={now ? "ink" : "ink2"}
                numberOfLines={1}
                style={{ flex: 1, minWidth: 0 }}
              >
                {now && going ? sayOf(use, view) : step.say}
              </Text>
            </View>
          )
        })}
      </View>
    </ScrollView>
  )
}

/** Pause, or carry on: a round button with the symbol alone, or one with the word beside it. */
function HoldButton({
  spot,
  view,
  words = false,
}: {
  spot: Spot | undefined
  view: LiveView | undefined
  words?: boolean
}) {
  const theme = useTheme()
  const held = view?.held === true
  const label = held ? "Carry on" : "Pause"
  const icon = held ? "play" : "pause"
  const disabled = spot === undefined
  const press = () => {
    if (spot === undefined) return
    haptic.tap()
    void holdUse(spot, !held).catch(() => {})
  }
  if (words)
    return (
      <Button
        kind="line"
        size="small"
        icon={icon}
        title={label}
        disabled={disabled}
        onPress={press}
      />
    )
  // The look of the transcript's other round buttons, and one that can be out of use.
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={press}
      style={({ pressed }) => ({
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: theme.fill,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.45 : pressed ? 0.6 : 1,
      })}
    >
      <Icon name={icon} size={15} color={theme.ink} weight="medium" />
    </Pressable>
  )
}

/**
 * The little window in the chat while the agent is at it. A tap on the picture unfolds its
 * steps under it, as the web app does at a phone's width.
 */
function UseWindow({
  use,
  view,
  spot,
}: {
  use: Use
  view: LiveView | undefined
  spot: Spot | undefined
}) {
  const theme = useTheme()
  const stop = useStop(use, spot)
  const [unfolded, setUnfolded] = useState(false)
  const held = view?.held === true
  const page = pageOf(use, view)
  return (
    <Card style={{ width: "100%", maxWidth: 520 }}>
      <View
        style={{
          height: 46,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingLeft: 12,
          paddingRight: 8,
        }}
      >
        <Icon name={use.what === "screen" ? "desktop" : "globe"} size={16} color={theme.ink2} />
        <Text variant="footnote" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
          <Text variant="footnote" weight="500">
            {use.computer.name}
          </Text>
          <Text variant="footnote" tone="ink2">
            {" · "}
            {use.what === "screen" ? (
              "the screen"
            ) : (
              <Text variant="caption" tone="ink2" style={{ fontFamily: mono }}>
                {page ?? "a browser"}
              </Text>
            )}
          </Text>
          {use.startedAt === undefined ? null : <Clock since={use.startedAt} />}
        </Text>
        <HoldButton spot={spot} view={view} />
        <Button
          kind="line"
          size="small"
          title="Stop"
          onPress={() => {
            haptic.medium()
            stop()
          }}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open it large"
        accessibilityState={{ expanded: unfolded }}
        onPress={() => {
          haptic.tap()
          setUnfolded((was) => !was)
        }}
        style={{
          borderTopWidth: StyleSheet.hairlineWidth,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderColor: theme.sep,
        }}
      >
        <LivePicture use={use} view={view} />
      </Pressable>
      <View
        role="status"
        accessibilityLiveRegion="polite"
        style={{
          minHeight: 40,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingVertical: 4,
          paddingLeft: 12,
          paddingRight: 8,
        }}
      >
        {held ? (
          <Icon name="pause" size={14} color={theme.ink2} />
        ) : (
          <Spin size={14} color={theme.ink2} />
        )}
        <Text variant="footnote" tone="ink2" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
          {sayOf(use, view)}
        </Text>
        {held ? <HoldButton spot={spot} view={view} words /> : null}
      </View>
      {unfolded ? <StepList use={use} view={view} live /> : null}
    </Card>
  )
}

/**
 * The picture kept of a step, in the film or opened large: grey until it is in, and words
 * where none was taken.
 */
function FrameBox({
  step,
  box,
  children,
}: {
  step: UseStep
  /** The size to draw it at. Left out: as wide as it is let, and as tall as its shape makes it. */
  box?: Box
  children?: React.ReactNode
}) {
  const theme = useTheme()
  const { agentId } = useChatScope()
  const { client, auth } = useSession()
  const { shot, width, height } = step
  const source = useMemo(
    () =>
      shot === undefined
        ? undefined
        : { uri: client.agent(agentId).shotUrl(shot), headers: authHeaders(auth) },
    [shot, client, agentId, auth],
  )
  return (
    <View
      style={[
        {
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.fill,
        },
        box ?? { width: "100%", aspectRatio: width && height ? width / height : UNKNOWN_SHAPE },
      ]}
    >
      {source === undefined ? (
        <Text variant="caption" tone="ink2" style={{ textAlign: "center", paddingHorizontal: 16 }}>
          No picture was taken at this step.
        </Text>
      ) : (
        <Image source={source} alt={step.say} contentFit="fill" style={StyleSheet.absoluteFill} />
      )}
      {children}
    </View>
  )
}

/** The film of a use: the picture kept at each step, side by side, each over what the step was. */
function Film({ use, onOpen }: { use: Use; onOpen: (index: number) => void }) {
  const theme = useTheme()
  // It opens on the first step there is a picture of: listing the windows leaves none.
  const first = Math.max(
    0,
    use.steps.findIndex((each) => each.shot !== undefined),
  )
  return (
    <ScrollView
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator={false}
      contentOffset={{ x: first * (FRAME_WIDTH + FRAME_GAP), y: 0 }}
      contentContainerStyle={{ gap: FRAME_GAP, alignItems: "flex-start", paddingRight: 4 }}
    >
      {use.steps.map((step, index) => {
        const frame = (
          <View
            style={{
              overflow: "hidden",
              borderRadius: radius.sm,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.sep,
            }}
          >
            <FrameBox step={step} />
          </View>
        )
        return (
          <View key={step.toolCallId} style={{ width: FRAME_WIDTH, gap: 4 }}>
            {step.shot === undefined ? (
              frame
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Step ${index + 1}: ${step.say}`}
                onPress={() => {
                  haptic.tap()
                  onOpen(index)
                }}
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
              >
                {frame}
              </Pressable>
            )}
            <Text variant="caption" tone="ink2" numberOfLines={2}>
              {step.say}
            </Text>
          </View>
        )
      })}
    </ScrollView>
  )
}

/** The largest box of a shape that fits in a room. */
const fit = (room: Box, shape: number): Box =>
  room.width / room.height > shape
    ? { width: room.height * shape, height: room.height }
    : { width: room.width, height: room.width / shape }

/** One picture of the film over the whole screen, with the pointer where the agent left it. */
function Large({ use, at, onClose }: { use: Use; at: number; onClose: () => void }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { agentId, accent } = useChatScope()
  const me = useAgentSummary(agentId)
  const [room, measure] = useBox()
  const step = use.steps[at]
  if (step === undefined) return null
  const { width, height, pointer } = step
  const box =
    room === undefined || room.width === 0 || room.height === 0
      ? undefined
      : fit(room, width && height ? width / height : UNKNOWN_SHAPE)
  return (
    <Modal visible animationType="fade" onRequestClose={onClose}>
      <View
        accessibilityViewIsModal
        style={{
          flex: 1,
          backgroundColor: theme.bg,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        }}
      >
        <View
          style={{
            height: 52,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingHorizontal: 16,
          }}
        >
          <Text variant="headline" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
            {at + 1} of {use.steps.length}
          </Text>
          <Button kind="grey" size="small" title="Close" onPress={onClose} />
        </View>
        <View
          onLayout={measure}
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          {box === undefined ? null : (
            <FrameBox step={step} box={box}>
              {step.shot !== undefined && pointer !== undefined && width && height ? (
                <Pointer
                  at={pointer}
                  size={{ width, height }}
                  box={box}
                  name={me?.name ?? undefined}
                  ink={accent}
                />
              ) : null}
            </FrameBox>
          )}
        </View>
        <Text
          variant="subhead"
          tone="ink2"
          style={{ textAlign: "center", paddingHorizontal: 20, paddingVertical: 14 }}
        >
          {step.say}
        </Text>
      </View>
    </Modal>
  )
}

/** Word that a use ended, which unfolds into what was done: the picture kept at each step. */
const UseEnded = memo(function UseEnded({ use }: { use: Use }) {
  const { agentId } = useChatScope()
  const name = useAgentSummary(agentId)?.name ?? "It"
  /** The step whose picture is open large, by where it is among the steps. */
  const [large, setLarge] = useState<number | null>(null)
  const count = use.steps.length
  const [computer, rest] =
    use.what === "screen" ? [wordsOf(use), ""] : ["a browser", ` on ${use.computer.name}`]
  return (
    <NoticeLine icon="checkCircle">
      <Text variant="subhead" tone="ink2">
        {name} used{" "}
        <Text variant="subhead" weight="500">
          {computer}
        </Text>
        {rest}
        {/* Under a second is no time worth telling. */}
        {use.ms === undefined || use.ms < 1_000 ? "" : ` for ${spanOf(use.ms)}`} · {count}{" "}
        {count === 1 ? "step" : "steps"}
      </Text>
      <Fold label="What it did">
        <Film use={use} onOpen={setLarge} />
      </Fold>
      {large === null ? null : <Large use={use} at={large} onClose={() => setLarge(null)} />}
    </NoticeLine>
  )
})

const sameStep = (a: UseStep, b: UseStep) =>
  a.toolCallId === b.toolCallId &&
  a.status === b.status &&
  a.say === b.say &&
  a.shot === b.shot &&
  a.width === b.width &&
  a.height === b.height &&
  a.pointer?.x === b.pointer?.x &&
  a.pointer?.y === b.pointer?.y &&
  a.url === b.url &&
  a.title === b.title

/**
 * Whether two tellings of a use say the same. A use is made anew whenever anything in its chat
 * changes, a word of an answer included, and nearly always says what it said before.
 */
const sameUse = (a: Use, b: Use) =>
  a === b ||
  (a.id === b.id &&
    a.what === b.what &&
    a.computer.id === b.computer.id &&
    a.computer.name === b.computer.name &&
    a.going === b.going &&
    a.last === b.last &&
    a.startedAt === b.startedAt &&
    a.ms === b.ms &&
    a.steps.length === b.steps.length &&
    a.steps.every((step, index) => {
      const other = b.steps[index]
      return other !== undefined && sameStep(step, other)
    }))

/**
 * A use, drawn again only when what it says changes: the screen while the agent is at it, and
 * word of it after.
 */
const UseShown = memo(
  function UseShown({ use }: { use: Use }) {
    const [ref, seen] = useSeen()
    const { spot, view, live } = useWatched(use, seen)
    return (
      <View ref={ref}>
        {live ? <UseWindow use={use} view={view} spot={spot} /> : <UseEnded use={use} />}
      </View>
    )
  },
  (before, after) => sameUse(before.use, after.use),
)

/** The use this tool call is the first step of; nothing for a later step of the same use. */
export const UseView = memo(function UseView({ part }: { part: ToolPart }) {
  const use = useContext(UsesContext).byId.get(part.toolCallId)
  // The other steps of a use are in the one thing shown where it began.
  return use === undefined ? null : <UseShown use={use} />
})
