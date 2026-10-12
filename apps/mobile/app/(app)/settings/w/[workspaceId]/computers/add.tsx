import { isPersonalWorkspace } from "@durable-computer/protocol"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import { useState } from "react"
import { ActivityIndicator, View } from "react-native"
import { canBeAdded, Problem, RadioRow, useComputerKinds } from "@/computers/shared"
import { keys, useWorkspaces } from "@/lib/queries"
import { mono } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import { Button, Empty, Field, haptic, Row, Screen, Section } from "@/ui"

/**
 * Adding a machine to the workspace: the app makes it at a provider, and every agent of the
 * workspace can work on it until someone says otherwise.
 */
export default function AddComputer() {
  const { workspaceId } = useLocalSearchParams<{ workspaceId: string }>()
  const router = useRouter()
  const { client } = useSession()
  const queryClient = useQueryClient()
  const kinds = useComputerKinds()
  const workspace = useWorkspaces().data?.workspaces.find((each) => each.id === workspaceId)
  const addable = (kinds.data?.kinds ?? []).filter(canBeAdded)
  const [picked, setPicked] = useState<string>()
  const [name, setName] = useState("")
  // The kind the deployment gives new agents, if it is one that can be added.
  const kind =
    picked ?? addable.find((entry) => entry.id === kinds.data?.default)?.id ?? addable[0]?.id
  const add = useMutation({
    mutationFn: () =>
      client.addComputer({
        kind: kind ?? "",
        // As when pairing: one's own workspace is meant by naming none.
        ...(isPersonalWorkspace(workspaceId) ? {} : { workspaceId }),
        ...(name.trim() ? { name: name.trim() } : {}),
      }),
    onSuccess: () => {
      haptic.done()
      // Opened by its address alone, there is nothing under it to go back to.
      if (router.canGoBack()) router.back()
      else router.replace(`/settings/w/${encodeURIComponent(workspaceId)}/computers`)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.computers }),
  })
  const only = addable[0]

  return (
    <Screen>
      <Stack.Screen options={{ title: "Add a computer" }} />
      {kinds.data === undefined ? (
        <ActivityIndicator style={{ marginVertical: 32 }} />
      ) : only === undefined ? (
        <Empty title="Nothing to add">This server makes no machines for a workspace.</Empty>
      ) : (
        <>
          <Section
            title="Kind of computer"
            footer="A machine made here for the workspace. Every agent in it can work there, each in a folder of its own, until you choose which ones may."
          >
            {addable.length > 1 ? (
              addable.map((entry) => (
                <RadioRow
                  key={entry.id}
                  title={entry.label}
                  subtitle={entry.description}
                  checked={entry.id === kind}
                  disabled={add.isPending}
                  onPress={() => setPicked(entry.id)}
                />
              ))
            ) : (
              <Row title={only.label} subtitle={only.description} />
            )}
          </Section>
          <Section footer={<Problem error={add.error} />}>
            <Field
              label="Name"
              placeholder="Left empty, it is given one"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!add.isPending}
              value={name}
              onChangeText={setName}
              returnKeyType="done"
              style={{ fontFamily: mono, letterSpacing: 0 }}
            />
            <Row
              title="For"
              value={
                workspace === undefined || workspace.kind === "personal" ? "You" : workspace.name
              }
            />
          </Section>
          <View style={{ marginHorizontal: 16 }}>
            <Button
              title={add.isPending ? "Adding…" : "Add computer"}
              busy={add.isPending}
              disabled={kind === undefined}
              onPress={() => add.mutate()}
            />
          </View>
        </>
      )}
    </Screen>
  )
}
