import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import { ActivityIndicator, View } from "react-native"
import { ComputerSection, RequestCard } from "@/computers/computer-section"
import {
  canBeAdded,
  Problem,
  useAgentsById,
  useComputerKinds,
  useComputerRequests,
  useComputers,
  useRefresh,
} from "@/computers/shared"
import { keys, useMe, useWorkspaces } from "@/lib/queries"
import { useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import { HeaderItems, Icon, type MenuItem, Row, Screen, Section, Text } from "@/ui"

/** How often the page asks how its computers stand, which is how often the web's does. */
const EVERY = 5_000

/**
 * A workspace's computers: the machines made for it, the ones people have paired, and any
 * computer of someone's own that one of its agents was given. Each says whose it is and which
 * agents can work on it, and an agent that asked for one is answered here.
 */
export default function Computers() {
  const { workspaceId } = useLocalSearchParams<{ workspaceId: string }>()
  const theme = useTheme()
  const router = useRouter()
  const { client } = useSession()
  const queryClient = useQueryClient()
  const me = useMe()
  // Whether a computer is online changes without any event reaching this page.
  const computers = useComputers(EVERY)
  // Someone else's agent may ask for a computer of the person's, and nothing tells this page.
  const asked = useComputerRequests(EVERY)
  const kinds = useComputerKinds()
  const workspaces = useWorkspaces().data?.workspaces ?? []
  const agents = useAgentsById()

  const optionsKey = keys.workspace(workspaceId, "options")
  const options = useQuery({
    queryKey: optionsKey,
    queryFn: () => client.workspace(workspaceId).options(),
  })
  const save = useMutation({
    mutationFn: (showBrowser: boolean) => client.workspace(workspaceId).setOptions({ showBrowser }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: optionsKey }),
  })

  const requests = (asked.data ?? []).filter((request) => request.canAnswer)
  const listed = computers.data?.filter(
    (computer) =>
      computer.workspaceId === workspaceId ||
      computer.agentIds.some((id) => agents.get(id)?.workspaceId === workspaceId),
  )
  const addable = (kinds.data?.kinds ?? []).filter(canBeAdded)
  const base = `/settings/w/${encodeURIComponent(workspaceId)}/computers`
  const add: MenuItem[] = [
    ...(addable.length > 0
      ? [{ title: "Add a computer", icon: "plus" as const, onPress: () => router.push(`${base}/add`) }]
      : []),
    {
      title: "Connect a computer of your own",
      icon: "desktop",
      onPress: () => router.push(`${base}/own`),
    },
  ]

  const refresh = useRefresh(() =>
    Promise.all([computers.refetch(), asked.refetch(), options.refetch()]),
  )

  return (
    <Screen {...refresh}>
      <Stack.Screen options={{ title: "Computers" }} />
      <HeaderItems items={[{ icon: "plus", label: "Add or connect a computer", menu: add }]} />
      {requests.length === 0 ? null : (
        <View accessibilityLabel="Agents asking to use a computer" style={{ marginBottom: 10 }}>
          {requests.map((request) => (
            <RequestCard
              key={request.id}
              request={request}
              agent={agents.get(request.agentId)}
              team={workspaces.find(
                (workspace) =>
                  workspace.kind === "team" && workspace.id === request.computer.workspaceId,
              )}
            />
          ))}
        </View>
      )}

      {listed === undefined ? (
        computers.isError ? (
          <View style={{ marginHorizontal: 32, marginBottom: 22 }}>
            <Problem error={computers.error} />
          </View>
        ) : (
          <ActivityIndicator style={{ marginVertical: 32 }} />
        )
      ) : (
        listed.map((computer) => (
          <ComputerSection
            key={computer.id}
            computer={computer}
            meId={me.data?.user.id ?? ""}
            workspaceId={workspaceId}
            workspaces={workspaces}
            agents={agents}
            kinds={kinds.data?.kinds ?? []}
          />
        ))
      )}

      {options.data === undefined ? null : (
        <Section
          footer={
            <View style={{ gap: 4 }}>
              <Text variant="footnote" tone="ink2">
                On a computer with a screen, the browser an agent uses opens in a window you can
                watch. Off, it works out of sight.
              </Text>
              <Problem error={save.error} />
            </View>
          }
        >
          <Row
            title="Show the browser agents use"
            toggle={{
              value: save.isPending ? (save.variables ?? false) : options.data.showBrowser,
              disabled: save.isPending || !options.data.canChange,
              onChange: (next) => save.mutate(next),
            }}
          />
        </Section>
      )}

      <Section footer="Sends the install command to your Mac, or confirms the code it shows.">
        {addable.length > 0 ? (
          <Row title="Add a computer" tone="tint" onPress={() => router.push(`${base}/add`)} />
        ) : null}
        <Row
          lead={<Icon name="qr" size={24} color={theme.tint} />}
          title="Connect a computer of your own"
          tone="tint"
          go
          onPress={() => router.push(`${base}/own`)}
        />
      </Section>
      <Text variant="footnote" tone="ink2" style={{ marginHorizontal: 32, marginBottom: 8 }}>
        Where agents run commands, and read and write files: machines made here for a workspace,
        and computers of your own or of a team that you connect. Everything an agent does on a
        connected computer is logged on that machine.
      </Text>
    </Screen>
  )
}
