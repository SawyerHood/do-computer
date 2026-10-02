import type { UserSettings } from "@durable-computer/protocol"
import { ArrowLeftIcon } from "@phosphor-icons/react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { ModelPicker } from "@/components/model-picker"
import { Button } from "@/components/ui/button"
import { client } from "@/lib/client"
import { modelsKey, settingsKey } from "@/lib/collections"
import { queryClient } from "@/lib/query"

export const Route = createFileRoute("/_app/a/$agentId/settings")({ component: SettingsPage })

/** Settings for the account, as opposed to for the agent on screen. */
function SettingsPage() {
  const { agentId } = Route.useParams()
  const { data: settings } = useQuery<UserSettings>({
    queryKey: settingsKey,
    queryFn: () => client.settings(),
  })
  const { data: models } = useQuery({
    queryKey: modelsKey,
    queryFn: () => client.models(),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const save = useMutation({
    mutationFn: (defaultModel: string | null) => client.updateSettings({ defaultModel }),
    onSuccess: (next) => queryClient.setQueryData(settingsKey, next),
  })
  const shown = save.isPending ? save.variables : settings?.defaultModel
  const own = shown !== null && shown !== undefined

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 pt-16 pb-24 md:pt-10">
        <Link
          to="/a/$agentId"
          params={{ agentId }}
          className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon /> Back to chat
        </Link>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">
            For your account. What one agent is like is set on that agent, under Identity and
            memory.
          </p>
        </div>
        <section aria-labelledby="default-model" className="flex flex-col gap-3 border-t pt-6">
          <div>
            <h2 id="default-model" className="text-sm font-medium">
              Default model
            </h2>
            <p className="text-sm text-muted-foreground">
              The model a new agent starts on. Agents you already have keep theirs; change one on
              its own page.
            </p>
          </div>
          {settings === undefined || models === undefined ? null : (
            <>
              <ModelPicker
                label="Default model"
                models={models}
                value={shown ?? settings.deploymentDefaultModel}
                onChange={(model) => save.mutate(model)}
              />
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                {own ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={save.isPending}
                    onClick={() => save.mutate(null)}
                  >
                    Use this server’s default
                  </Button>
                ) : (
                  <span>This is the server’s default. Pick another to make it yours.</span>
                )}
                {save.isSuccess && !save.isPending ? <span role="status">Saved</span> : null}
              </div>
              {save.isError ? (
                <p role="alert" className="text-sm text-destructive">
                  {save.error.message}
                </p>
              ) : null}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
