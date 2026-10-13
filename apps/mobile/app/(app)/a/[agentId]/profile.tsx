import {
  type Avatar as AvatarSpec,
  AVATAR_COLORS,
  defaultAvatar,
  PAIRED_COMPUTER,
  randomId,
} from "@do-computer/protocol"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import { useEffect, useState } from "react"
import { ActivityIndicator, Pressable, View } from "react-native"
import { useAgentPage, useMoveAgent, useSaveAgent } from "@/agent/agent"
import { keys } from "@/lib/queries"
import { useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import {
  Button,
  Empty,
  errorText,
  Field,
  haptic,
  HeaderItems,
  Icon,
  Menu,
  Row,
  Screen,
  Section,
  tell,
  Text,
} from "@/ui"
import { Avatar } from "@/ui/avatar"

type Form = { name: string; tagline: string; avatar: AvatarSpec; soul: string }

const same = (a: Form, b: Form) =>
  a.name === b.name &&
  a.tagline === b.tagline &&
  a.soul === b.soul &&
  a.avatar.color === b.avatar.color &&
  a.avatar.seed === b.avatar.seed

/**
 * Who the agent is: its name and tagline, how it looks, how it talks, and which workspace it is
 * in. Deleting it is at the foot, and asks for its name to be typed, as the web app does.
 */
export default function AgentProfile() {
  const { agentId, delete: deleting } = useLocalSearchParams<{ agentId: string; delete?: string }>()
  const theme = useTheme()
  const { state, query, workspace, name } = useAgentPage(agentId)
  const { save, saving } = useSaveAgent(agentId)
  const move = useMoveAgent(agentId, state?.agent.name ?? "This Dood")
  const [form, setForm] = useState<Form>()

  const saved: Form | undefined =
    state === undefined
      ? undefined
      : {
          name: state.agent.name ?? "",
          tagline: state.agent.tagline ?? "",
          avatar: state.agent.avatar ?? defaultAvatar(state.agent.id),
          soul: state.soul,
        }
  const dirty = form !== undefined && saved !== undefined && !same(form, saved)
  // What is on the page follows the agent until something is changed here, as on the web.
  const shown = dirty ? form : saved
  useEffect(() => {
    if (!dirty && form !== undefined) setForm(undefined)
  }, [dirty, form])

  if (state === undefined || shown === undefined) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Profile" }} />
        {query.error ? (
          <Empty title="This Dood could not be loaded">{errorText(query.error)}</Empty>
        ) : (
          <ActivityIndicator style={{ marginTop: 80 }} />
        )}
      </Screen>
    )
  }

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm({ ...shown, [key]: value })
  const submit = async () => {
    const next = await save({
      ...(shown.name.trim() ? { name: shown.name.trim() } : {}),
      tagline: shown.tagline,
      avatar: shown.avatar,
      soul: shown.soul,
    })
    if (next !== undefined) setForm(undefined)
  }
  const agentName = state.agent.name ?? "This Dood"

  return (
    <Screen>
      <Stack.Screen options={{ title: "Profile" }} />
      <HeaderItems
        items={[
          {
            label: "Save changes",
            text: saving ? "Saving…" : "Save",
            prominent: true,
            disabled: !dirty || saving,
            onPress: () => void submit(),
          },
        ]}
      />

      <Section
        footer={`Who ${state.agent.name ?? "this Dood"} is: how it looks, how it talks, and which workspace it is in.`}
      >
        <Field
          label="Name"
          value={shown.name}
          maxLength={40}
          placeholder="Not named yet"
          onChangeText={(value) => set("name", value)}
        />
        <Field
          label="Tagline"
          value={shown.tagline}
          maxLength={120}
          onChangeText={(value) => set("tagline", value)}
        />
      </Section>

      <Section
        title="Look"
        footer="Its shape and face were not chosen: they grew from a roll of the dice. Pick its color, or roll again for a different creature."
      >
        <View style={{ alignItems: "center", paddingTop: 14, paddingBottom: 6 }}>
          <Avatar
            avatar={shown.avatar}
            seed={agentId}
            outfit={state.agent.outfit}
            hatched={state.agent.hatched}
            size={120}
          />
        </View>
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel="Color"
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: 10,
            paddingHorizontal: 16,
            paddingVertical: 12,
          }}
        >
          {AVATAR_COLORS.map((color) => {
            const chosen = shown.avatar.color === color.id
            return (
              <Pressable
                key={color.id}
                accessibilityRole="radio"
                accessibilityLabel={color.label}
                accessibilityState={{ selected: chosen, checked: chosen }}
                hitSlop={4}
                onPress={() => {
                  if (chosen) return
                  haptic.tap()
                  set("avatar", { ...shown.avatar, color: color.id })
                }}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 17,
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 2,
                  borderColor: chosen ? color.hex : "transparent",
                }}
              >
                <View
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 13,
                    backgroundColor: color.hex,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {chosen ? <Icon name="check" size={13} color="#fff" weight="bold" /> : null}
                </View>
              </Pressable>
            )
          })}
        </View>
        <Row
          title="Roll a new look"
          tone="tint"
          onPress={() => {
            haptic.tap()
            set("avatar", { ...shown.avatar, seed: randomId().slice(0, 12) })
          }}
        />
      </Section>

      <Section
        title="Personality"
        footer="How the Dood talks and behaves, written to it in the second person."
      >
        <Field
          accessibilityLabel="Personality"
          multiline
          value={shown.soul}
          maxLength={4000}
          placeholder="You are…"
          onChangeText={(value) => set("soul", value)}
        />
      </Section>

      {workspace === undefined ? null : (
        <Section
          title="Workspace"
          footer={
            workspace.kind === "team"
              ? `${agentName} is in ${workspace.name}: everyone there can use it and read its chats.`
              : `${agentName} is yours alone. Move it to a team to share it.`
          }
        >
          {!move.may ? (
            <Row title={<Text tone="ink2">Only an admin of the team can move it.</Text>} />
          ) : move.elsewhere.length === 0 ? (
            <Row
              numberOfLines={3}
              title={
                <Text tone="ink2">
                  Start a team with New team, from the list of Doods, to have somewhere to move it.
                </Text>
              }
            />
          ) : (
            <Menu
              title="Move to"
              items={move.elsewhere.map((to) => ({
                title: to.name,
                onPress: () => void move.moveTo(to),
              }))}
            >
              <View
                accessibilityLabel="Move to"
                style={{
                  minHeight: 50,
                  paddingHorizontal: 16,
                  flexDirection: "row",
                  alignItems: "center",
                }}
              >
                <Text tone="tint" style={{ flex: 1 }}>
                  {move.moving ? "Moving…" : "Move to…"}
                </Text>
                <Icon name="chevronDown" size={12} color={theme.ink3} weight="bold" />
              </View>
            </Menu>
          )}
        </Section>
      )}

      {/* A team's agent is everyone's, so deleting it is for the people who run the team. */}
      {workspace?.role === "member" ? null : (
        <DeleteAgent agentId={agentId} name={state.agent.name} open={deleting === "1"} />
      )}
    </Screen>
  )
}

