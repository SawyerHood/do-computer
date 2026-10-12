import type { AgentSummary, SlackApp, SlackState } from "@do-computer/protocol"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Stack, useLocalSearchParams } from "expo-router"
import { useState } from "react"
import { ActivityIndicator, StyleSheet } from "react-native"
import { hostOf, open } from "@/agent/connectors"
import { keys, useAgentLive, useAgentSummary } from "@/lib/queries"
import { mono, useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import {
  confirm,
  Empty,
  errorText,
  Field,
  haptic,
  Icon,
  Pill,
  Row,
  Screen,
  Section,
  tell,
  Text,
} from "@/ui"
import { Avatar } from "@/ui/avatar"

/** Slack's own color, for its mark. */
const SLACK = "#611f69"

/**
 * The agent in Slack, as a bot under its own name: the three steps that put it there, and once
 * it is there, what it is called, its picture, and what it does.
 */
export default function Slack() {
  const { agentId } = useLocalSearchParams<{ agentId: string }>()
  const theme = useTheme()
  const { client } = useSession()
  useAgentLive(agentId)
  const agent = useAgentSummary(agentId)
  const slack = useQuery({
    queryKey: keys.slack(agentId),
    queryFn: () => client.agent(agentId).slack(),
  })
  const [refreshing, setRefreshing] = useState(false)
  const name = agent?.name ?? "your agent"

  const refresh = async () => {
    setRefreshing(true)
    await slack.refetch()
    setRefreshing(false)
  }

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <Stack.Screen options={{ title: "Slack" }} />
      <Text variant="footnote" tone="ink2" style={styles.intro}>
        Put {name} in Slack as a bot. Mention it in a channel or message it, and it answers there.
      </Text>
      {slack.data === undefined ? (
        slack.error ? (
          <Empty title="Slack could not be loaded">
            {errorText(slack.error, "Check your connection and pull down to try again.")}
          </Empty>
        ) : (
          <ActivityIndicator style={{ marginTop: 60 }} color={theme.ink2} />
        )
      ) : slack.data.app === null ? (
        <AddToSlack agentId={agentId} agent={agent} name={name} state={slack.data} />
      ) : (
        <InSlack agentId={agentId} agent={agent} name={name} app={slack.data.app} />
      )}
    </Screen>
  )
}

/**
 * The agent's face for Slack. Slack lets nobody but a person set an app's icon, and the picture
 * is drawn by the web app in a browser, so the row opens this page of the web app, where
 * "Download picture" saves it.
 */
function BotPicture({
  agentId,
  agent,
  name,
  title,
}: {
  agentId: string
  agent: AgentSummary | undefined
  name: string
  title?: string
}) {
  const theme = useTheme()
  const { server } = useSession()
  return (
    <Section
      title={title}
      footer={`To give it ${name}'s face, set this picture as the app's icon: on the app's page in Slack, Basic Information, then Display Information. The picture is saved from this page of Do Computer in a browser.`}
    >
      <Row
        lead={
          agent === undefined ? undefined : (
            <Avatar
              avatar={agent.avatar}
              seed={agent.id}
              outfit={agent.outfit}
              size={40}
              hatched={agent.hatched}
              still
            />
          )
        }
        title="Download picture"
        tail={<Icon name="arrowUpRight" size={16} color={theme.ink3} weight="semibold" />}
        onPress={() =>
          open(`${server}/a/${agentId}?settings=${encodeURIComponent(`agent.${agentId}.slack`)}`)
        }
      />
    </Section>
  )
}

