import type { UserSettings } from "@durable-computer/protocol"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { ComputerPicker } from "@/components/computer-picker"
import { ModelPicker } from "@/components/model-picker"
import { Button } from "@/components/ui/button"
import { client } from "@/lib/client"
import { computerKindsKey, modelsKey, settingsKey } from "@/lib/collections"
import { queryClient } from "@/lib/query"

function DefaultModel({ settings }: { settings: UserSettings }) {
  const { data: models } = useQuery({
    queryKey: modelsKey,
    queryFn: () => client.models(),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const save = useMutation({
    mutationFn: (defaultModel: string | null) => client.updateSettings({ defaultModel }),
    onSuccess: (next) => queryClient.setQueryData(settingsKey, next),
  })
  const shown = save.isPending ? save.variables : settings.defaultModel
  return (
    <section aria-labelledby="default-model" className="flex flex-col gap-3 border-t pt-6">
      <div>
        <h2 id="default-model" className="text-sm font-medium">
          Default model
        </h2>
        <p className="text-sm text-muted-foreground">
          The model a new agent starts on. Agents you already have keep theirs; change one on its
          own page.
        </p>
      </div>
      {models === undefined ? null : (
        <>
          <ModelPicker
            label="Default model"
            models={models}
            value={shown ?? settings.deploymentDefaultModel}
            onChange={(model) => save.mutate(model)}
          />
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            {shown !== null ? (
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
  )
}

function DefaultComputer({ settings }: { settings: UserSettings }) {
  const { data: computers } = useQuery({
    queryKey: computerKindsKey,
    queryFn: () => client.computerKinds(),
    staleTime: Number.POSITIVE_INFINITY,
  })
  // What was just picked, shown at once and until the server has answered either way.
  const [picked, setPicked] = useState<string>()
  const save = useMutation({
    mutationFn: (defaultComputer: string | null) => client.updateSettings({ defaultComputer }),
    onSuccess: (next) => queryClient.setQueryData(settingsKey, next),
    onSettled: () => setPicked(undefined),
  })
  // With one kind there is nothing to choose.
  if (computers === undefined || computers.kinds.length < 2) return null
  return (
    <section aria-labelledby="default-computer" className="flex flex-col gap-3 border-t pt-6">
      <div>
        <h2 id="default-computer" className="text-sm font-medium">
          Default computer
        </h2>
        <p className="text-sm text-muted-foreground">
          The kind of computer a new agent gets, for its files and for running commands. Agents you
          already have keep theirs; move one on its own page.
        </p>
      </div>
      <ComputerPicker
        label="Default computer"
        kinds={computers.kinds}
        value={picked ?? settings.defaultComputer ?? settings.deploymentDefaultComputer}
        note={(kind) =>
          kind.id === settings.deploymentDefaultComputer ? "this server’s default" : undefined
        }
        // Choosing the server's own default is choosing to follow it.
        onChange={(kind) => {
          setPicked(kind)
          save.mutate(kind === settings.deploymentDefaultComputer ? null : kind)
        }}
      />
      {save.isSuccess && !save.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Saved
        </p>
      ) : null}
      {save.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {save.error.message}
        </p>
      ) : null}
    </section>
  )
}

/** Settings for the account, as opposed to for the agent on screen. */
export function DefaultsSettings() {
  const { data: settings } = useQuery<UserSettings>({
    queryKey: settingsKey,
    queryFn: () => client.settings(),
  })

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Settings</h2>
        <p className="text-sm text-muted-foreground">
          For your account. What one agent is like is set on that agent, under Identity and memory.
        </p>
      </div>
      {settings === undefined ? null : (
        <>
          <DefaultModel settings={settings} />
          <DefaultComputer settings={settings} />
        </>
      )}
    </div>
  )
}
