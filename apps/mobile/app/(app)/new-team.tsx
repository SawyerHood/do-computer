import { type InviteResult, personalWorkspaceId, WORKSPACE_COLORS } from "@durable-computer/protocol"
import { useQueryClient } from "@tanstack/react-query"
import { Stack, useRouter } from "expo-router"
import { useState } from "react"
import { Pressable, TextInput, View } from "react-native"
import { keys, useAgents, useMe } from "@/lib/queries"
import { useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import { entered, INVITE_ROLES, InviteOutcome, WhoInput } from "@/settings/who"
import { Button, Choice, errorText, Field, haptic, HeaderItems, Icon, Row, Screen, Section, Text, Tile } from "@/ui"
import { Avatar } from "@/ui/avatar"

/** Start a team: name it, optionally bring agents of your own along, and ask people to join. */
export default function NewTeam() {
  const theme = useTheme()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { client } = useSession()
  const me = useMe()
  const agents = useAgents()
  const [name, setName] = useState("")
  const [color, setColor] = useState<string>(WORKSPACE_COLORS[0].id)
  const [moving, setMoving] = useState<string[]>([])
  const [who, setWho] = useState<string[]>([])
  const [typed, setTyped] = useState("")
  const [note, setNote] = useState("")
  const [role, setRole] = useState<"member" | "admin">("member")
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string>()
  // Once the team exists: what came of the invitations.
  const [made, setMade] = useState<InviteResult>()

  const userId = me.data?.user.id
  const mine =
    userId === undefined
      ? []
      : (agents.data ?? []).filter((agent) => agent.workspaceId === personalWorkspaceId(userId))
  const hex = WORKSPACE_COLORS.find((option) => option.id === color)?.hex ?? WORKSPACE_COLORS[0].hex
  const close = () => router.dismiss()

  const create = async () => {
    setCreating(true)
    setError(undefined)
    try {
      const invite = entered(who, typed)
      const trimmed = note.trim()
      const { invited } = await client.createWorkspace({
        name,
        color,
        agentIds: moving,
        ...(invite.length > 0
          ? { invite: { who: invite, role, ...(trimmed === "" ? {} : { note: trimmed }) } }
          : {}),
      })
      void queryClient.invalidateQueries({ queryKey: keys.workspaces, exact: true })
      void queryClient.invalidateQueries({ queryKey: keys.agents, exact: true })
      haptic.done()
      // Back to the list of agents, where the team now has a section of its own.
      if (invited === undefined) close()
      else setMade(invited)
    } catch (failure) {
      haptic.fail()
      setError(errorText(failure, "That did not work. Try again."))
    } finally {
      setCreating(false)
    }
  }

  if (made !== undefined) {
    return (
      <Screen>
        <Stack.Screen options={{ title: `${name} is ready`, gestureEnabled: true }} />
        <HeaderItems placement="left" items={[]} />
        <HeaderItems items={[{ label: "Done", text: "Done", prominent: true, onPress: close }]} />
        <Text variant="subhead" tone="ink2" style={{ marginHorizontal: 32, marginBottom: 18 }}>
          Each link works once, for seven days. It is only shown here, so copy any you need before
          going on.
        </Text>
        <InviteOutcome result={made} />
        <Button title={`Go to ${name}`} onPress={close} style={{ marginHorizontal: 16 }} />
      </Screen>
    )
  }

  const ready = name.trim() !== "" && !creating
  return (
    <Screen>
      <HeaderItems placement="left" items={[{ label: "Cancel", text: "Cancel", onPress: close }]} />
      <HeaderItems
        items={[{ label: "Create", text: "Create", prominent: true, disabled: !ready, onPress: () => void create() }]}
      />
      <Section footer="A place for agents you share. Your own agents stay yours unless you move them.">
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, minHeight: 56 }}>
          <Tile name={name || "T"} color={hex} size={34} />
          <TextInput
            accessibilityLabel="Team name"
            value={name}
            maxLength={60}
            placeholder="Team name"
            placeholderTextColor={theme.ink3}
            selectionColor={theme.tint}
            autoFocus
            returnKeyType="done"
            onChangeText={setName}
            style={{ flex: 1, color: theme.ink, fontSize: 17, letterSpacing: -0.41, padding: 0, minHeight: 24 }}
          />
        </View>
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel="Color"
          style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 }}
        >
          {WORKSPACE_COLORS.map((option) => (
            <Pressable
              key={option.id}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ selected: color === option.id, checked: color === option.id }}
              hitSlop={4}
              onPress={() => {
                haptic.tap()
                setColor(option.id)
              }}
              style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: option.hex, alignItems: "center", justifyContent: "center" }}
            >
              {color === option.id ? <Icon name="check" size={16} color="#fff" weight="bold" /> : null}
            </Pressable>
          ))}
        </View>
      </Section>

      <Section
        title="Bring an agent along"
        footer="An agent moves with its chats, library and memory. The team will be able to read them."
      >
        {mine.map((agent) => (
          <Row
            key={agent.id}
            lead={
              <View style={{ width: 34, height: 34 }}>
                <Avatar avatar={agent.avatar} seed={agent.id} outfit={agent.outfit} size={34} hatched={agent.hatched} still />
              </View>
            }
            title={agent.name ?? "New agent"}
            accessibilityLabel={`Bring ${agent.name ?? "New agent"} along`}
            toggle={{
              value: moving.includes(agent.id),
              onChange: (on) =>
                setMoving(on ? [...moving, agent.id] : moving.filter((id) => id !== agent.id)),
            }}
          />
        ))}
      </Section>

      <Section title="Invite people" footer="You can also do this later.">
        <WhoInput who={who} onChange={setWho} typed={typed} onTyped={setTyped} label="Who to invite" />
        <Field
          accessibilityLabel="Add a note"
          value={note}
          maxLength={500}
          placeholder="Add a note. Optional."
          onChangeText={setNote}
        />
        <Row
          title="Role"
          value={<Choice label="Role" value={role} options={INVITE_ROLES} onChange={setRole} />}
        />
      </Section>

      {error === undefined ? null : (
        <Text variant="footnote" tone="red" accessibilityRole="alert" style={{ marginHorizontal: 32, marginBottom: 14 }}>
          {error}
        </Text>
      )}
      <Button
        title="Create team"
        busy={creating}
        disabled={name.trim() === ""}
        onPress={() => void create()}
        style={{ marginHorizontal: 16 }}
      />
    </Screen>
  )
}