/** The three steps, and the rows the Slack app's credentials are pasted into. */
function AddToSlack({
  agentId,
  agent,
  name,
  state,
}: {
  agentId: string
  agent: AgentSummary | undefined
  name: string
  state: SlackState
}) {
  const theme = useTheme()
  const { client } = useSession()
  const queryClient = useQueryClient()
  const [botToken, setBotToken] = useState("")
  const [signingSecret, setSigningSecret] = useState("")
  const [connecting, setConnecting] = useState(false)
  const filled = botToken.trim() !== "" && signingSecret.trim() !== ""

  const connect = async () => {
    if (!filled || connecting) return
    setConnecting(true)
    try {
      const next = await client.agent(agentId).connectSlack({ botToken, signingSecret })
      queryClient.setQueryData(keys.slack(agentId), next)
      haptic.done()
    } catch (error) {
      tell(`${name} could not be put in Slack`, errorText(error))
    } finally {
      setConnecting(false)
    }
  }

  return (
    <>
      <Section
        title="1. Create the Slack app"
        footer={`Slack's page opens already filled in for ${name}. Choose your workspace there and press Create.`}
      >
        <Row
          icon={["hash", SLACK]}
          title={`Create ${name}'s Slack app`}
          numberOfLines={2}
          tail={<Icon name="arrowUpRight" size={16} color={theme.ink3} weight="semibold" />}
          onPress={() => open(state.createUrl)}
        />
      </Section>
      <BotPicture agentId={agentId} agent={agent} name={name} />

      <Section title="2. Install it">
        <Row
          title={
            <Text variant="subhead">
              On the app's page in Slack, press{" "}
              <Text variant="subhead" weight="600">
                Install to Workspace
              </Text>
              . If Slack asks you to verify the address it sends events to, press Verify.
            </Text>
          }
        />
      </Section>

      <Section
        title="3. Paste what Slack gives you"
        footer="The bot token begins xoxb- and is under OAuth & Permissions. The signing secret is under Basic Information."
      >
        <Field
          accessibilityLabel="Bot token"
          placeholder="Bot token"
          value={botToken}
          onChangeText={setBotToken}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          style={{ fontFamily: mono, fontSize: 15 }}
        />
        <Field
          accessibilityLabel="Signing secret"
          placeholder="Signing secret"
          value={signingSecret}
          onChangeText={setSigningSecret}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
        />
        <Row
          title={connecting ? "Connecting…" : "Connect"}
          tone="tint"
          bold
          busy={connecting}
          disabled={!filled}
          onPress={() => void connect()}
        />
      </Section>

      {/* Slack's page already has it. It is here for an app that is set up by hand. */}
      <Text variant="caption" tone="ink2" selectable style={styles.events}>
        Slack sends what is said to{" "}
        <Text variant="caption" tone="ink2" style={{ fontFamily: mono }}>
          {state.eventsUrl}
        </Text>
      </Text>
    </>
  )
}

/** What the agent is in Slack: what it is called there, its picture, and what it does. */
function InSlack({
  agentId,
  agent,
  name,
  app,
}: {
  agentId: string
  agent: AgentSummary | undefined
  name: string
  app: SlackApp
}) {
  const { client } = useSession()
  const queryClient = useQueryClient()
  const [removing, setRemoving] = useState(false)
  const teamHost = hostOf(app.teamUrl)
  const teamUrl = app.teamUrl

  const remove = async () => {
    if (removing) return
    const sure = await confirm({
      title: `Remove ${name} from Slack?`,
      message: `@${app.bot} stops answering in ${app.team}.`,
      action: "Remove from Slack",
    })
    if (!sure) return
    setRemoving(true)
    try {
      await client.agent(agentId).disconnectSlack()
      haptic.done()
    } catch (error) {
      tell(`${name} could not be removed from Slack`, errorText(error))
    } finally {
      setRemoving(false)
      void queryClient.invalidateQueries({ queryKey: keys.slack(agentId) })
    }
  }

  return (
    <>
      <Section
        footer={`Each thread it is spoken to in shows up on ${name}'s page, under From Slack.`}
      >
        <Row
          icon={["hash", SLACK]}
          title={`@${app.bot}`}
          bold
          subtitle={teamHost === undefined ? app.team : `${app.team} · ${teamHost}`}
          tail={<Pill label="In Slack" tone="good" />}
          accessibilityLabel={`@${app.bot}, in Slack: ${app.team}`}
          onPress={teamUrl === null || teamHost === undefined ? undefined : () => open(teamUrl)}
        />
      </Section>

      <BotPicture agentId={agentId} agent={agent} name={name} title="Its picture" />

      <Section title="What it does there">
        <Row
          title="Works for everyone in the Slack workspace"
          numberOfLines={2}
          subtitle={
            <Text variant="subhead" tone="ink2">
              Anyone there can mention {name} or write to it, and it works for them as it does for
              you here, with everything it knows and can do.
            </Text>
          }
        />
        <Row
          title="Writes and reads on its own"
          numberOfLines={2}
          subtitle={
            <Text variant="subhead" tone="ink2" selectable>
              From any chat or automation, {name} can read the channels it has been added to and
              write in them, or to one person. Add it to a channel by typing{" "}
              <Text variant="footnote" tone="ink2" style={{ fontFamily: mono }}>
                /invite @{app.bot}
              </Text>{" "}
              there.
            </Text>
          }
        />
      </Section>

      <Section>
        <Row title="Remove from Slack" tone="red" busy={removing} onPress={() => void remove()} />
      </Section>
    </>
  )
}

const styles = StyleSheet.create({
  intro: { marginHorizontal: 32, marginBottom: 18 },
  events: { marginHorizontal: 32, marginBottom: 12 },
})
