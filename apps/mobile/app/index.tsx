import { Redirect } from "expo-router"
import { useAtomValue } from "jotai"
import { ActivityIndicator, View } from "react-native"
import { serverAtom, sessionFor } from "@/lib/session"
import { useTheme } from "@/lib/theme"

/** Where the app opens: straight to the chats when signed in, otherwise to connecting. */
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
          backgroundColor: theme.canvas,
        }}
      >
        <ActivityIndicator color={theme.muted} />
      </View>
    )
  }
  return <Redirect href={data ? "/(app)" : "/connect"} />
}
