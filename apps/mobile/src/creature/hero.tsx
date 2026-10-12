import { hasEverything } from "@durable-computer/protocol"
import { useFocusEffect, useRouter } from "expo-router"
import { type ReactNode, useCallback, useState } from "react"
import { View } from "react-native"
import { useAgentLive, useAgentSummary } from "@/lib/queries"
import { useAgentAccent, useTheme } from "@/lib/theme"
import { Button, Icon, Text } from "@/ui"
import { Pixels } from "./pixels"
import { useCreatureStage } from "./stage"
import { boxProgress, useCreature } from "./state"

/** The time until its next box, short enough for a button: "7h", "40m". */
const brief = (nextBoxAt: number | undefined, now: number) => {
  if (nextBoxAt === undefined) return ""
  const minutes = Math.max(1, Math.round((nextBoxAt - now) / 60_000))
  return minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`
}

const capsule = { height: 44, borderRadius: 22, paddingLeft: 12, paddingRight: 15 } as const

/** The agent's creature, large, that can be stroked, with its Treat, Box and Wardrobe buttons under it. */
export function CreatureHero({
  agentId,
  size = 196,
}: {
  agentId: string
  size?: number
}): ReactNode {
  const theme = useTheme()
  const router = useRouter()
  const agent = useAgentSummary(agentId)
  useAgentLive(agentId)
  const accent = useAgentAccent(agent)
  const hatched = agent?.hatched === true
  const creature = useCreature(agentId, hatched)
  const { stage, kind, busy, give } = useCreatureStage({ agent, creature, size })
  // The time left is read when the page is come to, and not kept ticking.
  const [now, setNow] = useState(() => Date.now())
  useFocusEffect(useCallback(() => setNow(Date.now()), []))

  const name = agent?.name ?? "it"
  const boxes = creature?.boxes ?? 0
  const coming =
    creature !== undefined && hasEverything(creature.owned)
      ? `${name} has found everything there is`
      : `${name}'s next box turns up in about ${boxProgress(creature ?? {}, now).left}`
  return (
    <View style={{ alignItems: "center" }}>
      {stage}
      {!hatched || creature === undefined ? null : (
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: 8,
            marginTop: 12,
          }}
        >
          <Button
            kind="line"
            size="medium"
            style={capsule}
            accessibilityLabel={`Give ${name} a treat`}
            // It eats one treat at a time: a press while it eats comes to nothing. The button is
            // under the creature and to the left of its middle, and the treat sets out from there.
            onPress={() => (busy ? undefined : give({ dx: -size * 0.45, dy: size * 0.5 }))}
          >
            {kind === undefined ? null : <Pixels art={kind} size={22} />}
            <Text variant="subhead" weight="600">
              Treat
            </Text>
          </Button>
          <Button
            kind="line"
            size="medium"
            style={capsule}
            accessibilityLabel={
              boxes > 1
                ? `Open one of ${name}'s ${boxes} boxes`
                : boxes === 1
                  ? `Open ${name}'s box`
                  : coming
            }
            disabled={boxes === 0}
            onPress={() => router.push(`/a/${agentId}/box`)}
          >
            <Icon name="gift" size={21} color={boxes > 0 ? accent.a : theme.ink2} />
            <Text variant="subhead" weight="600">
              Box
            </Text>
            {boxes > 0 ? (
              <View
                style={{
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
            ) : (
              <Text variant="footnote" tone="ink2">
                {brief(creature.nextBoxAt, now)}
              </Text>
            )}
          </Button>
          <Button
            kind="line"
            size="medium"
            style={capsule}
            accessibilityLabel="Wardrobe"
            onPress={() => router.push(`/a/${agentId}/wardrobe`)}
          >
            <Icon name="hanger" size={21} color={theme.ink} />
            <Text variant="subhead" weight="600">
              Wardrobe
            </Text>
          </Button>
        </View>
      )}
    </View>
  )
}
