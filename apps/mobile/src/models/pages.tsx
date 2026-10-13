import type { ModelLoginMethod, ModelOption, ModelProvider } from "@do-computer/protocol"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Stack, useRouter } from "expo-router"
import { useState } from "react"
import { ActivityIndicator, View } from "react-native"
import { useRefresh } from "@/computers/shared"
import { keys, useMe, useWorkspaces } from "@/lib/queries"
import { useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import { confirm, Empty, haptic, Pill, Row, Screen, Section, Text } from "@/ui"
import { DEPLOYMENT, offer, type Scope, short, signedInWords, whose } from "./words"

/** The name a scope's providers are cached under. */
export const providersKey = (scopeId: string) => keys.workspace(scopeId, "model-providers")

/**
 * Whose sign-ins a screen is about: the workspace in its address, or the server itself where
 * the address says `deployment`, as the server's own are kept. Undefined until it is known.
 */
export function useScope(workspaceId: string): Scope | undefined {
  const workspaces = useWorkspaces().data?.workspaces
  if (workspaceId === DEPLOYMENT.id) return DEPLOYMENT
  return workspaces?.find((workspace) => workspace.id === workspaceId)
}

/** The providers there are, and which of them the scope is signed in to. */
export function useProviders(scopeId: string) {
  const { client } = useSession()
  return useQuery<ModelProvider[]>({
    queryKey: providersKey(scopeId),
    queryFn: () => client.workspace(scopeId).modelProviders(),
  })
}

/** The deployment's own models, the ones nobody signed in for, and the providers they are through. */
function useOwnModels(scope: Scope | undefined) {
  const { client } = useSession()
  const server = scope?.kind === "deployment"
  const { data: models } = useQuery<ModelOption[]>({
    queryKey: keys.models(server ? undefined : scope?.id),
    // The deployment's own are among what anyone can choose, wherever they are.
    queryFn: () => client.models(server ? undefined : scope?.id),
    staleTime: Number.POSITIVE_INFINITY,
    enabled: scope !== undefined,
  })
  const own = (models ?? []).filter((model) => model.signIn === undefined)
  const through = [
    ...new Set(own.map((model) => model.provider).filter((name) => name !== undefined && name !== "")),
  ] as string[]
  return { loaded: models !== undefined, own, through }
}

/** A provider's mark, where a face would be: its first letter. */
function Mark({ name }: { name: string }) {
  const theme = useTheme()
  return (
    <View
      style={{
        width: 32,
        height: 32,
        borderRadius: 9,
        borderCurve: "continuous",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.fill,
      }}
    >
      <Text variant="subhead" weight="600" tone="ink2">
        {name.slice(0, 1)}
      </Text>
    </View>
  )
}

const provider = (workspaceId: string, providerId: string) =>
  `/settings/w/${encodeURIComponent(workspaceId)}/models/${encodeURIComponent(providerId)}`

/**
 * The models a workspace's agents can run on: the deployment's own, and those of the providers
 * the workspace is signed in to. With the server for a scope, the same for everyone's agents.
 */
export function ModelsPage({ workspaceId }: { workspaceId: string }) {
  const theme = useTheme()
  const router = useRouter()
  const me = useMe()
  const scope = useScope(workspaceId)
  const providers = useProviders(workspaceId)
  const { loaded, own, through } = useOwnModels(scope)
  const [more, setMore] = useState(false)
  const refresh = useRefresh(() => providers.refetch())
  const server = scope?.kind === "deployment"
  const title = workspaceId === DEPLOYMENT.id ? "Server models" : "Models"

  if (scope === undefined || providers.data === undefined) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        {providers.isError ? (
          <Empty title="The models did not load">{providers.error.message}</Empty>
        ) : (
          <ActivityIndicator style={{ marginVertical: 32 }} />
        )}
      </Screen>
    )
  }

  // With none set apart, as where there are only a few, all of them are shown.
  const any = providers.data.some((each) => each.featured)
  const first = providers.data.filter((each) => !any || each.featured || each.signedIn !== null)
  const rest = providers.data.filter((each) => !first.includes(each))
  const row = (each: ModelProvider) => (
    <Row
      key={each.id}
      lead={<Mark name={each.name} />}
      title={each.name}
      subtitle={
        each.signedIn === null
          ? offer(each, !server && through.includes(each.name))
          : signedInWords(each, me.data?.user.id ?? "")
      }
      tail={each.signedIn === null ? undefined : <Pill label="Signed in" tone="good" />}
      go
      onPress={() => router.push(provider(workspaceId, each.id))}
    />
  )

  return (
    <Screen {...refresh}>
      <Stack.Screen options={{ title }} />
      <Text variant="footnote" tone="ink2" style={{ marginHorizontal: 32, marginBottom: 18 }}>
        {server
          ? "What everyone's Doods can run on without signing in to anything. Sign the server in with a subscription or a key, and its models are offered to every workspace."
          : `What ${whose(scope)} Doods can run on. Sign in with a subscription or a key, and every Dood of the workspace can be set to its models.`}
      </Text>
      {loaded ? (
        <Section>
          <Row
            icon={["cpu", theme.blue]}
            title="Do Computer's models"
            subtitle={
              <Text variant="subhead" tone="ink2">
                {through.length === 0
                  ? "A built-in echo model that repeats what it is told: this deployment has no model key and is signed in to nothing."
                  : `${own.length} model${own.length === 1 ? "" : "s"} through ${through.join(" and ")}, ${
                      server ? "offered to everyone" : "paid for by this deployment. Always there"
                    }.`}
              </Text>
            }
          />
        </Section>
      ) : null}
      <Section
        title="Model providers"
        footer={`${
          server
            ? "A sign-in here is the server's: everyone's Doods can then be set to its models, and what they use counts against whoever signed in. Where the server's settings name the models it offers, a key gives only those of them; a subscription gives all of its own."
            : scope.kind === "team"
              ? `A sign-in belongs to the workspace: everyone in ${scope.name} can then set Doods to its models, and what the Doods use counts against whoever signed in.`
              : "A sign-in belongs to this workspace: your Doods here can then be set to its models."
        } Nobody is shown a key or a token again, and Doods never see one.`}
      >
        {first.map(row)}
        {more ? rest.map(row) : null}
        {rest.length === 0 ? null : (
          <Row
            title={more ? "Fewer" : `${rest.length} more`}
            tone="tint"
            onPress={() => {
              haptic.tap()
              setMore(!more)
            }}
          />
        )}
      </Section>
    </Screen>
  )
}

