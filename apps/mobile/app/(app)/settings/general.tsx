import { useQuery } from "@tanstack/react-query"
import Constants from "expo-constants"
import { useRouter } from "expo-router"
import { useState } from "react"
import { Linking } from "react-native"
import { keys } from "@/lib/queries"
import { useSession } from "@/lib/use-session"
import { APPEARANCES, canSetAppearance, chosenAppearance, setAppearance } from "@/settings/appearance"
import { enablePush, sendTest, useNotificationsState } from "@/settings/notifications"
import { Choice, errorText, haptic, Row, Screen, Section, tell } from "@/ui"

/**
 * What is the person's own, whichever workspace or agent is on screen: how the app looks on
 * this phone, what a new agent starts with, and whether this phone is told when an agent has
 * something for them.
 */
export default function General() {
  const router = useRouter()
  const { client, server } = useSession()
  const [appearance, setChosen] = useState(chosenAppearance)
  const [notifications, refresh] = useNotificationsState()
  const [busy, setBusy] = useState<"allow" | "test">()
  const settings = useQuery({ queryKey: keys.settings, queryFn: () => client.settings() })
  const models = useQuery({
    queryKey: keys.models(),
    queryFn: () => client.models(),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const kinds = useQuery({
    queryKey: keys.computerKinds,
    queryFn: () => client.computerKinds(),
    staleTime: Number.POSITIVE_INFINITY,
  })

  const model = settings.data?.defaultModel ?? settings.data?.deploymentDefaultModel
  const computer = settings.data?.defaultComputer ?? settings.data?.deploymentDefaultComputer

  const allow = async (on: boolean) => {
    haptic.tap()
    // Only the system's Settings can take the permission back, or give it once it was refused.
    if (!on || notifications === "refused") return void Linking.openSettings()
    setBusy("allow")
    await enablePush(client)
    await refresh()
    setBusy(undefined)
  }

  const test = async () => {
    setBusy("test")
    try {
      await sendTest()
      haptic.done()
    } catch (error) {
      tell("The test could not be sent.", errorText(error))
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <Screen>
      {canSetAppearance ? (
        <Section footer="How Do Computer looks on this phone. System follows what the phone is set to.">
          <Row
            title="Appearance"
            value={
              <Choice
                label="Appearance"
                value={appearance}
                options={APPEARANCES}
                onChange={(choice) => {
                  haptic.tap()
                  setAppearance(choice)
                  setChosen(choice)
                }}
              />
            }
          />
        </Section>
      ) : null}

      <Section
        title="New Doods start with"
        footer="Doods you already have keep theirs. Change one in its own settings."
      >
        <Row
          title="Model"
          accessibilityLabel="Default model"
          busy={settings.data === undefined && !settings.isError}
          value={
            model === undefined
              ? undefined
              : (models.data?.find((entry) => entry.id === model)?.name ?? model.split("/").at(-1))
          }
          go
          onPress={() => router.push("/settings/default-model")}
        />
        {/* With one kind there is nothing to choose. */}
        {kinds.data !== undefined && kinds.data.kinds.length >= 2 ? (
          <Row
            title="Computer"
            accessibilityLabel="Default computer"
            value={kinds.data.kinds.find((kind) => kind.id === computer)?.label ?? computer}
            go
            onPress={() => router.push("/settings/default-computer")}
          />
        ) : null}
      </Section>

      <Section
        title="Notifications"
        footer={
          notifications === "unsupported"
            ? "Notifications come to the app on a phone."
            : notifications === "refused"
              ? "This phone was told not to allow notifications from Do Computer. Allow them in Settings, then come back."
              : "Hear from a Dood when it answers in a chat you do not have open, needs your OK, or reports on something it does on a schedule."
        }
      >
        <Row
          title="Allow notifications"
          busy={busy === "allow"}
          toggle={{
            value: notifications === "on",
            disabled: notifications === undefined || notifications === "unsupported" || busy !== undefined,
            onChange: (on) => void allow(on),
          }}
        />
        {notifications === "refused" ? (
          <Row title="Open Settings" tone="tint" onPress={() => void Linking.openSettings()} />
        ) : null}
        {notifications === "on" ? (
          <Row title="Send a test" tone="tint" busy={busy === "test"} onPress={() => void test()} />
        ) : null}
      </Section>

      <Section title="This phone">
        <Row title="Server" value={server.replace(/^https?:\/\//, "")} />
        <Row title="Version" value={Constants.expoConfig?.version ?? "Unknown"} />
      </Section>
    </Screen>
  )
}
