import { personalWorkspaceId } from "@do-computer/protocol"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import { type ReactNode, useEffect, useState } from "react"
import { ActivityIndicator, View } from "react-native"
import { Problem, RadioRow } from "@/computers/shared"
import { keys, useAgents, useMe, useWorkspaces } from "@/lib/queries"
import { mono, radius, useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import { Button, Field, haptic, HeaderItems, Icon, Row, Screen, Section, Text } from "@/ui"
import { Avatar } from "@/ui/avatar"

/** A title and a line under it, where a screen has something to say before its groups. */
function Heading({ title, children }: { title: string; children: string }) {
  return (
    <View style={{ marginHorizontal: 32, marginTop: 8, marginBottom: 20, gap: 6 }}>
      <Text variant="title2" accessibilityRole="header">
        {title}
      </Text>
      <Text variant="subhead" tone="ink2">
        {children}
      </Text>
    </View>
  )
}

/** One thing the daemon said about its computer, in the fixed-width face. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <Row
      title={label}
      value={
        <Text
          selectable
          tone="ink2"
          numberOfLines={1}
          ellipsizeMode="middle"
          style={{ flexShrink: 1, maxWidth: "72%", fontFamily: mono, fontSize: 15, letterSpacing: 0 }}
        >
          {value}
        </Text>
      }
    />
  )
}

/**
 * Where the code a daemon prints leads: the person agrees to pair that computer, and says whose
 * it is and which agents can use it. Opened with a code by `docomputer://pair?code=…`, or
 * with none, to type one.
 */
export default function Pair() {
  const params = useLocalSearchParams<{ code?: string }>()
  const code = (params.code ?? "").trim()
  const theme = useTheme()
  const router = useRouter()
  const { client } = useSession()
  const queryClient = useQueryClient()
  const me = useMe()
  const [typed, setTyped] = useState("")
  const pairing = useQuery({
    queryKey: ["pairing", code],
    queryFn: () => client.pairingRequest(code),
    retry: false,
    enabled: code !== "",
  })
  const agents = useAgents()
  const workspaces = useWorkspaces().data?.workspaces ?? []
  const teams = workspaces.filter((workspace) => workspace.kind === "team")
  const own = workspaces.find((workspace) => workspace.kind === "personal")
  /** Whose it is to be. Undefined: the person's own. */
  const [teamId, setTeamId] = useState<string>()
  const [chosen, setChosen] = useState<readonly string[]>()
  // One's own computer can serve any agent one can use; a team's serves the team's agents.
  const offered = (agents.data ?? []).filter(
    (agent) => teamId === undefined || agent.workspaceId === teamId,
  )
  useEffect(() => {
    // With one agent there is nothing to choose between, so it is chosen.
    const only = agents.data?.[0]
    if (chosen === undefined && agents.data !== undefined) {
      setChosen(agents.data.length === 1 && only !== undefined ? [only.id] : [])
    }
  }, [agents.data, chosen])
  const agentIds = (chosen ?? []).filter((id) => offered.some((agent) => agent.id === id))
  const confirm = useMutation({
    mutationFn: () =>
      client.confirmPairing({
        code,
        agentIds,
        ...(teamId === undefined ? {} : { workspaceId: teamId }),
      }),
    onSuccess: () => {
      haptic.done()
      return queryClient.invalidateQueries({ queryKey: keys.computers })
    },
    onError: () => haptic.fail(),
  })

  const close = () => (router.canDismiss() ? router.dismiss() : router.replace("/"))
  const enter = () => {
    if (typed.trim() !== "") router.setParams({ code: typed.trim() })
  }
  /** The computers of the workspace it was given to, in the settings sheet. */
  const see = () => {
    const workspaceId = teamId ?? own?.id ?? personalWorkspaceId(me.data?.user.id ?? "")
    // Back to that page where it is under this one; otherwise it takes this one's place.
    router.dismissTo(`/settings/w/${encodeURIComponent(workspaceId)}/computers`)
  }

  let body: ReactNode
  if (confirm.isSuccess) {
    body = (
      <>
        <View style={{ alignItems: "center", marginTop: 24 }}>
          <Icon name="checkCircle" size={54} color={theme.green} />
        </View>
        <View style={{ marginHorizontal: 32, marginTop: 14, marginBottom: 24, gap: 6 }}>
          <Text variant="title2" accessibilityRole="header" style={{ textAlign: "center" }}>
            Connected
          </Text>
          <Text variant="subhead" tone="ink2" style={{ textAlign: "center" }}>
            {agentIds.length === 0
              ? "No Dood can use it yet: connect one under Computers, or let a Dood ask. It is called "
              : agentIds.length === 1
                ? "Your Dood knows this computer as "
                : "Your Doods know this computer as "}
            <Text variant="subhead" style={{ fontFamily: mono, letterSpacing: 0 }}>
              {confirm.data.name}
            </Text>
            . The daemon in your terminal will connect in a moment; you can close this page.
          </Text>
        </View>
        <View style={{ marginHorizontal: 16 }}>
          <Button title="See your computers" onPress={see} />
        </View>
      </>
    )
  } else if (code === "") {
    body = (
      <>
        <Text variant="subhead" tone="ink2" style={{ marginHorizontal: 32, marginTop: 8, marginBottom: 20 }}>
          Run the install command on the computer. It prints a link that ends in a code.
        </Text>
        <Section title="Enter the code it shows" footer="Codes last ten minutes.">
          <Field
            placeholder="Code"
            accessibilityLabel="Enter the code it shows"
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            value={typed}
            onChangeText={setTyped}
            returnKeyType="go"
            onSubmitEditing={enter}
          />
        </Section>
        <View style={{ marginHorizontal: 16 }}>
          <Button title="Continue" disabled={typed.trim() === ""} onPress={enter} />
        </View>
      </>
    )
  } else if (pairing.isError) {
    body = (
      <>
        <Heading title="That code did not work">
          It may have expired; codes last ten minutes. Run the install command again on the
          computer to get a fresh link.
        </Heading>
        <View style={{ marginHorizontal: 16 }}>
          <Button
            kind="grey"
            title="Enter another code"
            onPress={() => {
              setTyped("")
              router.setParams({ code: "" })
            }}
          />
        </View>
      </>
    )
  } else if (pairing.data === undefined) {
    body = <ActivityIndicator style={{ marginVertical: 48 }} />
  } else {
    body = (
      <>
        <Heading title="Connect this computer?">
          Check that this is the machine you just ran the command on.
        </Heading>
        <Section>
          <Fact label="Code" value={pairing.data.code} />
          <Fact label="Name" value={pairing.data.name} />
          <Row title="Host" value={pairing.data.hostname} />
          <Fact label="Home" value={pairing.data.home} />
        </Section>
        {/* It is there from the start, so it is a note and not something to announce. */}
        <View
          style={{
            marginHorizontal: 16,
            marginBottom: 22,
            padding: 14,
            flexDirection: "row",
            gap: 10,
            borderRadius: radius.md,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: theme.amber,
            backgroundColor: theme.card,
          }}
        >
          <Icon name="warning" size={20} color={theme.amber} />
          <Text variant="subhead" style={{ flex: 1 }}>
            {pairing.data.readOnly
              ? "A Dood connected to it will be able to read any file your account can read on this computer. It will not be able to run commands or change anything."
              : "A Dood connected to it will be able to run any command and read and change any file your account can on this computer, without asking first. Only connect a machine you are comfortable handing over."}
          </Text>
        </View>
        {teams.length === 0 ? null : (
          <Section title="Whose computer is it?">
            {[own, ...teams].map((workspace) => {
              if (workspace === undefined) return null
              // One's own workspace is meant by naming no team.
              const id = workspace.kind === "personal" ? undefined : workspace.id
              return (
                <RadioRow
                  key={workspace.id}
                  title={workspace.kind === "personal" ? "Mine" : workspace.name}
                  subtitle={
                    workspace.kind === "personal"
                      ? "Only you decide which Doods use it, in any of your workspaces."
                      : `Anyone in ${workspace.name} can connect its Doods to it.`
                  }
                  checked={teamId === id}
                  disabled={confirm.isPending}
                  onPress={() => setTeamId(id)}
                />
              )
            })}
          </Section>
        )}
        <Section
          title="Which Doods can use it?"
          footer="You can change this later under Computers, and a Dood that is not connected can ask you for it."
        >
          {offered.length === 0 ? (
            <Row
              title={
                <Text tone="ink2">{agents.data === undefined ? "Loading…" : "No Doods here yet"}</Text>
              }
            />
          ) : null}
          {offered.map((agent) => (
            <Row
              key={agent.id}
              lead={
                <Avatar
                  avatar={agent.avatar}
                  seed={agent.id}
                  outfit={agent.outfit}
                  size={30}
                  hatched={agent.hatched}
                  still
                />
              }
              title={agent.name ?? "New Dood"}
              subtitle={
                teamId === undefined && teams.length > 0
                  ? workspaces.find((workspace) => workspace.id === agent.workspaceId)?.name
                  : undefined
              }
              toggle={{
                value: agentIds.includes(agent.id),
                disabled: confirm.isPending,
                onChange: (checked) => {
                  haptic.tap()
                  setChosen(
                    checked ? [...agentIds, agent.id] : agentIds.filter((id) => id !== agent.id),
                  )
                },
              }}
            />
          ))}
        </Section>
        <View style={{ marginHorizontal: 16, gap: 10 }}>
          <Problem error={confirm.error} />
          <Button
            title={confirm.isPending ? "Connecting…" : "Connect this computer"}
            busy={confirm.isPending}
            onPress={() => confirm.mutate()}
          />
        </View>
      </>
    )
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: "Connect a computer" }} />
      <HeaderItems
        placement="left"
        items={[
          confirm.isSuccess
            ? { label: "Done", text: "Done", prominent: true, onPress: close }
            : { label: "Cancel", text: "Cancel", onPress: close },
        ]}
      />
      {body}
    </Screen>
  )
}
