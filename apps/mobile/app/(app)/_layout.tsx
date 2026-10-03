import { Tabs, useRouter } from "expo-router"
import * as Notifications from "expo-notifications"
import { useEffect } from "react"
import { Platform } from "react-native"
import { Icon } from "@/components/icons"
import { notificationTarget, registerForPush } from "@/lib/push"
import { setAgentId } from "@/lib/session"
import { useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"

/** The signed-in app: one tab per thing an agent has. */
export default function AppLayout() {
  const theme = useTheme()
  const router = useRouter()
  const { client } = useSession()

  useEffect(() => {
    void registerForPush(client)
  }, [client])

  // Tapping a notification opens the chat it is about.
  useEffect(() => {
    if (Platform.OS === "web") return
    const open = (data: unknown) => {
      const target = notificationTarget(data)
      if (target === undefined) return
      setAgentId(target.agentId)
      if (target.chatId !== null) router.push(`/chat/${target.chatId}`)
    }
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) open(response.notification.request.content.data)
    })
    const subscription = Notifications.addNotificationResponseReceivedListener((response) =>
      open(response.notification.request.content.data),
    )
    return () => subscription.remove()
  }, [router])

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.ink,
        tabBarInactiveTintColor: theme.muted,
        tabBarStyle: { backgroundColor: theme.canvas, borderTopColor: theme.border },
        sceneStyle: { backgroundColor: theme.canvas },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Chats", tabBarIcon: ({ color }) => <Icon.chat color={color} /> }}
      />
      <Tabs.Screen
        name="automations"
        options={{ title: "Automations", tabBarIcon: ({ color }) => <Icon.clock color={color} /> }}
      />
      <Tabs.Screen
        name="skills"
        options={{ title: "Skills", tabBarIcon: ({ color }) => <Icon.bolt color={color} /> }}
      />
      <Tabs.Screen
        name="library"
        options={{ title: "Library", tabBarIcon: ({ color }) => <Icon.folder color={color} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: "You", tabBarIcon: ({ color }) => <Icon.person color={color} /> }}
      />
    </Tabs>
  )
}
