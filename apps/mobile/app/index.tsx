import { Redirect } from "expo-router"
import { useAtomValue } from "jotai"
import { ActivityIndicator, View } from "react-native"
import { serverAtom, sessionFor } from "@/lib/session"
import { useTheme } from "@/lib/theme"

/** Where the app opens: straight to the agents when signed in, otherwise to signing in. */
export default function Gate() {
  const server = useAtomValue(serverAtom)
  if (server === null) return <Redirect href="/connect" />
  return <SignedInGate server={server} />
}

function SignedInGate({ server }: { server: string }) {
  const theme = useTheme()
  const { data, isPending } = sessionFor(server).auth.useSession()
  if (isPending) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.bg,
        }}
      >
        <ActivityIndicator color={theme.ink2} />
      </View>
    )
  }
  return <Redirect href={data ? "/(app)" : "/connect"} />
}
