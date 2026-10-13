import type { UserSettings } from "@do-computer/protocol"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ActivityIndicator } from "react-native"
import { keys } from "@/lib/queries"
import { useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import { Empty, errorText, haptic, Icon, Row, Screen, Section, tell } from "@/ui"

/** Choose the kind of computer a workspace is given when the person makes an agent in one. */
export default function DefaultComputer() {
  const theme = useTheme()
  const { client } = useSession()
  const queryClient = useQueryClient()
  const settings = useQuery({ queryKey: keys.settings, queryFn: () => client.settings() })
  const kinds = useQuery({
    queryKey: keys.computerKinds,
    queryFn: () => client.computerKinds(),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const save = useMutation({
    mutationFn: (kind: string) =>
      // Choosing the server's own default is choosing to follow it.
      client.updateSettings({
        defaultComputer: kind === settings.data?.deploymentDefaultComputer ? null : kind,
      }),
    onSuccess: (next) => {
      haptic.done()
      queryClient.setQueryData<UserSettings>(keys.settings, next)
    },
    onError: (error) => tell("That did not work", errorText(error)),
  })

  if (settings.data === undefined || kinds.data === undefined) {
    return (
      <Screen>
        {settings.isError || kinds.isError ? (
          <Empty title="The computers could not be read.">
            {errorText(settings.error ?? kinds.error)}
          </Empty>
        ) : (
          <ActivityIndicator style={{ marginTop: 40 }} />
        )}
      </Screen>
    )
  }

  // What was just picked is shown at once, until the server has answered either way.
  const shown = save.isPending
    ? save.variables
    : (settings.data.defaultComputer ?? settings.data.deploymentDefaultComputer)
  return (
    <Screen>
      <Section footer="The kind of computer a workspace is given when you make a Dood in one that has none the Dood could use. A workspace that already has a computer keeps it, and more are added under Computers.">
        {kinds.data.kinds.map((kind) => (
          <Row
            key={kind.id}
            title={kind.label}
            subtitle={
              kind.id === settings.data.deploymentDefaultComputer
                ? `${kind.description} This server’s default.`
                : kind.description
            }
            tail={
              kind.id === shown ? (
                <Icon name="check" size={17} color={theme.tint} weight="semibold" />
              ) : undefined
            }
            disabled={save.isPending}
            onPress={() => {
              haptic.tap()
              if (kind.id !== shown) save.mutate(kind.id)
            }}
          />
        ))}
      </Section>
    </Screen>
  )
}
