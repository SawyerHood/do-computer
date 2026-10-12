import {
  type AgentSummary,
  type CreatureState,
  hasEverything,
  RARITIES,
  rarityOf,
  WEAR_ITEMS,
  WEAR_SLOTS,
  type WearItem,
  type WearSlot,
} from "@do-computer/protocol"
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import { useCallback, useMemo, useState } from "react"
import { ActivityIndicator, FlatList, Pressable, useWindowDimensions, View } from "react-native"
import { Pixels } from "@/creature/pixels"
import { useCreatureStage } from "@/creature/stage"
import { boxProgress, foundLine, SLOT_NAMES, useCare, useCreature } from "@/creature/state"
import { STILL, Wearing } from "@/creature/stills"
import { useAgentLive, useAgentSummary } from "@/lib/queries"
import { radius, useAgentAccent, useTheme } from "@/lib/theme"
import { haptic, Icon, Segmented, Text } from "@/ui"
import { Avatar } from "@/ui/avatar"

/** The room at the page's sides, and between two tiles. */
const EDGE = 16
const GAP = 8
/** The square a treat or the box is pressed in, beside the creature. */
const SIDE = 60

/** One thing in the wardrobe: the creature wearing it if it has been found, and a blank if not. */
function Tile({
  agent,
  item,
  owned,
  worn,
  width,
  ring,
  onPick,
}: {
  agent: Pick<AgentSummary, "id" | "avatar">
  /** Undefined for the tile that takes off what is worn there. */
  item: WearItem | undefined
  owned: boolean
  worn: boolean
  width: number
  /** The agent's accent, around the one that is on. */
  ring: string
  onPick: () => void
}) {
  const theme = useTheme()
  const rarity = item === undefined ? undefined : rarityOf(item.rarity)
  const frame = {
    width,
    minHeight: STILL + 58,
    borderRadius: radius.md,
    borderCurve: "continuous",
    borderWidth: 2,
    borderColor: "transparent",
    overflow: "hidden",
    alignItems: "center",
  } as const
  const foot =
    rarity === undefined ? null : (
      <View
        style={{
          position: "absolute",
          left: 10,
          right: 10,
          bottom: 0,
          height: 3,
          backgroundColor: rarity.color,
        }}
      />
    )
  if (!owned && rarity !== undefined) {
    return (
      <View
        accessible
        accessibilityLabel={`Not found yet: ${rarity.label.toLowerCase()}`}
        style={[frame, { justifyContent: "center", backgroundColor: theme.fill }]}
      >
        <Text variant="title1" weight="600" color={rarity.color} style={{ opacity: 0.8 }}>
          ?
        </Text>
        {foot}
      </View>
    )
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item?.name ?? "Nothing"}
      accessibilityHint={rarity?.label}
      accessibilityState={{ selected: worn }}
      onPress={onPick}
      style={({ pressed }) => [
        frame,
        { paddingTop: 8, paddingBottom: 10, paddingHorizontal: 4, backgroundColor: theme.card },
        worn ? { borderColor: ring } : null,
        pressed ? { opacity: 0.7 } : null,
      ]}
    >
      <Wearing agent={agent} item={item} />
      <View style={{ minHeight: 32, justifyContent: "center", marginTop: 2 }}>
        <Text variant="caption" weight="500" numberOfLines={2} style={{ textAlign: "center" }}>
          {item?.name ?? "Nothing"}
        </Text>
      </View>
      {foot}
    </Pressable>
  )
}

/**
 * The top of the page: the creature, large, between its treats and its box, with its name and
 * how much it has found. What moves here (hearts, a treat on its way) is kept to itself, so that
 * the tiles under it are not drawn again for every heart.
 */
function Care({
  agent,
  creature,
  now,
}: {
  agent: AgentSummary
  creature: CreatureState
  /** The time the page was come to: how long until the next box is counted from it. */
  now: number
}) {
  const theme = useTheme()
  const router = useRouter()
  const window = useWindowDimensions()
  const accent = useAgentAccent(agent)
  const size = Math.max(120, Math.min(176, window.width - 2 * (EDGE + SIDE + 6)))
  const { stage, kind, busy, give } = useCreatureStage({ agent, creature, size })
  const name = agent.name ?? "New agent"
  const boxes = creature.boxes
  const coming = hasEverything(creature.owned)
    ? `${name} has found everything there is`
    : `${name}'s next box turns up in about ${boxProgress(creature, now).left}`
  const beside = ({ pressed }: { pressed: boolean }) =>
    ({
      width: SIDE,
      height: SIDE,
      marginBottom: 22,
      alignItems: "center",
      justifyContent: "center",
      opacity: pressed ? 0.6 : 1,
    }) as const
  return (
    <View style={{ alignItems: "center", paddingTop: 4 }}>
      <View
        style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "center", gap: 6 }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Give ${name} a treat`}
          accessibilityState={{ busy }}
          // The treats are at its left, level with its mouth: one sets out from there. It eats
          // one at a time, and a press while it eats comes to nothing.
          onPress={() => (busy ? undefined : give({ dx: -(size / 2 + 6 + SIDE / 2), dy: 0 }))}
          style={beside}
        >
          {kind === undefined ? null : <Pixels art={kind} size={42} />}
        </Pressable>
        {stage}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            boxes > 1
              ? `Open one of ${name}'s ${boxes} boxes`
              : boxes === 1
                ? `Open ${name}'s box`
                : coming
          }
          accessibilityState={{ disabled: boxes === 0 }}
          disabled={boxes === 0}
          onPress={() => router.push(`/a/${agent.id}/box`)}
          style={beside}
        >
          <Icon name="gift" size={46} color={boxes > 0 ? accent.a : theme.ink3} />
          {boxes === 0 ? null : (
            <View
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                minWidth: 22,
                height: 22,
                borderRadius: 11,
                paddingHorizontal: 6,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: accent.a,
              }}
            >
              <Text variant="footnote" weight="700" color={accent.onA}>
                {boxes}
              </Text>
            </View>
          )}
        </Pressable>
      </View>
      <Text variant="title2" accessibilityRole="header" style={{ marginTop: 6 }}>
        {name}
      </Text>
      <Text variant="subhead" tone="ink2" style={{ marginTop: 2 }}>
        {foundLine(creature, now)}
      </Text>
    </View>
  )
}

