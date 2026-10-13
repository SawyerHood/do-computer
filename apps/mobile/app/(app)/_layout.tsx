import { ApiError } from "@do-computer/client"
import * as Notifications from "expo-notifications"
import { Redirect, Stack, useRouter } from "expo-router"
import { useEffect } from "react"
import { Platform } from "react-native"
import { notificationTarget } from "@/lib/push"
import { useFeed, useMe, useWorkspaces } from "@/lib/queries"
import { usePresence } from "@/lib/presence"
import { enablePush } from "@/settings/notifications"
import { useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"

/** A sheet that comes up from the bottom over what is behind it. */
const sheet = (detents: number[]) =>
  ({
    presentation: "formSheet",
    sheetAllowedDetents: detents,
    sheetGrabberVisible: true,
    sheetCornerRadius: 34,
    headerTransparent: false,
  }) as const

/**
 * The signed-in app: one stack of screens under the system's own bars. Screens that come up as
 * a sheet or over everything are named here, since how a screen arrives is the stack's to say;
 * everything else about a screen's bar is said by the screen itself.
 */
export default function AppLayout() {
  const theme = useTheme()
  const router = useRouter()
  const { client } = useSession()
  const me = useMe()
  const workspaces = useWorkspaces()
  useFeed(me.data?.user.id)
  usePresence(
    (workspaces.data?.workspaces ?? [])
      .filter((each) => each.kind === "team")
      .map((each) => each.id),
  )

  useEffect(() => {
    void enablePush(client)
  }, [client])

  // Tapping a notification opens the chat it is about.
  useEffect(() => {
    if (Platform.OS === "web") return
    const open = (data: unknown) => {
      const target = notificationTarget(data)
      if (target === undefined) return
      router.push(
        target.chatId === null ? `/a/${target.agentId}` : `/a/${target.agentId}/c/${target.chatId}`,
      )
    }
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) open(response.notification.request.content.data)
    })
    const subscription = Notifications.addNotificationResponseReceivedListener((response) =>
      open(response.notification.request.content.data),
    )
    return () => subscription.remove()
  }, [router])

  if (me.error instanceof ApiError && me.error.status === 401) return <Redirect href="/connect" />
  // Someone on the waiting list has an account and a creature, and nothing else yet.
  if (me.data?.waiting === true) return <Redirect href="/welcome" />

  return (
    <Stack
      screenOptions={{
        headerBackButtonDisplayMode: "minimal",
        headerShadowVisible: false,
        headerLargeTitleShadowVisible: false,
        // Since iOS 26 a bar has no background of its own: its buttons are glass over the page.
        headerTransparent: Platform.OS === "ios",
        headerTintColor: theme.ink,
        headerTitleStyle: { color: theme.ink },
        headerStyle: Platform.OS === "ios" ? undefined : { backgroundColor: theme.bg },
        contentStyle: { backgroundColor: theme.bg },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: "Doods",
          headerLargeTitle: true,
          contentStyle: { backgroundColor: theme.page },
        }}
      />
      <Stack.Screen name="settings" options={{ presentation: "modal", headerShown: false }} />
      <Stack.Screen name="new-team" options={{ presentation: "modal", title: "New team" }} />
      <Stack.Screen name="pair" options={{ presentation: "modal", title: "Connect a computer" }} />
      <Stack.Screen
        name="w/[workspaceId]/invite"
        options={{ presentation: "modal", title: "Invite people" }}
      />
      <Stack.Screen
        name="a/[agentId]/side-chats"
        options={{ ...sheet([0.55, 1]), title: "Side chats" }}
      />
      <Stack.Screen
        name="a/[agentId]/subagents"
        options={{ ...sheet([0.45, 1]), title: "Sub-agents" }}
      />
      <Stack.Screen
        name="a/[agentId]/box"
        options={{ presentation: "fullScreenModal", headerShown: false, animation: "fade" }}
      />
      <Stack.Screen
        name="a/[agentId]/library/share"
        options={{ ...sheet([0.65, 1]), title: "Share" }}
      />
      <Stack.Screen
        name="a/[agentId]/library/versions"
        options={{ ...sheet([0.5, 1]), title: "Versions" }}
      />
      <Stack.Screen
        name="a/[agentId]/library/pick"
        options={{ presentation: "modal", title: "From the library" }}
      />
      <Stack.Screen
        name="a/[agentId]/model-picker"
        options={{ presentation: "modal", title: "Model" }}
      />
      <Stack.Screen
        name="a/[agentId]/connectors/add"
        options={{ presentation: "modal", title: "Add a connector" }}
      />
    </Stack>
  )
}
