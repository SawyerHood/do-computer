import { Stack } from "expo-router"
import { ActivityIndicator } from "react-native"
import { useMe } from "@/lib/queries"
import { ModelsPage } from "@/models/pages"
import { DEPLOYMENT } from "@/models/words"
import { Empty, Screen } from "@/ui"

/**
 * What the deployment itself offers everyone's agents, for whoever looks after it: the same
 * sign-ins a workspace has, kept for all of them. Its providers and sign-in steps are the
 * workspace's own screens, under the name the server's sign-ins are kept by.
 */
export default function ServerModels() {
  const me = useMe()
  if (me.data?.admin === true) return <ModelsPage workspaceId={DEPLOYMENT.id} />
  return (
    <Screen>
      <Stack.Screen options={{ title: "Global models" }} />
      {me.data === undefined ? (
        <ActivityIndicator style={{ marginVertical: 32 }} />
      ) : (
        <Empty title="Global models">Only those who look after this server can change them.</Empty>
      )}
    </Screen>
  )
}
