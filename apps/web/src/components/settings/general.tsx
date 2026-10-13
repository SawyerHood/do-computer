import type { UserSettings } from "@do-computer/protocol"
import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { Loads } from "@/components/loads"
import { FormPlaceholder } from "@/components/placeholders"
import { useEffect, useState } from "react"
import { ComputerPicker } from "@/components/computer-picker"
import { ModelPicker } from "@/components/model-picker"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { client } from "@/lib/client"
import { computerKindsKey, modelsKey, settingsKey } from "@/lib/collections"
import { queryClient } from "@/lib/query"
import { chosenTheme, setTheme, type ThemeChoice } from "@/lib/theme"

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
          The model a new Dood of yours starts on. Doods you already have keep theirs; change one in
          its own settings.
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
          The kind of computer a workspace is given when you make a Dood in one that has none the
          Dood could use. A workspace that already has a computer keeps it, and more are added under
          Computers.
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

const THEMES: readonly { id: ThemeChoice; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
]

/** Light or dark, or whichever the device is set to. Kept by this browser, not by the account. */
function Theme() {
  // What this browser has kept is only known once the page is in it.
  const [chosen, setChosen] = useState<ThemeChoice>()
  useEffect(() => setChosen(chosenTheme()), [])
  return (
    <section aria-labelledby="theme" className="flex flex-col gap-3 border-t pt-6">
      <div>
        <h2 id="theme" className="text-sm font-medium">
          Theme
        </h2>
        <p className="text-sm text-muted-foreground">
          How Do Computer looks in this browser. System follows what the device is set to.
        </p>
      </div>
      <ToggleGroup
        aria-label="Theme"
        variant="outline"
        value={chosen === undefined ? [] : [chosen]}
        // Pressing the one that is chosen leaves it chosen: there is always a theme.
        onValueChange={([next]) => {
          const theme = THEMES.find((entry) => entry.id === next)
          if (theme === undefined) return
          setTheme(theme.id)
          setChosen(theme.id)
        }}
      >
        {THEMES.map((theme) => (
          <ToggleGroupItem key={theme.id} value={theme.id} className="px-3.5">
            {theme.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </section>
  )
}

/** What is the user's own, whichever workspace or agent is on screen. */
export function GeneralSettings() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">General</h2>
        <p className="text-sm text-muted-foreground">
          Yours, whichever workspace you are in. What one Dood is like is set on that Dood, and what
          a workspace has is set on the workspace.
        </p>
      </div>
      <Theme />
      <Loads fallback={<FormPlaceholder fields={2} />}>
        <Defaults />
      </Loads>
    </div>
  )
}

/** The settings themselves, which wait for what the account has set. */
function Defaults() {
  const { data: settings } = useSuspenseQuery<UserSettings>({
    queryKey: settingsKey,
    queryFn: () => client.settings(),
  })
  return (
    <>
      <DefaultModel settings={settings} />
      <DefaultComputer settings={settings} />
    </>
  )
}