/**
 * Deleting the agent for good. Its name has to be typed first; a computer that only it could
 * use goes with it unless they say to keep it.
 */
function DeleteAgent({
  agentId,
  name,
  open: openAtFirst,
}: {
  agentId: string
  name: string | null
  open: boolean
}) {
  const router = useRouter()
  const { client } = useSession()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(openAtFirst)
  const [typed, setTyped] = useState("")
  const [withComputers, setWithComputers] = useState(true)
  const [removing, setRemoving] = useState(false)
  const expected = name ?? "delete"
  const computers = useQuery({ queryKey: keys.computers, queryFn: () => client.listComputers() })
  const alone = (computers.data ?? []).filter(
    (computer) =>
      computer.kind !== PAIRED_COMPUTER &&
      computer.access === "chosen" &&
      computer.agentIds.length === 1 &&
      computer.agentIds[0] === agentId,
  )
  const names = alone.map((computer) => computer.name)
  const listed =
    names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`

  const remove = async () => {
    setRemoving(true)
    try {
      await client.deleteAgent(
        agentId,
        alone.length > 0 && !withComputers ? { keepComputers: true } : {},
      )
      haptic.done()
      void queryClient.invalidateQueries({ queryKey: keys.computers })
      await queryClient.invalidateQueries({ queryKey: keys.agents, exact: true })
      // Back to the list of agents first, so that no page of this one asks after it again.
      if (router.canDismiss()) router.dismissAll()
      else router.replace("/")
      queryClient.removeQueries({ queryKey: keys.of(agentId) })
    } catch (error) {
      haptic.fail()
      tell("It could not be deleted", errorText(error))
      setRemoving(false)
    }
  }

  return (
    <Section
      title="Delete this Dood"
      footer="Removes its memory, chats, schedules, skills and connectors, and disconnects it from every computer. Files in the library stay with the workspace. This cannot be undone."
    >
      {open ? null : <Row title="Delete Dood…" tone="red" onPress={() => setOpen(true)} />}
      {open ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
          <Text variant="subhead" tone="ink2">
            Type{" "}
            <Text variant="subhead" weight="600">
              {expected}
            </Text>{" "}
            to confirm
          </Text>
        </View>
      ) : null}
      {open ? (
        <Field
          accessibilityLabel={`Type ${expected} to confirm`}
          autoFocus={openAtFirst}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          placeholder={expected}
          value={typed}
          onChangeText={setTyped}
        />
      ) : null}
      {open && alone.length > 0 ? (
        <Row
          title={`Also delete ${listed}`}
          numberOfLines={2}
          subtitle={
            alone.length === 1
              ? "No other Dood can use this computer. Deleting it deletes everything on it."
              : "No other Dood can use these computers. Deleting them deletes everything on them."
          }
          toggle={{ value: withComputers, onChange: setWithComputers, disabled: removing }}
        />
      ) : null}
      {open ? (
        <View style={{ flexDirection: "row", gap: 10, padding: 12 }}>
          <Button
            title="Cancel"
            kind="grey"
            size="medium"
            disabled={removing}
            style={{ flex: 1 }}
            onPress={() => {
              setOpen(false)
              setTyped("")
            }}
          />
          <Button
            title={removing ? "Deleting…" : "Delete for good"}
            destructive
            size="medium"
            busy={removing}
            disabled={typed.trim() !== expected}
            style={{ flex: 1 }}
            onPress={() => void remove()}
          />
        </View>
      ) : null}
    </Section>
  )
}