/** What each rarity's color means, under the tiles. */
function Legend() {
  return (
    <View
      accessibilityLabel="Rarities"
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: "center",
        columnGap: 14,
        rowGap: 4,
        paddingTop: 8,
        paddingHorizontal: EDGE,
      }}
    >
      {RARITIES.map((rarity) => (
        <View key={rarity.id} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: rarity.color }} />
          <Text variant="caption" tone="ink2">
            {rarity.label}
          </Text>
        </View>
      ))}
    </View>
  )
}

/**
 * The creature's page: where it is looked after and dressed. The creature with its treats on one
 * side and its box on the other, and under it everything there is to wear, a place at a time.
 * What it has found is shown on the creature itself; what it has not is a blank in the color of
 * its rarity. Picking a thing puts it on, and picking it again takes it off. In a team the
 * outfit is the agent's, and everyone sees it.
 */
export default function WardrobePage() {
  const { agentId } = useLocalSearchParams<{ agentId: string }>()
  const theme = useTheme()
  const window = useWindowDimensions()
  const agent = useAgentSummary(agentId)
  useAgentLive(agentId)
  const accent = useAgentAccent(agent)
  const hatched = agent?.hatched === true
  const creature = useCreature(agentId, hatched)
  const care = useCare(agentId)
  const [slot, setSlot] = useState<WearSlot>("hat")
  // How long until its next box is read when the page is come to, and not kept ticking.
  const [now, setNow] = useState(() => Date.now())
  useFocusEffect(useCallback(() => setNow(Date.now()), []))

  const have = creature?.owned
  const outfit = creature?.outfit
  const owned = useMemo(() => new Set(have ?? []), [have])
  // "Nothing" first; then what it has, in the order of the catalog; then what it has not,
  // commonest first.
  const tiles = useMemo(() => {
    const here = WEAR_ITEMS.filter((item) => item.slot === slot)
    const rank = (item: WearItem) => RARITIES.findIndex((rarity) => rarity.id === item.rarity)
    return [
      undefined,
      ...here.filter((item) => owned.has(item.id)),
      ...here.filter((item) => !owned.has(item.id)).sort((a, b) => rank(a) - rank(b)),
    ]
  }, [slot, owned])
  const slots = useMemo(
    () =>
      WEAR_SLOTS.map((place) => {
        const here = WEAR_ITEMS.filter((item) => item.slot === place)
        const found = here.filter((item) => owned.has(item.id)).length
        return { value: place, label: `${SLOT_NAMES[place].many} ${found}/${here.length}` }
      }),
    [owned],
  )
  const tileWidth = Math.floor((window.width - 2 * EDGE - 2 * GAP) / 3)
  const ring = accent.a
  // Made anew only when what a tile shows has changed: the list draws its tiles again when it is.
  const renderItem = useCallback(
    ({ item }: { item: WearItem | undefined }) => {
      if (agent === undefined || outfit === undefined) return null
      const worn = outfit[slot] === item?.id
      return (
        <Tile
          agent={agent}
          item={item}
          owned={item === undefined || owned.has(item.id)}
          worn={worn}
          width={tileWidth}
          ring={ring}
          // Picked while it is on, it comes off.
          onPick={() => {
            haptic.tap()
            const { [slot]: _off, ...rest } = outfit
            void care.wear(worn || item === undefined ? rest : { ...rest, [slot]: item.id })
          }}
        />
      )
    },
    [agent, outfit, slot, owned, tileWidth, ring, care],
  )

  const bar = <Stack.Screen options={{ title: "" }} />
  if (agent === undefined || (hatched && creature === undefined)) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.bg,
        }}
      >
        {bar}
        <ActivityIndicator />
      </View>
    )
  }
  if (creature === undefined) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          backgroundColor: theme.bg,
        }}
      >
        {bar}
        <Avatar avatar={agent.avatar} seed={agent.id} size={140} hatched={false} />
        <Text variant="subhead" tone="ink2">
          {agent.name ?? "New agent"} has not hatched yet.
        </Text>
      </View>
    )
  }

  return (
    <>
      {bar}
      <FlatList
        accessibilityLabel={SLOT_NAMES[slot].many}
        data={tiles}
        extraData={renderItem}
        keyExtractor={(item) => item?.id ?? "nothing"}
        numColumns={3}
        // Only the tiles near the ones on screen are kept: each found one is a picture.
        initialNumToRender={12}
        maxToRenderPerBatch={9}
        windowSize={5}
        contentInsetAdjustmentBehavior="automatic"
        style={{ flex: 1, backgroundColor: theme.bg }}
        contentContainerStyle={{ paddingBottom: 40 }}
        columnWrapperStyle={{ gap: GAP, paddingHorizontal: EDGE, marginBottom: GAP }}
        ListHeaderComponent={
          <>
            <Care agent={agent} creature={creature} now={now} />
            <View style={{ marginHorizontal: EDGE, marginTop: 16, marginBottom: 14 }}>
              <Segmented value={slot} options={slots} onChange={setSlot} label="Where it is worn" />
            </View>
          </>
        }
        ListFooterComponent={<Legend />}
        renderItem={renderItem}
      />
    </>
  )
}
