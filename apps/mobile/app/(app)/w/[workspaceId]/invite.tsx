import type { InviteResult } from "@do-computer/protocol"
import { useQueryClient } from "@tanstack/react-query"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useState } from "react"
import { View } from "react-native"
import { useWorkspaces } from "@/lib/queries"
import { useSession } from "@/lib/use-session"
import { invitationsKey } from "@/settings/team"
import { entered, INVITE_ROLES, InviteOutcome, WhoInput } from "@/settings/who"
import { Button, Empty, errorText, Field, haptic, HeaderItems, Screen, Section, Segmented, Text } from "@/ui"

/** Ask people to join a team, by email address or GitHub username. */
export default function Invite() {
  const { workspaceId } = useLocalSearchParams<{ workspaceId: string }>()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { client } = useSession()
  const workspace = useWorkspaces().data?.workspaces.find((each) => each.id === workspaceId)
  const [who, setWho] = useState<string[]>([])
  const [typed, setTyped] = useState("")
  const [role, setRole] = useState<"member" | "admin">("member")
  const [note, setNote] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string>()
  const [result, setResult] = useState<InviteResult>()
  const everyone = entered(who, typed)
  const close = () => router.dismiss()

  const send = async () => {
    setSending(true)
    setError(undefined)
    try {
      const sent = await client.workspace(workspaceId).invite({ who: everyone, role, note })
      await queryClient.invalidateQueries({ queryKey: invitationsKey(workspaceId) })
      haptic.done()
      setResult(sent)
    } catch (failure) {
      haptic.fail()
      setError(errorText(failure, "That did not work. Try again."))
    } finally {
      setSending(false)
    }
  }

  // Only a team's admins and its owner invite. The app does not lead a member here.
  if (workspace !== undefined && (workspace.kind !== "team" || workspace.role === "member")) {
    return (
      <Screen>
        <HeaderItems placement="left" items={[{ label: "Cancel", text: "Cancel", onPress: close }]} />
        <Empty title="Only a team’s admins can invite people." />
      </Screen>
    )
  }

  if (result !== undefined) {
    return (
      <Screen>
        <HeaderItems placement="left" items={[]} />
        <HeaderItems items={[{ label: "Done", text: "Done", prominent: true, onPress: close }]} />
        <Text variant="subhead" tone="ink2" style={{ marginHorizontal: 32, marginBottom: 18 }}>
          Each link works once, for seven days. It is only shown here, so copy any you need before
          closing.
        </Text>
        <InviteOutcome result={result} />
      </Screen>
    )
  }

  const sendWords =
    everyone.length <= 1 ? "Send invitation" : `Send ${everyone.length} invitations`
  return (
    <Screen>
      <HeaderItems placement="left" items={[{ label: "Cancel", text: "Cancel", onPress: close }]} />
      <Text variant="subhead" tone="ink2" style={{ marginHorizontal: 32, marginBottom: 18 }}>
        {workspace === undefined ? "" : `Invite people to ${workspace.name}. `}
        They will be able to use every agent here and read its chats.
      </Text>
      <Section footer="Anything without an @ in the middle is taken as a GitHub username. Separate people with a comma or Return.">
        <WhoInput who={who} onChange={setWho} typed={typed} onTyped={setTyped} label="Who to invite" autoFocus />
      </Section>
      <Section title="Add a note">
        <Field
          accessibilityLabel="Add a note"
          value={note}
          maxLength={500}
          placeholder="Optional. Goes with the invitation."
          onChangeText={setNote}
        />
      </Section>
      <Section title="Role">
        <View style={{ padding: 10 }}>
          <Segmented label="Role" value={role} options={INVITE_ROLES} onChange={setRole} />
        </View>
      </Section>
      {error === undefined ? null : (
        <Text variant="footnote" tone="red" accessibilityRole="alert" style={{ marginHorizontal: 32, marginBottom: 14 }}>
          {error}
        </Text>
      )}
      <Button
        title={sendWords}
        busy={sending}
        disabled={everyone.length === 0}
        onPress={() => void send()}
        style={{ marginHorizontal: 16 }}
      />
    </Screen>
  )
}