/**
 * One provider: how the scope is signed in to it, with the way out for those who may take it,
 * or the ways of signing in, each of which starts on a screen of its own.
 */
export function ProviderPage({ workspaceId, providerId }: { workspaceId: string; providerId: string }) {
  const theme = useTheme()
  const router = useRouter()
  const { client } = useSession()
  const queryClient = useQueryClient()
  const me = useMe()
  const scope = useScope(workspaceId)
  const providers = useProviders(workspaceId)
  const { through } = useOwnModels(scope)
  const found = providers.data?.find((each) => each.id === providerId)
  const signOut = useMutation({
    mutationFn: () => client.workspace(workspaceId).signOutOfModelProvider(providerId),
    onSuccess: (next) => {
      haptic.done()
      queryClient.setQueryData(providersKey(workspaceId), next)
      // What the scope's agents can run on has changed with it.
      void queryClient.invalidateQueries({ queryKey: ["models"] })
    },
  })

  if (scope === undefined || found === undefined) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "" }} />
        {providers.data === undefined || scope === undefined ? (
          <ActivityIndicator style={{ marginVertical: 32 }} />
        ) : (
          <Empty title="No such provider" />
        )}
      </Screen>
    )
  }

  const server = scope.kind === "deployment"
  const { signedIn } = found
  // Whoever signed in can sign out, since it is theirs, and so can an admin of the team.
  const maySignOut = scope.role !== "member" || signedIn?.byId === me.data?.user.id
  const ask = async () => {
    const agreed = await confirm({
      title: `Sign out of ${found.name}?`,
      message: server
        ? "Doods set to one of its models stop answering until they are set to another."
        : "A Dood set to one of its models stops answering until it is set to another.",
      action: "Sign out",
    })
    if (agreed) signOut.mutate()
  }
  const start = (method: ModelLoginMethod) =>
    router.push(`${provider(workspaceId, "sign-in")}?providerId=${encodeURIComponent(found.id)}&type=${method.type}`)
  const problem =
    signOut.error === null ? undefined : (
      <Text variant="footnote" tone="red" accessibilityRole="alert">
        {signOut.error.message}
      </Text>
    )

  return (
    <Screen>
      <Stack.Screen options={{ title: found.name }} />
      {signedIn !== null ? (
        <>
          <Section>
            <Row
              lead={<Mark name={found.name} />}
              title={found.name}
              subtitle={
                <Text variant="subhead" tone="ink2">
                  {signedInWords(found, me.data?.user.id ?? "")}
                </Text>
              }
              tail={<Pill label="Signed in" tone="good" />}
            />
          </Section>
          {maySignOut ? (
            <Section footer={problem}>
              <Row
                title="Sign out"
                tone="red"
                busy={signOut.isPending}
                accessibilityLabel={`Sign out of ${found.name}`}
                onPress={() => void ask()}
              />
            </Section>
          ) : null}
        </>
      ) : (
        <Section title="Sign in" footer={offer(found, !server && through.includes(found.name))}>
          {found.methods.map((method) =>
            method.type === "oauth" ? (
              <Row
                key="oauth"
                icon={["person", theme.blue]}
                title={`Sign in with ${short(method)}`}
                go
                onPress={() => start(method)}
              />
            ) : (
              <Row
                key="key"
                icon={["key", theme.amber]}
                title="Use a key"
                accessibilityLabel={`Use a key for ${found.name}`}
                go
                onPress={() => start(method)}
              />
            ),
          )}
        </Section>
      )}
    </Screen>
  )
}
