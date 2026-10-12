import { ApiError } from "@durable-computer/client"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { type Href, useLocalSearchParams, useRouter } from "expo-router"
import { useAtomValue, useSetAtom } from "jotai"
import { useEffect, useState } from "react"
import { ActivityIndicator, ScrollView, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { keys } from "@/lib/queries"
import { DEFAULT_SERVER, serverAtom, sessionFor } from "@/lib/session"
import { useTheme } from "@/lib/theme"
import { nextAtom } from "@/start/met"
import { Button, errorText, Faces, GlassButton, haptic, Text, Tile } from "@/ui"
import { Avatar } from "@/ui/avatar"

/** "Maya", "Maya and Jon", "Maya, Jon and Priya". */
function names(people: readonly { name: string }[]): string {
  const list = people.map((person) => person.name.split(" ")[0]!)
  if (list.length <= 1) return list.join("")
  return `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`
}

/**
 * An invitation to a team, for whoever holds its link: `durablecomputer://invite/<token>` opens
 * it. Seen before signing in, and answered after. Someone who signs in or makes an account from
 * here is brought back to it.
 */
export default function Invitation() {
  const { token } = useLocalSearchParams<{ token: string }>()
  const theme = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const queryClient = useQueryClient()
  const setNext = useSetAtom(nextAtom)
  // A phone that has not signed in anywhere yet asks the deployment everyone uses.
  const server = useAtomValue(serverAtom) ?? DEFAULT_SERVER
  const { client } = sessionFor(server)
  const { data: invitation, error } = useQuery({
    queryKey: ["invitation", server, token],
    queryFn: () => client.invitation(token),
    retry: false,
  })
  // Whether anyone is signed in decides what the button does.
  const { data: me, isFetched } = useQuery({
    queryKey: ["invitation-me", server],
    queryFn: () => client.me().catch(() => null),
    retry: false,
    gcTime: 0,
  })
  // Someone signed in who has no agent yet is new here, whichever way they signed in: they
  // meet their own first, and the first run brings them back.
  const { data: agents, isFetched: counted } = useQuery({
    queryKey: ["invitation-agents", server, me?.user.id],
    queryFn: async () => (await client.listAgents()).length,
    enabled: me != null,
    retry: false,
    // Asked again each time the page is come to: they come back to it with an agent.
    gcTime: 0,
  })
  const fresh = invitation !== undefined && agents === 0
  const here = `/invite/${encodeURIComponent(token)}`
  useEffect(() => {
    if (!fresh) return
    setNext(here)
    router.replace("/welcome")
  }, [fresh, here, router, setNext])
  const [joining, setJoining] = useState(false)
  const [failure, setFailure] = useState<string>()

  /** Away from the invitation, with nothing answered. */
  const away = () => {
    setNext(null)
    router.replace(me != null ? "/(app)" : "/")
  }
  const page = {
    flexGrow: 1,
    alignItems: "center",
    paddingTop: insets.top + 96,
    paddingBottom: insets.bottom + 16,
    paddingHorizontal: 24,
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
  } as const
  const close = (
    <View style={{ position: "absolute", top: insets.top + 8, left: 16 }}>
      <GlassButton icon="close" label="Close" onPress={away} />
    </View>
  )

  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <View style={[page, { justifyContent: "center", gap: 8, paddingTop: insets.top }]}>
          <Text variant="title2" accessibilityRole="header" style={{ textAlign: "center" }}>
            This invitation is no longer good
          </Text>
          <Text variant="subhead" tone="ink2" style={{ textAlign: "center" }}>
            {error instanceof ApiError && error.status === 404
              ? "It may have been used, withdrawn, or have run out. Ask whoever sent it for a new one."
              : errorText(error)}
          </Text>
          <Button kind="plain" title="Go to Do Computer" onPress={away} />
        </View>
        {close}
      </View>
    )
  }
  // Nothing is offered until it is known who is here, and that they are not on their way out.
  if (invitation === undefined || !isFetched || (me != null && !counted) || fresh) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.bg,
        }}
      >
        <ActivityIndicator color={theme.ink2} />
        {close}
      </View>
    )
  }

  const team = invitation.workspace.name
  const join = async () => {
    setJoining(true)
    setFailure(undefined)
    try {
      await client.acceptInvitation(token)
      haptic.done()
      setNext(null)
      // The team and its agents are theirs now, and are asked for again.
      void queryClient.invalidateQueries({ queryKey: keys.workspaces })
      void queryClient.invalidateQueries({ queryKey: keys.agents })
      router.replace("/(app)")
    } catch (problem) {
      haptic.fail()
      setFailure(errorText(problem, "That did not work. Try again."))
      setJoining(false)
    }
  }
  const decline = async () => {
    // Only an invitation addressed to this account can be turned down. A link is just left alone.
    await client.declineInvitation(invitation.id).catch(() => {})
    void queryClient.invalidateQueries({ queryKey: keys.workspaces })
    away()
  }
  /**
   * To signing in, or to making an account, and back here afterwards. This page gives way to
   * that one, so that it is not still there, unanswered, under the one they come back to.
   */
  const through = (to: Href) => {
    setNext(here)
    router.replace(to)
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView contentContainerStyle={page} alwaysBounceVertical={false}>
        <Tile name={team} color={invitation.workspace.color} size={72} />
        <Text
          variant="title1"
          accessibilityRole="header"
          style={{ marginTop: 20, textAlign: "center" }}
        >
          Join {team}
        </Text>
        <Text tone="ink2" style={{ marginTop: 6, textAlign: "center" }}>
          {invitation.invitedBy.name} invited you.
        </Text>
        {invitation.note ? (
          <Text variant="subhead" tone="ink2" style={{ marginTop: 8, textAlign: "center" }}>
            “{invitation.note}”
          </Text>
        ) : null}
        {invitation.agents.length === 0 ? null : (
          <View
            accessibilityRole="list"
            accessibilityLabel={`${team}'s agents`}
            style={{
              marginTop: 28,
              flexDirection: "row",
              flexWrap: "wrap",
              justifyContent: "center",
              gap: 18,
            }}
          >
            {invitation.agents.slice(0, 4).map((agent) => (
              <View key={agent.id} style={{ alignItems: "center", gap: 6 }}>
                <Avatar
                  avatar={agent.avatar}
                  seed={agent.id}
                  hatched={agent.hatched}
                  size={72}
                  still
                />
                <Text variant="subhead" weight="500" numberOfLines={1}>
                  {agent.name ?? "New agent"}
                </Text>
              </View>
            ))}
          </View>
        )}
        <View
          style={{
            marginTop: 20,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          <Faces people={invitation.members} size={20} ring={theme.bg} />
          <Text variant="subhead" tone="ink2" style={{ flexShrink: 1, textAlign: "center" }}>
            {invitation.agents.length === 0
              ? `${names(invitation.members)} ${invitation.members.length === 1 ? "is" : "are"} in it`
              : `You would share ${invitation.agents.length === 1 ? "this agent and its" : "these agents and their"} chats with ${names(invitation.members)}`}
          </Text>
        </View>
        <View style={{ flexGrow: 1, minHeight: 32 }} />
        <View style={{ alignSelf: "stretch", gap: 10 }}>
          {failure === undefined ? null : (
            <Text
              variant="subhead"
              tone="red"
              accessibilityRole="alert"
              style={{ textAlign: "center" }}
            >
              {failure}
            </Text>
          )}
          {me != null ? (
            <>
              <Button
                title={`Join ${team}`}
                color={invitation.workspace.color}
                busy={joining}
                onPress={() => void join()}
              />
              <Button
                kind="grey"
                title="Not now"
                disabled={joining}
                onPress={() => void decline()}
              />
              <Text variant="footnote" tone="ink2" style={{ marginTop: 6, textAlign: "center" }}>
                Signed in as {me.user.email}.
              </Text>
            </>
          ) : (
            <>
              <Button
                title="Sign in to join"
                color={invitation.workspace.color}
                onPress={() => through("/connect")}
              />
              <Button
                kind="grey"
                title="Create an account"
                onPress={() => through("/connect?mode=sign-up" as Href)}
              />
            </>
          )}
        </View>
      </ScrollView>
      {close}
    </View>
  )
}
