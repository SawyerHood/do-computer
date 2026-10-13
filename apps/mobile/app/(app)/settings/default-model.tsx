import type { ModelOption, UserSettings } from "@do-computer/protocol"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ActivityIndicator } from "react-native"
import { keys } from "@/lib/queries"
import { useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import { Empty, errorText, haptic, Icon, Row, Screen, Section, tell } from "@/ui"

/** The models under the name of the service each is reached through, in the order they came. */
function byProvider(models: readonly ModelOption[]): [string, ModelOption[]][] {
  const groups = new Map<string, ModelOption[]>()
  for (const model of models) {
    const provider = model.provider ?? ""
    groups.set(provider, [...(groups.get(provider) ?? []), model])
  }
  return [...groups]
}

/** Choose the model a new agent of the person's starts on, or go back to the server's own. */
export default function DefaultModel() {
  const theme = useTheme()
  const { client } = useSession()
  const queryClient = useQueryClient()
  const settings = useQuery({ queryKey: keys.settings, queryFn: () => client.settings() })
  const models = useQuery({
    queryKey: keys.models(),
    queryFn: () => client.models(),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const save = useMutation({
    mutationFn: (defaultModel: string | null) => client.updateSettings({ defaultModel }),
    onSuccess: (next) => {
      haptic.done()
      queryClient.setQueryData<UserSettings>(keys.settings, next)
    },
    onError: (error) => tell("That did not work", errorText(error)),
  })

  if (settings.data === undefined || models.data === undefined) {
    return (
      <Screen>
        {settings.isError || models.isError ? (
          <Empty title="The models could not be read.">
            {errorText(settings.error ?? models.error)}
          </Empty>
        ) : (
          <ActivityIndicator style={{ marginTop: 40 }} />
        )}
      </Screen>
    )
  }

  // What was just picked is shown at once, until the server has answered either way.
  const chosen = save.isPending ? save.variables : settings.data.defaultModel
  const shown = chosen ?? settings.data.deploymentDefaultModel
  const tick = <Icon name="check" size={17} color={theme.tint} weight="semibold" />
  return (
    <Screen>
      <Section
        footer={
          chosen === null
            ? "This is the server’s default. Pick another to make it yours."
            : "The model a new Dood of yours starts on. Doods you already have keep theirs; change one in its own settings."
        }
      >
        <Row
          title="Use this server’s default"
          tone="tint"
          tail={chosen === null ? tick : undefined}
          disabled={save.isPending}
          onPress={() => {
            if (chosen !== null) save.mutate(null)
          }}
        />
      </Section>
      {byProvider(models.data).map(([provider, group]) => (
        <Section key={provider} title={provider === "" ? undefined : provider}>
          {group.map((model) => (
            <Row
              key={model.id}
              title={model.name}
              tail={model.id === shown ? tick : undefined}
              disabled={save.isPending}
              onPress={() => {
                haptic.tap()
                save.mutate(model.id)
              }}
            />
          ))}
        </Section>
      ))}
    </Screen>
  )
}
