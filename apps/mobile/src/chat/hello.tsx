import type { AgentSummary } from "@do-computer/protocol"
import { useQueryClient } from "@tanstack/react-query"
import { atom, getDefaultStore, useAtomValue } from "jotai"
import { useCallback, useEffect, useRef, useState } from "react"
import { Pressable, View } from "react-native"
import { usePetting } from "@/creature/petting"
import { keys } from "@/lib/queries"
import type { Accent } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import { Button, Icon, Text } from "@/ui"
import { Avatar, type Mood } from "@/ui/avatar"

/** Who a new agent has just met in the first run, and what it was given there. */
export type Meeting = {
  agentId: string
  /** What its person is called, as it greeted them. */
  first: string
  /** The computer it asked for, null where it was told not now. Absent on a phone. */
  computer?: { name: string; readOnly: boolean } | null
}

/**
 * The meeting the first run has just ended with, kept for as long as the app is open: the
 * agent's first words in its chat go by it. The first-run screen sets it with `rememberMeeting`.
 */
const meetingAtom = atom<Meeting | undefined>(undefined)

export function rememberMeeting(meeting: Meeting | undefined): void {
  getDefaultStore().set(meetingAtom, meeting)
}

/** How long a new agent sits in its egg before it starts to hatch. */
const EGG_MS = 1_600

/** Record that the agent's owner has seen it out of its egg, so it is shown hatched from now on. */
export function useMarkHatched(agentId: string) {
  const { client } = useSession()
  const queryClient = useQueryClient()
  return useCallback(async () => {
    try {
      queryClient.setQueryData(
        keys.agent(agentId),
        await client.agent(agentId).update({ hatched: true }),
      )
      await queryClient.invalidateQueries({ queryKey: keys.agents, exact: true })
    } catch {
      // It hatches again the next time, which is no harm.
    }
  }, [client, queryClient, agentId])
}

/**
 * A new agent is met as an egg, which hatches while its owner watches. Once: after that it is
 * out, here and everywhere it is shown.
 */
function useHatch(agent: AgentSummary) {
  const [phase, setPhase] = useState<"egg" | "hatching" | "out">(agent.hatched ? "out" : "egg")
  const mark = useMarkHatched(agent.id)
  useEffect(() => {
    if (phase !== "egg") return
    const timer = setTimeout(() => setPhase("hatching"), EGG_MS)
    return () => clearTimeout(timer)
  }, [phase])
  const told = useRef(agent.hatched)
  const hatched = useCallback(() => {
    setPhase("out")
    if (told.current) return
    told.current = true
    void mark()
  }, [mark])
  // Leaving the hatch while it plays jumps to its end.
  const skip = useCallback(
    () => (phase === "hatching" ? setPhase("out") : hatched()),
    [phase, hatched],
  )
  return { phase, hatched, skip }
}

/**
 * What a new agent offers to start with, in its first hello: things that show what it can do.
 * These are the web app's own (apps/web/src/lib/starters.ts) for an agent that was given no
 * computer in the first run, which is every agent met on a phone. `say` is what is said to the
 * agent for whoever pressed it, in full, as if they had typed it.
 */
const STARTERS = [
  {
    label: "Make me a little game",
    say: "Make me a little game with you in it that I can play right here in the chat.",
  },
  {
    label: "Research three things at once",
    say: "Pick three things worth knowing about today and research them all at once with sub-agents. Tell me what they find.",
  },
  {
    label: "Check in with me every morning",
    say: "Check in with me every morning at 9 with something worth knowing.",
  },
]

/**
 * The hello of a chat nothing has been said in: the creature, large, in its egg the first time,
 * and who it is. Straight after the first run it says hello first and offers things to start with.
 */
export function Hello({
  agent,
  mood,
  accent,
  onSay,
}: {
  agent: AgentSummary
  mood: Mood
  accent: Accent
  /** Say this to it, as if it had been typed. */
  onSay: (text: string) => void
}) {
  const hatch = useHatch(agent)
  const kept = useAtomValue(meetingAtom)
  const met = agent.name !== null && kept?.agentId === agent.id ? kept : undefined
  const face = (
    <Avatar
      avatar={agent.avatar}
      seed={agent.id}
      outfit={agent.outfit}
      size={200}
      mood={mood}
      hatched={hatch.phase === "out"}
      hatching={hatch.phase === "hatching"}
      onHatched={hatch.hatched}
    />
  )
  // Out of its egg it can be patted, as everywhere it is drawn large.
  const petting = usePetting(agent.id)
  return (
    <View style={{ alignItems: "center", paddingHorizontal: 28, gap: 6 }}>
      {hatch.phase === "out" ? (
        <View {...petting.props} style={{ width: 200, height: 200 }}>
          {face}
          {petting.hearts}
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Skip the hatching"
          onPress={hatch.skip}
        >
          {face}
        </Pressable>
      )}
      <Text
        variant="title1"
        weight="700"
        accessibilityRole="header"
        style={{ textAlign: "center", marginTop: 8 }}
      >
        {met !== undefined ? `Hi ${met.first}, I’m ${agent.name}.` : (agent.name ?? "Say hello")}
      </Text>
      <Text tone="ink2" style={{ textAlign: "center" }}>
        {met !== undefined
          ? "What should we do first?"
          : agent.name
            ? (agent.tagline ?? "What would you like to do?")
            : "Your Dood is brand new. It has no name yet. Start talking and work out together who it is."}
      </Text>
      {met === undefined ? null : (
        <View style={{ alignItems: "center", gap: 8, marginTop: 12 }}>
          {STARTERS.map((starter) => (
            <Button
              key={starter.label}
              title={starter.label}
              kind="line"
              size="medium"
              color={accent.ink}
              onPress={() => onSay(starter.say)}
            />
          ))}
        </View>
      )}
    </View>
  )
}

/** The hello of a side chat nothing has been said in: what a side chat is. */
export function SideChatHello({ name, carried }: { name: string; carried: boolean }) {
  return (
    <View style={{ alignItems: "center", paddingHorizontal: 36, gap: 10 }}>
      <Icon name="chats" size={30} color="#8b949a" />
      <Text variant="subhead" tone="ink2" style={{ textAlign: "center" }}>
        {carried
          ? `A side chat keeps its own conversation. ${name} picks up from the main chat, which stays as it was.`
          : `A side chat keeps its own conversation. ${name} brings what it remembers, and the main chat stays as it was.`}
      </Text>
    </View>
  )
}
